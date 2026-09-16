package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestWebListenAddress(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "default", want: defaultListenAddress, valid: true},
		{name: "loopback", value: "127.0.0.1:8092", want: "127.0.0.1:8092", valid: true},
		{name: "container ipv4", value: "0.0.0.0:8092", want: "0.0.0.0:8092", valid: true},
		{name: "container ipv6", value: "[::]:8092", want: "[::]:8092", valid: true},
		{name: "named interface", value: "example.test:8092"},
		{name: "invalid port", value: "0.0.0.0:70000"},
		{name: "missing port", value: "0.0.0.0"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := webListenAddress(test.value)
			if (err == nil) != test.valid {
				t.Fatalf("webListenAddress(%q) error = %v, want valid %t", test.value, err, test.valid)
			}
			if got != test.want {
				t.Fatalf("webListenAddress(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestWebHandlerRequiresAnExplicitSecureLocalAuthConfiguration(t *testing.T) {
	fixture, mode, err := webHandlerFromEnvironment(func(string) string { return "" })
	if err != nil || fixture == nil || mode != "fixture mockup" {
		t.Fatalf("fixture configuration = handler:%v mode:%q error:%v", fixture != nil, mode, err)
	}

	secretPath := localAuthUsersFile(t)
	for _, values := range []map[string]string{
		{"DOCKERCD_WEB_AUTH_USERS_FILE": secretPath},
		{"DOCKERCD_WEB_AUTH_USERS_FILE": secretPath, "DOCKERCD_WEB_PUBLIC_ORIGIN": "http://console.example.test", "DOCKERCD_WEB_CONTROLLER_URL": "http://controller:8080"},
		{"DOCKERCD_WEB_AUTH_USERS_FILE": secretPath, "DOCKERCD_WEB_PUBLIC_ORIGIN": "https://console.example.test"},
	} {
		if handler, _, err := webHandlerFromEnvironment(func(key string) string { return values[key] }); err == nil || handler != nil {
			t.Fatalf("unsafe local auth configuration succeeded: %#v", values)
		}
	}

	handler, mode, err := webHandlerFromEnvironment(func(key string) string {
		return map[string]string{
			"DOCKERCD_WEB_AUTH_USERS_FILE": secretPath,
			"DOCKERCD_WEB_PUBLIC_ORIGIN":   "https://console.example.test",
			"DOCKERCD_WEB_CONTROLLER_URL":  "http://controller:8080",
		}[key]
	})
	if err != nil || handler == nil || mode != "local-auth presentation" {
		t.Fatalf("valid local auth configuration = handler:%v mode:%q error:%v", handler != nil, mode, err)
	}
}

func localAuthUsersFile(t *testing.T) string {
	t.Helper()
	salt := bytes.Repeat([]byte{0x22}, 16)
	digest := argon2.IDKey([]byte("test-password"), salt, 1, 32768, 1, 32)
	verifier := "$argon2id$v=19$m=32768,t=1,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(digest)
	path := filepath.Join(t.TempDir(), "users.json")
	registry := `{"version":1,"users":[{"subject":"operator","passwordHash":"` + verifier + `","controllerToken":"test-scoped-controller-token"}]}`
	if err := os.WriteFile(path, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
