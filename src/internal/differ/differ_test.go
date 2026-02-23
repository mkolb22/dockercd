package differ

import (
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
)

func TestDiff_AllInSync(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Environment: map[string]string{
				"FOO": "bar",
			},
			Ports: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Environment: map[string]string{
				"FOO":  "bar",
				"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
			},
			Ports: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("expected InSync=true, got false. Summary: %s", result.Summary)
		for _, u := range result.ToUpdate {
			for _, f := range u.Fields {
				t.Logf("  field diff: %s desired=%q live=%q", f.Field, f.Desired, f.Live)
			}
		}
	}
	if result.Summary != "All services in sync" {
		t.Errorf("unexpected summary: %q", result.Summary)
	}
}

func TestDiff_NewService(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "web", Image: "nginx:1.25"},
		{Name: "redis", Image: "redis:7"},
	}
	live := []app.ServiceState{
		{Name: "web", Image: "docker.io/library/nginx:1.25"},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToCreate) != 1 {
		t.Fatalf("expected 1 ToCreate, got %d", len(result.ToCreate))
	}
	if result.ToCreate[0].ServiceName != "redis" {
		t.Errorf("expected create redis, got %q", result.ToCreate[0].ServiceName)
	}
	if result.ToCreate[0].ChangeType != app.ChangeTypeCreate {
		t.Errorf("expected ChangeTypeCreate, got %q", result.ToCreate[0].ChangeType)
	}
	if result.ToCreate[0].DesiredState == nil {
		t.Error("expected DesiredState to be set on ToCreate")
	}
}

func TestDiff_RemovedService(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "web", Image: "nginx:1.25"},
	}
	live := []app.ServiceState{
		{Name: "web", Image: "docker.io/library/nginx:1.25"},
		{Name: "redis", Image: "redis:7"},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToRemove) != 1 {
		t.Fatalf("expected 1 ToRemove, got %d", len(result.ToRemove))
	}
	if result.ToRemove[0].ServiceName != "redis" {
		t.Errorf("expected remove redis, got %q", result.ToRemove[0].ServiceName)
	}
	if result.ToRemove[0].LiveState == nil {
		t.Error("expected LiveState to be set on ToRemove")
	}
}

func TestDiff_ImageChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "web", Image: "nginx:1.26"},
	}
	live := []app.ServiceState{
		{Name: "web", Image: "docker.io/library/nginx:1.25"},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToUpdate) != 1 {
		t.Fatalf("expected 1 ToUpdate, got %d", len(result.ToUpdate))
	}

	update := result.ToUpdate[0]
	if update.ServiceName != "web" {
		t.Errorf("expected update web, got %q", update.ServiceName)
	}

	var imageField *app.FieldDiff
	for i, f := range update.Fields {
		if f.Field == "image" {
			imageField = &update.Fields[i]
			break
		}
	}
	if imageField == nil {
		t.Fatal("expected image field diff")
	}
	if imageField.Desired != "nginx:1.26" {
		t.Errorf("expected desired 'nginx:1.26', got %q", imageField.Desired)
	}
}

func TestDiff_EnvironmentChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Environment: map[string]string{
				"FOO":  "baz", // changed
				"NEW":  "val", // added
				"SAME": "keep",
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Environment: map[string]string{
				"FOO":  "bar",  // different
				"OLD":  "gone", // removed
				"SAME": "keep",
				"PATH": "/bin", // Docker-injected, should be ignored
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToUpdate) != 1 {
		t.Fatalf("expected 1 ToUpdate, got %d", len(result.ToUpdate))
	}

	fields := result.ToUpdate[0].Fields
	fieldMap := make(map[string]app.FieldDiff)
	for _, f := range fields {
		fieldMap[f.Field] = f
	}

	// FOO should be changed
	if f, ok := fieldMap["environment.FOO"]; !ok {
		t.Error("expected diff for environment.FOO")
	} else if f.Desired != "baz" || f.Live != "bar" {
		t.Errorf("unexpected FOO diff: desired=%q live=%q", f.Desired, f.Live)
	}

	// NEW should be added
	if f, ok := fieldMap["environment.NEW"]; !ok {
		t.Error("expected diff for environment.NEW")
	} else if f.Desired != "val" || f.Live != "" {
		t.Errorf("unexpected NEW diff: desired=%q live=%q", f.Desired, f.Live)
	}

	// OLD should NOT be in diffs (live-only vars are inherited from image, not drift)
	if _, ok := fieldMap["environment.OLD"]; ok {
		t.Error("OLD should not appear in diffs (live-only, inherited from image)")
	}

	// SAME should not be in diffs
	if _, ok := fieldMap["environment.SAME"]; ok {
		t.Error("SAME should not appear in diffs (unchanged)")
	}

	// PATH should not be in diffs (Docker-injected)
	if _, ok := fieldMap["environment.PATH"]; ok {
		t.Error("PATH should not appear in diffs (Docker-injected)")
	}
}

