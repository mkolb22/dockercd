package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/mkolb22/dockercd/internal/app"
)

func newAppDiffCmd() *cobra.Command {
	var (
		serverAddr string
		outputJSON bool
	)

	cmd := &cobra.Command{
		Use:   "diff [name]",
		Short: "Show the current diff for an application",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return runAppDiff(serverAddr, args[0], outputJSON)
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")
	cmd.Flags().BoolVarP(&outputJSON, "json", "j", false, "Output as JSON")

	return cmd
}

func runAppDiff(serverAddr, name string, outputJSON bool) error {
	resp, err := apiClient.Get(serverAddr + "/api/v1/applications/" + name + "/diff")
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	var diff app.DiffResult
	if err := json.NewDecoder(resp.Body).Decode(&diff); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if outputJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(diff)
	}

	if diff.InSync {
		fmt.Println("In sync: no differences detected")
		if diff.Summary != "" {
			fmt.Printf("Note: %s\n", diff.Summary)
		}
		return nil
	}

	fmt.Printf("Summary: %s\n\n", diff.Summary)

	for _, s := range diff.ToCreate {
		fmt.Printf("+ CREATE service: %s\n", s.ServiceName)
	}
	for _, s := range diff.ToUpdate {
		fmt.Printf("~ UPDATE service: %s\n", s.ServiceName)
		for _, f := range s.Fields {
			fmt.Printf("    %s: %s -> %s\n", f.Field, f.Live, f.Desired)
		}
	}
	for _, s := range diff.ToRemove {
		fmt.Printf("- REMOVE service: %s\n", s.ServiceName)
	}

	return nil
}
