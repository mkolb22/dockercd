package health

import "github.com/mkolb22/dockercd/internal/app"

// Aggregate computes the application-level health status from individual
// service statuses using the worst-child-status rule.
//
// The severity order is: Healthy < Progressing < Degraded < Unknown.
// If there are no services, the result is Unknown.
func Aggregate(services []app.ServiceStatus) app.HealthStatus {
	if len(services) == 0 {
		return app.HealthStatusUnknown
	}

	worst := app.HealthStatusHealthy
	for _, s := range services {
		worst = app.WorstHealth(worst, s.Health)
	}
	return worst
}
