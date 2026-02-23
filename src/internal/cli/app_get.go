package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"github.com/mkolb22/dockercd/internal/api"
)

func newAppGetCmd() *cobra.Command {
	var serverAddr string

	cmd := &cobra.Command{
		Use:   "get [name]",
		Short: "Get application details",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return runAppGet(serverAddr, args[0])
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")

	return cmd
}

func runAppGet(serverAddr, name string) error {
	resp, err := http.Get(serverAddr + "/api/v1/applications/" + name)
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("application %q not found", name)
	}

	var result api.ApplicationResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	fmt.Printf("Name:         %s\n", result.Metadata.Name)
	fmt.Printf("Sync Status:  %s\n", result.Status.SyncStatus)
	fmt.Printf("Health:       %s\n", result.Status.HealthStatus)
	fmt.Printf("Repo:         %s\n", result.Spec.Source.RepoURL)
	fmt.Printf("Revision:     %s\n", result.Spec.Source.TargetRevision)
	fmt.Printf("Path:         %s\n", result.Spec.Source.Path)
	fmt.Printf("Project:      %s\n", result.Spec.Destination.ProjectName)
	if result.Status.LastSyncedSHA != "" {
		fmt.Printf("Last SHA:     %s\n", result.Status.LastSyncedSHA)
	}
	if result.Status.LastSyncTime != "" {
		fmt.Printf("Last Sync:    %s\n", result.Status.LastSyncTime)
	}
	if result.Status.LastError != "" {
		fmt.Printf("Error:        %s\n", result.Status.LastError)
	}

	if len(result.Status.Services) > 0 {
		fmt.Println("\nServices:")
		for _, svc := range result.Status.Services {
			fmt.Printf("  - %s (%s) [%s] %s\n", svc.Name, svc.Image, svc.Health, svc.State)
		}
	}

	// Also output JSON for programmatic consumption
	enc := json.NewEncoder(os.Stderr)
	enc.SetIndent("", "  ")

	return nil
}
