package cli

import "github.com/spf13/cobra"

func newAppCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "Manage applications",
		Long:  "Commands for listing, inspecting, syncing, and diffing applications.",
	}

	cmd.AddCommand(
		newAppListCmd(),
		newAppGetCmd(),
		newAppSyncCmd(),
		newAppDiffCmd(),
		newAppRollbackCmd(),
		newAppAdoptCmd(),
	)

	return cmd
}
