# SPEC-021: Provider Evolution Evidence and Capability Probes

Date: 2026-03-27
Status: In Progress (Core Manual-First Slices Landed)
Owner: Runtime

## Summary

Introduce a manual-first provider evolution probe flow that lets `cats-runtime` collect evidence about upstream CLI event behavior, compare that evidence against prior baselines, and surface whether a provider has become richer, weaker, broken, or semantically different.

This spec is not about always-on end-user adaptation. It is about giving maintainers a reliable runtime-owned way to decide when provider adapters need updates.

## Problem

The runtime currently knows whether providers can install, authenticate, list models, and complete basic live probes. It does not yet have a formal mechanism for answering:

- Did a provider start emitting new event types?
- Did expected event types disappear?
- Did a known event keep its name but change payload shape?
- Did an event keep the same shape but drift semantically?

Without this mechanism, provider adapter maintenance is reactive and low-confidence.

## Goals

- Add a manual probe path for provider evolution checks
- Preserve raw and normalized evidence about provider event behavior
- Detect upgrades, regressions, schema changes, and suspected semantic drift
- Compare current evidence to prior baselines
- Keep the first slice runtime-owned and independent of host UI

## Non-Goals

- Always-on probing on user machines
- Automatic parser self-modification
- Automatic promotion of new event types into host-facing features
- A polished dashboard or public HTTP surface in the first slice

## Protocol Boundary

The first slice is intentionally focused on CLI-backed provider evolution.

However, the evidence model MUST NOT assume that all future adapters will:

- expose a single `kind` discriminator
- emit line-oriented events
- carry an explicit final/completed boolean

This matters for future protocol-backed adapters, including A2A-aligned agent interfaces, where:

- event discrimination may rely on wrapper shape rather than a flat `kind`
- completion may be indicated by stream closure rather than an explicit final flag
- content parts may evolve independently of legacy CLI assumptions

The probe framework should therefore treat provider-specific parsing rules as adapter-owned while keeping the evidence collector and classification model transport-neutral.

## Requirements

### 1. Manual Probe Entry

The runtime MUST provide a manual entrypoint for running provider evolution probes.

The first slice MAY implement this as:

- a CLI command
- a development script
- an internal runtime command

The first slice does not need a public HTTP route.

### 2. Probe Targeting

A probe MUST be able to target:

- provider id
- optional instance id
- optional model or probe profile
- current provider version when discoverable

### 3. Evidence Collection

Each probe MUST collect enough information to distinguish:

- normalized events
- ignored events
- raw passthrough events
- schema validation failures

Each evidence bundle MUST include metadata such as:

- provider
- instance
- provider version if discoverable
- probe profile
- timestamp

### 4. Classification Model

The probe result MUST support classification for:

- `upgrade`
  - unknown event types appeared
- `regression`
  - expected event types disappeared or dropped below baseline thresholds
- `schema_change`
  - event names remain but schema validation fails
- `semantic_drift_suspected`
  - schema passes but content heuristics deviate from baseline

### 5. Capability Snapshot

Each probe MUST produce a summarized capability snapshot with fields sufficient to guide adapter maintenance.

At minimum, it SHOULD track:

- incremental text support
- tool use support
- tool result support
- progress support
- final result support
- ignored event types observed
- schema validation failures observed

The snapshot MAY also include confidence or richness metadata.

### 6. Baseline Compare

The system MUST support comparison between:

- the current probe snapshot
- a prior stored baseline snapshot

The compare output MUST be able to highlight:

- added event types
- removed event types
- event frequency drops
- schema failures newly introduced
- semantic drift warnings

### 7. External Context Separation

Release notes, changelogs, and upstream issue references MUST be modeled as separate context metadata, not as runtime evidence.

The system MAY allow operators to attach upstream context references to a probe result, but these references MUST remain logically separate from the observed runtime evidence.

### 8. Semantic Drift as Weak Signal

The first slice MUST treat semantic drift as a heuristic warning, not as a hard compatibility verdict.

Examples of semantic drift heuristics:

- event payloads become low-signal placeholders
- plan updates remain structurally valid but stop carrying actionable information
- tool events remain present but collapse into generic labels

## Proposed Runtime Shape

### Adapter Instrumentation

Provider adapters SHOULD route ignored or unknown events through shared instrumentation hooks rather than silently dropping them when running under probe collection.

The first slice SHOULD make it easy to distinguish:

- intentionally ignored
- unknown
- malformed
- normalized

### Shared Evidence Collector

The runtime SHOULD own a shared evidence collector that accumulates:

- raw samples
- normalized samples
- ignored counts
- schema failure counts
- per-event-type frequency summaries

The collector MUST remain transport-neutral enough to preserve evidence from:

- line-oriented CLI streams
- wrapper-shaped protocol events
- transports whose completion semantics are inferred from stream lifecycle

### Baseline Storage

The first slice MAY use simple file-backed baseline artifacts for provider probe snapshots.

The design MUST allow later evolution toward richer evidence storage without changing the classification model.

## Expected Outputs

The first slice SHOULD produce:

- a machine-readable evidence bundle
- a machine-readable capability snapshot
- a human-readable diff summary against the last baseline

## Risks

- Providers may emit unstable or noisy event shapes that make semantic drift difficult to classify automatically
- Overfitting the probe shape to one provider may harm generality
- Always-on collection could create unnecessary user-machine overhead if the scope expands too early

## Rollout

### Slice 1

- manual probe entry
- adapter instrumentation
- shared evidence collector
- baseline snapshot and compare
- no public HTTP route

### Slice 2

- diagnostics or management read surface for recent probe results
- richer baseline management
- optional evidence export and review helpers

### Slice 3

- selective product/runtime integration where host surfaces can rely on provider capability truth

## Related

- [ADR-025](../decisions/025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [2026-03-27 Provider Evolution Evidence Framework](../research/2026-03-27-provider-evolution-evidence-framework.md)
- [2026-03-27 CLI Provider Event Capability Audit](../research/2026-03-27-cli-provider-event-capability-audit.md)
- [SPEC-007 Provider Compatibility and Evidence Engine](./SPEC-007-provider-compatibility-and-evidence-engine.md)
