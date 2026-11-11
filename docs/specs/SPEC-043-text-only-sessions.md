# SPEC-043: Text-Only Sessions

## Metadata

| Field | Value |
| --- | --- |
| Status | Draft, 2026-11-11. Not approved; not implemented. Per-provider support depends on the research in this spec |
| Owner | Runtime execution, with Bot as the first consumer |
| Reviewer | Owner; independent security review before implementation |
| Date | 2026-11-11 |
| Baseline | Runtime fb50e59ab2244bd2c45ae93fa11345cb7507011c |
| Decision | To be recorded as an ADR at approval |
| Delivery | A plan follows approval; its first phase is the research below |
| Requested by | Bot [SPEC-015](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-015-bot-memory-layers-recall-and-consolidation.md) FR-14 and [SPEC-012](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-012-boss-cat-status-board-and-contact-notes.md) FR-13 |

## Summary

A text-only session is one in which the model can read the prompt it is given and write
text, and can do nothing else: no tool can run, no MCP server is attached, and no other
context source is loaded. Consumers need it to run a model over text they do not trust. Bot
needs it to consolidate memory from conversation transcripts and, later, for the status
answers of SPEC-012.

**No CLI adapter can do this today.** Every adapter either leaves tools in the model's
toolset and refuses them at approval time, or cannot restrict them at all. This spec
therefore defines the contract, a fail-closed admission, and the evidence a provider needs
before Runtime may offer it. It does not promise that any particular provider will qualify.

## Current state

An audit at the baseline; file references are to `src/`. "Removed" means a tool is not in the
model's toolset. "Denied" means it is advertised and refused when called.

- **Tools are denied or unrestricted, never removed.**
  - **claude** selects a permission mode and an optional allow list; it passes no flag that
    empties the toolset (`backends/cli/providers/claude.ts`).
  - **codex** starts a thread with a sandbox and an approval policy
    (`codex.ts`, `codexPolicy.ts`). Its built-in tools are not exposed to Runtime
    (`codexInventory.ts`).
  - **grok (per-turn)** passes `--tools <list>` and refuses an empty list.
    - The adapter's own comment explains why: in live probes, plan, deny and
      disallowed-tools modes still executed tools.
    - Research `2026-08-08-grok-cli-install-tier-probe.md` found a non-empty allow list to
      be the only hard boundary.
  - **muse (per-turn)** can disable write, shell and web tools, but its read tools have no
    switch (`muse.ts`).
  - **Hosted ACP (grok, antigravity) and muse MSP** require a provider policy with full
    machine and network access (`hostedAcp.ts`, `musePolicy.ts`).
  - **copilot** always launches with all tools allowed, **cursor** launches with `--trust`,
    and **goose** and **junie** declare no permission support.
- **Session MCP servers are added to whatever the CLI loads itself.**
  - No adapter passes a strict flag.
  - A headless claude run loaded the account's connectors, 73 tools
    (`docs/research/2026-10-28-claude-host-control-protocol.md`).
  - codex inherits user and system configuration, where `codex_apps` exposed 279 tools
    (`docs/research/2026-10-28-codex-host-capability-gaps.md`).
- **Nothing isolates the CLI's own configuration.**
  - The child process inherits Runtime's environment (`backends/cli/pool/WorkerProcess.ts`).
  - No adapter passes a setting that limits which settings, memory, plugins or hooks the
    CLI loads.
  - Instance `args` are prepended to every launch and can add plugin or profile
    directories.
- **Runtime itself adds little.**
  - Skills are resolved only when requested.
  - The workspace substrate is audited, not written.
  - Instructions travel as a prompt prefix.
- **The private directory exists, with a catch.** A session created without `cwd` runs in an
  empty `<sessionBaseDir>/<sessionId>`. A read-write sandbox forces permission mode `skip`,
  which is full-auto (`core/workspace/sessionWorkspace.ts`).
- **What a provider reports before the first turn differs.**
  - claude answers `mcp_status` without a turn, but emits its `system/init` tool list only
    after the first user message.
  - codex reports MCP servers without a turn and does not report built-in tools.
  - Per-turn adapters put the prompt in the launch itself, so there is no moment before the
    first turn.
- **Ephemeral native sessions are verified for Codex only** (SPEC-041).
- **Delete is already broad.**
  - `DELETE /sessions/:id` removes the sandbox, the Runtime transcript, and provider files
    or native sessions for most adapters.
  - It answers `retained`, with the paths, when removal was incomplete
    (`http/routes/sessions.ts`).
  - Whether metering, receipts and diagnostics hold prompt text has not been audited.
