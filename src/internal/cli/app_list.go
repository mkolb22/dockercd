package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/mkolb22/dockercd/internal/api"
)

func newAppListCmd() *cobra.Command {
	var (
		serverAddr string
		outputJSON bool
	)

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List all applications",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runAppList(serverAddr, outputJSON)
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")
	cmd.Flags().BoolVarP(&outputJSON, "json", "j", false, "Output as JSON")

	return cmd
}

func runAppList(serverAddr string, outputJSON bool) error {
	resp, err := apiRequest(http.MethodGet, serverAddr+"/api/v1/applications", "", nil)
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	var result api.ListResponse[api.ApplicationResponse]
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if outputJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(result)
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tSYNC STATUS\tHEALTH\tLAST SYNC SHA")
	for _, app := range result.Items {
		sha := app.Status.LastSyncedSHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
			app.Metadata.Name,
			app.Status.SyncStatus,
			app.Status.HealthStatus,
			sha,
		)
	}
	w.Flush()

	return nil
}
