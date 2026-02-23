package app

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// Duration wraps time.Duration with YAML/JSON support for
// human-readable strings like "180s", "3m", "1h".
type Duration struct {
	time.Duration
}

func (d Duration) MarshalYAML() (interface{}, error) {
	return d.Duration.String(), nil
}

func (d *Duration) UnmarshalYAML(unmarshal func(interface{}) error) error {
	var s string
	if err := unmarshal(&s); err != nil {
		return fmt.Errorf("cannot parse duration: %w", err)
	}
	// YAML unmarshals bare integers (e.g., 60) as strings.
	// Try parsing as integer seconds first.
	if secs, err := strconv.ParseInt(s, 10, 64); err == nil {
		d.Duration = time.Duration(secs) * time.Second
		return nil
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	d.Duration = dur
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Duration.String())
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		// Try as number (seconds)
		var secs float64
		if err2 := json.Unmarshal(b, &secs); err2 != nil {
			return fmt.Errorf("cannot parse duration: %w", err)
		}
		d.Duration = time.Duration(secs * float64(time.Second))
		return nil
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	d.Duration = dur
	return nil
}

// NewDuration creates a Duration from time.Duration.
func NewDuration(d time.Duration) Duration {
	return Duration{Duration: d}
}
