# SPEC-024: Curated CLI Catalog Input and Runtime Evidence Overlay

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` needs a way to accept human-curated CLI model knowledge without
forcing the curator to learn runtime internals.

The curator-facing file should be simple:

- one CLI name
- one CLI version
- the visible models
- the visible labels
- the visible option labels and values
- optional default/current markers

It should not require the curator to know:

- lowercased canonical values
- runtime-owned control keys
- provider/backend matcher logic
- evidence/provenance metadata
- internal selection-resolution rules

This spec defines that split explicitly:

1. a **curated input file** containing only human-readable catalog facts
2. a **runtime-owned evidence overlay** containing what `cats-runtime`
   later confirmed as available, deprecated, conflicting, or missing

## Goals

- let a human provide CLI catalog knowledge in the same wording they see in the
  CLI or UI
- keep the curator file practical to maintain by hand
- support both simple single-provider CLIs and router-style/multi-provider CLIs
- make runtime canonicalization an internal responsibility of `cats-runtime`
- keep evidence and verification separate from curator input

## Non-Goals

- require curators to translate labels into runtime canonical values
- require semver range logic, provenance ids, or runtime match predicates in
  the curator file
- force every CLI version to be curated
- replace compatibility probes or provider-evolution evidence
- expose the runtime evidence overlay as a required human-authored format

## User Stories

- As a user, I want to paste what I can read from Claude/Codex/Gemini/Cursor
  without needing to know internal keys like `reasoning_effort` or `xhigh`.
- As a forum or marketplace maintainer, I want to publish one YAML file that
  other users can adjust locally.
- As a runtime maintainer, I want the runtime to normalize human labels into
  canonical controls and values later, rather than making curators do that work
  up front.

## Requirements

### Functional Requirements

1. `cats-runtime` shall reserve a default curated-input path at:
   `~/.cats/runtime/config/curated-model-catalogs.yaml`
   (or `<CATS_RUNTIME_DIR>/config/curated-model-catalogs.yaml`).
2. The repo shall ship a reference file at:
   `config/curated-model-catalogs.yaml.example`.
3. The curated input shall accept YAML or JSON. YAML is the preferred authoring
   format.
4. The curated input shall use a human-facing schema. It shall not require
   runtime canonical ids for options or values.
5. The top-level file shall contain:
   - `schema_version`
   - `catalogs`
6. Each catalog entry shall contain:
   - `cli`
   - `version`
   - either `models` or `providers`
7. `models` shall be used for CLIs where the catalog is effectively one model
   list.
8. `providers` shall be used for CLIs where the user sees multiple provider
   groups or the maintainer wants to organize the file that way.
9. Each model entry shall support at least:
   - `name`
   - optional `label`
   - optional `default`
   - optional `current`
   - optional `options`
   - optional `notes`
10. Each option entry shall support:
    - `name`
    - `values`
11. Each option value entry shall support:
    - `name`
    - optional `default`
12. The runtime shall treat all curator-facing `cli`, `provider`, `model`,
    `option`, and `value` names as raw labels first.
13. The runtime shall own later normalization from raw labels such as:
    - `Claude` -> internal provider family
    - `Effort` -> runtime control key
    - `Extra High` -> internal canonical value such as `xhigh`
14. The runtime shall not require the curator to lowercase labels or pre-map
    them into internal wire values.
15. The runtime may retain only the latest one or two imported revisions later,
    but the first human-facing file format shall not require explicit revision
    bookkeeping from the curator.
16. The runtime shall keep evidence and verification outside the curator file.
17. The runtime evidence overlay shall remain runtime-authored and may record
    verdicts such as:
    - `confirmed_available`
    - `confirmed_deprecated`
    - `not_observed`
    - `conflicting`
18. The public advanced catalog may later be derived from:
    - imported curator input
    - runtime normalization rules
    - runtime evidence overlays
    but those internal layers shall not leak back into the required curator
    schema.

### Non-Functional Requirements

- **Editability**: a human should be able to author the file after reading CLI
  help, model pickers, or UI labels
- **Separation of concerns**: curator facts and runtime evidence must remain
  distinct
- **Extensibility**: the schema should handle simple CLIs and grouped-provider
  CLIs without a second format
- **Tolerance**: incomplete curation should still be acceptable; the runtime
  can consume partial files and fall back elsewhere when needed

## Design Overview

### Curator Input

The curator input is deliberately small and display-first.

```yaml
schema_version: 1