func TestDiff_PortChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Ports: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
				{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Ports: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}

	var portField *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "ports" {
			portField = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if portField == nil {
		t.Fatal("expected ports field diff")
	}
}

func TestDiff_VolumeChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Volumes: []app.VolumeMount{
				{Source: "./data", Target: "/app/data"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Volumes: []app.VolumeMount{
				{Source: "./data", Target: "/app/data", ReadOnly: true},
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync — volume readOnly differs")
	}

	var volField *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "volumes" {
			volField = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if volField == nil {
		t.Fatal("expected volumes field diff")
	}
}

func TestDiff_NetworkChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:     "web",
			Image:    "nginx:1.25",
			Networks: []string{"frontend", "backend"},
		},
	}
	live := []app.ServiceState{
		{
			Name:     "web",
			Image:    "docker.io/library/nginx:1.25",
			Networks: []string{"frontend"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}

	var netField *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "networks" {
			netField = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if netField == nil {
		t.Fatal("expected networks field diff")
	}
}

func TestDiff_RestartPolicyChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:          "web",
			Image:         "nginx:1.25",
			RestartPolicy: "always",
		},
	}
	live := []app.ServiceState{
		{
			Name:          "web",
			Image:         "docker.io/library/nginx:1.25",
			RestartPolicy: "unless-stopped",
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}

	var field *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "restartPolicy" {
			field = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if field == nil {
		t.Fatal("expected restartPolicy field diff")
	}
	if field.Desired != "always" || field.Live != "unless-stopped" {
		t.Errorf("unexpected values: desired=%q live=%q", field.Desired, field.Live)
	}
}

func TestDiff_CommandChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:    "web",
			Image:   "nginx:1.25",
			Command: []string{"nginx", "-g", "daemon off;"},
		},
	}
	live := []app.ServiceState{
		{
			Name:    "web",
			Image:   "docker.io/library/nginx:1.25",
			Command: []string{"nginx"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}

	var field *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "command" {
			field = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if field == nil {
		t.Fatal("expected command field diff")
	}
}

func TestDiff_MultipleChangesOnOneService(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:          "web",
			Image:         "nginx:1.26",
			RestartPolicy: "always",
			Environment:   map[string]string{"ENV": "prod"},
		},
	}
	live := []app.ServiceState{
		{
			Name:          "web",
			Image:         "docker.io/library/nginx:1.25",
			RestartPolicy: "unless-stopped",
			Environment:   map[string]string{"ENV": "dev"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToUpdate) != 1 {
		t.Fatalf("expected 1 ToUpdate, got %d", len(result.ToUpdate))
	}

	// Should have 3 field diffs: image, environment.ENV, restartPolicy
	if len(result.ToUpdate[0].Fields) != 3 {
		t.Errorf("expected 3 field diffs, got %d", len(result.ToUpdate[0].Fields))
		for _, f := range result.ToUpdate[0].Fields {
			t.Logf("  field: %s desired=%q live=%q", f.Field, f.Desired, f.Live)
		}
	}
}

func TestDiff_MultipleServicesWithMixedChanges(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "web", Image: "nginx:1.26"},       // updated
		{Name: "redis", Image: "redis:7"},         // new
		{Name: "db", Image: "postgres:16"},        // unchanged
	}
	live := []app.ServiceState{
		{Name: "web", Image: "docker.io/library/nginx:1.25"},
		{Name: "db", Image: "docker.io/library/postgres:16"},
		{Name: "old-cache", Image: "memcached:1.6"},  // removed
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToCreate) != 1 {
		t.Errorf("expected 1 ToCreate, got %d", len(result.ToCreate))
	}
	if len(result.ToUpdate) != 1 {
		t.Errorf("expected 1 ToUpdate, got %d", len(result.ToUpdate))
	}
	if len(result.ToRemove) != 1 {
		t.Errorf("expected 1 ToRemove, got %d", len(result.ToRemove))
	}

	if result.ToCreate[0].ServiceName != "redis" {
		t.Errorf("expected create redis, got %q", result.ToCreate[0].ServiceName)
	}
	if result.ToUpdate[0].ServiceName != "web" {
		t.Errorf("expected update web, got %q", result.ToUpdate[0].ServiceName)
	}
	if result.ToRemove[0].ServiceName != "old-cache" {
		t.Errorf("expected remove old-cache, got %q", result.ToRemove[0].ServiceName)
	}
}

