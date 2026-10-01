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
HTTPS. HTTP is visibly identified as trusted-network/development-only. The
client rejects HTTP redirects, so a controller response cannot silently send a
bearer to another origin or obscure the controller's result. Tokens are stored
in the local macOS Keychain rather than the connection-profile preferences.
TLS trust controls, certificate pinning, and mTLS remain future work; do not
use unauthenticated HTTP for an untrusted network.

On first launch after this change, the Console attempts to move a legacy token
from local preferences into Keychain. It immediately removes the plaintext
preference whether that secure write succeeds or fails. A Keychain migration
or later read failure leaves only a non-secret, persisted “token repair
required” marker. The affected controller makes no automatic connection or
request until you explicitly re-enter and save its token, or remove its
profile. A failed save leaves the connection editor open so its draft can be
corrected.

Enter a bare controller origin such as `https://controller.example:8443`.
Profiles reject embedded URL credentials, paths, queries, and fragments, so
the optional token stays in its dedicated field and every request has one
unambiguous controller origin.

The legacy embedded controller UI has been retired under the v0.1 release
gate. `dockercd-web` is the browser monitoring surface; authenticated CLI/API
remain the recovery controls. This Console is an independent local client, not
a prerequisite for the retired controller UI.