catalogs:
  - cli: Claude
    version: 2.1.96
    models:
      - name: Opus
        label: Opus 4.6 with 1M context
        default: true
        options:
          - name: Effort
            values:
              - name: Low
              - name: Medium
                default: true
              - name: High
              - name: Max
```

This file says only what the curator can read.

It does **not** say:

- which backend matcher should apply
- what the runtime control key is
- what canonical enum value should be stored
- what evidence level the runtime has

Those are internal runtime responsibilities.

### Grouped Providers

For CLIs like Cursor, Kilo, Goose, or other router-style tools, the same file
can switch from `models` to `providers`:

```yaml
schema_version: 1

catalogs:
  - cli: Cursor
    version: 2026.03.30-a5d3e17
    providers:
      - name: OpenAI
        models:
          - name: gpt-5.4-xhigh
            label: GPT-5.4 1M Extra High
            current: true
      - name: Anthropic
        models:
          - name: claude-4.6-opus-high-thinking
            label: Opus 4.6 1M Thinking
```

Again, the curator is only recording visible labels.

### Runtime Normalization Boundary

After import, `cats-runtime` may normalize the raw labels into internal
runtime-owned concepts such as:

- provider family ids
- advanced control keys
- normalized enum values
- entry applicability
- advanced selection defaults

That normalization is intentionally **not** part of the curator contract.

### Evidence Overlay

The runtime evidence overlay remains separate.

Illustrative shape:

```yaml
schema_version: cats-runtime/catalog-evidence/v1
observations:
  - cli: Claude
    version: 2.1.96
    model_name: Opus
    option_name: Effort
    value_name: Medium
    verdict: confirmed_available
    observed_at: 2026-04-08T12:30:00Z
```

This is runtime-owned state, not curator input.

## Intended File Location

The current intended runtime config seam is:

- runtime path:
  `~/.cats/runtime/config/curated-model-catalogs.yaml`
- repo example:
  `config/curated-model-catalogs.yaml.example`

The importer is not landed yet in this draft spec. This document defines the
intended human-facing contract and file location first.

## Example Backfill

The repo example file should seed the format with backfilled entries from the
current local/runtime-observed baseline for:

- Claude
- Codex
- Gemini
- Cursor (as a `providers[]` example)

Those seeds are expected to be corrected by the user after review.

## Dependencies

- [SPEC-018: Advanced Provider Model Catalog and Selection Schema](./SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-021: Provider Evolution Evidence and Capability Probes](./SPEC-021-provider-evolution-evidence-and-capability-probes.md)
- [SPEC-023: Verified Advanced Provider Catalogs and Manual-Refresh Discovery](./SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [ADR 022: Model Advanced Selection as Entries, Presets, and Provider-Specific Controls](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md)
- [ADR 025: Keep Provider Evolution Detection Manual-First and Evidence-Driven](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR 029: Keep Advanced Provider Catalogs Verified and Manual-Refresh](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md)

## Open Questions

- [ ] Should the first importer require exact `cli` string matches or apply a
      light alias table (`Claude` / `Claude Code`, `Codex` / `codex-cli`)?
- [ ] Should model entries later gain an optional visible-id field separate
      from `name`, or is `name` enough as the raw selector text?
- [ ] Should `providers[]` and `models[]` remain mutually exclusive, or should
      grouped CLIs also be allowed to carry a small top-level shared model list?

## References

- [config/providers.yaml.example](../../config/providers.yaml.example)
- [src/core/models/providerModelCatalog.ts](../../src/core/models/providerModelCatalog.ts)
- [src/core/models/providerAdvancedKnowledge.ts](../../src/core/models/providerAdvancedKnowledge.ts)
- [src/backends/cli/cursor/models.ts](../../src/backends/cli/cursor/models.ts)
- [src/core/compatibility/types.ts](../../src/core/compatibility/types.ts)

---

*Created: 2026-04-08*
*Author: Codex*
*Related Plan: TBD*
