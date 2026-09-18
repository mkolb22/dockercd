package cli

import (
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
)

func newAppAdoptCmd() *cobra.Command {
	var serverAddr string

	cmd := &cobra.Command{
		Use:   "adopt NAME",
		Short: "Adopt an existing live stack without re-deploying",
		Long:  "Snapshots the current live state of the application's containers and marks it as synced.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppAdopt(serverAddr, args[0])
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")

	return cmd
}

func runAppAdopt(serverAddr, name string) error {
	url := fmt.Sprintf("%s/api/v1/applications/%s/adopt", serverAddr, name)

	resp, err := apiRequest(http.MethodPost, url, "application/json", nil)
	if err != nil {
		return fmt.Errorf("adopt request failed: %w", err)
	}
	defer resp.Body.Close()

	if err := responseError(resp); err != nil {
		return err
	}

	var result map[string]interface{}
	if err := decodeResponse(resp.Body, &result); err != nil {
		return err
	}

	fmt.Printf("Application %q adopted (%v services)\n", name, result["services"])
	return nil
}
