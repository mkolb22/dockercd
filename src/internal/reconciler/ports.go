package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/store"
)

// reservedPorts maps host ports that are reserved for dockercd infrastructure.
var reservedPorts = map[string]string{
	"8080": "dockercd",
}

// checkPortConflicts validates that the desired services' host ports don't
// conflict with reserved ports or ports used by other applications.
func checkPortConflicts(ctx context.Context, st *store.SQLiteStore, appName string, desiredServices []app.ServiceSpec) error {
	// Collect desired host ports → serviceName
	desired := make(map[string]string) // hostPort → serviceName
	for _, svc := range desiredServices {
		for _, p := range svc.Ports {
			if p.HostPort == "" {
				continue
			}
			desired[p.HostPort] = svc.Name
		}
	}

	if len(desired) == 0 {
		return nil
	}

	// Check against reserved ports (skip if this app owns the reserved port)
	// seen tracks (port, owner) pairs to avoid duplicate conflict messages.
	seen := make(map[string]bool)
	var conflicts []string
	addConflict := func(port, msg string) {
		key := port + "|" + msg
		if !seen[key] {
			seen[key] = true
			conflicts = append(conflicts, msg)
		}
	}

	for port, svcName := range desired {
		if owner, ok := reservedPorts[port]; ok && owner != appName {
			addConflict(port, fmt.Sprintf("port %s (service %s) is reserved for %s", port, svcName, owner))
		}
	}

	// Check against other applications' live ports
	apps, err := st.ListApplications(ctx)
	if err != nil {
		return fmt.Errorf("listing applications for port check: %w", err)
	}

	for _, appRec := range apps {
		if appRec.Name == appName {
			continue
		}
		if appRec.ServicesJSON == "" {
			continue
		}

		var services []app.ServiceStatus
		if err := json.Unmarshal([]byte(appRec.ServicesJSON), &services); err != nil {
			continue
		}

		for _, svc := range services {
			for _, p := range svc.Ports {
				if p.HostPort == "" {
					continue
				}
				if svcName, ok := desired[p.HostPort]; ok {
					addConflict(p.HostPort, fmt.Sprintf(
						"port %s (service %s) conflicts with app %q service %s",
						p.HostPort, svcName, appRec.Name, svc.Name,
					))
				}
			}
		}
	}

	if len(conflicts) > 0 {
		return fmt.Errorf("%s", strings.Join(conflicts, "; "))
	}
	return nil
}
