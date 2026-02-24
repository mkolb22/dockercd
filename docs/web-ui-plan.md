# Web UI Implementation Plan

## Context

dockercd has a complete REST API (Phase 8) but no visual dashboard. ArgoCD's web UI is a key part of its UX — seeing app status, diffs, and triggering syncs at a glance. This plan adds a self-contained SPA embedded in the Go binary via `//go:embed`, served from the same port as the API. No build toolchain (npm/webpack/node) — vanilla HTML/CSS/JS only, under 100KB total.

---

## Files to Create

All under `src/internal/api/static/`:

| File | Purpose | ~Size |
|------|---------|-------|
| `index.html` | SPA shell: header, breadcrumb nav, `<main id="app">` container | 3 KB |
| `css/style.css` | Dark theme (ArgoCD-inspired), CSS custom properties, grid layout, status colors, responsive | 12 KB |
| `js/api.js` | `API` object wrapping `fetch()` for all 6 endpoints + error handling | 3 KB |
| `js/components.js` | Pure render functions: app cards, badges, service tables, diff view, history/events tables, toast notifications | 10 KB |
| `js/app.js` | Hash router (`#/apps`, `#/apps/{name}`), state manager, page controllers, auto-refresh (10s), sync button handler | 15 KB |
| `favicon.svg` | Simple container/whale SVG icon | 1 KB |

## File to Modify

- **`src/internal/api/server.go`** — Add `//go:embed static/*` directive, `fs.Sub()` for path stripping, static file server under `/ui/*` with SPA fallback (serve `index.html` for unknown paths), root redirect `GET / → /ui/`.
- **`src/internal/api/handlers_test.go`** — Add 3 tests: root redirect, UI serves HTML, SPA fallback.

---

## Pages

### Dashboard (`#/apps`)

- CSS Grid of app cards: `repeat(auto-fill, minmax(320px, 1fr))`
- Each card shows: name, repo URL, sync badge, health badge, last sync time (relative), commit SHA (7 chars), error (if any)
- Card left-border color:
  - **Green**: healthy + synced
  - **Yellow**: progressing / out-of-sync
  - **Red**: degraded / error
  - **Gray**: unknown
- Cards are `<a href="#/apps/{name}">` — click navigates to detail
- Auto-refreshes every 10s (skips if tab hidden via Page Visibility API)

### App Detail (`#/apps/{name}`)

- Header: app name, sync badge, health badge, **Sync button**
- Fetches all 4 endpoints in parallel via `Promise.all` (app, diff, history, events)
- **4 tabs** (client-side switch, no re-fetch):

#### Overview Tab
- Metadata: repo, branch, path, project, docker host
- Sync policy flags: automated, prune, self-heal, poll interval
- Services table: name, image, health badge, state
- Last error alert (if any)

#### Diff Tab
- If `inSync` → green "In Sync" message
- Otherwise three sections:
  - `+CREATE` (green background) — new services with desired image
  - `~UPDATE` (yellow background) — per-field diffs: `field: "live" → "desired"`
  - `-REMOVE` (red background) — services to remove

#### History Tab
- Table of SyncRecords: time (relative), commit SHA (7 chars), operation type (poll/manual/self-heal), result badge (success/failure/skipped), duration, error

#### Events Tab
- Table of EventRecords: time (relative), type, message, severity badge (info=blue, warning=yellow, error=red)

### Sync Button Flow

1. Click → disable button, add spinner, text "Syncing..."
2. `POST /api/v1/applications/{name}/sync`
3. Toast notification: green (success), red (failure), blue (skipped)
4. Re-fetch page data after 500ms delay

---

## CSS Architecture

### Color System (CSS Custom Properties)

```css
:root {
    /* Dark theme */
    --bg-primary: #1a1d21;
    --bg-secondary: #22262b;
    --bg-card: #2a2e34;
    --bg-hover: #32373e;
    --border-color: #3a3f47;
    --text-primary: #e8eaed;
    --text-secondary: #9aa0a6;

    /* Status colors */
    --color-healthy: #34d399;      /* green */
    --color-synced: #34d399;
    --color-progressing: #fbbf24;  /* yellow/amber */
    --color-out-of-sync: #fbbf24;
    --color-degraded: #f87171;     /* red */
    --color-error: #f87171;
    --color-unknown: #6b7280;      /* gray */

    /* Severity */
    --color-info: #60a5fa;         /* blue */
    --color-warning: #fbbf24;
    --color-danger: #f87171;

    /* Diff backgrounds */
    --diff-create-bg: rgba(52, 211, 153, 0.1);
    --diff-update-bg: rgba(251, 191, 36, 0.1);
    --diff-remove-bg: rgba(248, 113, 113, 0.1);
}
```

### Layout

- System font stack (no web fonts): `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Monospace for SHAs: `'SF Mono', 'Fira Code', Consolas, monospace`
- Fixed header (56px), scrollable main
- CSS Grid for dashboard cards
- Flexbox for header, badges, detail layout
- Single responsive breakpoint at 768px (single-column cards)
- CSS-only spinner via `@keyframes`
- Toast: slide in from top-right, auto-dismiss 4s

### Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.app-card` | Card with colored left border accent |
| `.app-card--healthy/--warning/--error/--unknown` | Border color variants |
| `.badge--synced/--out-of-sync/--error/--unknown` | Sync status pills |
| `.badge--healthy/--progressing/--degraded` | Health status pills |
| `.diff-block--create/--update/--remove` | Diff section backgrounds |
| `.btn--primary` | Blue sync button |
| `.btn--loading` | Disabled + spinner |
| `.toast--success/--error/--info` | Notification variants |
| `.tab-bar__tab--active` | Active tab indicator |

