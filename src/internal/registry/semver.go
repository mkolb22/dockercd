package registry

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// SemVer represents a parsed semantic version.
type SemVer struct {
	Major      int
	Minor      int
	Patch      int
	Prerelease string
	Raw        string
}

// ParseSemVer parses a semver string like "1.26.0", "v1.26", "1.26.0-rc1".
func ParseSemVer(s string) (*SemVer, error) {
	raw := s
	s = strings.TrimPrefix(s, "v")

	parts := strings.SplitN(s, "-", 2)
	version := parts[0]
	prerelease := ""
	if len(parts) == 2 {
		prerelease = parts[1]
	}

	nums := strings.Split(version, ".")
	if len(nums) < 1 || len(nums) > 3 {
		return nil, fmt.Errorf("invalid semver: %s", raw)
	}

	sv := &SemVer{Raw: raw, Prerelease: prerelease}
	var err error

	sv.Major, err = strconv.Atoi(nums[0])
	if err != nil {
		return nil, fmt.Errorf("invalid major version: %s", raw)
	}

	if len(nums) >= 2 {
		sv.Minor, err = strconv.Atoi(nums[1])
		if err != nil {
			return nil, fmt.Errorf("invalid minor version: %s", raw)
		}
	}

	if len(nums) >= 3 {
		sv.Patch, err = strconv.Atoi(nums[2])
		if err != nil {
			return nil, fmt.Errorf("invalid patch version: %s", raw)
		}
	}

	return sv, nil
}

// Compare returns -1, 0, or 1 comparing v against other.
func (v *SemVer) Compare(other *SemVer) int {
	if v.Major != other.Major {
		if v.Major > other.Major {
			return 1
		}
		return -1
	}
	if v.Minor != other.Minor {
		if v.Minor > other.Minor {
			return 1
		}
		return -1
	}
	if v.Patch != other.Patch {
		if v.Patch > other.Patch {
			return 1
		}
		return -1
	}
	// Prerelease versions have lower precedence than release versions
	if v.Prerelease == "" && other.Prerelease != "" {
		return 1
	}
	if v.Prerelease != "" && other.Prerelease == "" {
		return -1
	}
	return 0
}

// ImagePolicy defines what tags are acceptable for auto-update.
type ImagePolicy string

const (
	// PolicySemver matches the latest semver tag across all versions.
	PolicySemver ImagePolicy = "semver"
	// PolicyMajor matches within the same major version.
	PolicyMajor ImagePolicy = "major"
	// PolicyMinor matches within the same major.minor version.
	PolicyMinor ImagePolicy = "minor"
)

// FindLatestTag finds the latest tag matching the policy constraint.
// currentTag is the currently deployed tag. Returns the new tag and true
// if an update is available, otherwise returns ("", false).
func FindLatestTag(tags []string, currentTag string, policy ImagePolicy) (string, bool) {
	current, err := ParseSemVer(currentTag)
	if err != nil {
		return "", false
	}

	var candidates []*SemVer
	for _, t := range tags {
		sv, err := ParseSemVer(t)
		if err != nil {
			continue
		}
		// Skip prereleases unless current is also a prerelease
		if sv.Prerelease != "" && current.Prerelease == "" {
			continue
		}

		switch policy {
		case PolicyMajor:
			if sv.Major != current.Major {
				continue
			}
		case PolicyMinor:
			if sv.Major != current.Major || sv.Minor != current.Minor {
				continue
			}
		case PolicySemver:
			// Accept any semver tag
		}

		if sv.Compare(current) > 0 {
			candidates = append(candidates, sv)
		}
	}

	if len(candidates) == 0 {
		return "", false
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Compare(candidates[j]) > 0
	})

	return candidates[0].Raw, true
}
