# ADR-052: Offer Text-Only Sessions Only on Evidence

## Status

Accepted, 2026-11-11. The owner chose the recommended options of
[SPEC-043](../specs/SPEC-043-text-only-sessions.md); the review of the draft refined three of
them without changing their intent. Nothing is implemented. An independent security review
is required before implementation, and no provider is offered until research qualifies it.

Amended later on 2026-11-11 with decision 9, after Bot chose to let a bot name a separate
consolidation target on an API backend.

## Context

Consumers need to run a model over text they do not trust. Bot will consolidate memory from
conversation transcripts, and SPEC-012's status answers have the same need. If such a
session has a tool, text inside a transcript can ask the model to use it.

An audit at Runtime `fb50e59a` found:

- **No CLI adapter can remove all tools.** Tools are refused at approval time, limited to an
  allow list that cannot be empty, or not restricted at all. In probes, denial did not stop
  a tool from running on grok.
- **Session MCP servers are added** to whatever the CLI loads itself, including account
  connectors.
- **Nothing isolates** the CLI's own settings, memory, plugins or hooks.
- **Older Runtimes ignore unknown create fields.** A cwd-less session there is full-auto.
- **Output is streamed as it arrives**, so a late violation cannot take text back.

## Decision

1. Add a `text_only` session profile. In it the model can read its prompt and write text;
   no tool, MCP server or other context source is available.
2. Fail closed. A target that cannot establish the profile refuses the session before any
   content is sent. It is never downgraded to a restricted session with tools.
3. Admit a target only on evidence.
   - For tools and MCP: the provider's own report for the session, checked every session, or
     Runtime sending no tool definitions itself.
   - For what no provider reports, such as hooks: captured launch evidence.
   - Refusal at approval time and launch switches alone do not qualify.
4. Close the surface. Create, sends and routes each have a closed list; everything else is
   refused.
5. Keep no resumable native conversation. A target qualifies only if the provider persists
   none for the session, and Runtime stores no resumable provider session id.
6. Hold output until the turn ends, and release it only without a violation. Detection is
   after the fact; the guarantee rests on admission.
7. Make the consumer check. It reads the capability before creating and the readback before
   sending, because an older Runtime would return an ordinary session.
8. Research each provider before offering it. API backends and claude are the first
   candidates; codex and grok have no known mechanism.
9. Keep API-backend credentials out of CLI processes. Runtime passes its environment to
   every provider CLI it starts, so a conversation's CLI could read a key meant for a
   text-only target in the same Runtime. Runtime removes the variables that API-backend
   instances name from each CLI's environment.

## Consequences

### Positive

- Untrusted text can be processed without giving it a way to act.
- What is guaranteed, how, and what is not, are stated in the readback.
- A violated turn delivers nothing.

### Negative

- Few targets will qualify at first, possibly none of the CLIs most bots use.
- Text-only turns do not stream.
- Launch evidence can go stale when a CLI changes, and re-capturing it is ongoing work.
- Consumers carry part of the safety: the capability and readback checks.

### Neutral

- Ordinary sessions are unchanged.
- Operating-system sandboxing of the CLI process stays possible later, under the same
  contract.

## Alternatives Considered

### Deny or intercept tool calls

- **Pros**: available on more providers.
- **Cons**: denial failed in probes, and some CLIs run read tools without asking. A read is
  enough to move a secret into the output.
- **Why rejected**: it does not hold.

### A read-only sandbox in an empty directory

- **Pros**: exists today for internal jobs.
- **Cons**: tools and account connectors remain, and how far the sandbox reads is
  unverified.
- **Why rejected**: it restricts, it does not remove.

### Keep a native conversation and delete it at the end

- **Pros**: more providers could qualify.
- **Cons**: a crash leaves untrusted text where a later tooled resume, or an older binary,
  could pick it up.
- **Why rejected**: the fence would depend on cleanup that may not run.

### A stateless completion endpoint

- **Pros**: simpler for single calls.
- **Cons**: duplicates cancellation, metering and deletion; consolidation needs several
  turns.
- **Why rejected**: a session profile reuses what exists.

### API backends only

- **Pros**: no tools by construction.
- **Cons**: needs API credentials that subscription-based bots lack.
- **Why rejected**: as the only path. It remains the likely first target.

## References

- [SPEC-043: Text-only sessions](../specs/SPEC-043-text-only-sessions.md)
- [ADR-050](050-separate-provider-session-persistence-from-product-history.md),
  [ADR-048](048-bridge-provider-interactions-and-report-effective-session-capabilities.md),
  [ADR-049](049-use-native-control-protocols-for-hosted-provider-tools.md),
  [ADR-035](035-never-block-provider-execution-on-exact-cli-version.md)
- Bot [SPEC-012](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-012-boss-cat-status-board-and-contact-notes.md)
  FR-13 and [SPEC-015](https://github.com/cats-inc/cats-bot/blob/main/docs/specs/SPEC-015-bot-memory-layers-recall-and-consolidation.md)
  FR-14

---

*Decision made: 2026-11-11*
*Decision makers: owner (chose the recommended options); drafted by Claude*
