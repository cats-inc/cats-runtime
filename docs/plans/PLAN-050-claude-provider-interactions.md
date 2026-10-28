# PLAN-050: Claude Code Provider Interactions

## Metadata

| Field | Value |
| --- | --- |
| Status | Ready, 2026-10-28; all phases pending |
| Owner | Runtime execution boundary |
| Assigned To | Claude |
| Reviewer | Product owner and consumer maintainers |
| Related spec | [SPEC-039 R8](../specs/SPEC-039-provider-session-capabilities-and-interactions.md#r8-claude-code-mapping) |
| Decision | [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md) |
| Evidence | [Claude protocol note](../research/2026-10-28-claude-host-control-protocol.md) |

## Overview

On 2026-10-28 the owner asked whether Claude can reach the capabilities that
PLAN-049 opened for Codex, then asked for the implementation. Claude Code 2.1.312
already hosts approvals, questions and MCP elicitation over its stream-json
control protocol; Runtime's Claude adapter uses none of it. This plan adds the
Claude mapping behind the existing SPEC-039 contract, then lets the standalone
Bot consume it. The change is additive within Runtime 0.6.x. No version bump or
publication is part of this plan; the Bot consumes a packed artifact.

## Implementation Phases

### P1 — Contract plumbing and Claude interactions

- [ ] Let the provider supply worker control-channel correlation; keep JSON-RPC
  as the default and use `request_id` for Claude.
- [ ] Add the `tool_approval` kind and move the bounded MCP form parser out of
  the Codex module so both adapters share it.
- [ ] Map `can_use_tool` and `elicitation` to typed prompts and answers; add
  `--permission-prompt-tool stdio` only for a negotiated host.
- [ ] Decline hostless elicitation, answer unknown control requests with an
  error, and resolve interactions on `control_cancel_request`.
- [ ] Launch read-only and allowlist sessions with `--permission-mode manual`.

**Exit:** scripted-CLI tests complete every advertised kind, a hostless
elicitation no longer waits, and existing Claude fixtures pass unchanged.

### P2 — Policy and inventory

- [ ] Advertise `admissibleAccess` and reject narrower ceilings at session
  admission.
- [ ] Map explicit approval to a permission mode, send `initialize` before the
  first user message, and verify the reported mode before releasing the turn.
- [ ] Read `mcp_status` through the worker control channel; report built-in
  tools from `system/init`; report browser and computer-use dependencies.

**Exit:** A4/A5/A9 pass against scripted frames; no model turn is started for
inspection.

### P3 — Bot consumption and acceptance

- [ ] Pack the merged Runtime source for `cats-bots` and record its provenance.
- [ ] Bots renders `tool_approval`, offers Claude in Chrome per bot, and passes
  a Claude scripted-CLI integration test.
- [ ] Run one real Claude CLI turn through Runtime and a fresh test Bot with
  isolated state. Record which kinds were exercised and which were not.
- [ ] Platform intersects advertised kinds with its own, so it needs no change
  until its next Runtime pin; record that boundary.

## Testing Strategy and Risks

Focused Vitest suites for the Claude adapter, control channel, interaction
store and session admission, using `createRuntimeTestEnv`. CI runs the full
suite. Real-CLI checks use haiku, a scratch directory and no session
persistence. Chrome is driven only with the owner's agreement.

Risks: forwarding a persistent permission suggestion into user settings; a file
approval carrying full file contents into receipts; reporting enforcement that
Claude cannot provide on Windows; a legacy session hanging on elicitation. Each
has a test or an explicit rejection.

## Progress Log

| Date | Update |
| --- | --- |
| 2026-10-28 | Plan created from direct CLI probes (no Runtime involvement). |

*Created / last updated: 2026-10-28*
