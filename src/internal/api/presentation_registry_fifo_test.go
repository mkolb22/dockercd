//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package api

import (
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestLoadOpaquePresentationAuthenticatorFileRejectsFIFOWithoutBlocking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "presentation-credentials.fifo")
	if err := unix.Mkfifo(path, 0600); err != nil {
		t.Fatalf("creating FIFO: %v", err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := LoadOpaquePresentationAuthenticatorFile(path)
		result <- err
	}()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("expected FIFO registry to be rejected")
		}
	case <-time.After(time.Second):
		t.Fatal("loading FIFO registry blocked")
	}
}
