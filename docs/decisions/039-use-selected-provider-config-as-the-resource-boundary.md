# ADR-039: Use Selected Provider Config as the Resource Boundary

## Status

Accepted on 2026-09-16; implementation is in progress. This makes a narrow amendment to
[ADR-021](./021-treat-providers-yaml-as-generated-config-and-bootstrap-without-it.md);
it does not supersede that record in full.

## Date

2026-09-16

## Context

Cats supports many provider families and several backends for some families.
The complete example describes supported configurations, but users usually
intend to use only a subset. Detecting every supported provider before asking
for that subset spends resources outside the user's intended scope.

Current setup scans enumerate the known CLI families independently of active
configuration. Routine CLI checks are already passive, but metadata reads,
discovery, timers, and host inventory still have costs. Increasing concurrency
or caching the full machine inventory cannot establish the requested boundary.

Standalone Runtime, local Platform, and packaged Desktop need the same meaning
of selection. Installed, authenticated, reachable, and selected are different
facts: a user must be able to select a provider before installing it or starting
its endpoint.

## Decision

### 1. One persisted source of provider intent per runtime root

The active, validated `providers.yaml` declares the selected targets and bounds
all provider-specific work. Its default location is
`~/.cats/runtime/config/providers.yaml`; `CATS_RUNTIME_DIR` selects another
runtime root. Separate roots and remote runtimes may have separate selections.

Reuse the configured targets rather than adding an ROI file, host preference,
or setup-state list with independent authority. Runtime owns validation and
activation; hosts consume their connected runtime's effective selection.

A target is identified by `(provider, backend, instance)`. Selecting one target
does not select its siblings in another backend. The contract covers CLI,
local, API, and agent backends even if the first editor exposes fewer choices.

### 2. Save intent before provider-specific work

Keep four concepts separate:

| Concept | Meaning |
|---------|---------|
| Supported catalog | Static choices and configuration templates; no machine detection |
| Selected targets | User intent in active YAML |
| Observations | Scoped availability, discovery, and diagnostic results |
| Setup progress | Workflow state that cannot enable a provider |

Start the basic service and static selection surface without provider discovery.
Missing configuration means no selected targets, with no legacy all-provider
fallback. Invalid configuration exposes repair rather than broad detection.
An existing valid file is already a selection and is neither expanded from the
example nor pruned using detection results.

Save and validate the user's selection before detection or installation. A
missing executable or offline endpoint does not invalidate that intent. Keep
service readiness separate from each selected target's execution readiness;
one unavailable target must not block another usable target.

### 3. Enforce the boundary at every provider work entry point

Runtime must enforce selection for execution, setup scans, diagnostics, session
discovery/import, watchers, model discovery, quota refreshes, warmups, and
compatibility/evolution work. Manual requests and force flags can refresh
selected targets, never widen the selected set. Hosts must apply the same
boundary to provider-specific inventory and installer helpers.

Preserve passive routine detection. Selection alone does not authorize live
model tests, account operations, or other work that already requires an explicit
trigger. Execution must not acquire an exact-version or live-verification gate.

General application prerequisites, static catalog display, and reading stored
historical records remain separate from provider-specific work. Ordinary
execution selectors expose compatible selected targets; the explicit provider
management surface may display the full static catalog without probing it.

### 4. Reconcile selection changes as runtime state changes

Runtime validates the complete candidate, preserves retained target settings
and valid routing, and writes atomically. Clients use an expected configuration
revision to avoid replacing another editor's changes. The effective selection
and observations carry revisions so old results cannot restore removed targets.

Activation updates admission, stops removed targets' background work, invalidates
cached choices, and starts only the new selection's permitted work. Deselecting
does not uninstall binaries or delete credentials, transcripts, or other
provider-owned data. Hand-authored YAML uses the same validation and activation
path on reload or restart.

The accepted policy rejects removal while a target has a running provider
operation. Its owner must finish or stop that operation before removal; setup
must not silently cancel it or leave it running outside the accepted scope.

#### Retained setup observations (2026-09-16 amendment)

User acceptance of save-without-detection requires preserving completed evidence
for unchanged targets. Runtime retains the latest observation per exact target,
its original time, and a private digest of the detection configuration. This is
history, not another source of provider intent or a live readiness guarantee.
Removed targets remain historical only; new targets have no observation, and
changed command/runtime/endpoint settings require detection for that target.

Current scan snapshots and in-flight completion still require the active whole
configuration revision. Completed current snapshots can contribute to history
before activation changes that revision; cancelled or late results cannot.
Read-only observation projections perform no probes. Fingerprints contain no
raw configuration values and are not exposed through the setup read model.

### 5. Amend only the detection-before-config part of ADR-021

ADR-021's static provider knowledge, bootstrap without a preexisting config,
runtime-owned setup semantics, host-owned presentation, and generated or
hand-authored YAML remain valid. This decision changes machine detection from
config-independent to selected-target-scoped. Selection creates the initial
config before detection, resolving first-run setup without a full machine scan.

## Consequences

### Positive

- Provider resource usage follows explicit intent across all three entry paths.
- Adding an installed CLI or shipping another supported provider does not
  expand the user's scope.
- Unavailable selected providers can show remediation without losing intent.
- A single runtime contract prevents Desktop helper catalogs and stale UI
  caches from becoming competing enabled-provider lists.

### Costs and tradeoffs

- Config activation, admission, background workers, and caches need coordinated
  lifecycle handling; filtering UI choices alone is insufficient.
- Runtime and Platform/Desktop setup contracts must change together.
- First-run users choose their intended providers before receiving local
  availability results. Existing broad configs stay broad until explicitly edited.

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|-------------------|
| Scan everything with more concurrency or caching | Reduces some latency but still spends resources outside user intent |
| Filter only the UI | Hidden providers can still be scanned, scheduled, or invoked |
| Persist an additional host or ROI selection file | Creates conflicting ownership and synchronization between clients |
| Derive selection from installed or ready providers | Cannot express intent before installation and changes with transient availability |

## Accepted Product Choices

The user authorized implementation using the proposed defaults on 2026-09-16:

- Allow an explicitly saved empty selection as a valid idle state, distinct
  from missing or invalid config.
- Reject removal of targets with running operations until they become idle.
- Initially expose native CLI, Ollama, and OpenClaw in the editor. Preserve
  manually configured API targets and enforce scope for every backend.

## References

- [SPEC-030: behavior and acceptance cases](../specs/SPEC-030-provider-selection-before-bootstrap-probes.md)
- [PLAN-039: runtime and host implementation sequence](../plans/PLAN-039-provider-selection-bootstrap-rollout.md)
- [SPEC-017: existing standalone bootstrap](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [Passive detection correction](../research/2026-08-27-cline-self-update-and-probe-concurrency.md)
- [Platform ADR-046: runtime-owned setup APIs](../../../cats-platform/docs/decisions/046-drive-packaged-setup-through-runtime-bootstrap-apis.md)

---

*Accepted: 2026-09-16*
