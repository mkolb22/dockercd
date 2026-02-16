package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/reconciler"
	"github.com/mkolb22/dockercd/internal/store"
)

// Handler holds the HTTP handler methods.
type Handler struct {
	store      *store.SQLiteStore
	reconciler reconciler.Reconciler
	logger     *slog.Logger
}

// Healthz is the liveness probe.
func (h *Handler) Healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(HealthResponse{Status: "ok"})
}

// Readyz is the readiness probe.
func (h *Handler) Readyz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	checks := map[string]string{}

	// Check database
	_, err := h.store.ListApplications(r.Context())
	if err != nil {
		checks["database"] = "error: " + err.Error()
	} else {
		checks["database"] = "ok"
	}

	allOk := true
	for _, v := range checks {
		if v != "ok" {
			allOk = false
			break
		}
	}

	if allOk {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(ReadyResponse{Status: "ready", Checks: checks})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(ReadyResponse{Status: "not ready", Checks: checks})
	}
}

// CreateApplication registers a new application.
func (h *Handler) CreateApplication(w http.ResponseWriter, r *http.Request) {
	var application app.Application
	if err := json.NewDecoder(r.Body).Decode(&application); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error(), CodeBadRequest)
		return
	}

	if application.Metadata.Name == "" {
		writeError(w, http.StatusBadRequest, "metadata.name is required", CodeBadRequest)
		return
	}

	// Check if already exists
	existing, err := h.store.GetApplication(r.Context(), application.Metadata.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "checking application: "+err.Error(), CodeInternalError)
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "application already exists: "+application.Metadata.Name, CodeConflict)
		return
	}

	manifestJSON, err := json.Marshal(application)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "serializing manifest: "+err.Error(), CodeInternalError)
		return
	}

	rec := &store.ApplicationRecord{
		Name:         application.Metadata.Name,
		Manifest:     string(manifestJSON),
		SyncStatus:   string(app.SyncStatusUnknown),
		HealthStatus: string(app.HealthStatusUnknown),
	}
	if err := h.store.CreateApplication(r.Context(), rec); err != nil {
		writeError(w, http.StatusInternalServerError, "creating application: "+err.Error(), CodeInternalError)
		return
	}

	h.logger.Info("application created via API", "name", application.Metadata.Name)

	resp, err := buildAppResponse(*rec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "building response: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusCreated, resp)
}

// ListApplications returns all applications.
func (h *Handler) ListApplications(w http.ResponseWriter, r *http.Request) {
	apps, err := h.store.ListApplications(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing applications: "+err.Error(), CodeInternalError)
		return
	}

	items := make([]ApplicationResponse, 0, len(apps))
	for _, a := range apps {
		resp, err := buildAppResponse(a)
		if err != nil {
			h.logger.Error("failed to build app response", "app", a.Name, "error", err)
			continue
		}
		items = append(items, resp)
	}

	writeJSON(w, http.StatusOK, ListResponse[ApplicationResponse]{
		Items: items,
		Total: len(items),
	})
}

// GetApplication returns a single application by name.
func (h *Handler) GetApplication(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	appRec, err := h.store.GetApplication(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting application: "+err.Error(), CodeInternalError)
		return
	}
	if appRec == nil {
		writeError(w, http.StatusNotFound, "application not found: "+name, CodeNotFound)
		return
	}

	resp, err := buildAppResponse(*appRec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "building response: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// SyncApplication triggers a manual sync for an application.
func (h *Handler) SyncApplication(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	// Verify app exists
	appRec, err := h.store.GetApplication(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting application: "+err.Error(), CodeInternalError)
		return
	}
	if appRec == nil {
		writeError(w, http.StatusNotFound, "application not found: "+name, CodeNotFound)
		return
	}

	// Trigger sync
	result, err := h.reconciler.ReconcileNow(r.Context(), name)
	if err != nil {
		// The result still contains useful info even on error
		if result != nil {
			writeJSON(w, http.StatusOK, result)
			return
		}
		writeError(w, http.StatusInternalServerError, "sync failed: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// DiffApplication computes and returns the current diff for an application.
func (h *Handler) DiffApplication(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	// Check recent sync history for the latest diff
	records, err := h.store.ListSyncHistory(r.Context(), name, 1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing sync history: "+err.Error(), CodeInternalError)
		return
	}

	if len(records) == 0 {
		// No sync history — return empty diff
		writeJSON(w, http.StatusOK, app.DiffResult{
			InSync:  true,
			Summary: "No sync history available",
		})
		return
	}

	// Parse stored diff JSON
	if records[0].DiffJSON != "" {
		var diff app.DiffResult
		if err := json.Unmarshal([]byte(records[0].DiffJSON), &diff); err == nil {
			writeJSON(w, http.StatusOK, diff)
			return
		}
	}

	// No diff data stored
	writeJSON(w, http.StatusOK, app.DiffResult{
		InSync:  true,
		Summary: "No diff data available",
	})
}

// GetEvents returns events for an application.
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	limit := queryInt(r, "limit", 50)

	events, err := h.store.ListEvents(r.Context(), name, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing events: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, ListResponse[store.EventRecord]{
		Items: events,
		Total: len(events),
	})
}

// GetHistory returns sync history for an application.
func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	limit := queryInt(r, "limit", 20)

	records, err := h.store.ListSyncHistory(r.Context(), name, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing sync history: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, ListResponse[store.SyncRecord]{
		Items: records,
		Total: len(records),
	})
}

// --- Helpers ---

func buildAppResponse(rec store.ApplicationRecord) (ApplicationResponse, error) {
	var application app.Application
	if err := json.Unmarshal([]byte(rec.Manifest), &application); err != nil {
		return ApplicationResponse{}, err
	}

	status := AppStatusResponse{
		SyncStatus:    rec.SyncStatus,
		HealthStatus:  rec.HealthStatus,
		LastSyncedSHA: rec.LastSyncedSHA,
		HeadSHA:       rec.HeadSHA,
		LastError:     strings.TrimSpace(rec.LastError),
	}
	if rec.LastSyncTime != nil {
		status.LastSyncTime = rec.LastSyncTime.Format(time.RFC3339)
	}

	// Parse services JSON if available
	if rec.ServicesJSON != "" {
		var services []app.ServiceStatus
		if err := json.Unmarshal([]byte(rec.ServicesJSON), &services); err == nil {
			status.Services = services
		}
	}

	return ApplicationResponse{
		Metadata: application.Metadata,
		Spec:     application.Spec,
		Status:   status,
	}, nil
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string, code string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{Error: msg, Code: code})
}

func queryInt(r *http.Request, key string, defaultVal int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return defaultVal
	}
	return n
}
