# SPEC-042: Turn-Scoped Context

## Metadata

| Field | Value |
| --- | --- |
| Status | Draft, 2026-11-11. Not approved; not implemented |
| Owner | Runtime execution, with Bot and Platform consumer owners |
| Reviewer | Owner; independent review before implementation |
| Date | 2026-11-11 |
| Baseline | Runtime fb50e59ab2244bd2c45ae93fa11345cb7507011c |
| Decision | To be recorded as an ADR at approval |
| Delivery | A plan follows approval |
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
- **Every turn re-sends the instruction layers.** Each adapter composes skills, session
  instructions and turn instructions into the turn's prompt (`compileRuntimeTurnPrompt` in
  `backends/cli/providers/prompt.ts`; inline envelopes in `codex.ts` and `pi.ts`; the API
  and agent backend managers; `core/peers/PeerExecutionClient.ts`).
- **An identical adjacent layer is dropped** (`mergeRuntimeInstructionLayers` in
  `core/skills/catalog.ts`). A turn-only text that happens to equal the session instructions
  would vanish if it went through that merge.
- **Runtime's own history records the layers.** Each user turn stores `sessionInstructions`
  and `instructions` beside the message (`appendUserTurnHistory`).
- **Unknown body fields are ignored silently.** A consumer that sends a new field to an older
  Runtime gets no error.
- **`context` is taken.** The existing `context` field is invocation metadata
  (`SessionInvocationContext`), not text for the provider.
- **No size check exists.**
  - The grok, antigravity and cursor adapters pass the whole composed prompt as a process
    argument.
  - Measured on Windows with Node 26: a 32,000-character argument starts, and a
    33,000-character one fails with `ENAMETOOLONG`.
  - The copilot adapter writes prompts over 2,000 characters to a temp file and tells the
    model to read it, which needs a read tool.
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
- Removing the argument-length limit of every adapter. R4 makes the limit visible; lifting
  it is per-adapter follow-up work.

## Requirements

### R1. The field

- `turnContext` is an optional string on every entry point that starts a turn with consumer
  text: `POST /sessions/:id/messages` in both stream forms, the MCP `send_message` tool, and
  peer-routed execution (R6). Wakeups send no consumer text and are unchanged.
- It is trimmed; empty means absent. A non-string value is a 400 with
  `code: "turn_context_invalid"`.
- It may hold at most 100,000 Unicode code points. A longer value is a 400 with
  `code: "turn_context_too_large"` and the limit.
- It applies to the execution that the send starts, including that execution's spawn
  retries, and to nothing else.

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

The composed prompt gains one section between the instructions and the message:

```text
Instructions:
<skills, session instructions, turn instructions>

Context for this turn:
<turnContext>

User message:
<message>
```

- The instructions section is omitted when there are no instruction layers, as today.
- Without `turnContext` the composed prompt is byte-for-byte what it is today.
- `turnContext` does not pass through `mergeRuntimeInstructionLayers`; it is never
  deduplicated against an instruction layer.
- One shared composer produces the envelope. The inline copies in `codex.ts` and `pi.ts` use
  it, and the API and agent backends deliver the same three parts in the same order within
  that turn's user content.
- Runtime does not fence or escape the text. A consumer that sends untrusted material fences
  it itself.

### R4. Capacity

- Before a turn starts, Runtime measures the composed prompt against the limit the target's
  adapter declares for its transport. Over the limit, the send is a 400 with
  `code: "turn_input_too_large"`, the measured size and the limit.
- The check runs before any session metadata is changed and before any process starts. A
  refused send leaves the session exactly as it was.
- The limit covers the whole composed prompt, because instructions, context and message
  share one transport.
- An adapter that passes the prompt as a process argument declares a limit per platform.
  - On Windows it must leave headroom under the measured 32,000 characters for the other
    arguments.
  - Limits for macOS and Linux are measured in the plan, not assumed.
- An adapter whose transport has no practical limit (stdin or a protocol frame) declares
  none.
