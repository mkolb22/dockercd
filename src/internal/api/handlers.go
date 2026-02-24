package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/events"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/reconciler"
	"github.com/mkolb22/dockercd/internal/store"
)

// Handler holds the HTTP handler methods.
type Handler struct {
	store         *store.SQLiteStore
	reconciler    reconciler.Reconciler
	inspector     inspector.StateInspector
	logger        *slog.Logger
	sseHub        eventbus.Broadcaster
	eventWatcher  *events.Watcher
	webhookSecret string
}

// Healthz is the liveness probe.
func (h *Handler) Healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(HealthResponse{Status: "ok"})
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
		_ = json.NewEncoder(w).Encode(ReadyResponse{Status: "ready", Checks: checks})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(ReadyResponse{Status: "not ready", Checks: checks})
	}
}

// maxRequestBody is the maximum allowed request body size (1 MB).
const maxRequestBody = 1 << 20

// CreateApplication registers a new application.
func (h *Handler) CreateApplication(w http.ResponseWriter, r *http.Request) {
	var application app.Application
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
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

// DeleteApplication removes an application.
func (h *Handler) DeleteApplication(w http.ResponseWriter, r *http.Request) {
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

	if err := h.store.DeleteApplication(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, "deleting application: "+err.Error(), CodeInternalError)
		return
	}

	h.logger.Info("application deleted via API", "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
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
// If the query parameter ?dryRun=true is set, it computes the diff without
// deploying and returns a DryRunResponse.
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

	// Dry-run mode: compute diff without deploying
	if r.URL.Query().Get("dryRun") == "true" {
		diff, headSHA, err := h.reconciler.DryRun(r.Context(), name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "dry-run failed: "+err.Error(), CodeInternalError)
			return
		}
		writeJSON(w, http.StatusOK, DryRunResponse{Diff: diff, HeadSHA: headSHA})
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

// GetSystemInfo returns Docker daemon system information.
func (h *Handler) GetSystemInfo(w http.ResponseWriter, r *http.Request) {
	if h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "inspector not available", CodeUnavailable)
		return
	}

	info, err := h.inspector.SystemInfo(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting system info: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, SystemInfoResponse{Host: info})
}

// GetHostStats returns aggregated resource usage across all running containers.
func (h *Handler) GetHostStats(w http.ResponseWriter, r *http.Request) {
	if h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "inspector not available", CodeUnavailable)
		return
	}

	stats, err := h.inspector.HostStats(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host stats: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, HostStatsResponse{Stats: stats})
}

// GetAppMetrics returns per-service resource metrics for an application.
func (h *Handler) GetAppMetrics(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	if h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "inspector not available", CodeUnavailable)
		return
	}

	appRec, err := h.store.GetApplication(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting application: "+err.Error(), CodeInternalError)
		return
	}
	if appRec == nil {
		writeError(w, http.StatusNotFound, "application not found: "+name, CodeNotFound)
		return
	}

	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		writeError(w, http.StatusInternalServerError, "parsing manifest: "+err.Error(), CodeInternalError)
		return
	}

	services, err := h.inspector.InspectWithMetrics(r.Context(), application.Spec.Destination)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "inspecting metrics: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, ListResponse[app.ServiceStatus]{
		Items: services,
		Total: len(services),
	})
}

