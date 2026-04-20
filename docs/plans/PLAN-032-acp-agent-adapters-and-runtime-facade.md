# PLAN-032: ACP Agent Adapters and Runtime ACP Facade

> Implementation plan for adopting ACP in both relevant directions without
> creating a new top-level backend family or confusing provider routing with
> runtime exposure.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Phase 4 Runtime HTTP/Stdio Facades Landed; Phase 5 Follow-Through Pending) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

[SPEC-025: ACP Agent Adapters and Runtime ACP Facade](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md)

## Overview

ACP matters to `cats-runtime` in two distinct ways:

1. `cats-runtime` can consume external ACP agents as provider targets.
2. `cats-runtime` can expose itself as an ACP-compatible backend so IDEs or
   other ACP-capable clients can consume it directly.

The first direction belongs inside the existing `agent` backend family. The
second is a runtime-owned transport/facade concern.

This plan stages both directions deliberately so the runtime can:

- keep current CLI/API/agent targets stable
- add `agent/acp` without inventing a new backend taxonomy
- defer the outward-facing ACP facade until the provider-side capability model
  is better understood
- document where A2A and ACP complement each other in the final stack

ACP also matters across more provider families than `claude` and `codex`.
The runtime should therefore keep an explicit ACP adoption matrix for the
provider families it already supports, rather than treating ACP as a one-off
integration track for only two vendors.

## Scope

### In Scope

- Reserve ACP as an `agent` transport family
- Extend config, adapter inspection, and diagnostics for ACP-backed providers
- Design a provider-side ACP capability bridge for permission/filesystem/
  terminal-style requests
- Implement the Tier 1 `agent/acp` provider matrix
- Design a separate runtime-owned ACP facade for IDE/client consumption
- Document the ACP + A2A layering model

### Out of Scope

- Replacing the current Claude/Codex CLI seams immediately
- Shipping every ACP capability in the first slice
- Making the runtime-owned ACP facade feature-complete before provider-side ACP
  capability truth is established
- Replacing MCP or A2A
- IDE-specific UX work beyond protocol and capability truth

## Architecture Guardrails

1. Do not add a new top-level `acp` backend family.
2. Do not model IDE-facing ACP exposure inside `providers.yaml`.
3. Keep provider-side ACP adapters under `src/backends/agent/adapters/`.
4. Keep runtime-owned ACP exposure as a separate transport/facade boundary.
5. Keep A2A documented as the peer/runtime layer and ACP as the client layer.

## Recommended Delivery Sequence

### Phase 0: Documentation and Taxonomy Lock

- [x] Land ADR/SPEC/PLAN alignment for ACP classification and layering
- [x] Record that ACP provider targets live under `agent`
- [x] Record that runtime ACP exposure is a separate facade
- [x] Record the A2A + ACP complementary stack

**Deliverables**:

- ADR 031
- SPEC 025
- PLAN 032
- supporting research note with external ACP/A2A references

### Phase 1: Reserve the `agent/acp` Transport Slot

- [x] Extend `buildAgentAdapter(...)` to recognize an ACP transport family
- [x] Extend `AgentAdapterInspection` so ACP can describe its transport,
      capability, and auth posture truthfully
- [x] Extend config parsing so agent transports can carry ACP-specific launch or
      connection settings without forcing those fields into CLI-only config
- [x] Keep provider routing unchanged so ACP targets can coexist with CLI/API
      targets for the same provider family

**Deliverables**:

- config/type scaffolding for ACP under `agent`
- runtime inspection/docs that show `agent/acp` as a first-class target family

### Phase 2: Provider-side ACP Capability Bridge

- [x] Define the minimal runtime-owned host capability surface the ACP adapter
      can call into
- [x] Map ACP permission requests onto runtime approval/guardrail policy
- [x] Map ACP file access onto runtime workspace/worktree rules
- [x] Map ACP terminal requests onto runtime execution controls
- [x] Decide how ACP-facing client MCP server access should relate to the
      runtime's existing MCP and local-tool policies

**Deliverables**:

- ACP host capability bridge contract
- explicit capability profile for the first provider-side ACP slice

### Phase 3: Full CLI `agent/acp` Provider Support

- [x] Land the full 12-family CLI ACP target matrix across Tier 1 and Tier 2
      provider families
