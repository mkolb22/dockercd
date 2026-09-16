package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mkolb22/dockercd/web/internal/httpui"
	"github.com/mkolb22/dockercd/web/internal/localauth"
	"github.com/mkolb22/dockercd/web/internal/presentation"
)

// defaultListenAddress keeps local fixture review on loopback. The container
// image can opt into an unspecified in-container address for a reverse proxy;
// that does not publish a host port or add controller connectivity.
const defaultListenAddress = "127.0.0.1:8092"

func main() {
	listenAddress, err := webListenAddress(os.Getenv("DOCKERCD_WEB_LISTEN_ADDR"))
	if err != nil {
		log.Fatal(err)
	}
	handler, mode, err := webHandlerFromEnvironment(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr:              listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Printf("dockercd Web UI %s listening on http://%s", mode, listenAddress)
	log.Fatal(server.ListenAndServe())
}

// webHandlerFromEnvironment runs only the deliberately small first local
// identity path when a Compose secret mount is explicitly configured. An
// absent users file preserves fixture review and cannot accidentally obtain a
// controller credential from the process environment.
func webHandlerFromEnvironment(getenv func(string) string) (http.Handler, string, error) {
	usersFile := strings.TrimSpace(getenv("DOCKERCD_WEB_AUTH_USERS_FILE"))
	if usersFile == "" {
		return httpui.New(presentation.NewFixtureSource()), "fixture mockup", nil
	}
	if err := requireHTTPSOrigin(getenv("DOCKERCD_WEB_PUBLIC_ORIGIN")); err != nil {
		return nil, "", err
	}
	authenticator, err := localauth.New(localauth.Config{UsersFile: usersFile, CookieSecure: true})
	if err != nil {
		return nil, "", fmt.Errorf("configuring local Web UI authentication: %w", err)
	}
	controllerURL := strings.TrimSpace(getenv("DOCKERCD_WEB_CONTROLLER_URL"))
	if controllerURL == "" {
		return nil, "", fmt.Errorf("DOCKERCD_WEB_CONTROLLER_URL is required with local Web UI authentication")
	}
	provider, err := presentation.NewSessionSourceProvider(presentation.SessionSourceProviderConfig{
		Resolver: authenticator, ControllerURL: controllerURL,
		ControllerLabel: strings.TrimSpace(getenv("DOCKERCD_WEB_CONTROLLER_LABEL")),
		Environment:     strings.TrimSpace(getenv("DOCKERCD_WEB_ENVIRONMENT")),
	})
	if err != nil {
		return nil, "", fmt.Errorf("configuring scoped controller presentation: %w", err)
	}
	return httpui.NewWithSourceProviderAndAuthenticator(provider, authenticator), "local-auth presentation", nil
}

func requireHTTPSOrigin(value string) error {
	origin, err := url.Parse(strings.TrimSpace(value))
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" {
		return fmt.Errorf("DOCKERCD_WEB_PUBLIC_ORIGIN must be an https origin without credentials, path, query, or fragment")
	}
	return nil
}

func webListenAddress(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultListenAddress, nil
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return "", fmt.Errorf("invalid DOCKERCD_WEB_LISTEN_ADDR: %w", err)
	}
	parsedPort, err := strconv.Atoi(port)
	if err != nil || parsedPort < 1 || parsedPort > 65535 {
		return "", fmt.Errorf("DOCKERCD_WEB_LISTEN_ADDR must use a port from 1 to 65535")
	}
	switch host {
	case "127.0.0.1", "::1", "0.0.0.0", "::":
		return value, nil
	default:
		return "", fmt.Errorf("DOCKERCD_WEB_LISTEN_ADDR host must be loopback or unspecified")
	}
}
