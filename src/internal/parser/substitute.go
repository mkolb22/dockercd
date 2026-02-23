package parser

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// loadDotEnv reads a .env file and returns the key-value pairs.
// Returns an empty map (not an error) if the file does not exist.
func loadDotEnv(path string) map[string]string {
	result := make(map[string]string)

	f, err := os.Open(path)
	if err != nil {
		return result
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments
		if line == "" || line[0] == '#' {
			continue
		}

		key, value := splitEnvVar(line)
		if key == "" {
			continue
		}

		// Strip surrounding quotes from value
		value = stripQuotes(value)
		result[key] = value
	}

	return result
}

// substituteVars replaces ${VAR}, ${VAR:-default}, ${VAR-default}, and
// ${VAR:?error} patterns in s using the provided variable map.
// Falls back to os.Getenv if the variable is not in vars.
func substituteVars(s string, vars map[string]string) string {
	var result strings.Builder
	i := 0
	for i < len(s) {
		// Look for ${ or $VARNAME
		if s[i] != '$' || i+1 >= len(s) {
			result.WriteByte(s[i])
			i++
			continue
		}

		if s[i+1] == '{' {
			// ${...} form
			end := strings.IndexByte(s[i+2:], '}')
			if end == -1 {
				// Unterminated — write literally
				result.WriteByte(s[i])
				i++
				continue
			}
			expr := s[i+2 : i+2+end]
			result.WriteString(resolveExpr(expr, vars))
			i = i + 2 + end + 1
		} else if isVarNameChar(s[i+1]) {
			// $VARNAME form (no braces)
			j := i + 1
			for j < len(s) && isVarNameChar(s[j]) {
				j++
			}
			varName := s[i+1 : j]
			result.WriteString(lookupVar(varName, vars))
			i = j
		} else {
			// $ followed by non-var char — write literally
			result.WriteByte(s[i])
			i++
		}
	}
	return result.String()
}

// resolveExpr handles the expression inside ${...}.
// Supports: VAR, VAR:-default, VAR-default, VAR:?error
func resolveExpr(expr string, vars map[string]string) string {
	// Check for :? (error if unset or empty)
	if idx := strings.Index(expr, ":?"); idx != -1 {
		varName := expr[:idx]
		errMsg := expr[idx+2:]
		val := lookupVar(varName, vars)
		if val == "" {
			// In Docker Compose, this produces an error. We return an error marker.
			return fmt.Sprintf("${%s:?%s}", varName, errMsg)
		}
		return val
	}

	// Check for :- (default if unset or empty)
	if idx := strings.Index(expr, ":-"); idx != -1 {
		varName := expr[:idx]
		defaultVal := expr[idx+2:]
		val := lookupVar(varName, vars)
		if val == "" {
			return defaultVal
		}
		return val
	}

	// Check for - (default if unset only, empty string is valid)
	if idx := strings.IndexByte(expr, '-'); idx != -1 {
		varName := expr[:idx]
		defaultVal := expr[idx+1:]
		if _, ok := vars[varName]; ok {
			return vars[varName]
		}
		if envVal, ok := os.LookupEnv(varName); ok {
			return envVal
		}
		return defaultVal
	}

	// Simple variable reference
	return lookupVar(expr, vars)
}

// lookupVar looks up a variable first in vars, then in the OS environment.
func lookupVar(name string, vars map[string]string) string {
	if val, ok := vars[name]; ok {
		return val
	}
	return os.Getenv(name)
}

// isVarNameChar returns true for characters valid in a bare $VAR reference.
func isVarNameChar(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'
}

// stripQuotes removes matching surrounding quotes (" or ') from a value.
func stripQuotes(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
