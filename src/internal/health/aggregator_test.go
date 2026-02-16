package health

import (
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
)

func TestAggregate_AllHealthy(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusHealthy},
		{Name: "api", Health: app.HealthStatusHealthy},
		{Name: "db", Health: app.HealthStatusHealthy},
	}

	result := Aggregate(services)
	if result != app.HealthStatusHealthy {
		t.Errorf("expected Healthy, got %s", result)
	}
}

func TestAggregate_OneDegraded(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusHealthy},
		{Name: "api", Health: app.HealthStatusDegraded},
		{Name: "db", Health: app.HealthStatusHealthy},
	}

	result := Aggregate(services)
	if result != app.HealthStatusDegraded {
		t.Errorf("expected Degraded, got %s", result)
	}
}

func TestAggregate_OneProgressing(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusHealthy},
		{Name: "api", Health: app.HealthStatusProgressing},
	}

	result := Aggregate(services)
	if result != app.HealthStatusProgressing {
		t.Errorf("expected Progressing, got %s", result)
	}
}

func TestAggregate_MixedWithUnknown(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusHealthy},
		{Name: "api", Health: app.HealthStatusDegraded},
		{Name: "db", Health: app.HealthStatusUnknown},
	}

	result := Aggregate(services)
	if result != app.HealthStatusUnknown {
		t.Errorf("expected Unknown (worst), got %s", result)
	}
}

func TestAggregate_Empty(t *testing.T) {
	result := Aggregate(nil)
	if result != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for empty, got %s", result)
	}
}

func TestAggregate_SingleService(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "solo", Health: app.HealthStatusProgressing},
	}

	result := Aggregate(services)
	if result != app.HealthStatusProgressing {
		t.Errorf("expected Progressing, got %s", result)
	}
}

func TestAggregate_AllDegraded(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusDegraded},
		{Name: "api", Health: app.HealthStatusDegraded},
	}

	result := Aggregate(services)
	if result != app.HealthStatusDegraded {
		t.Errorf("expected Degraded, got %s", result)
	}
}

func TestAggregate_AllUnknown(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusUnknown},
		{Name: "api", Health: app.HealthStatusUnknown},
	}

	result := Aggregate(services)
	if result != app.HealthStatusUnknown {
		t.Errorf("expected Unknown, got %s", result)
	}
}

func TestAggregate_ProgressingAndDegraded(t *testing.T) {
	services := []app.ServiceStatus{
		{Name: "web", Health: app.HealthStatusProgressing},
		{Name: "api", Health: app.HealthStatusDegraded},
	}

	result := Aggregate(services)
	if result != app.HealthStatusDegraded {
		t.Errorf("expected Degraded (worse than Progressing), got %s", result)
	}
}
