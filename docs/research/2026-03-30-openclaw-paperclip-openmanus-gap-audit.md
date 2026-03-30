# 2026-03-30 OpenClaw / Paperclip / OpenManus Gap Audit

## Scope

Audit `cats-runtime` durable project memory and current code against the local
submodule reference points:

- `../openclaw/`
- `../paperclip/`
- `../OpenManus/`

This note is a gap audit, not a recommendation to source-import or directly
integrate those submodules.

## Sources Reviewed

### `cats-runtime` durable docs

- `ROADMAP.md`
- `PROGRESS.md`
- `docs/decisions/*`
- `docs/specs/*`
- `docs/plans/*`

### `cats-runtime` code paths

- `src/backends/agent/**`
- `src/backends/api/runtime/strategies/**`
- `src/http/routes/diagnostics.ts`
- `src/http/routes/providers.ts`
- `src/http/sessionProviderTarget.ts`
- `src/core/tools/providerTooling.ts`

### Submodule reference points

- `../openclaw/docs/gateway/protocol.md`
- `../openclaw/docs/web/webchat.md`
- `../openclaw/src/gateway/server.tools-effective.test.ts`
- `../paperclip/doc/spec/agents-runtime.md`
- `../paperclip/packages/adapter-utils/src/types.ts`
- `../paperclip/server/src/services/heartbeat.ts`
- `../OpenManus/app/agent/react.py`
- `../OpenManus/app/flow/planning.py`

## Audit Summary

Most of the large architectural gaps that originally motivated
`cats-runtime` are now closed enough that the remaining differences are no
longer about missing backend families.

What the code already proves:

- OpenManus-style execution strategies are no longer the largest gap. The
  runtime already ships `simple_tool_call`, `react`, `plan_execute`, `pdca`,
  `reflexion`, `tree_of_thoughts`, and `deps` under
  `src/backends/api/runtime/strategies/`.
- The OpenClaw-aligned `agent` backend is real, not speculative. The codebase
  already has OpenClaw plus Agent SDK bridge adapters, shared inspection
  read-models, dynamic OpenClaw model discovery, and bounded remote tool
  catalog surfacing.
- Paperclip-aligned shared substrate work is largely in place for
  session/workspace/runtime boundaries. The largest remaining differences are
  operational maturity and semantic evidence depth, not missing core seams.

## Durable Doc Truth vs Code

### Broadly truthful

- `PLAN-020` and the OpenManus-oriented execution-strategy work are consistent
  with the shipped strategy substrate.
- `PLAN-004` is directionally correct that the first `agent` backend is in
  place and that follow-through now sits in richer probe/discovery work rather
  than basic adapter scaffolding.
- `ROADMAP.md` is not the primary source of current product gaps against
  OpenClaw/Paperclip/OpenManus. Its remaining items are mostly operational
  optimizations such as WSL discovery policy and browser hardening.

### Drift or ambiguity worth correcting later

- `PROGRESS.md` top-level status marks **Agent Backend** as `Completed`, while
  WP-4 still carries a concrete unchecked next step around broader remote tool
  discovery and stronger later-target semantic probes. The code matches the
  unchecked WP-4 note more closely than the top-level `Completed` label.
- `SPEC-003` still lists agent-managed runtime-service / preview surfacing as
  an open question, but the code already threads agent runtime services through
  provider state and browser/session preview surfaces. The open question is no
  longer whether surfacing exists; it is how far to deepen it.

## Largest Gap Groups

### 1. Agent remote-tool discovery breadth and later-target semantic probes

This is the largest still-open gap cluster.

Evidence:

- `PROGRESS.md` still explicitly calls out broader remote tool discovery and
  stronger later-target semantic validation.
- OpenClaw exposes both `tools.catalog` and session-scoped `tools.effective`,
  while `cats-runtime` currently only consumes the catalog path.
- The Agent SDK bridge probe is still mostly registry-depth:
  provider listed, configured model visible, streaming advertised, and
  registry-embedded tool metadata when present.

Why this is the highest-value next slice:

- It improves runtime-owned observability without changing upper-layer route
  shapes.
- It narrows a real code gap relative to OpenClaw rather than a hypothetical
  future integration.
- It directly answers the still-open `PROGRESS.md` / WP-4 follow-through.

### 2. Paperclip-style operational evidence depth inside runtime scope

`cats-runtime` should not import Paperclip heartbeat or company semantics, but
Paperclip still sets a higher bar for operator-facing execution evidence.

Remaining runtime-scope differences include:

- richer live semantic evidence per backend target
- stronger tool/runtime-service/work-product truth on host-facing read models
- more durable operator evidence for provider evolution and semantic drift

This is a real gap, but it depends on closing gap group 1 first because better
tool/service discovery creates the evidence foundation.

### 3. Work-product and runtime-service harvesting depth

Compared with Paperclip, `cats-runtime` still keeps a narrower boundary around
runtime services, previews, and externally owned work products.

This is a valid future track, but it is not the largest immediate gap because:

- session/browser preview surfacing already exists
- the currently larger missing truth is the breadth and specificity of remote
  tool/service discovery

### 4. OpenManus-style execution-loop substrate

This is no longer a leading gap group.

OpenManus still remains a useful reference point for planner/executor loop
behavior, but the execution-strategy substrate already exists in repo and is no
longer the most urgent missing capability.

## Recommended Slice Order

1. Add OpenClaw session-scoped effective tool discovery to the existing
   runtime-owned agent/tooling surface.
2. Tighten `PROGRESS.md` and `SPEC-003` truth after that code slice lands.
3. Reassess whether the next highest-value slice is:
   - stronger Agent SDK bridge semantic probing, or
   - richer runtime-service / work-product observability within existing
     session and diagnostics surfaces.

## Bottom Line

`cats-runtime` no longer mainly lags OpenClaw/Paperclip/OpenManus on backend
architecture. The biggest remaining gap is narrower and more concrete:

- richer agent-backed remote tool truth
- stronger later-target semantic probes
- then deeper operator evidence on top of that foundation

That makes OpenClaw-aligned `tools.effective` support the most defensible next
runtime slice.
