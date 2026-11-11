# SPEC-043: Text-Only Sessions

## Metadata

| Field | Value |
| --- | --- |
| Status | Approved by the owner on 2026-11-11 with the recommended answers to its open questions. R10 was added later the same day and accepted by the owner. Not implemented. No provider is offered until the research in this spec qualifies it |
| Owner | Runtime execution, with Bot as the first consumer |
| Reviewer | Owner; independent read-only review completed on the draft, findings fixed. An independent security review is required before implementation |
| Date | 2026-11-11 |
| Baseline | Runtime fb50e59ab2244bd2c45ae93fa11345cb7507011c |
| Decision | [ADR-052](../decisions/052-offer-text-only-sessions-only-on-evidence.md) |
| Delivery | A plan follows; its first phase is the research below. None is authorized yet |
| Requested by | Bot [SPEC-015](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-015-bot-memory-layers-recall-and-consolidation.md) FR-14 and [SPEC-012](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-012-boss-cat-status-board-and-contact-notes.md) FR-13 |

## Summary

A text-only session is one in which the model can read the prompt it is given and write
text, and can do nothing else: no tool can run, no MCP server is attached, and no other
context source is loaded. Consumers need it to run a model over text they do not trust. Bot
needs it to consolidate memory from conversation transcripts and, later, for the status
answers of SPEC-012.

**No CLI adapter can do this today.** Every adapter leaves at least some tools available to
the model, refuses them only at approval time, or cannot restrict them at all. This spec
therefore defines the contract, a fail-closed admission, and the evidence a provider needs
before Runtime may offer it. It does not promise that any particular provider will qualify.

## Current state

An audit at the baseline; file references are to `src/`. "Removed" means a tool is not in the
model's toolset. "Denied" means it is advertised and refused when called.

- **No adapter can remove all tools.**
  - **claude** selects a permission mode and an optional allow list; it passes no flag that
    empties the toolset (`backends/cli/providers/claude.ts`).
  - **codex** starts a thread with a sandbox and an approval policy
    (`codex.ts`, `codexPolicy.ts`). Its built-in tools are not exposed to Runtime
    (`codexInventory.ts`).
  - **grok (per-turn)** passes `--tools <list>`, which removes unlisted tools, and refuses
    an empty list.
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
  - A native provider CLI inherits Runtime's environment
    (`backends/cli/pool/WorkerProcess.ts`). Only `CLAUDECODE` and the plugin-management key
    are removed, so Runtime's own API key and any backend key in that environment reach it
    (R10).
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
- **Create and send ignore unknown fields.** An older Runtime that receives a new create
  field returns an ordinary session. In a private directory, that session is full-auto.
- **A send can change a session.** `POST /sessions/:id/messages` accepts `mcpServers`,
  `skills`, `context`, `outputDir`, routing and strategy fields
  (`http/routes/messages.ts`). Create also accepts `browserIntegration`, which adds a browser
  MCP server on claude.
- **What a provider reports differs.**
  - claude answers `mcp_status` without a turn. Its `system/init` arrives only after the
    first user message and lists tools, MCP servers, skills, plugins, agents, slash commands
    and memory paths. It does not list hooks.
  - codex reports MCP servers without a turn and does not report built-in tools.
  - Per-turn adapters put the prompt in the launch itself, so there is no moment before the
    first turn.
- **Output is streamed as it arrives.** Each event is written to the client when it is
  observed, and partial text is flushed to history on an error (`http/routes/messages.ts`).
- **Ephemeral native sessions are verified for Codex only** (SPEC-041).
- **Delete is broad, with two gaps.**
  - `DELETE /sessions/:id` removes the sandbox, the Runtime transcript, and provider files
    or native sessions for most adapters. It answers `retained`, with the paths, when file
    removal was incomplete (`http/routes/sessions.ts`).
  - It can still answer `deleted` when removing the sandbox directory failed.
  - Native cleanup needs a known provider session id.
  - Whether metering, receipts, diagnostics and provider-evolution raw samples
    (`core/compatibility/providerEvolution.ts`) hold prompt text has not been audited.
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

- A consumer can run model turns over untrusted text and know that no tool was available to
  the model and that the session loaded no context beyond what the consumer sent.
