# dockercd Console for macOS

`dockercd Console` is the native SwiftUI control surface for one or more
dockercd controllers. It communicates only through `/healthz` and `/api/v1`;
the controller remains responsible for reconciliation and Docker access.

## Run locally

From this directory:

```sh
swift run
```

To package an app bundle for local use:

```sh
./scripts/build-macos-app.sh
open .build/debug/DockercdConsole.app
```

The first launch provides Development and My Apps example profiles. Edit them
or add any network-reachable controller in **Settings → Edit Connection**.
URLs are not restricted to `localhost`.

## Session modes

- **Live** listens to server-sent events and performs a 30-second safety
  refresh.
- **Every 5 seconds** is for active development.
- **Every 10 seconds** is the default for new profiles.
- **Manual** refreshes when the profile is selected or the owner presses
  Refresh.

Only application summaries are refreshed on the session schedule. Desired
state, diffs, logs, history, service metrics, and host details are requested
only from their relevant screen. Failed requests retain the last known data
and retry at 5, 10, 30, then 60 seconds.

## Current transport posture

The connection form accepts an optional bearer token and supports HTTP or
HTTPS. HTTP is visibly identified as trusted-network/development-only. Token
storage in Keychain, TLS trust controls, certificate pinning, and mTLS are
intentionally deferred to the security phase; do not use unauthenticated HTTP
for an untrusted network.

The embedded controller web UI remains in place during this migration. It is
not removed until native owner workflows have been validated in production.
