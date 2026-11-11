# ADR-051: Carry One-Turn Context in Its Own Send Field

## Status

Accepted, 2026-11-11. The owner chose the recommended options of
[SPEC-042](../specs/SPEC-042-turn-scoped-context.md). Nothing is implemented, and no plan is
authorized yet.

## Context

A send's `instructions` is delivered as the top instruction layer and then stored as the
session's instructions for every later turn. Runtime has no channel for text that belongs to
one turn.

- **Bot** needs one: recall results, a change to core memory during a live session, and a
  handoff that is sent once (Bot ADR-022, SPEC-015).
- **Platform** already sends a continuity transplant through turn instructions. Traced in
  code, it then lingers as the session's instructions.
- **Size is unchecked.** Several per-turn adapters pass the whole composed prompt as a
  process argument. On native Windows an argument past about 32,000 characters fails to
  start ([probe](../research/2026-11-11-process-argument-length-probe.md)).
- **Older Runtimes ignore unknown fields**, so a new field needs a capability flag.

## Decision

1. Add an optional `turnContext` string to a send. It is delivered for the execution that
   send starts and is never session state. `instructions` keeps its meaning.
2. Compose it as its own section between the instructions and the message. It never passes
   through the instruction-layer merge, which drops identical adjacent layers.
3. Record it in Runtime's history on that turn, as evidence of what the provider was sent.
   It is deleted with the session.
4. Check capacity before anything starts.
   - Each adapter measures the launch for its launch path: adapter, runtime mode and
     platform.
   - A send that cannot be delivered is refused with a typed error and leaves the session
     unchanged.
   - A send that starts today is never refused.
5. Advertise the field and a conservative size figure in the target capability read, and
   acknowledge delivery on the turn's result.
6. Do not carry it through the ACP facade. Refuse it on peer-routed sends until peers
   advertise features.

## Consequences

### Positive

- A consumer can give one turn its own context without replacing the persona.
- A handoff can be sent once and then live in the provider's native history.
- A prompt that is too large fails with its limit instead of a spawn error.

### Negative

- There are now two text fields on a send, and consumers must choose correctly.
- Every adapter needs a measuring function, and limits must be measured per launch path.
- The context is one more thing stored in history.

### Neutral

- Session instructions are still re-sent with every turn. Moving them out of the per-turn
  prompt is separate work.
- Platform is unchanged until it chooses to move its transplant.

## Alternatives Considered

### Stop persisting a send's `instructions`

- **Pros**: one field.
- **Cons**: it breaks the documented contract that Platform's continuity delivery uses, and
  it merges standing instructions with one-turn data.
- **Why rejected**: a breaking change for a semantic that deserves its own field.

### Let consumers prepend context to the message

- **Pros**: no Runtime change.
- **Cons**: history, previews and summaries show the context as the user's words; labels
  differ per consumer; the size limit stays invisible.
- **Why rejected**: it hides the problem in every consumer. It remains possible as a
  stopgap.

### Send full instructions on every turn

- **Pros**: no new field.
- **Cons**: the previous send's instructions are composed in as the session layer, so the
  text doubles whenever it changes.
- **Why rejected**: cost and confusion.

## References

- [SPEC-042: Turn-scoped context](../specs/SPEC-042-turn-scoped-context.md)
- [SPEC-041](../specs/SPEC-041-provider-session-retention-and-continuity.md) R5,
  [ADR-012](012-separate-evidence-memory-and-retrieval-layers.md)
- [Process argument length probe](../research/2026-11-11-process-argument-length-probe.md)
- Bot [ADR-022](https://github.com/cats-inc/cats-bot/blob/main/docs/decisions/022-give-each-bot-layered-memory-it-consolidates-while-asleep.md)

---

*Decision made: 2026-11-11*
*Decision makers: owner (chose the recommended options); drafted by Claude*
