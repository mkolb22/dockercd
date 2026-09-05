package gitsync

import (
	"net/http"
	"net/url"
	"testing"
)

func TestHostPolicy_AllowsExactConfiguredHost(t *testing.T) {
	policy, err := NewHostPolicy([]string{"github.com", "gitea"})
	if err != nil {
		t.Fatalf("new policy: %v", err)
	}
	for _, repoURL := range []string{
		"https://github.com/org/repo.git",
		"ssh://git@github.com:22/org/repo.git",
		"git@gitea:org/repo.git",
	} {
		if err := policy.ValidateRepoURL(repoURL); err != nil {
			t.Errorf("expected %q to be allowed: %v", repoURL, err)
		}
	}
}

func TestHostPolicy_RejectsUntrustedOrCredentialBearingURL(t *testing.T) {
	policy, err := NewHostPolicy([]string{"github.com"})
	if err != nil {
		t.Fatalf("new policy: %v", err)
	}
	for _, repoURL := range []string{
		"https://attacker.example/repo.git",
		"https://user:password@github.com/org/repo.git",
		"file:///tmp/repo.git",
		"git@attacker.example:org/repo.git",
	} {
		if err := policy.ValidateRepoURL(repoURL); err == nil {
			t.Errorf("expected %q to be rejected", repoURL)
		}
	}
}

func TestHostPolicyRejectsRedirectToUntrustedHost(t *testing.T) {
	policy, err := NewHostPolicy([]string{"github.com"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := url.Parse("https://169.254.169.254/latest/meta-data")
	if err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckRedirect(&http.Request{URL: target}, nil); err == nil {
		t.Fatal("expected redirect to untrusted host to be denied")
	}
}
