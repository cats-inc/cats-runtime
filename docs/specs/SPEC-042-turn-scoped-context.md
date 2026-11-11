# SPEC-042: Turn-Scoped Context

## Metadata

| Field | Value |
| --- | --- |
| Status | Approved by the owner on 2026-11-11 with the recommended answers to its open questions. Not implemented |
| Owner | Runtime execution, with Bot and Platform consumer owners |
| Reviewer | Owner; independent read-only review completed on the draft, findings fixed |
| Date | 2026-11-11 |
| Baseline | Runtime fb50e59ab2244bd2c45ae93fa11345cb7507011c |
| Decision | [ADR-051](../decisions/051-carry-one-turn-context-in-its-own-send-field.md) |
| Delivery | A plan follows; none is authorized yet |
| Requested by | Bot [SPEC-015](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-015-bot-memory-layers-recall-and-consolidation.md) FR-6, FR-8 and FR-10, and [PLAN-014](https://github.com/cats-inc/cats-bot/blob/main/docs/plans/PLAN-014-bot-state-database-and-memory.md) P0 |

## Summary

A send can carry text that the provider receives for that one execution and that Runtime
does not keep as session state. Today the only text channel beside the message is
`instructions`, and a send's `instructions` becomes the session's instructions for every
later turn. A consumer therefore cannot give a turn its own context — recall results, a
memory change, a one-time handoff — without replacing the persona and everything else the
session was created with. This spec adds an additive `turnContext` field, a capacity check
for the composed prompt, and a capability flag.

## Current behaviour

Read at the baseline; file references are to `src/`.

- **A send's `instructions` persists.** `POST /sessions/:id/messages` delivers the field as
  the top instruction layer and stores it as the session's instructions
  (`http/routes/messages.ts`; `docs/api.md` describes the order for message turns).
- **Every turn re-sends the instruction layers.**
  - CLI adapters compose skills, session instructions and turn instructions into the turn's
    prompt (`compileRuntimeTurnPrompt` in `backends/cli/providers/prompt.ts`; inline
    envelopes in `codex.ts` and `pi.ts`).
  - API backends put the layers into the system prompt and rebuild the conversation from
    Runtime's history on every turn (`backends/api/runtime/ApiBackendManager.ts`,
    `backends/api/history.ts`).
  - The agent backend's ACP adapter prepends the turn's instructions to the message itself
    (`backends/agent/adapters/acp/AcpAdapter.ts`).
- **An identical adjacent layer is dropped** (`mergeRuntimeInstructionLayers` in
  `core/skills/catalog.ts`). A turn-only text that happens to equal the session instructions
  would vanish if it went through that merge.
- **Runtime's own history records the layers.** Each user turn stores `sessionInstructions`
  and `instructions` beside the message (`appendUserTurnHistory`).
- **Unknown body fields are ignored silently.** A consumer that sends a new field to an older
  Runtime gets no error.
- **`context` is taken.** The existing `context` field is invocation metadata
  (`SessionInvocationContext`), not text for the provider.
- **Session metadata is written early.** The route stores a send's `instructions` before it
  checks whether the session is busy, has a worker, or is stopped by a guardrail.
- **No size check exists.**
  - The grok, antigravity, cursor, muse, goose and cline per-turn adapters pass the whole
    composed prompt as a process argument.
  - How that argument travels also depends on the instance's runtime mode: native, WSL or
    docker (`backends/cli/runtime/runtime.ts`).
  - Measured on Windows with Node 26, native mode: a 32,000-character argument starts, and a
    33,000-character one fails with `ENAMETOOLONG`
    ([probe](../research/2026-11-11-process-argument-length-probe.md)).
  - The copilot and auggie adapters write long prompts to a temp file, tell the model to
    read it, and remove the file afterwards. That path needs a read tool.
- **Other entry points do not carry instructions.** The ACP facade's `session/prompt`
  forwards only the message and routing (`acp/server.ts`). Peers advertise providers and
  targets, not features (`core/peers/PeerCapabilitySnapshotService.ts`).
- **Consumers already work around this.**
  - Bot keeps its tool guidance out of turn instructions because Runtime persists them
    (`cats-bot/src/core/desktopControl/tools.ts`).
  - Platform delivers a continuity transplant as turn instructions
    (`continuityDeliveryMode: 'turn_instructions'`). Traced in code, not observed: a later
    turn that sends no instructions keeps re-sending that transplant as the session's
    instructions.

## Goals

- A consumer can attach context to one turn without changing what later turns receive.
- A turn that cannot be delivered because of its size is refused before anything starts,
  with the limit in the error.
- A consumer can tell whether a Runtime supports the field, and that a turn's context was
  delivered.
- Existing sends behave exactly as before.

## Non-goals

