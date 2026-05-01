// Package cli defines the command-line interface for dockercd.
package cli

import (
	"io"
	"net/http"
	"os"
	"time"

	"github.com/spf13/cobra"
)

// apiClient is a shared HTTP client for CLI commands. Manual sync and rollback
// requests can run up to the application's syncTimeout, which defaults to five
// minutes, so the client timeout must be longer than short status calls.
var apiClient = &http.Client{Timeout: 10 * time.Minute}

var (
	version  = "dev"
	commit   = "unknown"
	apiToken string
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
	root.PersistentFlags().StringVar(&apiToken, "api-token", "", "API bearer token (defaults to DOCKERCD_API_TOKEN)")

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

func apiRequest(method, url, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	token := apiToken
	if token == "" {
		token = os.Getenv("DOCKERCD_API_TOKEN")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return apiClient.Do(req)
}