---

## JavaScript Architecture

### Load Order

```html
<script src="js/api.js"></script>      <!-- defines API global -->
<script src="js/components.js"></script> <!-- defines Components global -->
<script src="js/app.js"></script>       <!-- defines Router, State, Pages, App -->
```

No modules, no bundler — three `<script>` tags loaded in dependency order.

### `api.js` — API Client

```javascript
const API = {
    listApplications()        → GET /api/v1/applications
    getApplication(name)      → GET /api/v1/applications/{name}
    syncApplication(name)     → POST /api/v1/applications/{name}/sync
    getDiff(name)             → GET /api/v1/applications/{name}/diff
    getEvents(name, limit)    → GET /api/v1/applications/{name}/events?limit=N
    getHistory(name, limit)   → GET /api/v1/applications/{name}/history?limit=N
};

class APIError extends Error {
    constructor(response) { ... }  // extracts .code and .error from ErrorResponse JSON
}
```

### `components.js` — Pure Render Functions

All functions take data and return HTML strings. No DOM manipulation.

```javascript
const Components = {
    // Badges
    syncBadge(syncStatus)       → '<span class="badge badge--synced">Synced</span>'
    healthBadge(healthStatus)   → '<span class="badge badge--healthy">Healthy</span>'
    severityBadge(severity)     → '<span class="badge badge--info">info</span>'

    // Dashboard
    appCard(app)                → single card HTML
    appCardGrid(apps)           → grid of cards

    // Detail sections
    appMetadata(app)            → metadata key-value display
    serviceTable(services)      → <table> of ServiceStatus[]
    diffView(diffResult)        → create/update/remove sections
    historyTable(records)       → <table> of SyncRecord[]
    eventsTable(events)         → <table> of EventRecord[]

    // UI elements
    syncButton(appName, loading) → sync button with loading state
    tabBar(tabs, activeTab)     → horizontal tab bar
    toast(message, type)        → notification element
    relativeTime(isoString)     → "3m ago"
    shortSHA(sha)               → first 7 chars
    emptyState(message)         → centered "no data" message
    loadingSpinner()            → CSS-only spinner
};
```

### `app.js` — Application Controller

**Router** — Hash-based routing:
- `#/apps` or empty → `Pages.dashboard()`
- `#/apps/{name}` → `Pages.appDetail(name)`
- Listens to `hashchange` event

**State** — Simple object:
```javascript
const State = {
    apps: [],              // cached app list
    currentApp: null,      // current detail page app name
    currentTab: 'overview', // active tab
    refreshTimer: null,    // setInterval ID
    syncing: new Set(),    // app names currently syncing
};
```

**Auto-Refresh** — `setInterval(callback, 10000)` with `document.hidden` guard. Cleared and recreated on navigation. Only one timer active at a time.

**Sync Handler**:
1. Add app name to `State.syncing` Set
2. Update button to disabled + spinner
3. `await API.syncApplication(name)`
4. Show toast based on `result.result` (success/failure/skipped)
5. Remove from `State.syncing`
6. `setTimeout(() => Router.resolve(), 500)` to refresh page

**Page Controllers**:
- `Pages.dashboard()` — fetch list, render card grid, start auto-refresh
- `Pages.appDetail(name)` — `Promise.all` 4 endpoints, render with tabs, start auto-refresh
- Tab switches re-render content area without re-fetching

---

## Go Integration

### server.go Changes

Follow the existing `//go:embed` pattern from `store/store.go`:

```go
import (
    "embed"
    "io/fs"
    // ... existing imports
)

//go:embed static/*
var staticFS embed.FS

// In NewServer(), add before API routes:

// Root redirect
router.Get("/", func(w http.ResponseWriter, r *http.Request) {
    http.Redirect(w, r, "/ui/", http.StatusFound)
})

// Static UI files with SPA fallback
staticContent, _ := fs.Sub(staticFS, "static")
fileServer := http.FileServer(http.FS(staticContent))
router.Route("/ui", func(r chi.Router) {
    r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
        path := chi.URLParam(req, "*")
        f, err := staticContent.Open(path)
        if err != nil {
            // SPA fallback: serve index.html for unknown paths
            req.URL.Path = "/ui/"
        } else {
            f.Close()
        }
        http.StripPrefix("/ui", fileServer).ServeHTTP(w, req)
    })
})
```

Key: `contentTypeJSON` middleware is scoped to `/api/v1` only — UI routes unaffected.

---

## Implementation Order

1. `mkdir -p src/internal/api/static/css src/internal/api/static/js`
2. `favicon.svg`
3. `css/style.css` — all styles first
4. `js/api.js` — API client (independent)
5. `js/components.js` — rendering functions (independent)
6. `js/app.js` — router + pages (depends on api.js + components.js)
7. `index.html` — ties scripts together
8. Modify `server.go` — embed + routes
9. Add tests to `handlers_test.go`
10. Build + smoke test

---

## Verification

1. `go build ./...` — embed directive validates all files exist
2. `go test -race ./internal/api/` — new route tests pass
3. Start server → `http://localhost:8080` redirects to `/ui/`
4. Dashboard loads with app cards, auto-refresh works (check Network tab)
5. Click app card → detail page with all 4 tabs functional
6. Sync button → loading state → toast → data refreshes
7. `/api/v1/applications` still returns JSON (not HTML)
8. `/healthz` and `/readyz` still return JSON
9. `du -sh src/internal/api/static/` → under 100KB
10. `grep -r 'https://' src/internal/api/static/` → no external dependencies
11. Resize to mobile width → layout remains usable
