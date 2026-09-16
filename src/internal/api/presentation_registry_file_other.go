//go:build !(darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris)

package api

import (
	"fmt"
	"os"
)

// Platforms without O_NONBLOCK support still validate the opened descriptor
// before decoding. DockerCD's supported controller targets use the Unix
// implementation above.
func openPresentationCredentialRegistry(path string) (*os.File, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening presentation credential registry: %w", err)
	}
	return file, nil
}
