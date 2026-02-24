// Package cli defines the command-line interface for dockercd.
package cli

import (
	"net/http"
	"time"

	"github.com/spf13/cobra"
)

// apiClient is a shared HTTP client for CLI commands with a sensible timeout.
var apiClient = &http.Client{Timeout: 30 * time.Second}

var (
	version = "dev"
	commit  = "unknown"
)

// SetVersion sets the version and commit for the CLI.
func SetVersion(v, c string) {
	version = v
	commit = c
}

// NewRootCmd creates the root cobra command.
func NewRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "dockercd",
		Short: "Docker Compose continuous deployment tool",
		Long:  "dockercd is a GitOps continuous deployment tool for Docker Compose environments.",
	}

	root.AddCommand(
		newServeCmd(),
		newAppCmd(),
		newVersionCmd(),
	)

	return root
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		Run: func(cmd *cobra.Command, _ []string) {
			cmd.Printf("dockercd %s (%s)\n", version, commit)
		},
	}
}
