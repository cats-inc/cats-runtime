# PLAN-021: Provider Evolution Evidence and Capability Probes

> Implementation plan for manual-first provider evolution detection in
> `cats-runtime`, focused on collecting evidence for upstream CLI and future
> agent-backend event changes without introducing always-on self-adaptation.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | TBD |
| **Reviewer** | User |

## Related Spec / Decisions

- [SPEC-021: Provider Evolution Evidence and Capability Probes](../specs/SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [ADR-025: Keep provider evolution detection manual-first and evidence-driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-026: Model A2A as an agent backend adapter](../decisions/026-model-a2a-as-an-agent-backend-adapter.md)
- Background audit:
  [2026-03-27 CLI Provider Event Capability Audit](../research/2026-03-27-cli-provider-event-capability-audit.md)
- Background framing:
  [2026-03-27 Provider Evolution Evidence Framework](../research/2026-03-27-provider-evolution-evidence-framework.md)

## Manual-First Framing

This plan does not build an automatic self-healing parser system.

The first rollout is intentionally narrow:

- collect evidence about what upstream providers actually emit
- compare current probe output to prior baselines
- let maintainers decide when adapters need updates

It must not:

- continuously probe on end-user machines
- mutate adapter logic automatically
- require a dashboard or public HTTP route in the first slice
- assume all transports look like CLI line streams

The design should be rich enough to support later protocol-backed adapters such
as A2A, but the first implementation focus is provider adapters that already
exist in the runtime.

## Scope

### In Scope

- adapter-level instrumentation for ignored, unknown, normalized, and
  schema-failure paths
- a shared evidence collector
- a manual probe entrypoint for targeted provider runs
- machine-readable evidence bundles and capability snapshots
- baseline snapshot storage and compare output
- first-pass classification for:
  - upgrade
  - regression
  - schema change
  - semantic drift suspicion

### Explicitly Deferred

- always-on background probing
- automatic parser/schema upgrades
- end-user dashboard or host-app UI integration
- automatic release-note scraping
- full semantic-drift automation beyond heuristics and review hints

## Implementation Phases

### Phase 1: Adapter Instrumentation and Observable Drops

- [x] Audit provider adapters for meaningful `return null` / ignored-event paths
- [x] Add thin instrumentation hooks so adapters can record:
      `ignored`, `unknown`, `normalized`, and `schema_failure`
- [x] Ensure existing normal runtime behavior is preserved when probe collection
      is disabled
- [x] Keep provider-specific parsing rules adapter-owned; do not move parser
      logic into a generic collector

**Deliverables**: adapters can expose what they currently normalize, ignore, or
drop without yet changing host-facing UX.

### Phase 2: Shared Evidence Collector and Bundle Shape

- [x] Add a shared runtime-owned evidence collector
- [x] Define a stable evidence bundle shape including:
      provider, instance, version, probe profile, timestamps, raw samples,
      normalized samples, ignored counts, and schema failures
- [x] Support transport-neutral evidence capture so future protocol-backed
      adapters are not forced into line-oriented assumptions
- [x] Add serialization/storage helpers for evidence bundle output

**Deliverables**: a reusable collector that can accumulate comparable evidence
across providers without duplicating bookkeeping in every adapter.

### Phase 3: Manual Probe Entry and Probe Profiles

- [x] Add a manual probe command or internal runtime entrypoint
- [x] Support targeting by provider, optional instance, and optional model or
      probe profile
- [x] Define a small set of deterministic probe profiles that try to elicit:
      incremental text, tool use, tool result, progress, and final result
- [x] Ensure probes can run without requiring host-app routes or UI

**Deliverables**: maintainers can manually run a repeatable probe and produce an
evidence bundle for a selected provider profile.

### Phase 4: Capability Snapshot and Baseline Compare

- [x] Derive a capability snapshot from each evidence bundle
- [x] Track at minimum:
      incrementalText, toolUse, toolResult, progress, finalResult,
      ignoredEventTypes, and schemaFailures
- [x] Define baseline artifact storage for previous probe snapshots
- [x] Add compare output that highlights:
      added event types, removed event types, event frequency drops, and newly
      failing schema paths

**Deliverables**: current probe results can be compared against prior baselines
to classify likely upgrades, regressions, and schema changes.

### Phase 5: Semantic Drift Heuristics and Review Output

- [x] Add weak-signal heuristics for semantic drift warnings
- [x] Keep semantic drift classification advisory rather than blocking
- [x] Produce human-readable summaries that distinguish:
      evidence, classification, and external context
- [x] Add hooks or fields for attaching release-note/changelog references
      without mixing them into runtime evidence

**Deliverables**: maintainers get reviewable output that can say "something
changed" without pretending the runtime can fully self-interpret all changes.

### Phase 6: Test Coverage and Provider Rollout Order

- [x] Add unit tests for collector bookkeeping, snapshot derivation, and compare
      logic
- [x] Add integration tests for adapter instrumentation where stable fixtures
      exist
- [x] Start rollout with the richest/highest-value providers first:
      Codex, Copilot, Pi, Goose, Gemini, Claude
- [x] Defer thin/noisy providers where instrumentation has limited value until
      the framework is stable

**Deliverables**: the framework is verified against at least a representative
subset of high-signal providers before it expands further.

### Phase 7: Follow-Through Into Agent Backends

- [x] Audit whether OpenClaw and Agent SDK adapters should emit comparable
      evidence through the same collector
- [x] Keep the collector transport-neutral enough for future A2A adapters
- [x] Document any adapter-specific gaps revealed by the first rollout
- [x] Defer any A2A-specific implementation details until a concrete adapter
      plan is approved

**Deliverables**: the framework remains future-compatible with `agent` backend
expansion without blocking the first CLI-focused slice.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/backends/cli/**` | Modify | Add provider-specific instrumentation for ignored/unknown/schema-failure paths |
| `src/backends/agent/**` | Audit / minimal modify | Ensure future compatibility with the shared evidence collector without forcing first-slice implementation |
| `src/core/**` | Create/Modify | Add shared evidence collector, snapshot derivation, and compare helpers |
| `src/http/routes/diagnostics.ts` | Optional later modify | Only if a later slice exposes probe summaries through diagnostics |
| `tests/**/*.test.ts` | Create/Modify | Add collector, snapshot, compare, and adapter instrumentation coverage |
| `docs/api.md` | Deferred | Only if a public/manual probe route is later exposed |
| `docs/architecture.md` | Follow-on | Document the evidence collector and manual probe boundary after implementation lands |

## Technical Decisions

- Keep provider-specific parsing logic in adapters; only the evidence bookkeeping
  should be shared.
- Record ignored/unknown/schema-failure events even when they are not promoted
  into normalized runtime events.
- Treat semantic drift as heuristic evidence, not as an automatic breaking
  verdict.
- Keep first-slice probe execution manual-first and developer/operator initiated.
- Keep the evidence collector transport-neutral so future A2A-backed agent
  adapters can reuse it.

## Testing Strategy

- **Unit Tests**:
  collector counters, evidence bundle assembly, snapshot derivation, baseline
  compare, semantic-drift heuristics
- **Integration Tests**:
  adapter instrumentation for representative providers, probe command output,
  compare output against fixture baselines
- **Manual Testing**:
  run the probe command against selected provider instances, inspect evidence
  bundle artifacts, compare against stored baselines, and verify the diff
  summary matches observed upstream changes

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Adapter instrumentation becomes provider-specific boilerplate everywhere | Medium | Keep instrumentation hooks thin and centralize evidence collection logic |
| The framework assumes CLI-only stream semantics and breaks future agent/A2A reuse | High | Keep collector transport-neutral and keep transport-specific parsing inside adapters |
| Semantic-drift heuristics create noisy false positives | Medium | Treat drift as advisory and require human review |
| Probe profiles become flaky or provider-version-sensitive | Medium | Keep profiles small, deterministic, and baseline them per provider family |
| Evidence collection expands into always-on overhead on user machines | High | Keep first slice manual-only and separate from normal runtime execution |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-27 | Plan created for adapter instrumentation, shared evidence collection, manual probe entry, baseline compare, and future agent-backend compatibility |
| 2026-03-27 | Core manual-first slices landed: high-value CLI adapters now emit transport-neutral evidence, manual probes persist capability snapshots with baseline compare and review summaries, retained artifact list/read commands exist, and diagnostics/provider-config surfaces can reuse the latest bounded summary without adding a public probe route |
| 2026-03-27 | Agent follow-through landed for the first OpenClaw and Agent SDK bridge targets; remaining work is now limited to optional release-note/changelog attachment and later breadth/depth expansion rather than missing core probe infrastructure |
| 2026-03-27 | Manual `reviewContext.references[]` attachment landed for probe artifacts through repeated `--probe-reference <kind=url>` flags, and the same separate-from-evidence context now flows through retained artifact summaries/read models without adding any new public probe route or automatic scraping behavior. |

---

*Created: 2026-03-27*
*Author: Codex*
