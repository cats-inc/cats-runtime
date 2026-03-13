# PLAN-001: WSL Discovery Policy and Dashboard Visibility

> Implementation plan for policy-driven WSL discovery and global status
> visibility in `cats-runtime`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | TBD |
| **Reviewer** | TBD |

## Related Spec

[SPEC-001: WSL Discovery Policy and Dashboard Status](../specs/SPEC-001-wsl-discovery-policy.md)

## Overview

Implement WSL discovery as an explicit policy instead of a hard-coded polling
side effect. The first delivery should focus on preventing accidental WSL
activation during background scans and making the runtime's current behavior
visible in the dashboard. Direct Windows-side SQLite reads via `\\wsl$` are
explicitly deferred.

## Implementation Phases

### Phase 1: Policy Model and Discovery State

- [x] Add `WslDiscoveryPolicy` config parsing in `src/backends/cli/config.ts`
- [x] Decide and document compatibility behavior when the env var is absent
- [x] Add a WSL runtime probe that can tell whether the configured distro is
      already running without launching a provider process
- [x] Refactor background Cursor/Kiro discovery in `src/server.ts` to respect
      the configured policy
- [x] Record per-provider discovery state for `cursor` and `kiro`

**Deliverables**: Background WSL discovery can run, skip, or stay manual-only
without relying on hidden behavior.

### Phase 2: HTTP Status Surface and Dashboard Indicator

- [x] Add a dedicated discovery status endpoint, preferably
      `GET /discovery/status`
- [x] Expose configured policy, runtime mode, distro, last scan timestamp, and
      last outcome per WSL-backed provider
- [x] Update `public/index.html` to show a compact global WSL indicator in the
      header
- [x] Show both the configured policy and the current state label in the UI

**Deliverables**: Users can see why WSL discovery is active, skipped, disabled,
or degraded.

### Phase 3: Follow-Up Items

- [ ] Decide in a future slice whether `POST /cursor/sessions/discover` and
      `POST /kiro/sessions/discover` should accept `startIfNeeded`
- [x] Add tests for policy parsing, skipped scans, state transitions, and the
      new status endpoint
- [x] Update `docs/api.md`, `docs/setup-guide.md`, and `docs/architecture.md`
      after the implementation lands
- [ ] Re-evaluate in a future slice whether `\\wsl$` or a Node-native SQLite
      reader is still justified after observing the policy-based design

**Deliverables**: The delivered slice is tested and documented, with follow-up
items clearly deferred instead of left ambiguous.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/backends/cli/config.ts` | Modify | Parse and export WSL discovery policy |
| `src/server.ts` | Modify | Apply policy in background discovery and track state |
| `src/http/app.ts` | Modify | Wire discovery status route |
| `src/http/routes/` | Create/Modify | Add dedicated discovery status endpoint |
| `public/index.html` | Modify | Show global WSL discovery indicator |
| `tests/runtime-server.test.ts` | Modify | Cover discovery state exposure |
| `src/backends/cli/*/*.test.ts` | Modify | Cover policy and WSL skip behavior |
| `docs/api.md` | Modify | Document discovery status route and request options |
| `docs/setup-guide.md` | Modify | Document env var and recommended values |
| `docs/architecture.md` | Modify | Document policy-aware discovery flow |

## Technical Decisions

- Decision 1: Solve unintended WSL activation first with a policy gate rather
  than replacing the SQLite readers immediately.
- Decision 2: Separate configuration from live runtime state so the dashboard
  can explain "why" instead of only showing a binary light.
- Decision 3: Prefer a dedicated status endpoint over overloading `/health`,
  because discovery policy is operational state, not basic liveness.
- Decision 4: Keep `\\wsl$` access as a deferred optimization until policy-based
  controls prove insufficient.

## Testing Strategy

- **Unit Tests**: Config parsing, policy transitions, WSL runtime probe parsing,
  and discovery state reducers
- **Integration Tests**: Runtime server status payload, policy-aware background
  scan behavior, and route responses
- **Manual Testing**:
  1. Start `cats-runtime` on Windows with `CURSOR_RUNTIME=wsl` and
     `KIRO_RUNTIME=wsl`
  2. Verify `always` still triggers scans
  3. Verify `if_running` skips scans when WSL is stopped and resumes when it is
     already running
  4. Verify `manual_only` shows the correct dashboard state without background
     scans
  5. Confirm the dashboard badge matches actual runtime behavior

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WSL "is running" detection itself accidentally starts WSL | High | Use a probe that inspects WSL state without entering the distro, and test stopped/running cases |
| Dashboard badge becomes misleading because config and live state are conflated | Medium | Keep policy and live state as separate fields in the payload and UI |
| Existing users rely on current aggressive discovery behavior | Medium | Preserve compatibility when the env var is absent and document the recommended opt-in values |
| The policy fix reduces wakeups but not scan latency once WSL is already running | Low | Revisit `\\wsl$` or a Node-native reader only after measuring the remaining cost |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-13 | Plan created |
| 2026-03-13 | Implemented policy parsing, background discovery state, status route, dashboard indicator, tests, and docs |
| 2026-03-13 | Closed the delivered slice; left manual discovery overrides and direct WSL file access as explicit future follow-ups |

---

*Created: 2026-03-13*
*Author: Codex*
