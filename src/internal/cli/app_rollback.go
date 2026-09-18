package cli

import (
	"fmt"
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

	resp, err := apiRequest(http.MethodPost, url, "application/json", strings.NewReader(body))
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	if err := responseError(resp); err != nil {
		return err
	}

	var result app.SyncResult
	if err := decodeResponse(resp.Body, &result); err != nil {
		return err
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

	return syncResultError("rollback", result)
}
