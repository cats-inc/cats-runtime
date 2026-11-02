# PLAN-051: Native Provider Tools and Interactions

## Metadata

| Field | Value |
| --- | --- |
| Status | In progress |
| Owner | Runtime provider execution |
| Reviewer | Independent review before merge |
| Spec | [SPEC-040](../specs/SPEC-040-native-provider-tools-and-interactions.md) |

## Overview

Implement native hosted transports behind Runtime's existing CLI worker and
interaction boundary. Keep one owner of process lifetime, pending turns and
native replies. Bot consumes the existing public contract and an exact Runtime
candidate artifact; it never understands MSP or ACP.

## Implementation Phases

### P0 — Protocol and policy evidence

- [x] Create Runtime/Bot worktrees from current default branches.
- [x] Export the installed Muse 1.4.14-R7309.1 stable schema; capture isolated
  help/version for Muse, Grok 1.0.70 and `agy` 1.4.12.
- [x] Probe MSP initialize/start/resume/echo-turn and session MCP against
  an isolated echo host; inspect durability and secret handling.
- [x] Probe Grok ACP with a local MCP fixture; inspect config, policy,
  resume and persisted overlay handling using current upstream source.
- [ ] Verify Google's official ACP archive/hash and executable initialization,
  MCP, permissions, installation/auth and history boundaries.

### P1 — Runtime implementation

- [x] Add native hosted Muse transport with model controls, truthful capability
  observations, MCP and multistage approval/input correlation.
- [x] Add native hosted Grok ACP transport with equivalent lifecycle guarantees.
- [x] Add the official Antigravity ACP local-tool/approval adapter and separate
  setup/remediation. Gate session MCP until native credential persistence is verified.
- [x] Reuse WorkerProcess control/interaction ownership, preserving legacy and
  bounded-media invocation where their contracts differ.
- [x] Document the capability/policy matrix and session MCP secret boundary.

### P2 — Bot adoption

- [x] Replace provider-name tool exclusions with resolved hosted/legacy target support.
- [x] Expose the supported work policy and accurate permission/tool status.
- [x] Exercise old profile/transcript loading, retarget/handoff, pending approval,
  restart and cancellation without replay or parallel model turns.
- [ ] Build and pin an exact source candidate after Runtime validation/review.

### P3 — Verification and delivery

- [x] Protocol regression fixtures: allow/deny/stale/cancel/expiry, isolation,
  model controls, initialization without prompt and resume without replay.
- [x] Muse/Grok executable fixture checks and bounded persistence/secret scan.
  Google native acceptance remains blocked as recorded above.
- [ ] Affected Runtime integration/consumer tests, type/build and Bot checks.
- [x] Independent Runtime review; resolved findings and native Grok effort
  readback verified before PR auto-merge. Bot review remains in its consumer plan.
- [ ] Open scoped PRs, enable squash auto-merge, verify CI/merge and clean only
  these worktrees. No version bump or publication.

## Technical Decisions

- [ADR-049](../decisions/049-use-native-control-protocols-for-hosted-provider-tools.md)
  keeps the existing native CLI lifecycle and public host API.
- Protocol initialization must precede tool-support claims. A successful process
  launch alone is insufficient; no version equality gates.
- Private protocol pipes may carry MCP header values only after validating that
  native session storage does not retain them. No secret-bearing JSON in argv.
- Keep acceptance fixtures in temporary homes/workspaces and terminate their own
  process groups. Never use real Bot conversations or credential files as tests.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Current native modes differ from old one-shot adapters | Opt in hosted transports; regression legacy/media consumers |
| Provider persists headers or widens sandbox | Native persistence and policy gates; no unsupported capability claim |
| Approval changes while owner answers | Native request/requirement identity plus Runtime generation/revision |
| Separate Antigravity executable/auth/history | Verified setup and explicit handoff; no silent fallback |
| Cross-repository pin drifts | Candidate from the reviewed source commit with digest and consumer tests |

## Progress Log

| Date | Update |
| --- | --- |
| 2026-11-02 | Owner authorized implementation. Runtime baseline `c6e575b6`, Bot `afad1c8` (0.4.6); both isolated `feat/provider-tools` worktrees created. Earlier temporary probe files were absent, so current protocol evidence is being recaptured. No release is authorized. |
| 2026-11-02 | Implemented explicit target `protocol: hosted`, native MCP and interaction mapping. Independent review led to inherited provider policy/full ceiling only, canonical resume-workspace checks, fatal admission shutdown and private grant redaction before diagnostics. Actual Muse and Grok worker cold-resume/MCP checks passed; see the [dated evidence](../research/native-provider-host-protocols-2026-11-02.md). |
| 2026-11-02 | Official Google ACP archive/hash verified; native initialization blocked by its 4 KiB build on this 16 KiB-page ARM64 host. Standard ACP adapter fixtures are implemented, while native authentication/tools/persistence remain unverified. Owner requested skipping desktop acceptance while X authorization is broken. |

## Local validation

Runtime build/typecheck passed. 73 new/adjacent protocol, interaction and install
checks passed; 312 affected configuration, compatibility, worker, Codex/Claude
interaction and legacy Muse/Grok/Antigravity checks passed. The independent
review found no remaining blocking Runtime issue. The source PR's required CI
and the Bot candidate/integration checks remain delivery gates, not claimed here.

*Created: 2026-11-02*
