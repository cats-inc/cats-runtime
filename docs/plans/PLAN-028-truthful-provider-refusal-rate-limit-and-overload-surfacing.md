# PLAN-028: Truthful Provider Refusal, Rate-Limit, and Overload Surfacing

> Implementation plan for the immediate fix that stops CLI-backed provider
> refusals from being collapsed into generic timeouts, plus a smaller follow-up
> track for broader backend parity if the first slice proves the shared shape.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

- [SPEC-010: Usage Metering, Rate-Limit Detection, and Execution Guardrails](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-007: Provider Compatibility and Evidence Engine](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
- Supporting decisions:
  [ADR-017](../decisions/017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- Related follow-through:
  [PLAN-029](./PLAN-029-provider-compatibility-and-evidence-engine.md)

## Overview

`cats-runtime` currently has an honesty gap in provider failure handling.
When an upstream provider explicitly refuses work, the runtime can still report
that situation as a generic timeout or a generic process-exit error.

The current Gemini failure is a concrete example:

- the provider does emit a real refusal
- the refusal is model-specific (`429 RESOURCE_EXHAUSTED /
  MODEL_CAPACITY_EXHAUSTED`)
- the user should be allowed to keep the selected model and decide what to do
- but the runtime currently surfaces the experience as
  `Provider did not respond within 30000ms`

This is not only a Gemini problem. The same honesty requirement applies across
all provider families:

- CLI providers that print refusal signals to `stderr`
- API/local providers that return structured `429`/`403`/`5xx` responses
- agent backends that reject over HTTP or websocket control channels
- local runtimes such as Ollama that may refuse because the daemon is absent,
  overloaded, or unavailable

The immediate goal is narrower than a full cross-backend error redesign:

- stop `WorkerProcess` from masking explicit CLI refusals as generic timeouts
- add the smallest shared refusal shape needed to carry truthful details
- prove the fix with focused tests

Broader API/local/agent parity is still worth doing, but it should be treated
as a follow-up only after the CLI slice lands and its error shape is proven.

The runtime must preserve the user-selected model, must not silently fall back
to another model, and must tell the user what actually happened.

## Current Gaps

- `WorkerProcess` waits for the first provider event and may synthesize a
  timeout before the user sees the provider's actual refusal.
- Some CLI providers emit refusal details through `stderr` or non-stream-json
  text; those signals are not normalized early enough.
- Generic launch/timeout errors do not carry even a minimal machine-readable
  refusal category, upstream status, retryability hint, or operator-safe user
  message.
- The current first slice does not yet prove what, if anything, must change in
  HTTP/UI layers once truthful refusal details start flowing out of the worker.

## Implementation Phases

### Phase 1: CLI Truthful Refusal Fix

- [ ] Define the smallest shared refusal shape needed for the first slice.
      Start with a compact category set such as:
      `rate_limited`, `capacity_exhausted`, `auth_required`,
      `provider_unavailable`, `provider_rejected`, `true_timeout`, `unknown`.
- [ ] Refactor `WorkerProcess` so first-event waiting does not hide explicit
      refusal signals coming through `stderr` or early non-JSON output.
- [ ] Add a provider-adapter seam for launch-failure classification rather than
      hardcoding Gemini-only heuristics in the hot path.
- [ ] Reuse `SPEC-007` compatibility/evidence knowledge where possible for CLI
      failure signatures such as `429`, `rateLimitExceeded`, auth prompts, and
      anti-abuse warnings.
- [ ] Ensure explicit provider refusals win over synthesized generic timeouts
      whenever the process actually told us why it refused.
- [ ] Keep `true_timeout` reserved for cases where the runtime genuinely lacks
      a refusal signal.
- [ ] Ship focused tests with the fix:
      refusal-on-stderr, refusal-before-first-event, and true-timeout
      separation.

**Deliverables**: CLI providers stop masking explicit refusals as generic
timeouts, and the runtime has a minimal truthful refusal contract proven by
tests.

### Phase 2: Backend Parity and Surfacing Follow-Up

- [ ] Evaluate whether the new CLI refusal shape already flows through current
      HTTP/UI layers without further changes.
- [ ] If needed, normalize API/local backend `429`/`403`/`5xx` responses into
      the same refusal shape.
- [ ] If needed, normalize agent-backend HTTP/websocket refusals into the same
      refusal shape.
- [ ] If needed, update dashboard/playground/session error rendering so users
      see truthful refusal details instead of generic timeout wording.
- [ ] Feed normalized refusal events into runtime metering/incident state so
      diagnostics and `/providers/config` summaries remain aligned.
- [ ] Capture representative evidence samples for volatile providers so future
      upstream behavior changes are reviewable.

**Deliverables**: broader backend parity only if the first slice demonstrates
remaining gaps outside CLI worker handling.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/backends/cli/pool/WorkerProcess.ts` | Modify | Stop generic first-event timeout from hiding explicit provider refusals |
| `src/backends/cli/providers/types.ts` | Modify | Add provider-facing refusal classification seam if needed |
| `src/backends/cli/providers/*.ts` | Modify | Add provider-specific refusal parsing where the shared path is insufficient |
| `src/core/types.ts` | Modify | Define a runtime-owned normalized refusal/error shape if it belongs in shared types |
| `src/backends/cli/pool/WorkerProcess.test.ts` | Modify | Cover refusal-vs-timeout behavior for ephemeral CLI providers |
| `tests/runtime-server.test.ts` | Modify if needed | Cover truthful HTTP/UI surfacing only if Phase 1 proves current route/UI flow is insufficient |
| `src/core/usage/*` | Modify if needed | Align incidents/guardrails with the normalized refusal shape after the CLI fix lands |
| `src/http/routes/messages.ts` | Modify if needed | Surface truthful provider failures if existing route flow does not already carry them |
| `src/http/routes/sessions.ts` | Modify if needed | Preserve truthful execution failure details in session state where applicable |
| `public/index.html` | Modify only if needed | Dashboard rendering follow-up after the worker/route shape is proven |
| `public/playground.html` | Modify only if needed | Playground rendering follow-up after the worker/route shape is proven |
| `docs/research/*` | Modify/Create as needed | Capture replayable refusal evidence for volatile providers |

## Technical Decisions

- Decision 1: Provider truth beats synthetic timeout. If the provider emitted a
  recognizable refusal, the runtime must surface that refusal instead of a
  generic timeout.
- Decision 2: The runtime must not silently change models. Model fallback is a
  separate product capability and is explicitly out of scope for this work.
- Decision 3: Start with the smallest refusal contract that solves the CLI
  masking bug, then grow it only when real backend-parity evidence demands it.
- Decision 4: Metering and guardrails should consume the same normalized
  refusal facts that user-facing chat flows surface, but that integration does
  not block the first CLI fix.
- Decision 5: "True timeout" remains a valid category, but only when the runtime
  genuinely did not receive a stronger upstream signal.

## Testing Strategy

- **Unit Tests**:
  cover the minimal refusal shape, provider-specific stderr parsing, and
  timeout-vs-refusal precedence in `WorkerProcess`
- **Integration Tests**:
  cover HTTP session/message flows only if Phase 1 proves current route
  propagation is insufficient
- **Manual Testing**:
  trigger known CLI refusal scenarios such as Gemini capacity exhaustion and
  auth-required states; verify the runtime surfaces truthful guidance without
  changing the chosen model

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overfitting to one provider's phrasing | High | Start with a minimal shared refusal shape plus provider-specific evidence-backed classifiers |
| False-positive refusal classification from incidental stderr text | High | Require strong signatures, structured codes when available, and regression evidence samples |
| Broad backend/UI follow-up expands before the first CLI fix proves itself | Medium | Treat backend parity and UI rendering as explicit Phase 2 follow-up, not a prerequisite |
| UI overwhelm from dumping raw upstream errors | Medium | Separate operator-safe summary from raw details while preserving both for diagnostics when UI follow-up is actually needed |
| Future providers regress to generic timeout handling | High | Add shared `WorkerProcess` tests and provider onboarding guidance tied to this plan |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-31 | Plan created after investigating Gemini CLI `429 MODEL_CAPACITY_EXHAUSTED` being surfaced as a generic runtime timeout |
| 2026-03-31 | Plan tightened after review: the CLI worker/refusal fix is now Phase 1, while backend parity and UI surfacing are explicit follow-up work |

---

*Created: 2026-03-31*
*Author: Codex*
