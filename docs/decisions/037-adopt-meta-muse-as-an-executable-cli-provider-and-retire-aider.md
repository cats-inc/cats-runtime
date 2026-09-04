# ADR-037: Adopt Meta Muse as an executable CLI provider family and retire Aider

Date: 2026-09-05
Status: Accepted

## Context

`environment-bootstrap` — the upstream installer suite this project mirrors —
added Meta's Muse CLI and deleted Aider in one commit (`6f59feb`, 2026-09-05).
Muse ships a native installer for every platform, so it joined Quick and Full
mode on all three; Aider's three installers were deleted outright with the note
"Install it by hand if still wanted."

Cats has carried Aider since [ADR-033](./033-adopt-grok-devin-cline-aider-as-cli-provider-families.md)
as a provider that setup could install and detect but the runtime could never
execute. The 2026-08-09 probe
([`2026-08-09-aider-cli-probe.md`](../research/2026-08-09-aider-cli-probe.md))
found no machine-readable output, no ACP or server mode, and a zero exit code
even when the model call failed. That state cost real complexity in three
places: `BootstrapService` special-cased Aider out of generated execution
config, the desktop onboarding grid special-cased its card away so users could
not install a provider that would never become usable, and its adapter existed
only to throw. Nothing about Aider has changed upstream since.

Muse is the opposite shape. A probe of 1.0.3-R2198.1
([`2026-09-05-meta-muse-cli-probe.md`](../research/2026-09-05-meta-muse-cli-probe.md))
found a real headless mode (`muse exec --json`) emitting one MSP record per
line, native tool-call and tool-result records, incremental text deltas,
conversation resume from an argument, and a provider-wide reasoning-effort
control. It is executable in the sense Aider never was.

Two properties of muse do not fit the shape of the providers already onboarded,
and both were established by probe rather than assumed:

1. **The installed entry point is a launcher, not the agent.** It downloads
   `muse-bin-<version>` beside itself, records the version in `.muse-version`,
   and forwards every argument it is given straight through. A flag the agent
   binary does not recognise therefore opens the interactive TUI rather than
   failing, which in an unattended installer is an unbounded hang.
2. **Approval mode is not an enforcement boundary in a headless run.** The same
   write-a-file prompt succeeded identically under the default mode, under
   `--approval-mode never`, and under `--approval-mode untrusted`. Only the
   `--disable-write` / `--disable-shell` / `--disable-web-tools` capability
   switches actually removed the capability. This is the Grok 1.0.0 lesson
   (`--permission-mode` did not gate edits either) in a different position.

## Decision

Adopt `muse` as a full CLI provider family — installable, detectable, and
executable — and delete Aider from the runtime in the same change.

For muse:

- The adapter drives `muse exec --json` and parses the MSP record stream. Text
  comes from `run.output.delta`; tool calls are paired from `tool.result`,
  whose `correlation_facts` name the tool and its outcome; progress is derived
  from `task.lifecycle.*`.
- Session identity is taken from the top-level `stream` ref present on every
  record, including the first, and announced as an `init` event, so a turn that
  fails halfway still leaves a resumable id. Resume passes `--session-id`.
- `fork` is declared unsupported and a fork request is refused. `session/fork`
  exists only on the MSP `muse serve` plane, which this adapter does not drive.
- Every runtime permission mode is expressed with the capability switches, never
  with the approval flags. `default` is fail-safe read-only; `skip` leaves all
  capabilities on; `whitelist` maps the requested tools onto the three switches
  and **refuses** an allowlist that names part of a gated group, rather than
  silently enabling the rest of it.
- Packaged setup never executes `muse`. Version comes from `.muse-version`, and
  "installed" means the launcher plus a matching `muse-bin-<version>` build, not
  the launcher alone. The runtime's compatibility probe does run `--version`,
  because it runs under an explicit timeout; it declares a 20s floor to cover
  the launcher's ~4.2s-per-probe indirection.
- No `museSessionsDir` is configured. muse's on-disk transcripts use a dated
  tree plus an index database that the runtime has no scanner for; resume does
  not depend on those files.

For Aider: the adapter, its tests, its install knowledge, its event-capability
entry, its provider-name registrations, and its packaged installers are all
deleted, along with the two special cases that existed only to keep it out of
execution config and out of the onboarding grid. The 2026-08-09 probe note and
ADR-033 stay as the historical record of why.

## Consequences

### Positive

- One more executable provider, with resume and a working permission story,
  rather than one more detect-only entry.
- Two special cases disappear: `BootstrapService` no longer skips a provider
  when writing execution config, and the desktop onboarding grid no longer
  hides a card. Both existed only for Aider.
- The "approval mode is not enforcement" finding is now written down twice —
  Grok and muse — which makes it a pattern to probe for rather than a surprise.

### Negative

- Turns through muse report no token usage, because the exec stream carries
  none. Metering and cost surfaces will show nothing for this provider.
- The `whitelist` permission mode is coarser here than for providers with a real
  per-tool allowlist: a caller asking for `write_file` alone is refused rather
  than served, because muse cannot enforce it.
- Anyone still using Aider through Cats loses it and must install it by hand.
- Model selection cannot be validated: muse silently falls back to the account
  default when `--model` names an unknown id.

### Neutral

- Finished muse runs do not appear through file-backed session discovery until
  a scanner for its session layout exists.
- The launcher self-updates in the background, so the installed build moves
  between runs. Per [ADR-035](./035-never-block-provider-execution-on-exact-cli-version.md)
  that drift is reported, never used as an execution gate.

## Alternatives Considered

### Alternative 1: Add muse install-tier only, like Aider was

- **Pros**: smaller change; no adapter to maintain.
- **Cons**: muse has a machine-readable headless mode, so this would recreate
  the exact "installed but never usable" state that ADR-033 left behind and this
  ADR is removing.
- **Why rejected**: the evidence for execution is there; declining to use it
  would be a worse outcome than not shipping the provider at all.

### Alternative 2: Keep Aider alongside muse

- **Pros**: no removal; anyone depending on it is unaffected.
- **Cons**: keeps two special cases alive for a provider that cannot execute,
  and diverges from the upstream installer suite that just deleted it.
- **Why rejected**: the pre-release policy in `AGENTS.md` says to delete a
  superseded path in the same change rather than carry it.

### Alternative 3: Use `--yolo` for the `skip` permission mode

- **Pros**: a single flag; obviously permissive.
- **Cons**: `--yolo` also disables the sandbox and trusts the workspace, which
  loads that repository's own muse skills and rules — more than "skip permission
  checks" asks for, and a silent behaviour change per repository.
- **Why rejected**: `--approval-mode never --disable-approval` says exactly what
  is intended and nothing more.

## References

- [Meta Muse CLI probe (2026-09-05)](../research/2026-09-05-meta-muse-cli-probe.md)
- [Aider CLI probe (2026-08-09)](../research/2026-08-09-aider-cli-probe.md)
- [ADR-033](./033-adopt-grok-devin-cline-aider-as-cli-provider-families.md)
- [ADR-035](./035-never-block-provider-execution-on-exact-cli-version.md)
- `sammykenny2/environment-bootstrap` commit `6f59feb`

---

*Decision made: 2026-09-05*
*Decision makers: Kenny Chou, Claude*
