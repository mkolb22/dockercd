package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// CreateHost registers a new Docker host.
func (h *Handler) CreateHost(w http.ResponseWriter, r *http.Request) {
	var req CreateHostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error(), CodeBadRequest)
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required", CodeBadRequest)
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", CodeBadRequest)
		return
	}
	if !strings.HasPrefix(req.URL, "tcp://") && !strings.HasPrefix(req.URL, "unix://") {
		writeError(w, http.StatusBadRequest, "url must start with tcp:// or unix://", CodeBadRequest)
		return
	}

	// Check for duplicate name
	existing, err := h.store.GetDockerHost(r.Context(), req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "checking host: "+err.Error(), CodeInternalError)
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "host already exists: "+req.Name, CodeConflict)
		return
	}

	// Check for duplicate URL
	existingByURL, err := h.store.GetDockerHostByURL(r.Context(), req.URL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "checking host URL: "+err.Error(), CodeInternalError)
		return
	}
	if existingByURL != nil {
		writeError(w, http.StatusConflict, "host URL already registered: "+req.URL, CodeConflict)
		return
	}

	tlsVerify := true
	if req.TLSVerify != nil {
		tlsVerify = *req.TLSVerify
	}

	rec := &store.DockerHostRecord{
		Name:         req.Name,
		URL:          req.URL,
		TLSCertPath:  req.TLSCertPath,
		TLSVerify:    tlsVerify,
		HealthStatus: "Unknown",
	}
	if err := h.store.CreateDockerHost(r.Context(), rec); err != nil {
		writeError(w, http.StatusInternalServerError, "creating host: "+err.Error(), CodeInternalError)
		return
	}

	// Register TLS with the inspector if cert path is provided
	if h.inspector != nil && req.TLSCertPath != "" {
		h.inspector.RegisterTLS(req.URL, inspector.TLSConfig{
			CertPath: req.TLSCertPath,
			Verify:   tlsVerify,
		})
	}

	// Start watching events on the new host
	if h.eventWatcher != nil {
		h.eventWatcher.WatchHost(req.URL)
	}

	h.logger.Info("docker host registered", "name", req.Name, "url", req.URL)
	writeJSON(w, http.StatusCreated, buildHostResponse(*rec))
}

// ListHosts returns all registered Docker hosts.
func (h *Handler) ListHosts(w http.ResponseWriter, r *http.Request) {
	hosts, err := h.store.ListDockerHosts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing hosts: "+err.Error(), CodeInternalError)
		return
	}

	items := make([]DockerHostResponse, 0, len(hosts))
	for _, host := range hosts {
		items = append(items, buildHostResponse(host))
	}

	writeJSON(w, http.StatusOK, ListResponse[DockerHostResponse]{
		Items: items,
		Total: len(items),
	})
}

// GetHost returns a single Docker host by name.
func (h *Handler) GetHost(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	host, err := h.store.GetDockerHost(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host: "+err.Error(), CodeInternalError)
		return
	}
	if host == nil {
		writeError(w, http.StatusNotFound, "host not found: "+name, CodeNotFound)
		return
	}

	writeJSON(w, http.StatusOK, buildHostResponse(*host))
}

// DeleteHost removes a registered Docker host.
func (h *Handler) DeleteHost(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	host, err := h.store.GetDockerHost(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host: "+err.Error(), CodeInternalError)
		return
	}
	if host == nil {
		writeError(w, http.StatusNotFound, "host not found: "+name, CodeNotFound)
		return
	}

	// Unregister TLS and stop event watching
	if h.inspector != nil {
		h.inspector.UnregisterTLS(host.URL)
	}
	if h.eventWatcher != nil {
		h.eventWatcher.UnwatchHost(host.URL)
	}

	if err := h.store.DeleteDockerHost(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, "deleting host: "+err.Error(), CodeInternalError)
		return
	}

	h.logger.Info("docker host deleted", "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
}

// CheckHost probes a Docker host for connectivity and updates its status.
func (h *Handler) CheckHost(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	host, err := h.store.GetDockerHost(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host: "+err.Error(), CodeInternalError)
		return
	}
	if host == nil {
		writeError(w, http.StatusNotFound, "host not found: "+name, CodeNotFound)
		return
	}

	if h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "inspector not available", CodeUnavailable)
		return
	}

	now := time.Now()
	update := store.HostStatusUpdate{LastCheck: &now}

	// Try system info
	info, err := h.inspector.SystemInfo(r.Context(), host.URL)
	if err != nil {
		update.HealthStatus = "Unreachable"
		update.LastError = err.Error()
		_ = h.store.UpdateDockerHostStatus(r.Context(), name, update)

		host.HealthStatus = update.HealthStatus
		host.LastError = update.LastError
		host.LastCheck = &now
		writeJSON(w, http.StatusOK, buildHostResponse(*host))
		return
	}

	infoJSON, _ := json.Marshal(info)
	update.HealthStatus = "Healthy"
	update.InfoJSON = string(infoJSON)
	update.LastError = " " // clear previous error

	// Try host stats (best-effort)
	stats, err := h.inspector.HostStats(r.Context(), host.URL)
	if err == nil {
		statsJSON, _ := json.Marshal(stats)
		update.StatsJSON = string(statsJSON)
	}

	_ = h.store.UpdateDockerHostStatus(r.Context(), name, update)

	host.HealthStatus = "Healthy"
	host.LastCheck = &now
	host.LastError = ""
	host.InfoJSON = string(infoJSON)
	if stats != nil {
		statsJSON, _ := json.Marshal(stats)
		host.StatsJSON = string(statsJSON)
	}

	writeJSON(w, http.StatusOK, buildHostResponse(*host))
}

// GetHostLiveStats returns live resource stats for a Docker host.
func (h *Handler) GetHostLiveStats(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	host, err := h.store.GetDockerHost(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host: "+err.Error(), CodeInternalError)
		return
	}
	if host == nil {
		writeError(w, http.StatusNotFound, "host not found: "+name, CodeNotFound)
		return
	}

	if h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "inspector not available", CodeUnavailable)
		return
	}

	stats, err := h.inspector.HostStats(r.Context(), host.URL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "getting host stats: "+err.Error(), CodeInternalError)
		return
	}

	writeJSON(w, http.StatusOK, HostStatsResponse{Stats: stats})
}

// buildHostResponse converts a DockerHostRecord to a DockerHostResponse,
// parsing any stored JSON fields.
func buildHostResponse(rec store.DockerHostRecord) DockerHostResponse {
	resp := DockerHostResponse{
		Name:         rec.Name,
		URL:          rec.URL,
		TLSCertPath:  rec.TLSCertPath,
		TLSVerify:    rec.TLSVerify,
		HealthStatus: rec.HealthStatus,
		LastError:    strings.TrimSpace(rec.LastError),
		CreatedAt:    rec.CreatedAt.Format(time.RFC3339),
	}
	if rec.LastCheck != nil {
		resp.LastCheck = rec.LastCheck.Format(time.RFC3339)
	}
	if rec.InfoJSON != "" {
		var info app.DockerHostInfo
		if err := json.Unmarshal([]byte(rec.InfoJSON), &info); err == nil {
			resp.Info = &info
		}
	}
	if rec.StatsJSON != "" {
		var stats app.HostStats
		if err := json.Unmarshal([]byte(rec.StatsJSON), &stats); err == nil {
			resp.Stats = &stats
		}
	}
	return resp
}