- **API backends can omit tools.**
  - An instance with `tool_profile` `none` or `chat` sends none
    (`core/tools/LocalToolRuntime.ts`).
  - This is per instance, not per session.
  - An unknown profile falls back to `standard`, and a payload template can add provider
    tools.
- **One candidate mechanism is already in the repository.**
  - The claude quota probe launches with
    `--safe-mode --no-session-persistence --tools '' --strict-mcp-config`
    (`backends/cli/usage/claudeQuota.ts`).
  - Research `2026-09-11-additional-cli-quota-queries.md` records that safe mode disables
    custom hooks, MCP and skills, and warns against `--bare` because it changes
    authentication.
  - That probe sends no user message, so it is not evidence for a model turn.

## Goals

- A consumer can run model turns over untrusted text and know that no tool executed and that
  the session loaded no context beyond what the consumer sent.
- Fail closed. A target that cannot establish this refuses the session before any content is
  sent. It is never downgraded to a restricted-but-tooled session.
- The session can be deleted together with its content.
- Runtime reports honestly how the guarantee was established and what remains outside it.

## Non-goals

- Confining the CLI process at the operating-system level. The binary still runs as the
  user; this spec is about what the model can do.
- Provider-side retention or training. ADR-050 already says persistence control is not a
  general data-erasure promise.
- Enforcing an output format. The consumer validates what it gets back.
- Making every provider qualify.
- Changing how ordinary sessions are permitted.

## Requirements

### R1. Request

- Session create gains an optional `sessionProfile`. Its only new value is `"text_only"`;
  omission keeps today's behaviour.
- The choice is immutable. It appears in session reads, spawn options and stored records.
- A text-only create accepts `provider`, `instance`, `model` and model selection,
  `instructions`, `sessionLabel` and `providerSessionPersistence`.
- It refuses, with a 400 and `code: "session_profile_invalid"`, any of: `cwd`, workspace
  kind, access, mode or isolation, `permissionMode`, `allowedTools`, `executionPolicy`,
  `interactionHost`, `mcpServers`, `skills`, `outputDir`, a session key for reuse, and peer
  routing.
- A target that cannot offer the profile answers 400 with
  `code: "session_profile_unsupported"` before any provider process starts.
- An instance with configured `args` is unsupported, as the quota probe already treats it,
  because such arguments can re-enable tools or plugins.

### R2. Guarantees

For the life of a text-only session:

1. **No tool can execute.** That covers built-in tools (file, command, web, memory,
   subagent, browser), MCP tools, Runtime dynamic tools and provider-side connectors.
2. **No MCP server is attached**, from the session, from user, project or system
   configuration, from account connectors, or from plugins.
3. **The workspace is private and empty.** Runtime creates `<sessionBaseDir>/<sessionId>`,
   writes nothing into it, and removes it on delete. The caller cannot choose it.
4. **Runtime adds no skills, hydration metadata or workspace substrate.**
5. **No provider-native memory or instruction file is loaded**, at project or user level,
   and the provider's automatic memory is neither read nor written.
6. **No plugins, hooks, native skills, custom commands or subagents are loaded.**
7. **No continuation.** The session does not resume a previous native session and cannot be
   forked, woken, peer-routed or reused by session key.
8. **The only inputs are the session `instructions` and each send's message, `instructions`
   and `turnContext`** (SPEC-042).

The profile overrides the legacy derivations that would otherwise apply: the
sandbox-to-`skip` rule does not run, and no adapter passes a flag that approves tools.

### R3. Reported, not guaranteed

The create readback and the capabilities read state what the guarantee does not cover:

- the provider's built-in system prompt;
- organization-managed settings that a user-level launch cannot disable;
- the inherited process environment, which the CLI can read and the model cannot;
- provider-side retention of the conversation.

An item of R2 whose state Runtime cannot establish is not reported as unknown. It makes the
target unsupported (R4).

### R4. Admission and verification

- A target is offered only with one of these mechanisms:
  - `provider_report`: the provider's own report for this session shows an empty toolset,
    no MCP server and no loaded memory, and Runtime checks it in every session;
  - `not_sent`: Runtime builds the provider request itself and sends no tool definitions
    (API backends, R7).
- Refusing tools at approval time is not a mechanism. Denial has failed in probes, and some
  CLIs run read tools without asking.
- Launch switches without a provider report are not a mechanism either. They are how an
  adapter asks for the profile; the report is how Runtime knows it was honoured.
