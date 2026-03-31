# PLAN-028: Truthful Provider Refusal, Rate-Limit, and Overload Surfacing

> Implementation plan for making `cats-runtime` surface explicit upstream
> provider refusals honestly across CLI, API, local, and agent backends,
> instead of collapsing them into generic timeouts or opaque launch failures.

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
  [PLAN-008](./PLAN-008-provider-compatibility-and-evidence-engine.md)

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

The goal of this plan is to make refusal, rate-limit, quota, auth, overload,
capacity-exhausted, and anti-abuse responses first-class runtime failures.
The runtime must preserve the user-selected model, must not silently fall back
to another model, and must tell the user what actually happened.

## Current Gaps

- `WorkerProcess` waits for the first provider event and may synthesize a
  timeout before the user sees the provider's actual refusal.
- Some CLI providers emit refusal details through `stderr` or non-stream-json
  text; those signals are not normalized early enough.
- Generic launch/timeout errors do not carry a machine-readable refusal
  category, upstream status, retryability, or operator-safe user message.
- Different backend families do not currently converge on one shared runtime
  failure contract for "provider said no".
- UI surfaces cannot reliably distinguish:
  - true silence / hang
  - transient rate limit or capacity exhaustion
  - auth failure
  - workspace or local-daemon unavailability
  - anti-abuse or provider-side hard blocks

## Implementation Phases

### Phase 1: Shared Runtime Failure Contract

- [ ] Define a shared runtime-owned execution failure envelope that can express:
      category, provider/backend, upstream status code, retryability,
      cooldown/backoff hints, source channel (`stdout`, `stderr`, HTTP body,
      websocket frame), and user-safe message.
- [ ] Distinguish at least these failure families:
      `rate_limited`, `quota_exhausted`, `capacity_exhausted`,
      `auth_required`, `permission_denied`, `provider_unavailable`,
      `provider_rejected`, `transport_unavailable`, `true_timeout`,
      `unknown`.
- [ ] Decide where this contract lives so all backends can emit it without
      inventing ad hoc error strings.
- [ ] Preserve compatibility with existing error and metering flows while
      introducing the new failure shape additively.

**Deliverables**: one runtime-wide refusal/error vocabulary that every backend
can target.

### Phase 2: CLI Truthful Refusal Capture

- [ ] Refactor `WorkerProcess` so first-event waiting does not hide explicit
      refusal signals coming through `stderr` or early non-JSON output.
- [ ] Add a provider-adapter seam for launch-failure classification rather than
      hardcoding Gemini-only heuristics in the hot path.
- [ ] Reuse `SPEC-007` compatibility/evidence knowledge where possible for CLI
      failure signatures such as `429`, `rateLimitExceeded`, auth prompts, and
      anti-abuse warnings.
- [ ] Ensure explicit provider refusals win over synthesized generic timeouts
      whenever the process actually told us why it refused.
- [ ] Keep "true timeout" reserved for cases where the runtime genuinely lacks
      a refusal signal.

**Deliverables**: CLI providers stop masking explicit refusals as generic
timeouts.

### Phase 3: Backend-Parity Normalization

- [ ] Normalize API/local backend `429`/`403`/`5xx` responses into the same
      refusal contract.
- [ ] Normalize agent-backend HTTP/websocket refusals into the same contract.
- [ ] Ensure local-runtime failures such as missing/closed Ollama daemons are
      surfaced as transport/local availability failures instead of generic
      provider silence.
- [ ] Feed normalized refusal events into runtime metering/incident state so
      diagnostics and `/providers/config` summaries remain aligned.

**Deliverables**: all backend families report refusal/overload states through
one shared shape.

### Phase 4: Honest HTTP and UI Surfacing

- [ ] Update session/message/playground/dashboard execution paths so the
      frontend receives truthful refusal details instead of a generic timeout.
- [ ] Preserve the user-selected provider/model in error rendering; do not
      silently auto-fallback to another model.
- [ ] Show short operator-safe guidance such as:
      "provider capacity exhausted; retry later or choose another model"
      without pretending the runtime made that choice automatically.
- [ ] Keep advanced guardrail, cooldown, and metering surfaces additive rather
      than forcing the user into setup flows just to understand an execution
      failure.

