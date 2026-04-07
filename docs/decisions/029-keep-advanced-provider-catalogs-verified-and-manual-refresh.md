# ADR 029: Keep Advanced Provider Catalogs Verified and Manual-Refresh

## Status

Accepted

## Date

2026-03-30

## Context

`cats-runtime` already owns provider topology, model-catalog discovery, and the
advanced selection contract. That ownership is still correct, but the current
advanced-catalog implementation is too optimistic in two different ways.

First, the runtime currently derives some advanced metadata from naming
heuristics and narrow provider-specific assumptions. That can be useful as an
internal bootstrap aid, but it is not a truthful public contract for many
providers, especially CLI providers whose per-model capabilities differ in ways
that do not collapse cleanly into one global preset or control list.

Second, ordinary UI read paths can trigger live model discovery. That is a poor
fit for `cats-runtime`'s current dashboard usage, where session management is
the primary job and `Create New Session` is a niche workflow. Repeated remote
API calls or CLI probes from high-frequency UI flows create unnecessary vendor
traffic, increase rate-limit and abuse risk, and still do not solve the
truthfulness problem.

ADR 008 kept model discovery runtime-owned and lazy with an in-memory TTL
cache. ADR 022 introduced a hybrid advanced catalog of entries, presets, and
provider-specific controls. This follow-up narrows both decisions: runtime
ownership stays, but the public advanced catalog must become conservative,
verified, and manual-refresh oriented.

## Decision

`cats-runtime` will keep provider model and advanced catalog ownership in the
runtime, but it will harden the contract with the following rules:

1. Concrete model entries may still come from dynamic discovery, config, or
   static fallback, but advanced metadata beyond raw entries shall only be
   exposed when the runtime has verified provider-target-specific knowledge for
   it.
2. Unverified targets shall degrade to conservative entry-only catalogs instead
   of publishing guessed presets, controls, defaults, or capability claims.
3. Runtime-owned advanced metadata shall come from curated provider capability
   manifests and verification evidence, not from model-name regex alone.
4. Ordinary read paths for provider catalogs shall become cache-first and
   non-probing. Live discovery is an explicit manual refresh action, not an
   automatic side effect of routine dashboard reads.
5. The canonical surfaces for live refresh and capability inspection are
   `setup` and `diagnostics`, not the session-management dashboard.
6. Successful live-discovery snapshots shall be persisted and timestamped so
   the runtime can serve useful cached truth across process restarts instead of
   relying only on in-memory TTL state.
7. Rate limits, auth failures, and repeated discovery errors shall activate
   visible warnings and backoff/cooldown behavior rather than causing repeated
   upstream probes from subsequent reads.
8. The runtime team owns provider capability verification. Users shall not be
   expected to manually compare every provider and tell the runtime which
   advanced controls are real.

The first hardening slices are now in-repo on the shared provider-model and
advanced-catalog routes. Remaining manifest/provenance and restart-stable
snapshot follow-through stays tracked under [SPEC-023](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
and [PLAN-026](../plans/PLAN-026-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md).

## Consequences

### Positive

- makes the advanced catalog more truthful by default
- removes pressure on users to audit each provider manually
- reduces unnecessary vendor/API/CLI traffic from routine UI activity
- keeps provider truth in the runtime boundary without pretending unverified
  metadata is authoritative
- creates a clean place for explicit refresh, cooldown, and provenance UX

### Negative

- some providers will temporarily lose advanced presets/controls until verified
  manifests are authored
- the discovery/read contract becomes more explicit and slightly more complex
- implementation now needs persisted cache snapshots, cooldown state, and a
  verification-oriented metadata layer

### Neutral

- lightweight compatibility model catalogs remain useful and continue to exist
- advanced catalogs can still be runtime-owned without being heuristic-heavy
- dynamic discovery remains valuable, but only as a manual refresh/input to
  cached truth rather than an always-live read path

## Alternatives Considered

### Alternative 1: Keep Heuristic Advanced Metadata and 60-Second Live Discovery

- **Pros**: minimal immediate code churn; broad advanced UI surfaces keep
  showing something for many providers
- **Cons**: public metadata remains inaccurate for providers with per-model
  capability differences and continues to probe upstream during routine UI use
- **Why rejected**: "something" is not good enough when the contract is
  provider truth; inaccurate advanced metadata is worse than conservative
  omission

### Alternative 2: Push Provider Truth Back Into Product UI Code

- **Pros**: product teams can special-case each provider visually
- **Cons**: leaks provider truth into the wrong layer and recreates the same
  drift problem outside the runtime
- **Why rejected**: provider capability truth and execution mapping still
  belong in `cats-runtime`

### Alternative 3: Ask Users to Manually Curate Every Provider

- **Pros**: fastest way to gather ad hoc corrections
- **Cons**: not scalable, not durable, and not a valid runtime ownership model
- **Why rejected**: the runtime must own verification and contract truth

## References

- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](./008-runtime-owned-provider-model-catalog.md)
- [ADR 014: Keep Lightweight Provider Setup and Diagnostics in cats-runtime](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR 022: Model Advanced Selection as Entries, Presets, and Provider-Specific Controls](./022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md)
- [ADR 025: Keep Provider Evolution Detection Manual-First and Evidence-Driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [SPEC-004: Provider Model Catalog and Discovery](../specs/SPEC-004-provider-model-catalog-and-discovery.md)
- [SPEC-018: Advanced Provider Model Catalog and Selection Schema](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-023: Verified Advanced Provider Catalogs and Manual-Refresh Discovery](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)

---

*Proposed: 2026-03-30*
*Accepted: 2026-04-07*
*Decision makers: user + Codex*
