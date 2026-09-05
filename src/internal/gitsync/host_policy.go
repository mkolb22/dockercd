package gitsync

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// HostPolicy restricts Git network operations to explicitly configured hosts.
// This is intentionally an allowlist rather than a denylist of private IPs:
// deployments commonly use an internal Git host, which must be an explicit
// administrative choice instead of an SSRF exception inferred from DNS.
type HostPolicy struct {
	allowed map[string]struct{}
}

// CheckRedirect is used by the Git HTTP transport. A remote is not allowed to
// turn a permitted initial URL into a request to a different host via HTTP
// redirects.
func (p *HostPolicy) CheckRedirect(req *http.Request, _ []*http.Request) error {
	if err := p.ValidateRepoURL(req.URL.String()); err != nil {
		return fmt.Errorf("Git redirect denied: %w", err)
	}
	return nil
}

func NewHostPolicy(hosts []string) (*HostPolicy, error) {
	policy := &HostPolicy{allowed: make(map[string]struct{}, len(hosts))}
	for _, host := range hosts {
		host = normalizeHost(host)
		if host == "" {
			continue
		}
		if strings.ContainsAny(host, "/:@") {
			return nil, fmt.Errorf("invalid allowed Git host %q", host)
		}
		policy.allowed[host] = struct{}{}
	}
	if len(policy.allowed) == 0 {
		return nil, fmt.Errorf("at least one allowed Git host is required")
	}
	return policy, nil
}

// ValidateRepoURL rejects non-network schemes, credential-bearing HTTP URLs,
// and every host that has not been explicitly authorized by the operator.
func (p *HostPolicy) ValidateRepoURL(repoURL string) error {
	host, err := repoHost(repoURL)
	if err != nil {
		return err
	}
	if _, ok := p.allowed[host]; !ok {
		return fmt.Errorf("Git host %q is not in the allowed-host policy", host)
	}
	return nil
}

func repoHost(repoURL string) (string, error) {
	if strings.HasPrefix(repoURL, "git@") {
		remainder := strings.TrimPrefix(repoURL, "git@")
		host, _, found := strings.Cut(remainder, ":")
		if !found || normalizeHost(host) == "" {
			return "", fmt.Errorf("invalid SSH repository URL")
		}
		return normalizeHost(host), nil
	}

	u, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("invalid repository URL: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "ssh" {
		return "", fmt.Errorf("repository scheme %q is not allowed", u.Scheme)
	}
	if u.Hostname() == "" {
		return "", fmt.Errorf("repository URL must include a hostname")
	}
	if u.User != nil && (u.Scheme != "ssh" || u.User.Username() == "" || passwordPresent(u)) {
		return "", fmt.Errorf("embedded repository credentials are not allowed")
	}
	return normalizeHost(u.Hostname()), nil
}

func passwordPresent(u *url.URL) bool {
	_, ok := u.User.Password()
	return ok
}

func normalizeHost(host string) string {
	return strings.ToLower(strings.TrimSpace(strings.Trim(host, "[]")))
}