- [x] Implement the provider-side ACP adapter against the shared `AgentAdapter`
      seam
- [x] Normalize lifecycle and stream events into runtime `StreamEvent`s
- [x] Persist provider-managed ACP continuity state in the existing session
      registry
- [x] Add targeted diagnostics, probe behavior, and model/tool discovery where
      the ACP target makes them available

The canonical ACP adoption matrix lives in
[SPEC-025](../specs/SPEC-025-acp-agent-adapters-and-runtime-facade.md#acp-ecosystem-scope).
Phase 3 should interpret that matrix this way:

- Tier 1 is the simultaneous provider-family support set:
  `claude`, `codex`, `gemini`, `cursor`, `copilot`
- Tier 2 is the lower-priority-but-supported set:
  `opencode`, `kilo`, `goose`, `pi`, `auggie`, `junie`, `kiro`
- runtime docs, diagnostics, and inspection summaries should treat all 12
  families as the current CLI ACP support matrix rather than singling out one
  provider as the exclusive ACP path or describing Tier 2 as future-only work
- Tier labels remain prioritization metadata for provider-specific refinements,
  not rollout gates for the shared ACP adapter path

Phase 3 implementation still needs to stay grounded in:

- protocol overlap with an existing runtime seam
- capability truthfulness
- auth and launch stability
- testability in local repo workflows

Current rationale for the tier split:

- `claude`, `codex`, `gemini`, `cursor`, and `copilot` are the primary runtime
  families with the strongest ACP ecosystem overlap and product relevance
- `codex` still has the deepest protocol-shaped runtime seam today, so some
  Codex-specific transport details may land earlier than the rest of Tier 1
  without changing the matrix itself
- the runtime should keep shared ACP capability/diagnostics machinery generic
  across the full 12-family matrix, while only adding provider-specific hints when
  they are validated for that provider family
- `opencode`, `kilo`, `goose`, `pi`, `auggie`, `junie`, and `kiro` remain
  lower-priority families for provider-specific refinements rather than
  future-only follow-on additions

**Deliverables**:

- working `agent/acp` provider targets for all 12 current CLI ACP families
- session creation/message/cancel/close flows through the existing runtime
  session API

### Phase 4: Runtime-owned ACP Facade for IDE Consumption

- [x] Define the ACP session lifecycle mapping onto runtime session routes
- [x] Decide the first transport shape for the runtime ACP facade
- [x] Implement a conservative capability profile for IDE/client consumption
- [x] Ensure facade sessions reuse the same runtime session ownership,
      diagnostics, and worktree truth
- [x] Add readiness/debug guidance for ACP-capable clients

**Deliverables**:

- a bounded `cats-runtime` ACP facade suitable for at least one external client,
  now via HTTP NDJSON prompt streaming plus both proxy and direct stdio carriers
- documented capability matrix and known limitations

### Phase 5: A2A + ACP Layering Follow-Through

- [x] Update architecture and terminology docs so ACP and A2A are shown as
      complementary layers
- [ ] Confirm how runtime-owned ACP sessions can coexist with A2A peer routing
- [ ] Keep diagnostics truthful about which flows are:
      - client-to-runtime over ACP
      - runtime-to-provider over `agent/acp`
      - runtime-to-peer over A2A

**Deliverables**:

- clear docs and diagnostics boundaries for ACP versus A2A

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider-side ACP and runtime-facing ACP get conflated | High | Keep separate file/module boundaries and separate docs from the first slice |
| ACP capability requests bypass runtime guardrails | High | Route permission/fs/terminal requests through runtime-owned policy seams only |
| Early ACP target coverage overfits the transport taxonomy | Medium | Reserve `agent/acp` conceptually and keep concrete transport names additive while validating the full 12-family CLI ACP matrix |
| IDE-facing ACP facade promises too much too early | Medium | Start with a bounded capability profile and document unsupported features explicitly |
| A2A and ACP are treated as competing protocols | Medium | Keep layering docs explicit and update architecture/terminology together |

## Open Questions

1. Should the first executable ACP provider transport be named `acp`,
   `acp_stdio`, or another additive name?
2. Which ACP client capabilities should be mandatory versus optional in the
   first provider-side slice?
3. After the initial HTTP ACP facade slice, should the runtime add a stdio
   entrypoint for hosts that prefer subprocess integration over HTTP?
4. Which lower-priority CLI ACP family should receive the next
   provider-specific launch/auth/capability refinement after the shared
   12-family matrix: `opencode`, `kilo`, `goose`, `pi`, `auggie`, `junie`, or
   `kiro`?

## Progress Log

| Date | Update |
|------|--------|
| 2026-04-15 | Draft plan created to stage ACP under `agent` while reserving a separate runtime-owned ACP facade and documenting ACP + A2A complementarity |
| 2026-04-15 | Phase 1 skeleton landed with `agent/acp` transport recognition, ACP launch config fields, truthful inspection, and focused coverage; execution remains a Phase 2 follow-up |
| 2026-04-15 | Phase 2 host-bridge contract landed with a runtime-owned ACP host bridge backed by runtime tool policy, `LocalToolRuntime`, and session workspace/permission context; ACP transport lifecycle execution remains Phase 3 work |
| 2026-04-15 | Expanded the ACP adoption plan from a `claude`/`codex` framing to a provider-overlap support matrix with SPEC-owned tiers, so Phase 3 treats Tier 1 (`claude`, `codex`, `gemini`, `cursor`, `copilot`) as one rollout bucket rather than a special-case two-provider branch |
| 2026-04-15 | Phase 3 bootstrap diagnostics landed for `codex-acp`: the runtime can run a stdio help probe for ACP command launches before lifecycle execution is enabled, and that bootstrap path now anchors shared Tier 1 diagnostics behavior |
| 2026-04-15 | Phase 3 stdio JSON-RPC plumbing landed for `agent/acp`: the runtime now has an ACP stdio client that can frame requests, match responses, handle notifications, and answer server-side requests such as permission prompts before adapter-level lifecycle mapping is wired in |
| 2026-04-15 | Phase 3 prompt lifecycle slice landed for `codex-acp`: `agent/acp` can now initialize a stdio ACP process, create or load a provider-managed session, suppress replay noise during `session/load`, route prompt-turn updates into runtime stream events, and answer basic ACP permission requests through runtime permission-mode mapping |
| 2026-04-15 | Refined ACP permission mediation so `whitelist` mode no longer behaves like a blanket reject: ACP permission requests now inspect requested tool metadata and compare it against runtime `allowedTools` before selecting an allow or reject option |
| 2026-04-15 | Added ACP remote-cancel support for the current `codex-acp` slice: runtime inspection now advertises remote cancel capability for the resolved Tier 1 profile, and `adapter.cancel()` can reattach to the provider-managed ACP session and emit `session/cancel` as a best-effort remote abort |
| 2026-04-15 | Added transient ACP model discovery for resolved Tier 1 profiles: `agent/acp` can now bootstrap a short-lived stdio ACP session and read the provider-advertised model catalog, so profiled ACP targets no longer report model discovery as unavailable in inspection |
| 2026-04-15 | Extended the `codex-acp` stream normalization slice so ACP reasoning, plan, and terminal-output updates now land as runtime progress events, while tool-call metadata and tool names persist across later terminal/result updates for a more truthful Codex-native session trace |
| 2026-04-15 | Added provider-managed ACP session-state normalization for the `codex-acp` slice: session title, available commands, and config-option updates now become runtime progress events and are persisted into `providerState.agentSession.adapterState`, so later inspection/resume flows can see the same state the ACP agent advertised mid-turn |
| 2026-04-15 | Enabled Codex-specific terminal-output capability negotiation inside the broader Tier 1 matrix: runtime ACP initialize payloads now advertise the profile-specific `_meta.terminal_output` hint only for the Codex profile, so the richer terminal-output stream landed in earlier slices can actually be requested from the upstream ACP agent without leaking Codex-specific hints into other ACP targets |
| 2026-04-15 | Landed the first official ACP filesystem bridge slice: `agent/acp` now advertises `fs.readTextFile`/`fs.writeTextFile` when a runtime ACP host bridge is attached, and incoming `fs/read_text_file` plus `fs/write_text_file` requests are mediated through the runtime's existing `read_file`/`write_file` guardrails so absolute ACP paths still obey workspace isolation and tool policy |
| 2026-04-15 | Landed the first official ACP terminal bridge slice: `agent/acp` now advertises `terminal` support when a runtime ACP host bridge is attached, and incoming `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, plus `terminal/release` requests are mediated through runtime-owned shell policy and a bounded terminal registry, so ACP agents can open short-lived execution terminals without bypassing `run_shell`-level workspace and whitelist controls |
| 2026-04-15 | Extended provider-managed ACP session-state normalization beyond title/commands/config: `current_mode_update` and `usage_update` now become runtime progress events and persist into `providerState.agentSession.adapterState`, so the Codex ACP slice keeps its current mode and context-window/cost state observable to later inspection, resume, and diagnostics surfaces |
| 2026-04-15 | Landed a runtime-observable ACP permission-decision slice: `session/request_permission` replies now produce runtime guardrail progress events, rejected decisions carry explicit policy reasons, and already-aborted turns return the ACP-required `cancelled` outcome instead of silently following the normal permission-mode path |
| 2026-04-15 | Closed the remaining Phase 2 client-MCP policy gap by making ACP `mcpServers` a runtime host-bridge seam: the default runtime bridge still exposes no client MCP servers, but session bootstrap now accepts explicit bridge-owned MCP declarations and persists them for later `session/load` continuity such as remote cancel |
| 2026-04-15 | Deepened the Codex ACP diagnostics and bootstrap discipline: ACP stdio requests can now take bounded per-request timeouts for initialize/load/new flows, `probe()` now validates a real `initialize + session/new` bootstrap instead of stopping at `--help`, and transient bootstrap callers such as model discovery reuse the same timeout-aware ACP client path |
| 2026-04-15 | Surfaced persisted ACP adapter state in runtime diagnostics evidence: retained and live agent evidence summaries can now show Codex ACP session title, current mode, available commands, config options, context-window usage, stop reason, and MCP declaration summaries instead of leaving that ACP-specific state trapped inside raw `providerState.agentSession.adapterState` |
| 2026-04-15 | Promoted Codex ACP command discovery into a first-class remote tool catalog path: ACP inspection now truthfully reports `session_bootstrap` tool discovery for the resolved ACP profile, `listTools()` can bootstrap a transient ACP session to capture `available_commands_update`, and provider-tooling read models map that bootstrap-backed catalog onto the existing `tools_effective` vocabulary instead of leaving command discovery buried inside progress events only |
| 2026-04-15 | Closed the active-worker runtime close gap for the Codex ACP slice: the shared `AgentAdapter` seam now exposes an optional provider-side `close()` hook, `AgentBackendManager` calls it during runtime close/reset/delete detachment, and `AcpAdapter` now sends draft ACP `session/close` only when the upstream agent explicitly advertises close-session capability instead of assuming it exists for every ACP target |
| 2026-04-15 | Aligned provider-side ACP docs and inspection language to the canonical simultaneous Tier 1 matrix, and extended profile resolution so versioned npm package launch forms like `@scope/pkg@latest` still map onto the correct ACP provider profile |
| 2026-04-15 | Expanded provider-side ACP support from the Tier 1-only framing to the full 12-family CLI matrix, and corrected Tier 2 launch-token resolution to match official ACP registry / provider entrypoints such as `binary acp`, `pi-acp`, `@kilocode/cli acp`, `@augmentcode/auggie --acp`, `junie --acp=true`, and `kiro-cli acp` |
| 2026-04-15 | Started Phase 4 with the first runtime-owned ACP facade slice: `cats-runtime` now exposes an HTTP `/acp` JSON-RPC endpoint that answers `initialize` with a conservative, truthful capability profile, advertises bootstrap/readiness state through `_meta`, and rejects ACP session methods explicitly until runtime-owned session mapping lands |
| 2026-04-15 | Extended the runtime ACP facade's truthful read surface before prompt-turn work: `initialize` now advertises `session/load` and `session/list`, `session/list` reflects the runtime registry as the ACP session source of truth, and `session/load` can reattach to an existing runtime-owned session without inventing a second session catalog |
| 2026-04-15 | Landed the first runtime-owned ACP write-path bridge without duplicating session-creation logic: `session/new` now forwards into the existing `/sessions` route through an in-process ACP-to-HTTP bridge, so ACP session creation reuses the runtime's real workspace/session registry path instead of growing a parallel create contract |
| 2026-04-15 | Added the first ACP control-plane notification bridge on the runtime facade: HTTP `/acp` now accepts `session/cancel` as a JSON-RPC notification and forwards it into the existing `/sessions/:id/cancel` route, so ACP clients can best-effort stop runtime-owned sessions without waiting for prompt-turn streaming support to land |
| 2026-04-15 | Tightened the runtime ACP facade's prompt-turn truthfulness: `session/prompt` refusals now say explicitly that the current HTTP transport still lacks the bidirectional `session/update` path ACP prompt turns require, so operators can distinguish a transport limitation from a generic missing-method stub |
| 2026-04-15 | Added a runtime ACP stdio transport foundation alongside the HTTP facade: the repo now has a dedicated ACP stdio frame server that can carry `initialize`, `session/new`, `session/list`, `session/load`, and `session/cancel` against the same runtime-owned ACP handler, giving Phase 4 a bidirectional-capable carrier before prompt-turn notifications are wired in |
| 2026-04-15 | Added a repo-local ACP proxy CLI alongside the new stdio carrier: `cats-runtime acp` now forwards stdio ACP traffic into the runtime's primary HTTP `/acp` endpoint using the same host/port/API-key conventions as the MCP proxy mode, so external ACP clients can target the runtime through either direct HTTP JSON-RPC or a CLI-friendly stdio command without waiting for prompt-turn support to land |
| 2026-04-15 | Enabled the first real prompt-turn path on the runtime ACP facade, but only on direct stdio transport: the shared ACP handler can now reuse `/sessions/:id/messages` over NDJSON, project runtime text/tool events into outbound `session/update` notifications, and return ACP `stopReason` results, while HTTP `/acp` still truthfully refuses `session/prompt` until it grows a comparable bidirectional carrier |
| 2026-04-15 | Exposed the direct stdio prompt-turn carrier as an actual operator-facing CLI mode: `cats-runtime acp --serve-runtime` now starts an in-process runtime-backed ACP stdio server, while the default `cats-runtime acp` command remains the HTTP proxy variant, so ACP clients can choose between a lightweight proxy to an already-running runtime or a standalone subprocess entrypoint that supports `session/prompt` over stdio immediately |
| 2026-04-15 | Closed the first ACP cancellation gap on the direct stdio carrier: `startAcpStdioServer` now lets JSON-RPC notifications such as `session/cancel` run concurrently with the single in-flight request chain, so a long-running `session/prompt` can be interrupted mid-turn and return ACP's required `cancelled` stop reason instead of forcing cancel notifications to wait behind the prompt response |
| 2026-04-15 | Improved the runtime-to-ACP projection fidelity for direct stdio prompt turns: runtime progress events that carry tool identity now emit ACP `tool_call_update` notifications with `in_progress` status, and the facade backfills a pending `tool_call` announcement when a tool update or tool result arrives before the ACP client has seen one, so IDE clients can observe live tool execution rather than only the terminal completed state |
| 2026-04-15 | Added the first structured runtime progress projections beyond plain text/tool output on the direct stdio carrier: `progress.kind === plan` now becomes an ACP `plan` update and `progress.kind === model_state` with a concrete model value becomes `config_option_update`, so ACP clients can observe runtime plan checkpoints and model reroutes as native ACP state changes instead of only free-form status text |
| 2026-04-15 | Added runtime session-state projection and dedupe on the direct stdio carrier: when streamed runtime events carry `providerState.agentSession.adapterState` or compatible `session` metadata, the ACP facade now emits native `current_mode_update` and `usage_update` notifications exactly once per observed state change, so IDE clients can track mode/context-window state without getting the same snapshot replayed on every later event |
| 2026-04-15 | Extended the same direct-stdio state projection pattern to session identity and command catalogs: repeated provider-side `sessionTitle` / `availableCommands` snapshots now normalize into single ACP `session_info_update` and `available_commands_update` notifications per actual change, so IDE clients can learn the effective title and slash-command catalog without reprocessing duplicate state on every later stream event |
| 2026-04-15 | Closed the first direct-stdio refusal UX gap: terminal runtime `error` events that are not cancellations now emit one final ACP `agent_message_chunk` before the prompt result returns `stopReason: refusal`, so IDE clients can show the actual refusal reason instead of only an abstract stop code |
| 2026-04-15 | Landed the first HTTP prompt carrier for the runtime ACP facade: `/acp` now advertises `session/prompt` on HTTP, requires `Accept: application/x-ndjson` for prompt turns, and streams `session/update` notifications plus the final JSON-RPC result as NDJSON lines on the same response body so browser/IDE clients no longer need direct stdio just to drive runtime-owned prompt turns |
| 2026-04-15 | Closed the first ACP proxy-mode follow-through gap: the default `cats-runtime acp` HTTP-proxy path now upgrades proxied `session/prompt` calls to `Accept: application/x-ndjson`, forwards upstream `session/update` notifications as they arrive, and waits for the terminal JSON-RPC result line instead of buffering the entire upstream prompt stream into a plain JSON response |
| 2026-04-15 | Updated the plan/docs baseline after the HTTP prompt slices: Phase 4 is now treated as landed across HTTP, proxy stdio, and direct stdio carriers, while architecture/API notes now state explicitly that ACP-created runtime sessions still flow into the shared `/sessions/:id/messages` path where later A2A peer-routing decisions remain a runtime-to-peer concern |
| 2026-04-15 | Tightened proxy-mode ACP truthfulness after prompt support landed: proxied initialize/result payloads now rewrite `_meta.catsRuntime.transport` to `stdio` and attach proxy metadata about the upstream HTTP target, so subprocess clients can distinguish a local stdio proxy carrier from the runtime's underlying `/acp` HTTP surface without losing the upstream session/prompt capability details |
| 2026-04-20 | Added the first dedicated ACP coexistence diagnostics slice: `GET /diagnostics/runtime` now exposes `runtime.acp` with machine-readable client-to-runtime HTTP/stdio carrier metadata plus the provider-side `agent/acp` boundary, and `GET /diagnostics/health` now mirrors a compact ACP summary so packaged hosts can poll the same layering truth without opening the full runtime snapshot |
| 2026-04-20 | Closed the next ACP proxy operator gap by giving `cats-runtime acp` the same `--inspect-proxy` preflight posture as the MCP helper: the ACP stdio proxy can now resolve its current target, run a `ping` preflight, preserve classified proxy failures, and exit without starting the stdio server, so packaged and repo-local hosts can validate ACP proxy mode before launch |
| 2026-04-20 | Deepened the Phase 5 layering diagnostics so `runtime.acp` now reports the separate runtime-to-peer boundary as well: runtime/health snapshots explicitly distinguish client-to-runtime ACP carriers, provider-side `agent/acp`, and the A2A/peer-execution layer exposed through `GET /diagnostics/peers` and `POST /peer/executions` |
| 2026-04-20 | Tightened ACP operator-truth metadata after the proxy preflight landed: `runtime.acp.clientToRuntime.stdio` and the compact health summary now advertise `--inspect-proxy` explicitly, so diagnostics consumers can discover the ACP proxy preflight capability without scraping CLI help text |
| 2026-04-20 | Started narrowing the ACP provider config shape without breaking existing YAML: `providers.yaml` can now express ACP stdio launch settings through a dedicated nested `launch:` block (`command`, `args`, `cwd`, `startup_timeout_ms`) while the runtime still normalizes onto the same remote provider instance fields and remains backward-compatible with the older flat keys |
| 2026-04-20 | Extended the same config-shape narrowing to ACP connection settings: `providers.yaml` can now express ACP endpoint/auth/header fields through a dedicated nested `connect:` block (`url`, `url_env`, `base_url`, `base_url_env`, `auth_token_env`, `api_key_env`, `password_env`, and `headers`) while still normalizing onto the existing remote provider instance fields and remaining backward-compatible with the older flat keys |
| 2026-04-20 | Tightened provider-side ACP auth truth for stdio targets: ACP inspection now reports env-propagated `auth_token` / `password` credentials under a dedicated `launch_env` auth mechanism when the stdio target is configured to pass those credentials through subprocess launch, instead of incorrectly reporting stdio ACP auth as always empty |
