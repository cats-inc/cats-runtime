# PLAN-018: Advanced Provider Model Catalog and Selection Schema

> Implementation plan for shipping `SPEC-018` in `cats-runtime` with strict
> additive migration discipline so upgraded runtime builds land before `cats`
> follow-up work without breaking existing product consumers.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / Claude follow-up |

## Related Spec / Decisions

- [SPEC-018: Advanced Provider Model Catalog and Selection Schema](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [ADR 022: Model Advanced Selection as Entries, Presets, and Provider-Specific Controls](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md)
- Supporting baseline:
  [SPEC-004: Provider Model Catalog and Discovery](../specs/SPEC-004-provider-model-catalog-and-discovery.md)
- Supporting baseline:
  [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](../decisions/008-runtime-owned-provider-model-catalog.md)

## Migration-First Framing

This is not a greenfield feature. `cats-runtime` already ships:

- `GET /providers/{provider}/models` in
  `src/http/routes/providers.ts` backed by
  `src/core/models/providerModelCatalog.ts`
- session create/view flows in `src/http/routes/sessions.ts`
- persisted session state in `src/backends/cli/pool/SessionRegistry.ts`
- session serialization in `src/backends/cli/pool/sessionView.ts`
- runtime session/public types in `src/core/types.ts`
- backend execution seams that still treat `model` as the primary executable
  selector:
  `ProviderSpawnOptions`, `ProviderTurnOptions`, `ApiCompletionInput`,
  `AgentInvokeInput`, and provider modules under `src/backends/*`

Runtime upgrades must land before `cats` product updates. The first rollout
therefore has to preserve current behavior for existing `cats` consumers.

### Compatibility Rules

- Keep `GET /providers/{provider}/models` as the lightweight compatibility
  surface for current `cats` consumers.
- First rollout is additive only:
  new route, new internal types, new additive session fields.
- Existing request shapes that only send `model` must continue to work.
- Existing response fields, especially top-level session `model`, must remain
  present during migration.
- `cats` must keep working unchanged against the upgraded runtime before any
  product-side follow-up ships.
- Any change that would remove, repurpose, or make existing `model` fields or
  the v1 provider-model route obsolete is deferred to a later coordinated phase
  and blocked on `cats` follow-up.

## Contract Separation

The implementation has to keep these concepts separate from the start:

- **Concrete entries**:
  runtime-resolvable executable choices. Their ids are the only values that may
  populate the legacy `model` compatibility snapshot.
- **Normalized presets**:
  small cross-provider intent shortcuts such as `fast` or `deep_reasoning`.
  Presets are not executable entries and are not raw provider payloads.
- **Provider-specific controls**:
  schema-driven knobs exposed as stable runtime keys, including namespaced keys
  such as `openai.reasoning_effort` when the control is provider-specific.
- **Authoritative structured selection**:
  the persisted session intent object, exposed as additive session
  `modelSelection`, that records chosen entry mode, optional preset, and
  explicit control values.
- **Legacy `model` compatibility snapshot**:
  the currently resolved concrete entry id kept for existing callers and
  existing backend execution seams. It remains available, but it is not the
  authoritative representation after structured selection lands.

## Scope

### In Scope

- add a parallel advanced provider-model catalog contract
- add a runtime-owned knowledge layer for entries, presets, and controls
- add an additive advanced catalog route
- add additive session-level structured selection support
- persist authoritative selection and resolved compatibility snapshot together
- add a runtime resolution pipeline from selection to backend execution input
- stage backend support by capability instead of forcing parity everywhere
- add compatibility, resolution, persistence, and route coverage

### Explicitly Deferred / Blocked

- removing or repurposing top-level session `model`
- removing or repurposing `GET /providers/{provider}/models`
- making structured selection mandatory on public write surfaces
- public per-message structured overrides in `POST /sessions/{id}/messages`
- renderer redesign or setup/install UX work in `cats`
- pretending every backend/provider supports one universal advanced-control API

## Planned Work Areas

| Area | Files / Modules | Planned Work |
|------|-----------------|--------------|
| Advanced catalog core | `src/core/models/*` | New advanced catalog types, provider knowledge, augmentation, and resolution helpers |
| Public session types | `src/core/types.ts` | Add structured selection and resolved snapshot types while keeping legacy `model` fields |
| Session persistence / views | `src/backends/cli/pool/SessionRegistry.ts`, `src/backends/cli/pool/sessionView.ts` | Persist and expose authoritative selection plus resolved snapshot |
| Provider routes | `src/http/routes/providers.ts` | Add `GET /providers/{provider}/models/advanced` without breaking v1 |
| Session routes | `src/http/routes/sessions.ts`, plus session snapshot consumers such as `observe` / `history` where needed | Accept additive structured selection and return additive session fields |
| Runtime execution | `src/core/runtime/RuntimeSessionManager.ts`, `src/backends/api/*`, `src/backends/agent/*`, `src/backends/cli/providers/*` | Resolve structured selection into backend-private execution input while preserving legacy `model` handoff during migration |
| Verification | `src/core/models/*.test.ts`, `tests/runtime-server.test.ts`, backend tests, session tests | Add compatibility, route, precedence, and persistence coverage |
| Documentation follow-through | `docs/api.md`, `docs/architecture.md` | Update only after implementation lands; not part of this planning-only task |

## Type Ownership

### Runtime Core / Model Catalog Layer

Add new route-neutral types in `src/core/models/*` for:

- advanced catalog entry definitions
- preset definitions and applicability
- provider-specific control schema
- default selection for a target
- provider knowledge records
- dynamic augmentation records
- resolution input / output for backend execution

This layer owns provider truth and execution mapping hints. It should be the
only place that understands how:

- a preset can prefer a different concrete entry
- a control applies only to a subset of entries
- a control maps to API payload fields, CLI flags, or other backend-specific
  mechanics

### Session / Public Contract Layer

Add new public session-facing types in `src/core/types.ts` for:

- authoritative `modelSelection`
- latest `modelResolution`
- compact additive session read-model fields that can appear in list/detail
  responses without exposing backend-private wire details

### Legacy Fields That Stay During Migration

Retain these legacy fields as compatibility and execution snapshots during the
first rollout:

- `SessionInfo.model`
- `SessionView.model`
- `SessionBranchRequest.model`
- `ProviderSpawnOptions.model`
- `ProviderTurnOptions.model`
- `ApiCompletionInput.model`
- `AgentInvokeInput.model`

The rule is:

- new public structured selection becomes authoritative
- top-level `model` stays as the resolved concrete-entry snapshot
- backends continue to receive `model` until each backend path is upgraded to
  consume richer resolved execution input safely

### Upper-Layer Boundary Guard

Upper layers such as `cats` may consume:

- entry ids
- preset ids
- runtime-owned control keys and schema
- resolved compatibility snapshot

Upper layers must not consume:

- raw vendor request-body templates
- CLI flag names as product contract
- provider adapter implementation details
- arbitrary vendor `/models` payloads

## Public API Migration

### 1. Keep the v1 Catalog Stable

`GET /providers/{provider}/models` remains the compatibility surface.

First-rollout rule:

- do not remove fields
- do not rename fields
- do not require consumers to switch routes
- do not stuff advanced catalog schema into the v1 route just because it is
  additive

The safest first rollout is to leave the v1 response shape materially unchanged
and add all advanced schema on a new route.

### 2. Add the Advanced Catalog Route

Add:

```text
GET /providers/{provider}/models/advanced?instance={id}
```

The new route should reuse existing provider-target resolution and error-code
semantics from the v1 route, then return:

- resolved `provider`, `backend`, and `instance`
- advanced `entries`
- normalized `presets`
- provider-specific `controls`
- `defaultSelection`
- additive provenance, availability, and warning metadata where useful

This route must stay runtime-owned and must not expose raw vendor discovery
payloads directly.

### 3. Extend Session Create Additively

`POST /sessions` keeps accepting the current shape and adds an optional
`modelSelection` field.

Migration behavior:

- legacy-only request:
  accept existing `model` and synthesize `modelSelection` internally
- structured-only request:
  resolve it and populate legacy `model` snapshot on the created session
- dual-write request:
  accept only if legacy `model` matches the resolved structured result
- conflicting dual-write request:
  reject with client error instead of silently rewriting one field

This keeps the old request shape accepted while enabling additive adoption by
newer callers.

### 4. Extend Session View / Inspection Additively

Session responses should add:

- additive `modelSelection`
- additive `modelResolution`

while preserving:

- top-level `model`
- existing response fields and route shapes

Detail routes and create/resume/fork responses should all expose the same
session-level selection fields. List responses may use the same field names
with a compact representation, but they should not invent a second schema.

For inspection-style responses, the same `modelResolution` snapshot should be reused
instead of creating a separate authoritative source. If a future per-request
override makes the active run differ from session defaults, inspection may add
run-scoped resolved details, but the session-level snapshot remains canonical
for the persisted session contract.

## Provider Knowledge Strategy

### Curated Runtime-Owned Knowledge

The baseline truth for advanced selection should come from runtime-owned
curated knowledge shipped with `cats-runtime`.

That knowledge should define, per provider target family/backend:

- concrete entries
- preset vocabulary actually supported by that target
- control schema, scope, and applicability
- default selection
- resolution hints from selection to backend execution

### Dynamic Discovery / Augmentation

Dynamic discovery should augment curated knowledge, not replace it.

Allowed augmentation examples:

- entry availability
- entry running/warm-state hints
- configured default model hints
- safe limit facts such as context-window metadata
- applicability or warning metadata when runtime can verify it honestly

Current augmentation sources already present in the codebase should be reused
where possible:

- `ProviderModelCatalogService` dynamic discovery for `ollama`
- agent adapter `listModels()`
- runtime-owned active-config inspection
- configured remote/default model metadata

### Do Not Leak Raw Vendor Payloads

Dynamic discovery payloads must be mapped into runtime schema before they leave
the runtime boundary. The advanced catalog contract is runtime-owned, not a
pass-through of vendor JSON.

## Resolution and Precedence Plan

### Entry Resolution

The runtime resolver should determine the concrete executable entry first.

Resolution rules:

1. If `entryMode` is `explicit`, the chosen entry is pinned.
2. If `entryMode` is `auto`, start from the requested `entryId` when present,
   otherwise the target default entry.
3. If `entryMode` is `auto` and the selected preset has a
   `preferredEntryId`, the runtime may switch to that preferred entry.
4. If `entryMode` is `explicit`, a preset must not silently replace the entry.
   Incompatible combinations should be rejected or surfaced as unavailable.

### Control / Default Precedence

The resolver must apply values in this order:

1. entry defaults
2. preset defaults
3. session-level explicit control values
4. per-request explicit overrides

This means:

- presets are default bundles, not immutable modes
- explicit controls beat preset defaults
- request overrides beat session defaults for that request only

### Public Surface vs Internal Readiness

The resolver should accept optional request-scoped overrides internally even if
the first public HTTP rollout only exposes session-level structured selection.
That keeps the precedence model stable without forcing `POST /sessions/{id}/messages`
to grow in the same rollout.

### Legacy Snapshot Rule

After resolution:

- the legacy top-level `model` snapshot must equal the resolved concrete entry
  id used for execution
- controls and presets do not replace `model`; they augment or influence how it
  was resolved

## Backend Impact Map

| Backend | First-Rollout Expectation | Deferred / Follow-On |
|---------|---------------------------|----------------------|
| `api` | Best candidate for first end-to-end structured execution support because payload mapping already centralizes in transports | Expand control mapping provider-by-provider once schema is validated |
| `local` | Support advanced catalog reads and entry-resolution first; keep control support limited to what the transport can apply honestly | Add richer local-model control support only when real transport semantics exist |
| `cli` | Keep `ProviderSpawnOptions.model` as compatibility handoff; support entry-resolution broadly, then add control execution provider-by-provider where stable CLI flags or config seams exist | Do not promise parity for every CLI wrapper in the first rollout |
| `agent` | Support advanced catalog reads and session contract reads; first rollout may still collapse execution to resolved `model` snapshot only | Add structured control execution only after adapter capability contracts expand |

### Backend Staging Rules

- No backend needs full advanced-control parity to ship the first additive
  read/write migration.
- Targets that cannot execute a requested control set yet must surface those
  controls as unavailable or reject the combination at session-create time.
- The runtime must not silently drop provider-specific controls just to claim
  parity.

## Implementation Phases

### Phase 1: Advanced Catalog Core Types and Migration Contract Freeze

- [ ] Add parallel advanced catalog types under `src/core/models/*`
- [ ] Keep the existing v1 `ProviderModelCatalogResult` contract stable
- [ ] Add public structured-selection and resolved-snapshot types in
      `src/core/types.ts`
- [ ] Define mapping rules between legacy `model` and new selection/resolution
      fields
- [ ] Add validation helpers for `entryMode`, namespaced control keys, control
      value kinds, and scope/applicability

**Deliverables**: a frozen additive contract foundation that does not mutate the
existing v1 provider-model or session `model` surfaces.

### Phase 2: Provider Knowledge Layer for Entries, Presets, and Controls

- [ ] Add runtime-owned curated knowledge modules for advanced entries,
      presets, controls, and default selections
- [ ] Encode preset applicability and preferred-entry metadata explicitly
- [ ] Encode control applicability, scope, and semantic tags explicitly
- [ ] Reuse current discovery / active-config seams only as augmentation over
      curated knowledge
- [ ] Establish a support matrix that marks targets as:
      full-resolution, entry-resolution-only, or read-contract-only

**Deliverables**: a truthful knowledge layer that separates concrete entries,
normalized presets, and provider-specific controls without leaking raw vendor
payloads.

### Phase 3: Additive Route `GET /providers/{provider}/models/advanced`

- [ ] Add an advanced catalog service that resolves provider target plus
      knowledge plus dynamic augmentation
- [ ] Add `GET /providers/{provider}/models/advanced`
- [ ] Reuse current target-resolution and error semantics from the v1 route
- [ ] Return `entries`, `presets`, `controls`, `defaultSelection`, and additive
      provenance/warnings
- [ ] Add regression tests that prove `GET /providers/{provider}/models`
      remains stable during the rollout

**Deliverables**: a new advanced read contract with no breaking change to the
current v1 catalog route.

### Phase 4: Structured Selection Contract in Session Create / View

- [ ] Extend `POST /sessions` with an additive `modelSelection` field
- [ ] Keep legacy `model`-only create payloads accepted and internally map them
      to `modelSelection`
- [ ] Validate dual-write payloads and reject ambiguous mismatches
- [ ] Persist authoritative `modelSelection` plus resolved `modelResolution` in
      `SessionRegistry`
- [ ] Update session serialization so create/list/detail/resume/fork responses
      expose structured selection additively while preserving top-level `model`
- [ ] Re-resolve the compatibility snapshot on create, resume, and fork without
      mutating the authoritative selection on simple reads

**Deliverables**: session APIs gain structured selection additively while
remaining backward-compatible for existing callers.

### Phase 5: Resolution Pipeline from Selection to Backend Execution Args

- [ ] Add a runtime resolver that converts target + structured selection +
      optional request overrides into:
      resolved entry, legacy model snapshot, resolved control map, warnings,
      and backend-private execution details
- [ ] Enforce precedence:
      entry defaults -> preset defaults -> explicit session controls ->
      per-request overrides
- [ ] Enforce explicit pin vs auto-resolution behavior
- [ ] Wire the resolver into create/resume/fork/message execution paths so
      session defaults drive backend input even before public message overrides
      exist
- [ ] Keep existing backend `model` handoff populated from the resolved
      compatibility snapshot while each backend path gains richer support
- [ ] Roll out execution support in tiers:
      API first, local entry-first, CLI provider-by-provider, agent read-only
      beyond resolved `model` in the first rollout

**Deliverables**: one runtime-owned path from structured selection to actual
backend execution, without forcing every backend to understand raw public
selection objects directly.

### Phase 6: Compatibility Hardening, Documentation, and Verification

- [ ] Add advanced catalog route tests for entries, presets, controls,
      default-selection, and warning/provenance behavior
- [ ] Add preset/control applicability tests
- [ ] Add explicit-vs-auto resolution tests
- [ ] Add precedence tests covering preset defaults, explicit controls, and
      request overrides
- [ ] Add backwards-compatibility tests for the v1 route and legacy
      `POST /sessions` payloads
- [ ] Add session persistence / hydration tests for save-load-resume-fork flows
- [ ] Update `docs/api.md` and `docs/architecture.md` after implementation
      lands

**Deliverables**: a verified additive rollout with docs and coverage aligned to
the shipped contract.

### Phase 7: Coordinated Cleanup and Contract Tightening

Blocked on coordinated `cats` changes.

- [ ] Deprecate or remove legacy-only write assumptions only after `cats`
      sends structured selection reliably
- [ ] Revisit whether `GET /providers/{provider}/models` can be downgraded to a
      fallback-only surface after product migration is complete
- [ ] Revisit whether top-level session `model` can become explicitly marked
      compatibility-only or be removed in a later major-contract change
- [ ] Add public per-message structured overrides only after the product/API
      follow-up is ready to consume them

**Deliverables**: explicit cleanup work that is intentionally not part of the
first additive runtime rollout.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/models/providerAdvancedCatalog.ts` | Create | Shared advanced catalog types and read-model builders for entries, presets, controls, and default selections |
| `src/core/models/providerAdvancedKnowledge.ts` | Create | Runtime-owned curated provider knowledge for advanced entries, presets, controls, and support tiers |
| `src/core/models/providerSelectionResolution.ts` | Create | Runtime resolver from `modelSelection` to `modelResolution`, compatibility snapshot, and backend-private execution details |
| `src/core/models/providerModelCatalog.ts` | Modify | Keep v1 catalog stable while sharing target resolution and augmentation inputs with the advanced layer |
| `src/core/types.ts` | Modify | Add additive public `modelSelection` and `modelResolution` session contract types |
| `src/backends/cli/pool/SessionRegistry.ts` | Modify | Persist authoritative `modelSelection` plus resolved `modelResolution` next to legacy `model` |
| `src/backends/cli/pool/sessionView.ts` | Modify | Expose additive session selection fields without breaking existing session payloads |
| `src/http/routes/providers.ts` | Modify | Add `GET /providers/{provider}/models/advanced` while keeping the v1 route unchanged |
| `src/http/routes/sessions.ts` | Modify | Accept additive `modelSelection`, validate dual-write payloads, and serialize selection/resolution state |
| `src/core/runtime/RuntimeSessionManager.ts` | Modify | Thread resolved selection output into create/resume/fork/message execution flows |
| `src/backends/api/*` | Modify | Consume resolved backend-private execution details where API transports can support them honestly |
| `src/backends/agent/*` | Modify | Support advanced read contract and keep execution on resolved `model` snapshot until adapter capability expansion lands |
| `src/backends/cli/providers/*` | Modify | Roll out provider-by-provider control execution only where CLI surfaces expose stable semantics |
| `src/core/models/*.test.ts` | Modify/Create | Add advanced catalog, knowledge, and resolution coverage |
| `tests/runtime-server.test.ts` | Modify | Add route-level compatibility and advanced catalog regressions |
| `src/http/*session*.test.ts`, `tests/*backend*.test.ts` | Modify | Add persistence, hydration, and backend support-tier coverage |
| `docs/api.md` | Modify (follow-on) | Document additive advanced route and session contract after implementation lands |
| `docs/architecture.md` | Modify (follow-on) | Document the advanced catalog / resolution layer after implementation lands |

## Technical Decisions

- Keep `GET /providers/{provider}/models` as the stable compatibility route and
  introduce advanced schema only on
  `GET /providers/{provider}/models/advanced`.
- Make additive session `modelSelection` the authoritative persisted intent
  object while keeping top-level `model` as the resolved compatibility
  snapshot.
- Persist authoritative selection and resolved snapshot side-by-side instead of
  trying to infer one from the other on every read.
- Treat advanced entries, presets, and controls as runtime-owned curated
  knowledge that dynamic discovery may augment, but not redefine.
- Enforce one precedence order everywhere:
  entry defaults -> preset defaults -> explicit session controls ->
  per-request overrides.
- Enforce one entry-resolution rule everywhere:
  `entryMode=auto` may switch to preset-preferred entries, while
  `entryMode=explicit` must never be silently rewritten.
- Roll out backend execution support by support tier, not by pretending every
  backend reaches full advanced-control parity in the first slice.
- Defer any cleanup that would tighten or remove current public contracts until
  coordinated `cats` follow-up work is ready.

## Testing Strategy

- **Advanced catalog route tests**:
  cover target resolution, route shape, warnings, provenance, and default
  selection on `GET /providers/{provider}/models/advanced`
- **Preset / control applicability tests**:
  prove unsupported combinations are surfaced through applicability metadata
  instead of guessed in the UI
- **Explicit-vs-auto resolution tests**:
  prove preset-preferred entry switching is allowed only for `entryMode=auto`
  and never silently rewrites explicit pins
- **Precedence tests**:
  prove the merge order is entry defaults, preset defaults, session controls,
  then request overrides
- **Backwards compatibility tests**:
  snapshot or assert unchanged v1
  `GET /providers/{provider}/models` output and legacy `POST /sessions`
  behavior
- **Session persistence / hydration tests**:
  cover registry save/load, resume, fork, and detail/list serialization so
  authoritative selection and resolved snapshot survive round-trips cleanly
- **Backend support-tier tests**:
  prove unsupported targets reject or mark unavailable controls instead of
  silently accepting them
- **Manual Testing**:
  - call `GET /providers/{provider}/models` for representative providers before
    and after the change and confirm the v1 route shape remains unchanged
  - call `GET /providers/{provider}/models/advanced` for representative `cli`,
    `api`, `local`, and `agent` targets and verify entries/presets/controls are
    surfaced through runtime schema rather than raw vendor payloads
  - create a session with only legacy `model` and verify runtime synthesizes
    `modelSelection`, returns additive `modelResolution`, and preserves the
    existing top-level `model`
  - create a session with only `modelSelection` and verify runtime resolves a
    compatible top-level `model`
  - send a dual-write create payload with mismatched `model` and
    `modelSelection` and verify the runtime rejects it instead of silently
    rewriting either field
  - persist, reload, resume, and fork sessions that carry `modelSelection` to
    verify authoritative selection survives registry round-trips and the
    resolved compatibility snapshot stays stable

## Risks & Scope Guards

| Risk / Drift | Guard |
|--------------|-------|
| `SPEC-018` turns into a breaking rewrite of current `cats-runtime` contracts | Keep the v1 route and legacy session `model` surface intact for the first rollout |
| Concrete entries, presets, and controls collapse into one vague schema | Keep three separate type families and resolver stages |
| Raw vendor payloads leak into product contracts | Require runtime-owned mapping from discovery payloads into advanced catalog schema |
| A fake universal "thinking" API hides real provider differences | Keep preset vocabulary intentionally small and use provider-specific control namespaces where needed |
| Backend parity work expands without bound | Ship support tiers; mark unavailable or reject unsupported controls instead of pretending support |
| Scope expands into renderer or setup redesign work | Treat UI redesign and provider install/setup UX overhaul as explicitly out of scope |

## Rollout Checklist

- [ ] `GET /providers/{provider}/models` remains backward-compatible
- [ ] `GET /providers/{provider}/models/advanced` exists and returns advanced
      schema
- [ ] `POST /sessions` accepts both legacy `model` and additive structured
      selection
- [ ] session read surfaces expose additive `modelSelection` plus
      `modelResolution` while preserving top-level `model`
- [ ] resolver enforces explicit pin vs auto behavior and precedence ordering
- [ ] unsupported backend/target combinations reject or mark unavailable
      controls instead of silently dropping them
- [ ] backend support tiers are documented in code/tests/docs
- [ ] any contract-tightening cleanup is parked in the blocked coordinated
      follow-up phase

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-25 | Plan created for `SPEC-018` with additive migration discipline, runtime-first rollout ordering, and explicit compatibility rules for existing `cats` consumers |

---

*Created: 2026-03-25*
*Author: Codex*