- Fail closed. A target that cannot establish this refuses the session before any content is
  sent. It is never downgraded to a restricted-but-tooled session.
- The session leaves no resumable native conversation, and can be deleted together with its
  content.
- Runtime reports honestly how each guarantee was established and what remains outside it.

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
- **A closed list for create.** A text-only create accepts only `provider`, `instance`,
  `model`, `modelSelection`, `instructions`, `sessionLabel`, `group` and `correlation`. Any
  other field is a 400 with `code: "session_profile_invalid"`. That includes the workspace
  fields, permission fields, `executionPolicy`, `interactionHost`, `mcpServers`, `skills`,
  `browserIntegration`, `providerSessionPersistence`, `context`, `outputDir`, strategy
  fields, and `sessionKey` with `reusePolicy`.
- **A closed list for sends.** A send to a text-only session accepts only `message`,
  `instructions` and `turnContext` (SPEC-042). Any other field is the same 400.
- **A closed list of routes.** A text-only session answers reads (the session, the list,
  capabilities, history, observe, stream and lineage), `messages`, `close`, `cancel` and
  `DELETE`. Every other session route refuses it with `code: "session_profile_invalid"`:
  resume, fork in either direction, reset, compact and its follow-through, maintenance
  follow-through, workspace cleanup, interaction responses, wakeups and discovery. The MCP
  facade's equivalent tools follow the same lists.
- A target that cannot offer the profile answers 400 with
  `code: "session_profile_unsupported"` before any provider process starts.
- An instance with configured `args` is unsupported, as the quota probe already treats it,
  because such arguments can re-enable tools or plugins.
- **The consumer's part.** An older Runtime ignores the field and returns an ordinary
  session. A consumer must therefore:
  - read the `textOnly` capability (R6) before it creates;
  - confirm that the create readback says `sessionProfile: "text_only"` before it sends
    anything;
  - delete the session without sending if the readback is absent.

### R2. Guarantees and how each is established

Each guarantee names its evidence class:

- **Reported**: the provider's own report for this session shows it, and Runtime checks the
  report in every session.
- **Constructed**: Runtime controls it itself.
- **Launch evidence**: captured fixtures show that the adapter's launch has this effect, for
  something the provider does not report. It is not checked per session.

For the life of a text-only session:

1. **No tool is available to the model.** That covers built-in tools (file, command, web,
   memory, subagent, browser), MCP tools, Runtime dynamic tools and provider-side
   connectors. *Reported*, or *constructed* for API backends (R7).
2. **No MCP server is attached**, from the session, from user, project or system
   configuration, from account connectors, or from plugins. *Reported*, or *constructed* for
   API backends.
3. **The workspace is private and empty.** Runtime creates `<sessionBaseDir>/<sessionId>`,
   writes nothing into it, and removes it on delete. The caller cannot choose it.
   *Constructed.*
4. **Runtime adds no skills, hydration metadata or workspace substrate.** *Constructed.*
5. **No provider-native memory or instruction file is loaded**, at project or user level,
   and the provider's automatic memory is neither read nor written. *Reported* where the
   provider reports loaded memory; otherwise *launch evidence*.
6. **No plugins, native skills, custom commands or subagents are loaded.** *Reported* where
   the provider lists them; otherwise *launch evidence*.
7. **No hooks run.** *Launch evidence*; no provider reports them.
8. **No continuation.** The session does not resume a previous native session, and the
   routes of R1 refuse every way to continue it elsewhere. *Constructed.*
9. **No resumable native conversation is left behind** (R5). *Reported* or *launch
   evidence*, plus a check of the provider's store.
10. **The only inputs are the session `instructions` and each send's `message`,
    `instructions` and `turnContext`.** *Constructed.*

An item whose evidence a target lacks makes that target unsupported. It is never reported as
unknown.

The profile overrides the legacy derivations that would otherwise apply: the
sandbox-to-`skip` rule does not run, and no adapter passes a flag that approves tools.

### R3. Reported, not guaranteed

The create readback and the capabilities read state what the guarantees do not cover:

- the provider's built-in system prompt;
- organization-managed settings that a user-level launch cannot disable;
- the inherited process environment, which the CLI can read and the model cannot;
- provider-side retention of the conversation.

### R4. Admission and verification