- Changing what `instructions` means, or adding a way to edit session instructions without a
  turn.
- Native per-turn channels such as a developer-instructions override. SPEC-041 R5 records
  that the Codex turn schema has none.
- Moving session instructions out of the per-turn prompt.
- Summarizing, truncating or interpreting the context. It is the consumer's text.
- Carrying the field through the ACP facade or to peers (R6).
- Removing the argument-length limit of every adapter. R4 makes the limit visible; lifting
  it is per-adapter follow-up work.

## Requirements

### R1. The field

- `turnContext` is an optional string on `POST /sessions/:id/messages`, in both stream
  forms, and on the MCP `send_message` tool. Wakeups send no consumer text and are
  unchanged.
- It is trimmed; empty means absent. A non-string value is a 400 with
  `code: "turn_context_invalid"`.
- It may hold at most 100,000 Unicode code points. A longer value is a 400 with
  `code: "turn_context_too_large"` and the limit.
- It applies to the execution that the send starts, including that execution's spawn
  retries, and to nothing else.
- A send may carry both `instructions` and `turnContext`. `instructions` persists as today;
  `turnContext` does not.

### R2. Not session state

- `turnContext` never changes the session's instructions, skills, context metadata, summary
  or `lastInputPreview`, and it is not part of any session read, inspection or dashboard
  view of the session.
- Resume, fork (including `context_transplant`), wakeup-triggered turns and later sends do
  not carry it.
- Runtime's own history records it on that user turn, beside `instructions`, as evidence of
  what the provider was sent (ADR-012). `GET /sessions/:id/history` keeps returning the
  user's message as the turn's text. Deleting the session deletes it with the transcript.
- The provider's own conversation keeps what it was sent. That is intended: a one-time
  handoff stays in the native history without Runtime sending it again.

### R3. Composition

CLI adapters gain one section between the instructions and the message:

```text
Instructions:
<skills, session instructions, turn instructions>

Context for this turn:
<turnContext>

User message:
<message>
```

- The instructions section is omitted when there are no instruction layers, as today.
- `turnContext` does not pass through `mergeRuntimeInstructionLayers`; it is never
  deduplicated against an instruction layer.
- One shared composer produces the envelope, and the inline copies in `codex.ts` and
  `pi.ts` use it.
- **API backends** keep instructions in the system prompt. The context is placed before that
  turn's user text under the same heading. The conversation is rebuilt from history on every
  turn, so each earlier turn is rebuilt with the context it was sent.
- **The agent backend's ACP adapter** uses the same three parts in the same order where it
  prepends instructions today.
- On every backend, a send without `turnContext` produces exactly what it produces today.
- Runtime does not fence or escape the text. A consumer that sends untrusted material fences
  it itself.

### R4. Capacity

- The launch path decides how a prompt travels and what limit applies. A launch path is the
  adapter, the instance's runtime mode (native, WSL or docker) and the platform.
- Each adapter provides a side-effect-free measure: given a turn's input and the launch
  path, it returns the size of what would be launched, in the unit that path limits, and the
  limit, or none.
- The route calls the measure before it writes any session metadata and before any process
  starts. Over the limit, the send is a 400 with `code: "turn_input_too_large"`, the
  measured size and the limit. The session is left exactly as it was, including its
  instructions when the refused send carried some.
- The refusal uses the actual arguments, with no safety margin. A send that starts today is
  never refused.
- The limit covers the whole composed prompt, because instructions, context and message
  share one transport.
- A launch path with no practical limit (stdin or a protocol frame) declares none.
- The copilot and auggie temp-file paths stay as they are and declare no limit. They depend
  on a read tool, so they cannot serve a session without tools (SPEC-043).
- Limits for launch paths other than native Windows are measured in the plan, not assumed.
- Follow-up, outside this spec: move argument-passing adapters to stdin or a prompt file
  where the CLI supports one without a tool.

### R5. Capability and acknowledgement

- The target capability read (the `continuity` block of `GET /providers/config` and
  `GET /providers/:provider/tools`) gains
  `turnContext: { version: 1, maxTurnInputChars: number | null }`.
  - `maxTurnInputChars` counts UTF-16 code units of the composed prompt. It is a
    conservative planning figure for that target's launch path; `null` means no declared
    limit.
  - A send above the figure is still accepted when the actual launch fits (R4).
- A consumer checks this block before sending `turnContext`. An older Runtime has no such
  block and would drop the field silently.
- When a turn's context was delivered, the terminal `result` event and the run inspection
  (`inspection.lastRun`) carry `turnContextChars`. Consumers and tests can assert delivery
  from it.

### R6. Entry points that do not carry it

- **ACP facade.** `session/prompt` does not carry `turnContext`, as it does not carry
  `instructions` today.
