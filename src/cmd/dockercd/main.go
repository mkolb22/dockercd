package main

import (
	"fmt"
	"os"

	"github.com/mkolb22/dockercd/internal/cli"
)

var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	cli.SetVersion(version, commit)

	if err := cli.NewRootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