- A target is offered only with one of these mechanisms for guarantees 1 and 2:
  - `provider_report`: the provider's own report for this session shows an empty toolset and
    no MCP server;
  - `not_sent`: Runtime builds the provider request itself and sends no tool definitions
    (API backends, R7).
- Refusing tools at approval time is not a mechanism. Denial has failed in probes, and some
  CLIs run read tools without asking.
- Launch switches alone are not a mechanism for guarantees 1 and 2. They are how an adapter
  asks for the profile; the report is how Runtime knows it was honoured.
- **Checks during the session:**
  - Whatever the provider can report without a turn is checked before the first send.
  - The provider's first report in a turn is checked before anything else of that turn is
    accepted.
  - Any tool event, MCP status change, approval request, question or elicitation is a
    violation.
- **Output is held, not streamed.** Runtime releases a turn's text to the client and to its
  history only once the provider's terminal result arrives without a violation. Progress and
  keep-alive events still flow.
- **On a violation**, Runtime:
  - kills the worker;
  - releases none of the turn's text and writes none of it to history;
  - fails the turn with `code: "text_only_violation"`;
  - marks the session terminal.
- A violation is detected after the fact. A tool event means the tool already ran. The
  guarantee rests on admission; the checks report a breach, they do not prevent one.
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

### R5. No native conversation, and deletion

- **No resumable native conversation.** A target qualifies only if the provider keeps no
  resumable native session for a text-only session: an ephemeral native session, or a launch
  that does not persist one. After the first turn Runtime checks the provider's store for
  the private directory and treats a native session file there as a violation.
- A text-only create does not accept `providerSessionPersistence`. SPEC-041's default for
  other sessions is unchanged.
- **Stored record.** Runtime stores no resumable provider session id for a text-only
  session. An older binary that reads the record finds a closed session with nothing to
  resume.
- **Lifecycle.** Turns may continue in the live worker. Once the worker ends, through close,
  cancellation, loss, a violation or a Runtime restart, the session is terminal and answers
  410, as SPEC-041's ephemeral sessions do.
- **Delete.** `DELETE /sessions/:id` removes:
  - the private directory;
  - the Runtime transcript, including recorded instructions and turn context;
  - the registry entry with its previews, summary and label;
  - run inspection and receipts for the session;
  - any provider-native file found for the private directory, which only a violation can
    leave behind.
- For a text-only session, `deleted` means all of that is gone. A failure to remove the
  private directory answers `retained`, which today it does not.
- **Content-free residue.** After `deleted`, no prompt or response text of the session
  remains in Runtime-owned storage, including diagnostics, logs and provider-evolution raw
  samples. Metering keeps counts, identifiers and times.
- Runtime does not delete on close. The consumer deletes, and can find leftovers after a
  crash because session reads show the profile.
- This remains a statement about the stores named here, not a data-erasure promise.

### R6. Capability

- The target capability read (the `continuity` block of `GET /providers/config` and
  `GET /providers/:provider/tools`) gains, only where the profile is offered,
  `textOnly: { version: 1, mechanism: "provider_report" | "not_sent" }`.
- The create readback repeats the admitted profile and mechanism, names the evidence class
  of each guarantee, and lists R3's items.
- `GET /sessions/:id/capabilities` for a text-only session reports an empty inventory with
  its source.

### R7. API backends

- A text-only session sends no tool definitions, whatever the instance's `tool_profile`.
- An instance whose payload template adds provider tools is unsupported.
- The fallback of an unknown profile to `standard` does not apply to text-only sessions.

### R8. Unchanged services

- Metering, guardrails, timeouts, cancellation and usage records work as for any session.
  Streaming differs as R4 states.
- A text-only session counts against the session limit.

### R9. Compatibility

- The create field, the capability block and the three error codes are additive within the
  current minor line.
- The stored session record gains one optional field; a record without it is a standard
  session. The plan states whether this needs an upgrade step under the version policy.
- Delete's stricter `retained` answer applies to text-only sessions only.
- R10 is not additive. It needs the next minor line, with release notes, because it changes
  what existing configurations pass to their child processes (R10, "What changes").
- No version bump or publication is part of this spec.

### R10. Credentials and child processes