func TestDiff_BothEmpty(t *testing.T) {
	d := New()
	result := d.Diff(nil, nil)

	if !result.InSync {
		t.Error("both empty should be in sync")
	}
}

func TestDiff_EmptyDesired(t *testing.T) {
	live := []app.ServiceState{
		{Name: "web", Image: "nginx:1.25"},
	}

	d := New()
	result := d.Diff(nil, live)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToRemove) != 1 {
		t.Errorf("expected 1 ToRemove, got %d", len(result.ToRemove))
	}
}

func TestDiff_EmptyLive(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "web", Image: "nginx:1.25"},
	}

	d := New()
	result := d.Diff(desired, nil)

	if result.InSync {
		t.Error("should not be in sync")
	}
	if len(result.ToCreate) != 1 {
		t.Errorf("expected 1 ToCreate, got %d", len(result.ToCreate))
	}
}

func TestDiff_PortsOrderIndependent(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Ports: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
				{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Ports: []app.PortMapping{
				{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("ports in different order should still be in sync. Summary: %s", result.Summary)
	}
}

func TestDiff_VolumesOrderIndependent(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			Volumes: []app.VolumeMount{
				{Source: "./data", Target: "/data"},
				{Source: "./logs", Target: "/logs"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Volumes: []app.VolumeMount{
				{Source: "./logs", Target: "/logs"},
				{Source: "./data", Target: "/data"},
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("volumes in different order should still be in sync. Summary: %s", result.Summary)
	}
}

func TestDiff_NetworksOrderIndependent(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:     "web",
			Image:    "nginx:1.25",
			Networks: []string{"backend", "frontend"},
		},
	}
	live := []app.ServiceState{
		{
			Name:     "web",
			Image:    "docker.io/library/nginx:1.25",
			Networks: []string{"frontend", "backend"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Error("networks in different order should be in sync")
	}
}

func TestDiff_LabelChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:   "web",
			Image:  "nginx:1.25",
			Labels: map[string]string{"app": "web", "version": "2"},
		},
	}
	live := []app.ServiceState{
		{
			Name:   "web",
			Image:  "docker.io/library/nginx:1.25",
			Labels: map[string]string{"app": "web", "version": "1"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync — label changed")
	}

	var field *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "labels.version" {
			field = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if field == nil {
		t.Fatal("expected labels.version field diff")
	}
	if field.Desired != "2" || field.Live != "1" {
		t.Errorf("unexpected values: desired=%q live=%q", field.Desired, field.Live)
	}
}

func TestDiff_DockerInjectedVarsIgnored(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
			Environment: map[string]string{
				"PATH":     "/usr/local/bin:/usr/bin",
				"HOME":     "/root",
				"HOSTNAME": "abc123",
				"TERM":     "xterm",
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("Docker-injected vars should be ignored. Summary: %s", result.Summary)
		for _, u := range result.ToUpdate {
			for _, f := range u.Fields {
				t.Logf("  unexpected diff: %s", f.Field)
			}
		}
	}
}

func TestDiff_SortedOutput(t *testing.T) {
	desired := []app.ServiceSpec{
		{Name: "zeta", Image: "zeta:1"},
		{Name: "alpha", Image: "alpha:1"},
		{Name: "beta", Image: "beta:1"},
	}

	d := New()
	result := d.Diff(desired, nil)

	if len(result.ToCreate) != 3 {
		t.Fatalf("expected 3 ToCreate, got %d", len(result.ToCreate))
	}

	// Should be sorted alphabetically
	if result.ToCreate[0].ServiceName != "alpha" {
		t.Errorf("expected first service alpha, got %q", result.ToCreate[0].ServiceName)
	}
	if result.ToCreate[1].ServiceName != "beta" {
		t.Errorf("expected second service beta, got %q", result.ToCreate[1].ServiceName)
	}
	if result.ToCreate[2].ServiceName != "zeta" {
		t.Errorf("expected third service zeta, got %q", result.ToCreate[2].ServiceName)
	}
}

func TestDiff_EntrypointChange(t *testing.T) {
	desired := []app.ServiceSpec{
		{
			Name:       "web",
			Image:      "nginx:1.25",
			Entrypoint: []string{"/custom-entrypoint.sh"},
		},
	}
	live := []app.ServiceState{
		{
			Name:       "web",
			Image:      "docker.io/library/nginx:1.25",
			Entrypoint: []string{"/docker-entrypoint.sh"},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("should not be in sync — entrypoint differs")
	}

	var field *app.FieldDiff
	for i, f := range result.ToUpdate[0].Fields {
		if f.Field == "entrypoint" {
			field = &result.ToUpdate[0].Fields[i]
			break
		}
	}
	if field == nil {
		t.Fatal("expected entrypoint field diff")
	}
}

func TestDiff_ImageInheritedEnvVarsIgnored(t *testing.T) {
	// Env vars from the base image (e.g. NODE_VERSION, YARN_VERSION)
	// exist in live state but not in desired — should NOT be drift
	desired := []app.ServiceSpec{
		{
			Name:  "app",
			Image: "node:18",
			Environment: map[string]string{
				"NODE_ENV": "production",
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "app",
			Image: "docker.io/library/node:18",
			Environment: map[string]string{
				"NODE_ENV":     "production",
				"NODE_VERSION": "18.19.0",
				"YARN_VERSION": "1.22.19",
				"PATH":         "/usr/local/bin:/usr/bin",
				"HOME":         "/root",
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("image-inherited env vars should be ignored. Summary: %s", result.Summary)
		for _, u := range result.ToUpdate {
			for _, f := range u.Fields {
				t.Logf("  unexpected diff: %s desired=%q live=%q", f.Field, f.Desired, f.Live)
			}
		}
	}
}

func TestDiff_ExtraLivePortsIgnored(t *testing.T) {
	// Extra ports from EXPOSE directives in the image should not be drift
	desired := []app.ServiceSpec{
		{
			Name:  "app",
			Image: "node:18",
			Ports: []app.PortMapping{
				{HostPort: "3000", ContainerPort: "3000", Protocol: "tcp"},
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "app",
			Image: "docker.io/library/node:18",
			Ports: []app.PortMapping{
				{HostPort: "3000", ContainerPort: "3000", Protocol: "tcp"},
				{ContainerPort: "9229", Protocol: "tcp"}, // debug port from image EXPOSE
			},
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("extra live ports from EXPOSE should be ignored. Summary: %s", result.Summary)
	}
}

func TestDiff_IgnoreDriftLabel(t *testing.T) {
	// A service with the ignore-drift label should be excluded from diff
	// even if it has image changes.
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.26", // changed vs live
			Labels: map[string]string{
				IgnoreDriftLabel: "true",
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("service with ignore-drift label should be excluded from diff, but got: %s", result.Summary)
	}
	if len(result.ToUpdate) != 0 {
		t.Errorf("expected no updates for ignored service, got %d", len(result.ToUpdate))
	}
}

func TestDiff_IgnoreDriftOnlyAffectsLabeledServices(t *testing.T) {
	// Services without the label should still be diffed normally.
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.26", // changed — should be diffed
		},
		{
			Name:  "cache",
			Image: "redis:8", // changed — but ignored
			Labels: map[string]string{
				IgnoreDriftLabel: "true",
			},
		},
	}
	live := []app.ServiceState{
		{
			Name:  "web",
			Image: "docker.io/library/nginx:1.25",
		},
		{
			Name:  "cache",
			Image: "docker.io/library/redis:7",
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if result.InSync {
		t.Error("web service has changes and should not be in sync")
	}
	if len(result.ToUpdate) != 1 {
		t.Errorf("expected 1 update (web only), got %d", len(result.ToUpdate))
	}
	if result.ToUpdate[0].ServiceName != "web" {
		t.Errorf("expected update for web, got %q", result.ToUpdate[0].ServiceName)
	}
}

func TestDiff_EmptyRestartPolicyNotCompared(t *testing.T) {
	// When desired has no restart policy set, it shouldn't diff against live
	desired := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:1.25",
			// RestartPolicy intentionally empty
		},
	}
	live := []app.ServiceState{
		{
			Name:          "web",
			Image:         "docker.io/library/nginx:1.25",
			RestartPolicy: "always",
		},
	}

	d := New()
	result := d.Diff(desired, live)

	if !result.InSync {
		t.Errorf("empty desired restart policy should not produce diff. Summary: %s", result.Summary)
	}
}
