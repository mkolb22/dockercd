package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"
)

func newAppDesiredCmd() *cobra.Command {
	var serverAddr string

	cmd := &cobra.Command{
		Use:   "desired [name]",
		Short: "Show the rendered desired compose state for an application",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return runAppDesired(serverAddr, args[0])
		},
	}

	cmd.Flags().StringVarP(&serverAddr, "server", "s", "http://localhost:8080", "API server address")

	return cmd
}

func runAppDesired(serverAddr, name string) error {
	resp, err := apiRequest(http.MethodGet, serverAddr+"/api/v1/applications/"+name+"/desired", "", nil)
	if err != nil {
		return fmt.Errorf("connecting to server: %w", err)
	}
	defer resp.Body.Close()

	var rendered any
	if err := json.NewDecoder(resp.Body).Decode(&rendered); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(rendered)
}