Added on 2026-11-11 and accepted by the owner the same day. It is for consumers that run a
tool-capable
target and a text-only target in one Runtime, as Bot's separate consolidation target does.

**Why.** A session with tools can read the environment of the process that runs it. Today
that environment holds everything Runtime was started with:

- A native provider CLI inherits Runtime's whole environment
  (`backends/cli/pool/WorkerProcess.ts`). WSL and docker launches receive the environment
  Runtime builds for them.
- Other processes inherit it as well: the junie per-turn launch, the agent backend's ACP
  agents and terminals, the local tool runtime's `run_shell`, the Kilo and Opencode servers,
  quota probes, image runners and the Windows Codex host.
- Runtime's own API key is in that environment, and Runtime has one key for every route
  (`http/auth.ts`). A process that holds it can create a session on any configured target,
  including an API-backend one, and read any session's history.
- An ordinary API-backend session has `run_shell` and defaults to permission mode `skip`.
  Its shell prints the environment, including that instance's key.

**Rules.**

1. **One builder.** Every process Runtime starts gets its environment from one shared
   builder. No spawn site passes `process.env` itself.
2. **What the builder removes.**
   - Runtime's own API key.
   - Every variable that a configured API, local or agent backend instance names in a
     credential field: `api_key_env`, `auth_token_env`, `password_env`, `organization_env`
     and `project_env`.
   - The plugin-management key, as today.
3. **Text-only-only instances.** An instance can be configured to admit only text-only
   sessions. Creating any other session on it is refused with `session_profile_invalid`, so
   no session with tools can ever run beside that instance's key.
4. **Backends keep working.** A backend reads its credential inside the Runtime process, so
   removing the variable from children does not affect it.

**What changes.**

- A CLI that signs in through a variable that a backend instance also names loses it. The
  shipped example configuration names vendor variables such as `ANTHROPIC_API_KEY`. Such an
  instance must name a variable of its own.
- A helper that a Runtime-started CLI launches, such as a user-configured stdio proxy, no
  longer inherits Runtime's API key. It must be given the key explicitly.
- Nothing that Runtime starts itself needs the key in a child: session MCP servers use
  per-session tokens, and runtime skills do not reference it.

**Limits.** A process that runs as the same OS user can still read files and other
processes. This rule closes the environment and the loopback API as easy paths; it is not a
boundary against the user's own account.

## Research required

The plan's first phase. Each item ends in redacted fixtures and a recorded answer, as for
`provider_session_unavailable` in Runtime #214. Runs use isolated provider homes and never
the user's real profile.

1. **claude**
   - With the quota probe's switches, does a completed model turn report an empty toolset,
     no MCP server, no skills, plugins or agents and no memory paths, and does a prompt that
     asks for a tool produce none?
   - Does `system/init` always arrive before any tool execution in the first turn?
   - Is user-level memory loaded under safe mode, and do hooks run?
   - Is a native session file written with the no-persistence switch?
   - Does authentication behave as in a normal launch?
2. **codex**
   - Can a thread be started with no tools, and can Runtime read the effective toolset?
   - What can the read-only sandbox read outside the working directory?
   - Can user-level instruction files be left out?
3. **grok**: is there any launch with an empty toolset that the CLI honours and reports?
4. **Other adapters a product can select**: the same questions, recorded as supported or
   unsupported with the evidence.
5. **Runtime's own stores**: which of metering, receipts, inspection, diagnostics, logs and
   provider-evolution raw samples hold prompt or response text, for R5's residue
   requirement.

## Consequences for consumers

Not requirements on Runtime; listed so the owners can decide.

- **Every consumer** must check the capability and the create readback before it sends
  (R1). Against an older Runtime, an unchecked create yields a full-auto session.
- **Bot consolidation** (SPEC-015 FR-14 and FR-19) runs only on targets that qualify.
  - Bot amended ADR-022 decision 6 on 2026-11-11: consolidation uses the bot's own target
    by default, or a separate consolidation target the owner names for that bot.
  - A bot on codex or grok can therefore consolidate through an API-backend instance in its
    private Runtime, once R7 and R10 exist. On its own provider it would have no
    consolidation until research finds a mechanism.
  - Bot enables a separate target only when R10 is in place, and marks that instance as
    admitting only text-only sessions.