- **Peers.** A send that asks for peer routing and carries `turnContext` is refused with a
  400 and `code: "turn_context_unsupported"`. Peers do not advertise features, so Runtime
  cannot know that a peer would deliver it. The context is never dropped silently.

### R7. Diagnostics and privacy

- Logs, metrics and error payloads carry the context's length, never its text.
- Runtime history stores the text (R2). Adapters that put a long prompt in a temp file hold
  it there until the turn ends and must keep removing the file, as they do today.

### R8. Compatibility

- The field, the capability block, `turnContextChars`, the optional history field and the
  four error codes are additive within the current minor line. Existing requests and stored
  records are unchanged.
- R4 turns a spawn failure into a typed refusal for prompts that could not have started. It
  does not refuse anything that works today.
- No version bump or publication is part of this spec.

## Consumers

Not requirements on Runtime; listed so the owners can plan.

- **Bot** uses the field for a live-session core-memory delta, core-side recall results and a
  one-time handoff (SPEC-015 FR-6, FR-8, FR-10).
  - Bot's planned handoff budget of up to 48,000 characters exceeds what argument-passing
    adapters can carry on Windows. Bot must bound it by `maxTurnInputChars`.
- **Platform** could move its continuity transplant and product-knowledge text from turn
  instructions to `turnContext`, which would stop the transplant from lingering as session
  instructions. That is Platform's decision and its own change.

## Acceptance

- **Delivery.** A send with `turnContext` reaches the provider with the parts in order. The
  next send without it carries the original session instructions and no context. Covered per
  transport: persistent stdin (claude), protocol (codex, hosted ACP, muse MSP), per-turn
  argument (grok), API backend, agent ACP adapter.
- **API replay.** On an API backend, a later turn's rebuilt conversation contains each
  earlier turn's context exactly once, in that turn.
- **No session change.** Session reads, inspection, `lastInputPreview`, resume and fork show
  no trace of a delivered context. Runtime history shows it on that turn only.
- **No deduplication.** A context equal to the session instructions is still delivered.
- **Unchanged without the field.** Composed prompts and API requests for existing fixtures
  are identical.
- **Capacity.**
  - An over-limit send on an argument-passing launch path returns `turn_input_too_large`
    and starts no process.
  - `session.instructions` is untouched even when that send carried `instructions`.
  - A send just under the actual limit starts.
- **Capability.** The block is present with the target's figure, and `turnContextChars`
  appears on `result` and `lastRun` only when a context was delivered.
- **Refusals.** A peer-routed send with a context returns `turn_context_unsupported`.
- **Privacy.** No log line or error body contains a canary placed in the context, and no
  temp prompt file outlives its turn.

## Alternatives considered

- **Stop persisting a send's `instructions`.**
  - It makes one field do the job.
  - It breaks the documented contract, and Platform's continuity delivery depends on that
    contract.
  - Standing instructions and one-turn data are also different things to a model.
- **Consumers prepend the context to `message`.** It works today without a Runtime change.
  The downsides:
  - Runtime history, previews and summaries then show the context as the user's words.
  - The label is whatever each consumer invents.
  - The size limit stays invisible.
  - It remains possible as a stopgap for a consumer that accepts those costs.
- **Send full instructions on every turn.** The previous send's instructions are composed in
  as the session layer, so the text doubles whenever it changes.

## Open questions

All were answered on 2026-11-11 with the recommended options:

- [x] Field name: `turnContext`. `context` is already invocation metadata.
- [x] History stores the text, as for `instructions`. History is the audit record and is
      deleted with the session.
- [x] Maximum length: 100,000 code points, well above Bot's 48,000-character handoff
      ceiling.
- [x] Section heading: `Context for this turn:`.
- [x] A target with no declared capacity accepts `turnContext`. Runtime refuses only what is
      known to be undeliverable.

## Dependencies and references

- [SPEC-041](SPEC-041-provider-session-retention-and-continuity.md) R5 (instruction
  envelope), [SPEC-039](SPEC-039-provider-session-capabilities-and-interactions.md)
  (capability reads), [SPEC-035](SPEC-035-session-mcp-servers.md).
- [ADR-012](../decisions/012-separate-evidence-memory-and-retrieval-layers.md) (evidence is
  Runtime's; memory is the product's).
- [Process argument length probe](../research/2026-11-11-process-argument-length-probe.md).
- Bot [ADR-022](https://github.com/cats-inc/cats-bot/blob/main/docs/decisions/022-give-each-bot-layered-memory-it-consolidates-while-asleep.md)
  and its [agent memory architecture survey](https://github.com/cats-inc/cats-bot/blob/main/docs/research/2026-11-11-agent-memory-architecture-survey.md).
- [SPEC-043](SPEC-043-text-only-sessions.md), the second prerequisite from the same plan.
