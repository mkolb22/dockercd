package cli

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"

	"github.com/mkolb22/dockercd/internal/app"
)

func newAppSyncCmd() *cobra.Command {
	var serverAddr string

	cmd := &cobra.Command{
		Use:   "sync [name]",
		Short: "Trigger a manual sync for an application",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return runAppSync(serverAddr, args[0])
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")

	return cmd
}

func runAppSync(serverAddr, name string) error {
	resp, err := apiClient.Post(serverAddr+"/api/v1/applications/"+name+"/sync", "application/json", nil)
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("application %q not found", name)
	}

	var result app.SyncResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	fmt.Printf("Sync result: %s\n", result.Result)
	if result.CommitSHA != "" {
		sha := result.CommitSHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		fmt.Printf("Commit:      %s\n", sha)
	}
	fmt.Printf("Duration:    %dms\n", result.DurationMs)

	if result.Diff != nil && !result.Diff.InSync {
		fmt.Printf("Changes:     %s\n", result.Diff.Summary)
	}

	if result.Error != "" {
		fmt.Printf("Error:       %s\n", result.Error)
	}

	return nil
}