- **Bot SPEC-012 Phase 2** has the same dependency.
- **Platform's Catlas jobs** keep their current read-only, ephemeral sessions. They may adopt
  the profile later.

## Acceptance

- **Refusals.**
  - An unsupported target and an instance with `args` answer with the typed 400.
  - Each field outside the create and send lists, and each route outside the route list,
    answers with the typed 400.
  - No provider process starts for a refused create.
- **A qualifying target.**
  - A turn whose prompt asks for file, command, web and MCP tools completes with text only.
  - The readback and capabilities show the mechanism, the evidence classes and an empty
    inventory.
- **Violation.** A fixture in which the provider reports a tool, or emits a tool event
  after some text, ends with `text_only_violation`, a killed worker and a terminal session.
  The client received none of the turn's text, and history holds none.
- **Isolation.** In an isolated home that holds user-level memory, project memory, a
  configured MCP server, a plugin and a hook, none appears in the provider's report or
  affects the turn.
- **No native conversation.** After a completed turn the provider's store holds no session
  for the private directory.
- **Lifecycle.**
  - A Runtime restart leaves the session terminal.
  - A stored text-only record holds no resumable provider session id.
- **Deletion.**
  - After `deleted`, a canary placed in the instructions, the turn context, the message and
    the reply is found nowhere under the Runtime directory or the isolated provider home.
  - A private directory that cannot be removed answers `retained`, with the path.
- **API backend.** No tool definitions are sent for any instance profile, and an instance
  with template tools is refused.
- **Credentials (R10).**
  - With a backend instance configured, no process Runtime starts has Runtime's own API key
    or any variable that instance names in a credential field. Covered per spawn site:
    provider CLIs on native, WSL and docker launches, the junie per-turn launch, ACP agents
    and their terminals, `run_shell`, the Kilo and Opencode servers, quota probes, image
    runners and the Windows Codex host.
  - The backend still authenticates.
  - A create without the text-only profile on a text-only-only instance is refused.
- **Ordinary sessions** behave exactly as before.

## Alternatives considered

- **Deny or intercept tool calls.**
  - It is available on more providers.
  - Probes showed denial failing on grok, and some CLIs run read tools without an approval
    request. A read is enough to move a secret into the model's output.
- **A read-only sandbox in an empty directory**, as today's internal jobs use.
  - Tools still exist, the account's MCP connectors still load, and how far such a sandbox
    reads is unverified.
- **Keep a native conversation and delete it at the end.**
  - More providers could qualify.
  - A crash leaves untrusted text in a native session that a later tooled resume, or an
    older binary's discovery, could pick up.
- **A stateless completion endpoint** instead of a session profile.
  - It is simpler for single calls.
  - It would duplicate cancellation, metering and deletion, and consolidation needs several
    turns.
- **Operating-system sandboxing of the CLI process.**
  - It is the strongest boundary.
  - It is specific to each platform and much larger than this change. It can be added later
    without changing this contract.
- **API backends only.**
  - They satisfy the profile by construction.
  - They need API credentials that subscription-based bots do not have.
  - They remain the likely first qualifying target.

## Open questions

All were answered on 2026-11-11 with the recommended options. The review of the draft
refined three of them, as noted.

- [x] Field name and value: `sessionProfile: "text_only"`.
- [x] Admitted mechanisms: `provider_report` and `not_sent` only, for tools and MCP.
      Refined: launch evidence is accepted for what no provider reports, such as hooks (R2).
- [x] User-level native instruction files must not be loaded (R2 item 5). User-level memory
      can hold text from the owner's other conversations. Reporting them instead is
      rejected.
- [x] First targets: API backends, then claude if its research passes; codex and grok after
      their research.
- [x] No delete on close; the consumer deletes. Refined: a qualifying target keeps no
      resumable native conversation in the first place (R5).
- [x] A violation is never retried automatically on a fresh session; the consumer decides.
      Refined: output is held until the turn ends, so a violated turn delivers nothing (R4).

Added on 2026-11-11 with R10, and answered by the owner the same day with the recommended
options:

- [x] R10 as written: one environment builder, Runtime's own key and backend credentials
      removed from every child, and text-only-only instances.
- [x] Version boundary for R10: the next minor line, with release notes, and no opt-out.

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
