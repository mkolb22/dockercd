package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/mkolb22/dockercd/internal/app"
)

// maxWebhookBodySize is the maximum allowed webhook payload size (1 MiB).
const maxWebhookBodySize = 1 << 20

// HandleGitWebhook accepts GitHub/Gitea push events and triggers reconciliation
// for any application whose repo URL matches the pushed repository.
func (h *Handler) HandleGitWebhook(w http.ResponseWriter, r *http.Request) {
	// Limit body size to prevent unbounded reads from untrusted input.
	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBodySize)

	// Read body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "reading body: "+err.Error(), CodeBadRequest)
		return
	}

	if h.webhookSecret == "" {
		writeError(w, http.StatusServiceUnavailable, "webhook secret is not configured", CodeUnavailable)
		return
	}

	// Validate HMAC signature.
	sig := r.Header.Get("X-Hub-Signature-256")
	if sig == "" {
		// Gitea sends signature without the "sha256=" prefix in X-Gitea-Signature
		gitSig := r.Header.Get("X-Gitea-Signature")
		if gitSig != "" {
			sig = "sha256=" + gitSig
		}
	}
	if !validateHMAC(body, sig, h.webhookSecret) {
		writeError(w, http.StatusUnauthorized, "invalid signature", CodeBadRequest)
		return
	}

	// Parse push event to extract repo URL
	var payload struct {
		Repository struct {
			CloneURL string `json:"clone_url"`
			HTMLURL  string `json:"html_url"`
			SSHURL   string `json:"ssh_url"`
		} `json:"repository"`
		Ref string `json:"ref"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid payload: "+err.Error(), CodeBadRequest)
		return
	}

	repoURL := payload.Repository.CloneURL
	if repoURL == "" {
		repoURL = payload.Repository.HTMLURL
	}

	if repoURL == "" {
		writeError(w, http.StatusBadRequest, "no repository URL in payload", CodeBadRequest)
		return
	}

	// Find matching applications
	apps, err := h.store.ListApplications(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "listing apps: "+err.Error(), CodeInternalError)
		return
	}

	triggered := 0
	for _, appRec := range apps {
		var application app.Application
		if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
			continue
		}
		if matchesRepo(application.Spec.Source.RepoURL, repoURL) {
			h.reconciler.TriggerReconcile(appRec.Name)
			h.logger.Info("webhook triggered reconciliation", "app", appRec.Name, "repo", repoURL)
			triggered++
		}
	}

	writeJSON(w, http.StatusOK, WebhookResponse{
		Message:   "webhook processed",
		Triggered: triggered,
	})
}

// matchesRepo checks if two repo URLs refer to the same repository.
func matchesRepo(configuredURL, webhookURL string) bool {
	return normalizeRepoURL(configuredURL) == normalizeRepoURL(webhookURL)
}

// normalizeRepoURL strips protocol, auth, and .git suffix for comparison.
func normalizeRepoURL(u string) string {
	u = strings.TrimSpace(u)
	u = strings.TrimSuffix(u, ".git")
	// Strip protocol
	for _, prefix := range []string{"https://", "http://", "git@", "ssh://"} {
		u = strings.TrimPrefix(u, prefix)
	}
	// Strip auth (user:pass@)
	if idx := strings.Index(u, "@"); idx != -1 {
		u = u[idx+1:]
	}
	// Normalize git@ style (github.com:org/repo -> github.com/org/repo)
	u = strings.Replace(u, ":", "/", 1)
	u = strings.ToLower(u)
	return u
}

// validateHMAC validates the HMAC-SHA256 signature of a webhook payload.
// signature must be in the form "sha256=<hex>".
func validateHMAC(body []byte, signature, secret string) bool {
	if !strings.HasPrefix(signature, "sha256=") {
		return false
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := mac.Sum(nil)
	return hmac.Equal(sig, expected)
}
