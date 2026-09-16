# ADR 0003: Local password bootstrap for Web presentation

| Field | Value |
| --- | --- |
| Status | Accepted for the first single-instance Web deployment |
| Date | 2026-09-15 |
| Related | [ADR 0001](0001-separate-control-plane-and-presentation.md), [ADR 0002](0002-scoped-presentation-api.md), [Web UI architecture](../web-ui-architecture.md) |

## Context

The separate Web presentation needs a network-capable local operator login
before an organization identity provider is selected. It must not reuse the
legacy controller administrator token, place a controller credential in a
browser, or make cloud identity a prerequisite for an on-premises deployment.

Docker Compose can mount a host-managed secret file into a specific service at
`/run/secrets/<name>`. That is suitable for a small local bootstrap registry,
but it is not Kubernetes-style encrypted secret storage or a replacement for
host access controls and backup hygiene.

## Decision

1. The Web service optionally enables local login only when
   `DOCKERCD_WEB_AUTH_USERS_FILE` names a Compose secret mount and
   `DOCKERCD_WEB_PUBLIC_ORIGIN` is an HTTPS origin. With no users file, the
   executable remains fixture-only.
2. The secret is bounded strict JSON, versioned, and contains 1–128 users. A
   user has a restricted `subject`, an Argon2id PHC password verifier, and one
   controller-scoped bearer credential. It contains no plaintext password.

   ```json
   {
     "version": 1,
     "users": [
       {
         "subject": "operator",
         "passwordHash": "$argon2id$v=19$m=65536,t=3,p=1$<base64-salt>$<base64-digest>",
         "controllerToken": "<unique-scoped-controller-bearer>"
       }
     ]
   }
   ```

   The implementation accepts Argon2id memory cost 32–256 MiB, time cost
   1–10, parallelism 1–4, a 16–64-byte salt, and a 32-byte digest. Every user
   in a registry must use the same cost profile, preventing account-dependent
   verification timing. Use the documented `m=65536,t=3,p=1` baseline or a
   stronger operationally-tested setting. The placeholder bearer is secret
   material and must exist only in the host-managed Compose secret file.
3. The controller receives only the SHA-256 digest of each corresponding
   bearer in its own, separate, digest-only presentation credential registry.
   Each bearer is unique to a local user, audience-bound, expiry-bound,
   capability-scoped, resource-scoped, and revocable. It is never the legacy
   API token and never a shared Web-service identity.
4. Successful local login creates an opaque, random server-side session. The
   browser receives only a host-only `HttpOnly`, `Secure`, `SameSite=Lax`
   cookie. A session's reference to the controller bearer is removed when the
   session expires or logs out; the validated user registry remains in process
   memory until restart so another login can create a new session.
5. Login uses a short-lived, HMAC-signed stateless double-submit CSRF challenge
   so unauthenticated GET traffic cannot exhaust a server-side challenge map.
   Logout is POST-only and requires a session-bound CSRF value. Login attempts
   have a globally bounded password-verification admission gate and an
   in-memory, HMAC-selected submitted-subject bucket lockout. Every submitted
   subject follows the same bounded allocation path; rare bucket collisions
   share a temporary lockout. All credential failures receive a generic
   response.
6. The Web service runs behind a TLS-terminating reverse proxy. It does not
   terminate TLS itself, trust forwarded identity headers, or publish the
   controller API. The controller remains reachable only through the private
   Compose network.
7. OIDC Authorization Code Flow with PKCE remains the preferred future
   enterprise identity integration. It replaces this Web-local password
   verification without changing the controller's final authorization rules.

## Consequences

- Local operators can use a networked Web UI without a cloud-provider account.
- The secret mount must be readable only by the Web service's deployment
  account. Compose file-backed secrets on a single host inherit host filesystem
  and backup risk; they require equivalent operational care.
- A Web restart intentionally signs everyone out. There is no persistent Web
  session store and no multi-replica session sharing in this phase.
- Password reset, user provisioning, credential issuance, revocation, and
  controller registry rotation are deliberate operator procedures, not UI
  features. The UI has no user-management route.
- No live mutation is enabled by this decision. ADR 0002's operation,
  idempotency, capability, audit, and confirmation requirements still apply.

## Acceptance evidence

- The Web registry rejects plaintext password fields, malformed/oversized
  files, duplicate users, invalid Argon2id verifiers, and invalid subjects.
- Pages cannot reach the controller before a valid Web session; failed session
  resolution redirects to local sign-in rather than fixture or admin access.
- Browser HTML and cookies contain no controller bearer, and security headers
  disable scripts, framing, and cross-origin form actions.
- A Compose example mounts the Web registry as a service-specific secret and
  keeps the controller endpoint private.
