package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/spf13/cobra"

	"github.com/mkolb22/dockercd/internal/app"
)

func newAppRollbackCmd() *cobra.Command {
	var serverAddr string

	cmd := &cobra.Command{
		Use:   "rollback [name]",
		Short: "Rollback an application to a specific commit SHA",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sha, _ := cmd.Flags().GetString("sha")
			return runAppRollback(serverAddr, args[0], sha)
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")
	cmd.Flags().String("sha", "", "Target commit SHA to rollback to (required)")
	_ = cmd.MarkFlagRequired("sha")

	return cmd
}

func runAppRollback(serverAddr, name, sha string) error {
	body := fmt.Sprintf(`{"targetSHA":%q}`, sha)
	url := serverAddr + "/api/v1/applications/" + name + "/rollback"

	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("application %q not found", name)
	}
	if resp.StatusCode == http.StatusBadRequest {
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &errResp)
		return fmt.Errorf("bad request: %s", errResp.Error)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("rollback failed (HTTP %d): %s", resp.StatusCode, string(data))
	}

	var result app.SyncResult
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	fmt.Printf("Rollback result: %s\n", result.Result)
	if result.CommitSHA != "" {
		sha := result.CommitSHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		fmt.Printf("Commit:          %s\n", sha)
	}
	fmt.Printf("Duration:        %dms\n", result.DurationMs)

	if result.Error != "" {
		fmt.Printf("Error:           %s\n", result.Error)
	}

	return nil
}