**Deliverables**: product surfaces tell the user what the provider actually
said and let the user decide the next step.

### Phase 5: Evidence, Tests, and Hardening

- [ ] Add provider-focused regression tests for explicit refusal signals across
      the highest-value providers.
- [ ] Add shared `WorkerProcess` tests covering:
      refusal-on-stderr, refusal-before-first-event, structured API refusal,
      and true timeout separation.
- [ ] Capture representative evidence samples for volatile providers so future
      upstream behavior changes are reviewable.
- [ ] Document the truthfulness contract so future provider additions do not
      regress into "timeout by default" behavior.

**Deliverables**: refusal surfacing remains stable as providers evolve.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/backends/cli/pool/WorkerProcess.ts` | Modify | Stop generic first-event timeout from hiding explicit provider refusals |
| `src/backends/cli/providers/types.ts` | Modify | Add provider-facing refusal classification seam if needed |
| `src/backends/cli/providers/*.ts` | Modify | Add provider-specific refusal parsing where the shared path is insufficient |
| `src/core/types.ts` | Modify | Define a runtime-owned normalized refusal/error shape if it belongs in shared types |
| `src/core/usage/*` | Modify | Align incident detection/guardrails with the normalized refusal shape |
| `src/http/routes/messages.ts` | Modify | Surface truthful provider failures through message/send flows |
| `src/http/routes/sessions.ts` | Modify | Preserve truthful execution failure details in session state where applicable |
| `public/index.html` | Modify | Render truthful refusal details in dashboard chat/session surfaces |
| `public/playground.html` | Modify | Render truthful refusal details in playground agent execution surfaces |
| `src/backends/cli/pool/WorkerProcess.test.ts` | Modify | Cover refusal-vs-timeout behavior for ephemeral CLI providers |
| `tests/runtime-server.test.ts` | Modify | Cover truthful HTTP/UI surfacing for execution failures |
| `docs/research/*` | Modify/Create as needed | Capture replayable refusal evidence for volatile providers |

## Technical Decisions

- Decision 1: Provider truth beats synthetic timeout. If the provider emitted a
  recognizable refusal, the runtime must surface that refusal instead of a
  generic timeout.
- Decision 2: The runtime must not silently change models. Model fallback is a
  separate product capability and is explicitly out of scope for this work.
- Decision 3: One shared refusal contract should span CLI, API/local, and agent
  backends; backend-specific strings alone are not sufficient.
- Decision 4: Metering and guardrails should consume the same normalized
  refusal facts that user-facing chat flows surface.
- Decision 5: "True timeout" remains a valid category, but only when the runtime
  genuinely did not receive a stronger upstream signal.

## Testing Strategy

- **Unit Tests**:
  cover refusal classification, retryability flags, provider-specific stderr
  parsing, API/local refusal normalization, and timeout-vs-refusal precedence
- **Integration Tests**:
  cover HTTP session/message flows and provider summaries so explicit refusals
  reach callers without being rewritten as generic timeouts
- **Manual Testing**:
  trigger known refusal scenarios such as Gemini capacity exhaustion, missing
  Ollama daemon, auth-required CLI states, and anti-abuse/rate-limit outputs;
  verify the UI shows truthful guidance without changing the chosen model

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overfitting to one provider's phrasing | High | Keep a shared failure contract plus provider-specific evidence-backed classifiers |
| False-positive refusal classification from incidental stderr text | High | Require strong signatures, structured codes when available, and regression evidence samples |
| UI overwhelm from dumping raw upstream errors | Medium | Separate operator-safe summary from raw details while preserving both for diagnostics |
| Reusing metering incidents directly for user-facing errors leaks internal semantics | Medium | Keep user-facing refusal rendering additive; do not force metering-only language into chat flows |
| Future providers regress to generic timeout handling | High | Add shared `WorkerProcess` tests and provider onboarding guidance tied to this plan |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-31 | Plan created after investigating Gemini CLI `429 MODEL_CAPACITY_EXHAUSTED` being surfaced as a generic runtime timeout |

---

*Created: 2026-03-31*
*Author: Codex*