// RollbackApplication re-deploys an application from a stored commit SHA snapshot.
func (h *Handler) RollbackApplication(w http.ResponseWriter, r *http.Request) {
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

	var req RollbackRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error(), CodeBadRequest)
		return
	}
	if req.TargetSHA == "" {
		writeError(w, http.StatusBadRequest, "targetSHA is required", CodeBadRequest)
		return
	}

	result, err := h.reconciler.Rollback(r.Context(), name, req.TargetSHA)
	if err != nil {
		if result != nil {
			writeJSON(w, http.StatusOK, result)
			return
		}
		writeError(w, http.StatusInternalServerError, "rollback failed: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// AdoptApplication snapshots the current live state of an application and marks
// it as synced, avoiding an unnecessary re-deployment.
func (h *Handler) AdoptApplication(w http.ResponseWriter, r *http.Request) {
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

	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		writeError(w, http.StatusInternalServerError, "parsing manifest: "+err.Error(), CodeInternalError)
		return
	}

	// Inspect live state
	liveStates, err := h.inspector.Inspect(r.Context(), application.Spec.Destination)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "inspecting live state: "+err.Error(), CodeInternalError)
		return
	}

	// Convert live state to a compose spec snapshot
	services := make([]app.ServiceSpec, 0, len(liveStates))
	for _, s := range liveStates {
		services = append(services, app.ServiceSpec{
			Name:          s.Name,
			Image:         s.Image,
			Environment:   s.Environment,
			Ports:         s.Ports,
			Volumes:       s.Volumes,
			Networks:      s.Networks,
			Labels:        s.Labels,
			RestartPolicy: s.RestartPolicy,
			Command:       s.Command,
			Entrypoint:    s.Entrypoint,
		})
	}
	composeSpec := &app.ComposeSpec{Services: services}
	specJSON, err := json.Marshal(composeSpec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "serializing compose spec: "+err.Error(), CodeInternalError)
		return
	}

	// Build service statuses for persisting
	serviceStatuses := make([]app.ServiceStatus, 0, len(liveStates))
	for _, s := range liveStates {
		serviceStatuses = append(serviceStatuses, app.ServiceStatus{
			Name:   s.Name,
			Image:  s.Image,
			Health: s.Health,
			State:  s.Status,
			Ports:  s.Ports,
		})
	}
	servicesJSON, _ := json.Marshal(serviceStatuses)

	// Record sync with operation=adopt
	now := time.Now()
	syncRec := &store.SyncRecord{
		AppName:         name,
		StartedAt:       now,
		FinishedAt:      &now,
		CommitSHA:       appRec.HeadSHA,
		Operation:       string(app.SyncOperationAdopt),
		Result:          string(app.SyncResultSuccess),
		ComposeSpecJSON: string(specJSON),
	}
	if err := h.store.RecordSync(r.Context(), syncRec); err != nil {
		writeError(w, http.StatusInternalServerError, "recording sync: "+err.Error(), CodeInternalError)
		return
	}

	// Mark application as synced
	_ = h.store.UpdateApplicationStatus(r.Context(), name, store.StatusUpdate{
		SyncStatus:   string(app.SyncStatusSynced),
		LastSyncTime: &now,
		ServicesJSON: string(servicesJSON),
		LastError:    " ",
	})

	h.logger.Info("application adopted", "name", name, "services", len(liveStates))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "adopted",
		"name":     name,
		"services": len(liveStates),
	})
}

// GetPollInterval returns the current global poll interval override.
func (h *Handler) GetPollInterval(w http.ResponseWriter, r *http.Request) {
	interval := h.reconciler.GetPollOverride()
	writeJSON(w, http.StatusOK, PollIntervalResponse{IntervalMs: int64(interval / time.Millisecond)})
}

// SetPollInterval sets the global poll interval override.
func (h *Handler) SetPollInterval(w http.ResponseWriter, r *http.Request) {
	var req PollIntervalRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", CodeBadRequest)
		return
	}
	if req.IntervalMs < 0 {
		writeError(w, http.StatusBadRequest, "intervalMs must be >= 0", CodeBadRequest)
		return
	}
	d := time.Duration(req.IntervalMs) * time.Millisecond
	if d > 0 && d < 30*time.Second {
		writeError(w, http.StatusBadRequest, "intervalMs must be >= 30000 (30s) or 0 to clear", CodeBadRequest)
		return
	}
	h.reconciler.SetPollOverride(d)
	writeJSON(w, http.StatusOK, PollIntervalResponse(req))
}

// StreamEvents sends Server-Sent Events for real-time updates.
func (h *Handler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported", CodeInternalError)
		return
	}

	if h.sseHub == nil {
		writeError(w, http.StatusServiceUnavailable, "event stream not available", CodeUnavailable)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch, unsub := h.sseHub.Subscribe()
	defer unsub()

	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, err := eventbus.MarshalEvent(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
			flusher.Flush()
		}
	}
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
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string, code string) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{Error: msg, Code: code})
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
