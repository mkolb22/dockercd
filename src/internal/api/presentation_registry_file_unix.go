//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package api

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

// openPresentationCredentialRegistry uses O_NONBLOCK before descriptor
// validation so an accidental FIFO cannot stall controller startup. The caller
// still verifies the opened descriptor is a regular file, which protects
// against a path replacement between any preflight and open.
func openPresentationCredentialRegistry(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("opening presentation credential registry: %w", err)
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("opening presentation credential registry: invalid file descriptor")
	}
	return file, nil
}
