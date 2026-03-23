# Roadmap

> Long-term project planning and milestones.

## Optimizations

### OPT-1: WSL Discovery Policy and Visibility

**Priority**: P1
**Status**: In Progress

#### Problem

`CursorNativeSessionService` and `KiroNativeSessionService` scan CLI sessions inside WSL by spawning `wsl -d Ubuntu bash -lc "python3 -c 'import base64; exec(...)'"`. This triggers the entire WSL VM to start (if stopped), which in turn causes systemd to auto-start all enabled services (e.g. `openclaw-gateway`), consuming 1GB+ RAM. On low-memory machines (8GB), this makes it difficult to run other VM-based features (e.g. Claude Desktop Cowork) concurrently.

#### Current Flow

1. `cats-runtime` polls for Cursor/Kiro sessions
2. For WSL sessions, it spawns `wsl -d Ubuntu bash -lc "python3 ..."` (see `src/backends/cli/runtime/runtime.ts:170-176`)
3. Python script reads SQLite databases inside WSL to extract session data
4. WSL Ubuntu starts up, systemd boots all enabled services, RAM usage spikes

#### Phase 1 Direction

Introduce an explicit WSL discovery policy for Windows/WSL-backed providers, and
surface its current behavior in the dashboard.

- Add `CATS_RUNTIME_WSL_DISCOVERY_POLICY` to control whether background
  Cursor/Kiro discovery may start WSL
- Start with three policies:
  - `always`: preserve the current behavior
  - `if_running`: scan only when the configured distro is already running
  - `manual_only`: never start WSL from background discovery
- Record discovery state so the UI can show whether scans are active, skipped,
  disabled, or failing
- Expose discovery status through a dedicated runtime endpoint for dashboard use
- Add a global dashboard indicator that shows both the configured policy and the
  current WSL discovery state

Current implementation status:

- Implemented `CATS_RUNTIME_WSL_DISCOVERY_POLICY`
- Implemented `GET /discovery/status`
- Implemented dashboard header visibility for WSL discovery state
- Deferred manual discovery overrides such as `startIfNeeded`

#### Deferred Optimization

Direct Windows-side SQLite reads via `\\wsl$\Ubuntu\...` (or
`\\wsl.localhost\Ubuntu\...`) remain an optional follow-up optimization, not the
first response.

This path should only be revisited if policy-based skipping is insufficient and
there is still a measurable need to reduce scan latency or remove the embedded
Python readers.

#### Rationale

- The primary pain is unintended WSL activation during background polling, not
  Python itself
