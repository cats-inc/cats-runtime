# ADR-035: Never block provider execution on an exact CLI version

Date: 2026-08-26
Status: Accepted

## Context

Provider CLIs update independently of `cats-runtime`, and the normal developer
workflow regularly upgrades them. Antigravity, Grok, and Cline were exceptions
to the other CLI adapters: an exact `supportedVersions` allowlist selected a
refusal profile for every unlisted release, and each adapter then threw unless
its compatibility profile had `exact` confidence.

That fail-closed behavior made a routine upstream patch or minor upgrade break
an otherwise usable provider before any incompatible surface had actually been
observed. It also blocked the evolution probe that was supposed to collect the
evidence needed to validate the new release. A version string is useful
provenance, but it is only a proxy for the invocation and wire contracts the
runtime depends on.

## Decision

Provider CLI version drift is fail-open with observation:

1. An adapter must not refuse, throw, or otherwise block a turn solely because
   the detected CLI version differs from a fixture-recorded or verified
   version, or because compatibility confidence is not `exact`.
2. Forward and unknown versions use the best-known invocation and parser. Help
   token checks, stream instrumentation, retained evidence, and diagnostics
   remain the mechanisms for surfacing possible drift.
3. Exact versions may remain in fixture names, profile ids, labels, and research
   notes as provenance. The compatibility profile contract does not expose an
   exact-version execution allowlist.
4. Minimum-version checks may still report an old release as
   `unsupported_version`, but that classification does not authorize an
   adapter-level execution refusal by itself.
5. Concrete capability and safety boundaries remain fail-closed. Examples
   include an unavailable permission mode, a missing session id required for a
   fork, or an invocation contract known not to exist. This ADR changes only
   refusals inferred from version inequality.

Antigravity, Grok, and Cline therefore follow the same best-fit behavior as the
other executable CLI providers. Their former exact-version assertions and
refusal profiles are removed.

## Consequences

### Positive

- Routine CLI upgrades no longer disable message execution.
- Evolution probes can observe a new release without first editing an
  allowlist.
- Diagnostics describe observed surface drift instead of treating every new
  version as proven incompatibility.
- Removing `supportedVersions` from the profile type makes accidental
  reintroduction of the old design a compile-time-visible architecture change.

### Negative

- A genuinely breaking upstream release may reach the adapter before runtime
  maintainers update it.
- Best-effort execution can fail at the real changed flag or stream boundary;
  retained evolution evidence and ordinary provider failure reporting must make
  that failure diagnosable.

## Superseded guidance

This decision supersedes the exact-version execution requirement in proposed
ADR-033, SPEC-027 requirement 12, and historical PLAN/research descriptions of
the Antigravity, Grok, and Cline refusal gates. Those documents remain useful as
probe history, not as authority to restore an exact-version gate.

## Related

- [ADR-025: Keep provider evolution detection manual-first and evidence-driven](./025-keep-provider-evolution-detection-manual-first-and-evidence-driven.md)
- [ADR-034: Automate light-tier provider drift detection and separate observation from acceptance](./034-automate-light-tier-provider-drift-and-separate-observation-from-acceptance.md)
- [2026-08-17 Provider upstream drift automation](../research/2026-08-17-provider-upstream-drift-automation.md)
- [2026-08-24 Grok and Cline version drift probe](../research/2026-08-24-grok-cline-version-drift-probe.md)
