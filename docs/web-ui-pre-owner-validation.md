# Web UI pre-owner validation

| Field | Evidence |
| --- | --- |
| Date | 2026-09-15 |
| Runtime | Fixture-only `dockercd-web` on loopback; no controller URL, credential, Docker access, or mutable fixture state |
| Browser exercise | Safari rendered semantic HTML without authored JavaScript |
| Owner approval | **Approved by the product owner on 2026-09-15.** This approves the fixture UX only; it does not authorize live identity wiring, controller exposure, mutations, or embedded-UI retirement. |

## Exercised path

1. Opened `/fleet?scenario=attention`: the Fleet Command Center showed a
   controller label, Fixture mode, explicit fixture evidence, health total,
   attention count, roster, and an accessible attention link.
2. Followed **Review attention** to the ordinary GET-filtered Applications
   view, which contained only `edge-api` and retained its revision and
   observation age.
3. Opened `edge-api`, then **Inspect**. The rendered evidence strip retained
   application name, revision `e713ab42`, observation age, sync, and health
   alongside fixture-only service/log labels.
4. Opened **Manage fixture**, selected delete, and verified the confirmation
   named the controller, application, reviewed revision, and displayed health
   before its final form.
5. Submitted the fixture confirmation. The Post/Redirect/Get outcome page
   explicitly reported: “No controller operation was sent.”

## Verified technical invariants

- The browser received only server-rendered HTML and CSS; the fixture has no
  controller data path or browser-held token.
- Every exercised page visibly retained **Fixture mode** and the controller
  context.
- The destructive-looking route performed no mutation; its success state is a
  fixture notice only.
- Fleet, application, and action paths are reachable with ordinary links and
  forms.

## Refreshed runtime evidence (2026-09-15)

The current fixture executable was restarted on `127.0.0.1:8092` after the
session-scoped presentation adapter changes. Direct runtime checks covered the
attention, healthy, stale, and unavailable fixture scenarios; `edge-api`
inspection; bounded Activity; and the fixture delete-review route. Every
checked response returned `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`; the pages retained the Fixture mode label.
The checked copy included the healthy-state limitation, retained-data label,
unavailable-controller label, bounded recent-activity limitation, and the
confirmation statement that no controller operation was sent.

The browser automation surface was unavailable for this refreshed local
process, so this is route and response evidence—not a substitute for the
human visual/accessibility review below.

## Container-boundary smoke evidence (2026-09-15)

`dockercd-web:review` was run transiently with a read-only filesystem, numeric
non-root user, all Linux capabilities dropped, `no-new-privileges`, and a
loopback-only host publication at `127.0.0.1:18092`. With no controller
configuration, its stale fixture response returned `200`, `no-store`,
`nosniff`, Fixture mode, and the retained-data label. The temporary container
was then removed. No existing container, controller endpoint, or network
exposure changed.

## Accessibility hardening evidence (2026-09-15)

An independent high-reasoning review of the narrow layout and static
accessibility behavior found four implementation issues, all corrected and
regression-tested: narrow fleet rows now place both Sync and Health text
badges together on a second row rather than clipping either at 320px; filter
controls retain the global visible keyboard focus ring; reduced-motion styles
disable transitions and animations; and the destructive fixture control uses
theme-specific foregrounds that preserve text contrast in dark and light
schemes. The refreshed loopback response contains the new roster-status group
and both status words; its stylesheet contains the narrow-row rule and both
danger-foreground tokens. This is technical evidence only—the owner must
still visually inspect narrow width, 200% zoom, keyboard focus, and both color
schemes.

## Owner decision and remaining gates

The product owner approved the fixture-backed Fleet Command Center experience
after the technical validation and accessibility hardening recorded above.
The approval covers the visual hierarchy, navigation, fixture safety language,
and intended desktop/narrow behavior. It is deliberately narrow: live browser
integration still requires a selected and implemented server-side identity
boundary, and the embedded UI remains until that later workflow parity is
validated. The local deployment credential is also awaiting a separate
owner-controlled rotation.
