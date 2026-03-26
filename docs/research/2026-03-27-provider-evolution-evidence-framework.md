# Provider Evolution Evidence Framework

Date: 2026-03-27
Topic: Provider evolution evidence and manual capability probes
Source: Internal architecture research
Summary: `cats-runtime` already owns compatibility, install, auth, and live-probe diagnostics, but it does not yet have a dedicated framework for detecting when upstream CLI providers gain, lose, or reshape mid-turn event capabilities. This note proposes a manual-first evidence framework that records raw and normalized event behavior so runtime maintainers can decide when adapters need updates.
Relevance: The runtime now depends on multiple fast-moving CLI providers. To close the gap with Paperclip/OpenClaw/OpenManus, it needs reliable evidence for provider evolution without over-committing to self-adapting parser logic.
Action Items:
- Define a provider-evolution evidence boundary in an ADR
- Specify a manual probe command and evidence bundle format
- Instrument adapters so ignored and unknown events are observable instead of silently dropped

## Problem

`cats-runtime` is already strong at answering:

- Is the provider installed?
- Is auth valid?
- Can the provider list models?
- Can the provider complete a basic live probe?

Those questions are covered by compatibility and diagnostics flows.

The missing capability is different:

- Did the provider start emitting a new event type?
- Did an expected event disappear?
- Did a known event keep the same name but change shape?
- Did an event keep the same shape but drift semantically?

Without evidence, adapter maintenance becomes guesswork. Maintainers notice the change only after a user reports degraded UX or a downstream surface stops rendering meaningful progress.

## What This Framework Is Not

This is not an always-on self-adaptation system.

The first slice should not:

- continuously probe on end-user machines
- automatically rewrite parser logic
- automatically promote new event types into first-class runtime semantics
- require dashboard or HTTP UI before the underlying evidence flow exists

The goal is narrower: give maintainers a reliable manual probe path and durable evidence bundle so they can decide when to update adapters.

## Five-Layer Detection Model

### 1. Upgrade Detection

Unknown event types begin appearing.

Examples:

- a provider adds `item/plan/delta`
- a CLI that only emitted final results starts emitting `tool_use`

This is the clearest signal that upstream became richer than the current adapter.

### 2. Regression Detection

Expected event types disappear, or their frequency collapses relative to baseline.

Examples:

- Codex normally emits multiple `tool_use` events during a probe, then suddenly emits none across repeated runs
- Pi stops surfacing `progress` even though the adapter and prompt profile are unchanged

This protects against silent feature loss.

### 3. Schema Change Detection

The event type still exists, but the normalized parser can no longer validate or extract the fields it depends on.

Examples:

- `tool_use` still appears, but `toolName` becomes absent
- a `progress` event changes its payload shape

This indicates an upstream breaking change rather than a simple missing capability.

### 4. Semantic Drift Detection

The event name and schema still pass validation, but the content no longer means what the runtime expects.

Examples:

- `tool_use` remains present but only contains generic placeholders
- a plan delta field begins carrying low-signal text that no longer corresponds to an actionable plan
- text deltas become coarse completion blocks instead of meaningful incremental progress

This layer is weaker and should begin as heuristic evidence, not a hard failure gate.

### 5. External Context

Release notes, changelogs, upstream issues, and maintainer announcements explain why something changed.

This is not runtime evidence itself. It is corroboration:

- evidence says "something changed"
- external context says "here is the likely reason"

The framework should keep these separate.

## Evidence, Not Guesses

The correct order of operations is:

1. collect evidence
2. derive capability judgments from evidence
3. compare against prior baselines
4. use external context to explain the delta
5. decide whether to update the adapter

This matters because capability judgments change over time, while evidence is the durable source of truth that can be replayed during review.

## Minimal Correct Runtime Shape

The smallest useful implementation has four moving parts.

### Adapter Instrumentation

Provider adapters should stop silently discarding meaningful unknowns.

That does not mean every unknown must be normalized. It means:

- unknown or ignored events should be observable
- events that are currently `return null` should be eligible for probe capture
- schema failures should be distinguishable from intentional ignores

### Shared Evidence Collector

A runtime-owned collector should capture:

- raw event samples
- normalized event samples
- ignored event counts
- schema validation failures
- provider, instance, version, and probe profile metadata

This logic should live outside individual adapters as much as possible.

### Manual Probe Entry

The first slice should be operator-triggered, not always-on.

Examples:

- a CLI command
- a script entrypoint
- a development-only runtime command

This keeps end-user overhead low while giving maintainers a repeatable inspection tool.

### Baseline Snapshot and Compare

Each provider profile should be able to store a previous evidence-derived capability snapshot, then compare current results to prior ones.

This enables classification such as:

- new event appeared
- previously expected event disappeared
- schema changed
- semantic drift suspected

## Why This Matters for Runtime UX

The runtime cannot give every provider its best possible UX if it does not know what upstream actually emits.

Today, some providers are richer than the normalized event tape currently exposed to host applications. That means:

- the runtime leaves progress and tool events on the table
- host apps see a thinner experience than upstream supports
- regressions can go unnoticed until users report them

An evidence framework is the foundation for improving provider UX without prematurely forcing every provider into a single over-designed abstraction.

## Relationship to Existing Runtime Capabilities

This should build on existing runtime strengths, not replace them.

Relevant existing surfaces:

- compatibility probes and evidence bundles
- setup diagnostics
- normalized stream events
- provider adapter parsing logic

The new framework should focus on provider evolution evidence, not on duplicating readiness diagnostics.

## Recommended Next Step

Promote this research into:

- an ADR that fixes the manual-first and evidence-driven boundary
- a spec that defines the probe command, evidence bundle, baseline compare rules, and classification output

See also:

- [2026-03-27 CLI Provider Event Capability Audit](./2026-03-27-cli-provider-event-capability-audit.md)
- [SPEC-007 Provider Compatibility and Evidence Engine](../specs/SPEC-007-provider-compatibility-and-evidence-engine.md)