- **Checks during the session:**
  - Whatever the provider can report without a turn is checked before the first send.
  - The provider's first report in a turn is checked before any other event of that turn is
    accepted.
  - Any tool event, MCP status change, approval request, question or elicitation is a
    violation.
- **On a violation**, Runtime does all of the following:
  - kills the worker and discards the turn's output;
  - fails the turn with `code: "text_only_violation"`;
  - marks the session terminal.

  A consumer must treat the turn as not having happened.
- **Known limits by adapter class**, to be settled by the research below:
  - **claude**: MCP can be checked before the first send. The built-in tool list arrives
    only once the first user message has been sent, so the prompt reaches the provider
    before the toolset is confirmed. Whether that report always precedes any tool execution
    must be shown.
  - **codex**: built-in tools are not reported, so `provider_report` is not available until
    Codex exposes them or a verified switch removes them.
  - **Per-turn adapters**: there is no check before the first turn. They qualify only if
    their stream reports the toolset first and a zero-tool launch exists.
- Support is granted per adapter by evidence, never by CLI version (ADR-035).

### R5. Persistence and deletion

- `providerSessionPersistence` defaults to `ephemeral` where the target supports it. An
  explicit value follows SPEC-041's rules.
- The lifecycle follows SPEC-041 R2: turns may continue in the live worker; after close,
  cancellation, worker loss or a Runtime restart the session cannot run again and answers
  410.
- `DELETE /sessions/:id` removes:
  - the private directory;
  - the Runtime transcript, including recorded instructions and turn context;
  - the registry entry with its previews, summary and label;
  - run inspection and receipts for the session;
  - provider-native files or native sessions attributable to it.

  It keeps the existing `deleted` and `retained` answers.
- **Content-free residue.** After `deleted`, no prompt or response text of the session
  remains in Runtime-owned storage, including diagnostics and logs. Metering keeps counts,
  identifiers and times.
- Runtime does not delete on close. The consumer deletes, and can find leftovers after a
  crash because session reads show the profile.
- This remains a statement about the stores named here, not a data-erasure promise.

### R6. Capability

- The target capability read (the `continuity` block of `GET /providers/config` and
  `GET /providers/:provider/tools`) gains, only where the profile is offered,
  `textOnly: { version: 1, mechanism: "provider_report" | "not_sent", persistence: "ephemeral" | "delete" }`.
- The create readback repeats the admitted profile and mechanism, and lists R3's items.
- `GET /sessions/:id/capabilities` for a text-only session reports an empty inventory with
  its source.

### R7. API backends

- A text-only session sends no tool definitions, whatever the instance's `tool_profile`.
- An instance whose payload template adds provider tools is unsupported.
- The fallback of an unknown profile to `standard` does not apply to text-only sessions.

### R8. Unchanged services

- Metering, guardrails, timeouts, cancellation, streaming and usage records work as for any
  session.
- A text-only session counts against the session limit.

### R9. Compatibility

- The create field, the capability block and the three error codes are additive within the
  current minor line.
- The stored session record gains one optional field; a record without it is a standard
  session. The plan states whether this needs an upgrade step under the version policy.
- No version bump or publication is part of this spec.

## Research required

The plan's first phase. Each item ends in redacted fixtures and a recorded answer, as for
`provider_session_unavailable` in Runtime #214. Runs use isolated provider homes and never
the user's real profile.

1. **claude**
   - With the quota probe's switches, does a completed model turn report an empty toolset,
     no MCP server and no memory paths, and does a prompt that asks for a tool produce none?
   - Does `system/init` always arrive before any tool execution in the first turn?
   - Is user-level memory loaded under safe mode?
   - Does authentication behave as in a normal launch?
2. **codex**
   - Can a thread be started with no tools, and can Runtime read the effective toolset?
   - What can the read-only sandbox read outside the working directory?
   - Can user-level instruction files be left out?
3. **grok**: is there any launch with an empty toolset that the CLI honours and reports?
4. **Other adapters a product can select**: the same three questions, recorded as supported
   or unsupported with the evidence.
5. **Runtime's own stores**: which of metering, receipts, inspection, diagnostics and logs
   hold prompt or response text, for R5's residue requirement.

## Consequences for consumers

Not requirements on Runtime; listed so the owners can decide.

- **Bot consolidation** (SPEC-015 FR-14) runs only on targets that qualify.
  - Bot ADR-022 decision 6 keeps consolidation on the bot's own provider.
  - Until research finds a mechanism, bots on codex or grok would have no consolidation.
  - Allowing a separate consolidation target, for example an API-backend instance in the
    bot's private Runtime, would remove that limit. That is Bot's decision.