- The copilot adapter's temp-file path stays as it is and declares no limit. It depends on a
  read tool, so it cannot serve a session without tools (SPEC-043).
- Follow-up, outside this spec: move argument-passing adapters to stdin or a prompt file
  where the CLI supports one without a tool.

### R5. Capability and acknowledgement

- The target capability read (the `continuity` block of `GET /providers/config` and
  `GET /providers/:provider/tools`) gains
  `turnContext: { version: 1, maxTurnInputChars: number | null }`. `null` means the adapter
  declares no limit.
- A consumer checks this before sending `turnContext`. An older Runtime has no such block
  and would drop the field silently.
- When a turn's context was delivered, the terminal `result` event and the run inspection
  (`inspection.lastRun`) carry `turnContextChars`. Consumers and tests can assert delivery
  from it.

### R6. Peers

- A peer-routed turn forwards `turnContext` with the turn.
- A peer that does not advertise the capability cannot receive it. The send fails with the
  existing typed peer-routing error; the context is never dropped silently.

### R7. Diagnostics and privacy

- Logs, metrics and error payloads carry the context's length, never its text.
- Runtime history is the only Runtime-owned place that stores the text (R2).

### R8. Compatibility

- The field, the capability block, `turnContextChars` and the three error codes are additive
  within the current minor line. Existing requests and stored records are unchanged.
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

- **Delivery.** A send with `turnContext` reaches the provider with the three sections in
  order. The next send without it carries the original session instructions and no context.
  Covered per transport: persistent stdin (claude), protocol (codex, hosted ACP, muse MSP),
  per-turn argument (grok), API backend.
- **No session change.** Session reads, inspection, `lastInputPreview`, resume and fork show
  no trace of a delivered context. Runtime history shows it on that turn only.
- **No deduplication.** A context equal to the session instructions is still delivered.
- **Unchanged without the field.** Composed prompts for existing fixtures are byte-identical.
- **Capacity.** An over-limit send on an argument-passing adapter returns
  `turn_input_too_large`, starts no process, and leaves `session.instructions` untouched even
  when the send also carried `instructions`.
- **Capability.** The block is present with the adapter's limit, and `turnContextChars`
  appears on `result` and `lastRun` only when a context was delivered.
- **Peers.** A capable peer receives it; an incapable peer makes the send fail with a typed
  error.
- **Privacy.** No log line or error body contains a canary placed in the context.

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

Each has a recommended default.

- [ ] Field name. Recommended: `turnContext`. `context` is already invocation metadata.
- [ ] Whether history stores the text or only its length and a digest. Recommended: the
      text, as for `instructions`, since history is the audit record and is deleted with the
      session.
- [ ] Maximum length. Recommended: 100,000 code points, well above Bot's 48,000-character
      handoff ceiling.
- [ ] Section heading. Recommended: `Context for this turn:`.
- [ ] Whether to refuse `turnContext` on a target with no declared capacity instead of
      trusting it. Recommended: no; refuse only what is known to be undeliverable.

## Dependencies and references

- [SPEC-041](SPEC-041-provider-session-retention-and-continuity.md) R5 (instruction
  envelope), [SPEC-039](SPEC-039-provider-session-capabilities-and-interactions.md)
  (capability reads), [SPEC-035](SPEC-035-session-mcp-servers.md).
- [ADR-012](../decisions/012-separate-evidence-memory-and-retrieval-layers.md) (evidence is
  Runtime's; memory is the product's).
- Bot [ADR-022](https://github.com/cats-inc/cats-bot/blob/main/docs/decisions/022-give-each-bot-layered-memory-it-consolidates-while-asleep.md)
  and its [agent memory architecture survey](https://github.com/cats-inc/cats-bot/blob/main/docs/research/2026-11-11-agent-memory-architecture-survey.md).
- [SPEC-043](SPEC-043-text-only-sessions.md), the second prerequisite from the same plan.
