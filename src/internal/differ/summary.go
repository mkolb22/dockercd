package differ

import (
	"fmt"
	"strings"

	"github.com/mkolb22/dockercd/internal/app"
)

// buildSummary generates a human-readable summary of a DiffResult.
func buildSummary(diff *app.DiffResult) string {
	if diff.InSync {
		return "All services in sync"
	}

	var parts []string

	if n := len(diff.ToCreate); n > 0 {
		names := serviceNames(diff.ToCreate)
		parts = append(parts, fmt.Sprintf("%d to create (%s)", n, strings.Join(names, ", ")))
	}

	if n := len(diff.ToUpdate); n > 0 {
		names := serviceNamesWithFields(diff.ToUpdate)
		parts = append(parts, fmt.Sprintf("%d to update (%s)", n, strings.Join(names, "; ")))
	}

	if n := len(diff.ToRemove); n > 0 {
		names := serviceNames(diff.ToRemove)
		parts = append(parts, fmt.Sprintf("%d to remove (%s)", n, strings.Join(names, ", ")))
	}

	return strings.Join(parts, "; ")
}

// serviceNames extracts service names from diffs.
func serviceNames(diffs []app.ServiceDiff) []string {
	names := make([]string, len(diffs))
	for i, d := range diffs {
		names[i] = d.ServiceName
	}
	return names
}

// serviceNamesWithFields formats each update as "name: field1, field2".
func serviceNamesWithFields(diffs []app.ServiceDiff) []string {
	parts := make([]string, len(diffs))
	for i, d := range diffs {
		fields := make([]string, len(d.Fields))
		for j, f := range d.Fields {
			fields[j] = f.Field
		}
		parts[i] = fmt.Sprintf("%s: %s", d.ServiceName, strings.Join(fields, ", "))
	}
	return parts
}