- **Bot SPEC-012 Phase 2** has the same dependency.
- **Platform's Catlas jobs** keep their current read-only, ephemeral sessions. They may adopt
  the profile later.

## Acceptance

- **Refusals.**
  - An unsupported target, an instance with `args`, and each excluded create field answer
    with the typed 400.
  - No provider process starts for any of them.
- **A qualifying target.**
  - A turn whose prompt asks for file, command, web and MCP tools completes with text only.
  - The readback and capabilities show the mechanism and an empty inventory.
- **Violation.** A fixture in which the provider reports a tool, or emits a tool event, ends
  with `text_only_violation`, a killed worker, a terminal session and no delivered output.
- **Isolation.** In an isolated home that holds user-level memory, project memory, a
  configured MCP server, a plugin and a hook, none appears in the provider's report or
  affects the turn.
- **Lifecycle.**
  - Resume, fork, wake, peer routing and session-key reuse are refused.
  - A Runtime restart leaves the session terminal.
- **Deletion.**
  - After `deleted`, a canary placed in the instructions, the turn context, the message and
    the reply is found nowhere under the Runtime directory or the isolated provider home.
  - `retained` names what is left.
- **API backend.** No tool definitions are sent for any instance profile, and an instance
  with template tools is refused.
- **Ordinary sessions** behave exactly as before.

## Alternatives considered

- **Deny or intercept tool calls.**
  - It is available on more providers.
  - Probes showed denial failing on grok, and some CLIs run read tools without an approval
    request. A read is enough to move a secret into the model's output.
- **A read-only sandbox in an empty directory**, as today's internal jobs use.
  - Tools still exist, the account's MCP connectors still load, and how far such a sandbox
    reads is unverified.
- **A stateless completion endpoint** instead of a session profile.
  - It is simpler for single calls.
  - It would duplicate streaming, cancellation, metering and deletion, and consolidation
    needs several turns.
- **Operating-system sandboxing of the CLI process.**
  - It is the strongest boundary.
  - It is specific to each platform and much larger than this change. It can be added later
    without changing this contract.
- **API backends only.**
  - They satisfy the profile by construction.
  - They need API credentials that subscription-based bots do not have.
  - They remain the likely first qualifying target.

## Open questions

Each has a recommended default.

- [ ] Field name and value. Recommended: `sessionProfile: "text_only"`.
- [ ] Admitted mechanisms. Recommended: `provider_report` and `not_sent` only.
- [ ] User-level native instruction files. Recommended: must not be loaded (R2 item 5),
      because SPEC-012 FR-13 needs it. Reporting them instead is rejected.
- [ ] First targets. Recommended: API backends, then claude if its research passes; codex
      and grok after their research.
- [ ] Delete on close. Recommended: no; the consumer deletes.
- [ ] Whether a failed violation check may be retried on a fresh session automatically.
      Recommended: no; the consumer decides.

## Dependencies and references

- [SPEC-041](SPEC-041-provider-session-retention-and-continuity.md) and
  [ADR-050](../decisions/050-separate-provider-session-persistence-from-product-history.md)
  (ephemeral sessions and their lifecycle).
- [SPEC-039](SPEC-039-provider-session-capabilities-and-interactions.md) and
  [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md)
  (effective capabilities; ceilings an adapter cannot enforce are rejected).
- [SPEC-040](SPEC-040-native-provider-tools-and-interactions.md) and
  [ADR-049](../decisions/049-use-native-control-protocols-for-hosted-provider-tools.md)
  (hosted tools need full access).
- [SPEC-035](SPEC-035-session-mcp-servers.md),
  [ADR-035](../decisions/035-never-block-provider-execution-on-exact-cli-version.md),
  [ADR-012](../decisions/012-separate-evidence-memory-and-retrieval-layers.md).
- [SPEC-042](SPEC-042-turn-scoped-context.md), the first prerequisite from the same plan.
- Research: `docs/research/2026-08-08-grok-cli-install-tier-probe.md`,
  `2026-09-11-additional-cli-quota-queries.md`,
  `2026-10-28-claude-host-control-protocol.md`,
  `2026-10-28-codex-host-capability-gaps.md`.
- Bot [ADR-022](https://github.com/cats-inc/cats-bot/blob/main/docs/decisions/022-give-each-bot-layered-memory-it-consolidates-while-asleep.md).