- `\\wsl$\` is not a complete fix because it can still activate WSL when the
  distro is stopped
- A policy-first design is lower-risk than introducing new native SQLite
  dependencies and cross-platform filesystem edge cases

#### Affected Files

- `src/backends/cli/config.ts`
- `src/server.ts`
- `src/http/app.ts`
- `src/http/routes/health.ts` or a new discovery status route
- `public/index.html`
- `src/backends/cli/runtime/runtime.ts`
- `src/backends/cli/cursor/CursorNativeSessionService.ts`
- `src/backends/cli/kiro/KiroNativeSessionService.ts`
- `docs/specs/SPEC-001-wsl-discovery-policy.md`
- `docs/plans/PLAN-001-wsl-discovery-policy.md`

---

### OPT-2: Provider-Agnostic Progress Events

**Priority**: P2
**Status**: In Progress

#### Problem

`crew-chat-poc` currently receives live progress updates only from Junie. The
current bridge works by mapping Junie session events into `raw` runtime events
with Junie-specific metadata, which is enough for immediate UX recovery but not
the right long-term contract for the runtime.

Other CLI backends may also expose useful mid-turn state such as:

- reasoning / planning status
- active tool execution
- command execution progress
- file editing milestones
- long-running task checkpoints

Without a provider-agnostic progress event, each upper-layer product must learn
provider-specific `raw` payloads or continue showing a generic "thinking"
spinner even when structured progress is available.

#### Direction

Introduce a first-class runtime progress event that providers can emit without
leaking backend-specific wire formats to consumers.

- Add a dedicated streamed event type for progress/status updates
- Define a minimal shared schema:
  - short human-readable message
  - stable progress kind/category
  - optional provider-native metadata
  - optional provider session id
- Keep provider-specific parsing inside `src/backends/cli/*`
- Normalize Junie onto the new event type first, then extend the same contract
  to other providers that can surface meaningful progress
- Update upper-layer consumers such as `crew-chat-poc` to react to the generic
  progress event instead of Junie-only metadata checks

#### Current Implementation Status

- Landed a shared runtime `progress` event helper in `src/core/progress.ts`
- Normalized Junie onto `type: "progress"` instead of runtime `raw` passthrough
- Extended the same contract to Pi, Goose, and Copilot CLI integrations
- Kept provider-native details additive under `metadata.native`
- Reused the same event contract for API/local cache and warm-state hints
- Added additive metering/guardrail metadata so progress and execution
  guardrails can share one runtime-owned contract surface without moving
  product budget policy into the runtime

#### Initial Candidate Providers

- `junie`
- `pi`
- `goose`
- `copilot`

#### Affected Files

- `src/core/types.ts`
- `src/backends/cli/providers/types.ts`
- `src/backends/cli/junie/*`
- `src/backends/cli/pi/*`
- `src/backends/cli/goose/*`
- `src/backends/cli/providers/copilot.ts`
- `src/core/progress.ts`
- downstream consumers such as `crew-chat-poc`

---

### OPT-3: Runtime-Owned Browser Driver Hardening and Recovery

**Priority**: P1
**Status**: Planned

#### Problem

`cats-runtime` now has the first browser/preview substrate slice:

- runtime-owned browser sessions and pages
- a pluggable browser driver seam
- normalized `browser_page` preview surfaces
- a `manual` driver that validates the contract without launching a real
  browser

That is enough to freeze the substrate, but not enough for production-grade
browser-backed preview and test workflows. The current gaps are:

- no real Playwright/CDP/browser-service driver yet
- browser sessions/pages are in-memory only and do not survive runtime restart
- there is no browser-session cleanup/expiry discipline yet
- browser state is exposed through `/browser/*`, but not yet folded into the
  broader session inspection/read-model surfaces that hosts will eventually
  want to poll

Without a second slice, the browser subsystem remains structurally correct but
operationally shallow.

#### Direction

Deepen the runtime-owned browser subsystem without coupling it to any monorepo
  sibling browser project or turning it into a full BrowserOS product.

- Add at least one real driver behind the existing `RuntimeBrowserDriver`
  interface
  - likely candidates: Playwright/CDP or a replaceable external browser service
  - keep the public route and preview-surface contract stable
- Add browser-session persistence and restart-safe recovery where it materially
  improves long-lived preview workflows
- Add runtime-owned cleanup discipline for stale/closed browser sessions and
  pages
- Add additive browser summary/inspection hooks to the broader runtime
  read-model where needed, so hosts can discover browser-backed preview state
  without polling only the dedicated `/browser/*` routes
- Keep browser capabilities machine-readable so hosts can distinguish:
  - manual registration only
  - preview-only driver
  - richer automated browser control

#### Why This Is Required

- A manual-only driver is not sufficient for deploy-preview-test workflows.
- In-memory-only browser state is too fragile for long-running sessions and
  runtime restarts.
- Browser pages need the same lifecycle discipline already applied to sessions,
  wakeups, and delivery surfaces.
- Future Cats Code preview canvases need a more complete runtime substrate
  before UI work can safely depend on it.

#### Affected Areas

- `src/core/browser/*`
- `src/backends/browser/*`
- `src/http/routes/browser.ts`
- `src/http/app.ts`
- additive session inspection/read-model surfaces where browser summary is
  eventually exposed
- `docs/api.md`
- `docs/architecture.md`
- `docs/decisions/011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md`

---

*Last updated: 2026-03-23*
