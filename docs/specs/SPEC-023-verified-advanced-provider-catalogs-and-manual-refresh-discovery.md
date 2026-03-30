# SPEC-023: Verified Advanced Provider Catalogs and Manual-Refresh Discovery

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` already owns provider model catalogs and advanced model
selection, but the current advanced-catalog slice blends truthful raw entries
with heuristic presets, controls, and support hints. It also lets routine UI
reads trigger live discovery work that is better suited to setup or diagnostics
surfaces.

This spec hardens the contract in two directions:

- advanced metadata must be conservative and verification-backed
- live discovery must move to explicit manual refresh instead of ordinary
  high-frequency read paths

The goal is not to remove runtime ownership. The goal is to keep that ownership
honest and operationally safe.

## Goals

- make advanced provider metadata truthful by default
- stop publishing guessed presets/controls for unverified provider targets
- move live discovery away from routine dashboard reads and into explicit setup
  or diagnostics refresh flows
- let `Create New Session` remain usable from cached/config/static entries even
  when live discovery is intentionally skipped
- support per-entry advanced control constraints so providers with different
  capabilities per model can be represented accurately

## Non-Goals

- guarantee full advanced-capability parity for every provider in one release
- remove the existing lightweight provider-model catalog routes
- make product UIs compare provider docs manually
- add background polling or scheduler-based model discovery
- redesign the entire session-selection contract from scratch

## User Stories

- As a runtime user, I want the advanced catalog to omit unknown controls
  instead of guessing and misleading me.
- As a product UI, I want a cache-first read contract so opening routine
  session-management surfaces does not cause hidden vendor probes.
- As a runtime maintainer, I want verified provider manifests with per-entry
  constraints so providers like Claude can express different effort options per
  model honestly.
- As an operator, I want explicit refresh and cooldown/backoff behavior so the
  runtime does not keep hammering upstream APIs or CLIs after failures.

## Requirements

### Functional Requirements

1. `cats-runtime` shall keep provider-model ownership in the runtime and shall
   continue exposing `GET /providers/{provider}/models` and
   `GET /providers/{provider}/models/advanced`.
2. Ordinary reads of those routes without explicit refresh shall be
   non-probing. They shall serve, in order:
   - in-memory cached snapshots when present
   - persisted last-successful discovery snapshots when present
   - config-derived fallback
   - static fallback
3. Live discovery against vendor APIs, local runtimes, or CLI subprocesses
   shall only happen through explicit manual refresh flows such as:
   - `?refresh=1` on catalog routes
   - setup/diagnostics refresh actions
   - future operator/admin-only refresh primitives
4. Session-management dashboard reads, including `Create New Session`, shall
   not trigger live discovery automatically.
5. `setup` and diagnostics surfaces shall become the canonical places to
   trigger live refresh and inspect refresh freshness, warnings, and cooldown
   state.
6. Advanced catalog `entries` may continue to derive from dynamic discovery,
   config fallback, or static fallback.
7. `presets`, `controls`, `defaultSelection`, and other advanced capability
   assertions shall only be emitted when the resolved provider target has
   verified runtime-owned advanced metadata for them.
8. Unverified targets shall degrade to conservative advanced catalogs:
   - `entries` remain available
   - `presets` shall be empty
   - `controls` shall be empty
   - `defaultSelection` shall be `null`
   - `support.tier` shall not claim `full`
9. The runtime shall not infer public preset applicability, control support,
   allowed values, or default selections solely from model-name regex when no
   verified provider metadata exists.
10. Advanced control schema shall support per-entry constraints. The public
    contract shall be able to express cases where one control:
    - exists for one entry but not another
    - allows different values on different entries
    - uses different defaults on different entries
11. A single global `values` list is insufficient when provider truth differs
    per entry. The advanced-catalog contract shall evolve additively with an
    entry-scoped constraint shape.
12. Runtime-owned provider capability manifests shall become the authoritative
    source for verified advanced metadata. Manifests shall describe at least:
    - supported presets per target
    - controls and value kinds
    - per-entry applicability
    - per-entry allowed values and defaults when they differ
    - optional evidence/provenance references
13. The runtime shall expose additive provenance and freshness information so
    callers can distinguish:
    - verified advanced metadata
    - conservative entry-only fallback
    - cached dynamic discovery snapshots
    - stale snapshots served during outage/cooldown conditions
14. Successful live discovery snapshots shall be persisted across process
    restarts with timestamps and source metadata.
15. Live-discovery failures such as auth-missing, timeout, rate-limit, or
    abuse-style responses shall be surfaced as warnings while falling back to
    cached/config/static data when possible.
16. Repeated refresh attempts after rate-limit or repeated probe failure shall
    honor cooldown/backoff instead of immediately retrying on every caller
    request.
17. UI surfaces that render advanced controls shall treat empty presets/controls
    on unverified targets as intentional omission, not as a reason to invent
    their own provider-specific heuristics.
18. `cats-runtime` shall own provider verification work. Users shall not be
    required to manually audit all providers before the runtime can present a
    safe contract.
19. The first safety slice may intentionally reduce currently exposed advanced
    metadata for many providers if that metadata is not yet verified.
20. Provider-specific manifests and discovery policy changes shall be covered by
    regression tests so future provider additions cannot silently reintroduce
    guessed advanced metadata on public routes.

### Non-Functional Requirements

- **Truthfulness**: public advanced metadata must be conservative; omission is
  preferred over incorrect claims
- **Operational safety**: routine dashboard usage must not create unnecessary
  upstream API or CLI pressure
- **Compatibility**: entry lists and legacy lightweight model routes remain
  available during migration
- **Extensibility**: verified provider manifests must be pluggable without
  pushing provider-specific logic into product UIs

## Design Overview

### Separation of Concerns

The hardening work introduces four distinct layers:

1. **Entry discovery**
   - dynamic, config, or static source of model ids and labels
2. **Persisted discovery snapshot**
   - last successful live refresh, freshness metadata, stale serving, cooldown
3. **Verified advanced metadata**
   - runtime-owned manifests for presets, controls, and per-entry constraints
4. **UI consumption policy**
   - dashboard/create-session uses cached truth only
   - setup/diagnostics owns manual refresh and capability inspection

### Illustrative Additive Shape

```json
{
  "provider": "claude",
  "backend": "cli",
  "instance": "default",
  "entries": [
    { "id": "claude-opus-4-6", "label": "opus 4.6", "default": true },
    { "id": "claude-sonnet-4-6", "label": "sonnet 4.6" },
    { "id": "claude-haiku-4-5", "label": "haiku 4.5" }
  ],
  "presets": [],
  "controls": [
    {
      "key": "claude.reasoning_effort",
      "label": "Reasoning effort",
      "kind": "enum",
      "scope": "both",
      "entryConstraints": {
        "claude-opus-4-6": {
          "values": ["low", "medium", "high", "max"],
          "default": "medium"
        },
        "claude-sonnet-4-6": {
          "values": ["low", "medium", "high"],
          "default": "medium"
        }
      }
    }
  ],
  "defaultSelection": null,
  "support": {
    "tier": "entry_only",
    "advancedMetadataStatus": "unverified_omitted",
    "discoveryMode": "manual_refresh"
  },
  "cache": {
    "servedFromCache": true,
    "cachedAt": "2026-03-30T10:00:00.000Z",
    "ttlSec": 3600,
    "stale": false
  },
  "warnings": []
}
```

The exact field names may evolve, but the contract must express both:

- truthful per-entry advanced capability differences
- explicit cached/manual-refresh semantics

## Dependencies

- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](../decisions/008-runtime-owned-provider-model-catalog.md)
- [ADR 014: Keep Lightweight Provider Setup and Diagnostics in cats-runtime](../decisions/014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR 022: Model Advanced Selection as Entries, Presets, and Provider-Specific Controls](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md)
- [ADR 025: Keep Provider Evolution Detection Manual-First and Evidence-Driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR 029: Keep Advanced Provider Catalogs Verified and Manual-Refresh](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)
- [SPEC-004: Provider Model Catalog and Discovery](./SPEC-004-provider-model-catalog-and-discovery.md)
- [SPEC-018: Advanced Provider Model Catalog and Selection Schema](./SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [PLAN-026: Verified Advanced Provider Catalogs and Manual-Refresh Discovery](../plans/PLAN-026-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)

## Open Questions

- [ ] Should explicit live refresh remain `?refresh=1` on the existing routes or
      move to dedicated setup/diagnostics mutation endpoints?
- [ ] Where should persisted discovery snapshots and cooldown state live so they
      stay host-safe, cross-platform, and restart-stable without becoming
      another ad hoc config format?

## References

- [PLAN-021: Provider Evolution Evidence and Capability Probes](../plans/PLAN-021-provider-evolution-evidence-and-capability-probes.md)
- [docs/research/2026-03-27-provider-evolution-evidence-framework.md](../research/2026-03-27-provider-evolution-evidence-framework.md)

---

*Created: 2026-03-30*
*Author: Codex*
*Related Plan: [PLAN-026](../plans/PLAN-026-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)*
