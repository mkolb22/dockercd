# dockercd Web UI owner review

This guide is the acceptance review for the fixture-backed Fleet Command
Center. It is intentionally separate from live-controller authorization: the
review server has no controller URL, Docker access, token, Git credential, or
mutable fixture state.

## Start the isolated mockup

From `web/` run:

```sh
go run ./cmd/dockercd-web
```

Open <http://127.0.0.1:8092/fleet>. Every page must retain the visible
**Fixture mode** label and describe displayed evidence as fixture data.

## Review the operator journeys

1. Open **Fleet**. Confirm the first reading path is clear: attention queue,
   a single Fleet health summary, then a named application. The orbital count
   must be accompanied by text and state chips; color alone must never carry
   the status.
2. Follow **Review attention** to `edge-api`, then visit Overview, Deploy,
   Timeline, and Inspect. Each page should retain application, revision, and
   observation context and offer a clear route back to Fleet.
3. Open **Manage fixture**, choose a destructive-looking action, and review
   the confirmation screen. It must name the application and displayed
   revision before the final fixture-only confirmation. Confirming it must
   state that no controller operation was sent.
4. Review `/fleet?scenario=healthy`, `/fleet?scenario=stale`, and
   `/fleet?scenario=error`. The message must distinguish retained/stale data
   from a current controller response; it must not imply a deployment is safe.
5. Open **Activity**. Confirm it frames future live data as a bounded recent
   window and does not imply a complete audit history.

## Accessibility and layout checks

Review desktop and a narrow browser width; check light and dark appearance,
200% text zoom, keyboard-only navigation, visible focus, skip-to-content, and
reduced-motion preference. Verify all status meanings remain understandable
from text and glyphs when color is unavailable.

## Approval record

Record the date, reviewer, browser/device, scenarios checked, and any
workflow or visual issue in the delivery record. Owner approval here validates
the fixture UX only; it does **not** approve live browser identity, controller
exposure, mutations, or removal of the embedded UI.
