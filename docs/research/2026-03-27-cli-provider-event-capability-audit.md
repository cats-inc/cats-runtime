# Research Log: CLI Provider Event Capability Audit

Date: 2026-03-27
Topic: What each CLI-backed provider can already emit vs what cats-runtime still leaves unused
Last updated: 2026-03-27

## Sources

- Internal adapter audit:
  - `cats-runtime/src/backends/cli/providers/claude.ts`
  - `cats-runtime/src/backends/cli/providers/codex.ts`
  - `cats-runtime/src/backends/cli/providers/copilot.ts`
  - `cats-runtime/src/backends/cli/providers/cursor.ts`
  - `cats-runtime/src/backends/cli/providers/gemini.ts`
  - `cats-runtime/src/backends/cli/providers/goose.ts`
  - `cats-runtime/src/backends/cli/providers/junie.ts`
  - `cats-runtime/src/backends/cli/providers/kiro.ts`
  - `cats-runtime/src/backends/cli/providers/opencode.ts`
  - `cats-runtime/src/backends/cli/providers/pi.ts`
  - `cats-runtime/src/backends/cli/providers/auggie.ts`
- Provider-specific parsers:
  - `cats-runtime/src/backends/cli/goose/parser.ts`
  - `cats-runtime/src/backends/cli/junie/parser.ts`
  - `cats-runtime/src/backends/cli/pi/parser.ts`
- Existing runtime contract:
  - `cats-runtime/src/core/types.ts`
  - `cats-runtime/src/http/routes/messages.ts`
  - `cats-runtime/src/http/routes/observe.ts`
- Existing roadmap / progress framing:
  - `cats-runtime/ROADMAP.md`
  - `cats-runtime/PROGRESS.md`

## Summary

`cats-runtime` already normalizes CLI output into a shared event envelope:

- `init`
- `text`
- `tool_use`
- `tool_result`
- `progress`
- `result`
- `error`
- `raw`

The gap is not that all providers are equally poor. The gap is that provider
capability is highly uneven, and `cats-runtime` still leaves useful mid-turn
signals on the floor for several major providers.

The most important findings are:

1. `Pi` and `Goose` are already rich enough for a good live progress UX.
2. `Copilot` and `Junie` already expose meaningful progress, but hosts are not
   taking advantage of it yet.
3. `Codex` is the biggest missed opportunity: the upstream CLI clearly emits
   more mid-turn structure than `cats-runtime` currently preserves.
4. `Claude`, `Gemini`, and `Cursor` do stream text progressively, but their
   non-text middle layers are still thin or under-normalized in the current
   adapter.
5. `Auggie`, `Kiro`, and `OpenCode` remain relatively shallow for live
   step-by-step UX, though each has a different reason.

## Scope and Confidence

This note audits the code that exists in this repo today. It is **not** a
vendor-claims document.

That means:

- "Available" means `cats-runtime` currently emits it, or the adapter
  definitely sees it.
- "Unused" means either:
  - the adapter currently drops the signal, or
  - the runtime normalizes it, but upper layers still do not consume it.
- When a capability is only inferred from raw passthrough or comments, it is
  called out explicitly as lower-confidence.

## Shared Event Contract vs Product UX

There are two different questions:

1. What raw or structured events the CLI/provider emits.
2. What product-layer experience upper apps can build from those events.

This note is about question 1, with special attention to where question 2 is
still leaving value unused.

## Audit Matrix

### Current Adapter Output

| Provider | Stepwise text today | `tool_use` today | `tool_result` today | `progress` today | `result` today | Notes |
|----------|---------------------|------------------|---------------------|------------------|----------------|-------|
| Claude | Yes | No | No | No | Yes | Text chunks are preserved via `content_block_delta`; non-text events are only passed through as `raw` |
| Codex | Yes | Yes | No | No | Yes | Mid-turn text is preserved, but many rich notifications are explicitly ignored |
| Copilot | Yes | Yes | No | Yes | Yes | Already one of the more useful adapters for progress UX |
| Cursor | Yes | No | No | No | Yes | Timestamp-based partial assistant chunks are preserved |
| Gemini | Partially | Yes | No | No | Yes | Assistant message text is preserved, but message parts are flattened |
| Goose | Yes | Yes | Yes | Yes | Yes | Already rich and close to a CLI event tape |
| Junie | Final result text + polled progress | No | No | Yes | Yes | Progress comes from session event polling, not tool-level stream events |
| Kiro | Yes (line-based) | No | No | No | Yes | Very shallow live semantics today |
| OpenCode | Post-call text only | Yes | No | No | Yes | Uses a native service path, not `parseStreamLine` JSONL |
| Pi | Yes | Yes | Yes | Yes | Yes | Richest adapter in the current CLI family |
| Auggie | No live text; only final text/result | No | No | No | Yes | Print mode is effectively "wait, then emit one structured result" |

### Unused or Underused Capability

| Provider | What exists but is not being fully used | Confidence | Why it matters |
|----------|------------------------------------------|------------|----------------|
| Claude | The adapter runs in `stream-json` mode with `--verbose` and `--include-partial-messages`, but only text and final result are normalized; non-text events are left as `raw` | Medium | Best path to block-level output and possibly richer visible middle steps without redesigning the protocol |
| Codex | The adapter explicitly ignores `item/completed`, `item/commandExecution/outputDelta`, `item/plan/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`, `turn/diff/updated`, `turn/plan/updated`, `thread/status/changed`, `model/rerouted`, and more | High | This is the highest-value provider to mine further if the goal is "feel like the official CLI" |
| Copilot | Reasoning and tool-start progress are already normalized, but there is no matching tool-result surface and no higher-level transcript/operator UX consuming the current `progress` events | High | A product-level win is available without a large runtime refactor |
| Cursor | Partial assistant chunks are already preserved, but `thinking` is dropped and no middle-layer structure is normalized | Medium | Cursor can at least support smoother block/text streaming even if tool-level traces stay absent |
| Gemini | The adapter keeps `tool_use` but intentionally drops `tool_result`; assistant content arrays are flattened into plain text | High | The provider can at least support a better block model than today's plain text flattening |
| Goose | `tool_use`, `tool_result`, and synthetic progress are already normalized, but upper layers do not yet expose them as a visible event tape | High | Low-risk win for products that want to show "someone is doing work" |
| Junie | Multiple progress kinds are already mapped (`status`, `terminal`, `file_changes`, `view_files`, `tool`, `plan`, `thought`), but they remain mostly operator-only / unused by hosts | High | Junie already has the bones for a high-signal progress pane |
| Kiro | The runtime currently treats Kiro as plain line output plus post-turn result; richer mid-turn structure is not modeled at all | Medium | Kiro likely needs a different strategy than other CLIs, but the current path is especially thin |
| OpenCode | Pending permission/question handling exists, but is only auto-handled internally; there is no live surface for those pending states or any incremental part stream | Medium | OpenCode could still feel alive even before true token/block streaming exists |
| Pi | `thinking`, `tool_use`, `tool_result`, and result metadata are already normalized, but upper layers still collapse most sessions to final-message UX | High | Fastest path to better product UX because the runtime part is already good |
| Auggie | The adapter can resolve session updates and usage after the turn, but there is no live mid-turn path; the runtime only sees the final print-mode JSON | High | Best treated as a post-hoc inspection provider unless Auggie itself exposes a richer stream later |

## Provider-by-Provider Notes

### Claude

What is already true today:

- Progressive text is preserved from `content_block_delta`
- Full assistant text blocks are preserved
- Final result and usage are preserved
- Unknown events are passed through as `raw`

What is still unused:

- The current adapter does not normalize any non-text structure beyond the
  final result.
- If Claude CLI emits richer stream-json events in practice, they currently
  stay trapped in `raw`.

Implication:

- Claude is already good enough for text streaming UX.
- Claude is not yet good enough for a convincing "tool trace" UX.

### Codex

What is already true today:

- Progressive text is preserved
- Tool start (`tool_use`) is preserved
- Final result and errors are preserved

What is still unused:

- The adapter explicitly silences many interesting notifications:
  - command output deltas
  - plan deltas
  - reasoning deltas
  - diff updates
  - thread status changes
  - model reroute notices

Implication:

- Codex is the single biggest "we already have more upstream than we surface"
  provider.
- If the goal is to narrow the gap with official CLI feel, this is the best
  first adapter to deepen.

### Copilot

What is already true today:

- Progressive text is preserved
- Tool start is preserved
- Reasoning/progress is preserved via normalized `progress` events
- Final result is preserved

What is still unused:

- There is no `tool_result` mapping
- Upper layers still do not meaningfully surface the existing progress feed

Implication:

- Copilot already supports a better UX than products currently expose.

### Cursor

What is already true today:

- Partial assistant chunks are preserved
- Final result is preserved

What is still unused:

- `thinking` is dropped
- No structured middle-layer events are normalized

Implication:

- Cursor can support better streaming text UX now
- It remains weak for tool/progress UX

### Gemini

What is already true today:

- Assistant message text is preserved
- `tool_use` is preserved
- Final result and errors are preserved

What is still unused:

- `tool_result` is intentionally dropped
- Multi-part message content is flattened into plain text

Implication:

- Gemini should be treated as a block-capable provider, not just a final-text
  provider, even if it is not as rich as Pi/Goose

### Goose

What is already true today:

- Assistant text is preserved
- `tool_use` and `tool_result` are preserved
- Synthetic provider-agnostic `progress` is already generated
- Final result is preserved

What is still unused:

- The runtime side is mostly fine; the missing layer is host/product
  consumption

Implication:

- Goose is already a strong candidate for a CLI-style live event tape

### Junie

What is already true today:

- Final result text is preserved
- Rich progress is reconstructed from session file polling
- Progress kinds already include:
  - status
  - terminal activity
  - file changes
  - file review
  - tool status text
  - plan updates
  - thought updates

What is still unused:

- The host layer still does not benefit much from these progress events
- There is no tool-granular `tool_use` / `tool_result` contract today

Implication:

- Junie is not rich in the same way as Pi/Goose, but it already has useful
  work-progress semantics

### Kiro

What is already true today:

- Text arrives line-by-line
- Final result is reconstructed after the turn

What is still unused:

- No structured tool or progress model exists in the current adapter

Implication:

- Kiro currently behaves more like "plain live stdout plus a final checkpoint"
  than a modern structured event source

### OpenCode

What is already true today:

- Tool uses are preserved
- Final text and result are preserved
- Runtime auto-handles pending permissions/questions behind the scenes

What is still unused:

- No incremental text or event stream is surfaced
- Permission/question pending states are not surfaced as progress

Implication:

- OpenCode has enough structure for a better status UX, but not yet enough for
  a rich live trace in the current runtime path

### Pi

What is already true today:

- Progressive text is preserved
- Thinking is normalized into `progress`
- `tool_use` and `tool_result` are preserved
- Final usage/result metadata is preserved

What is still unused:

- Very little is missing in the runtime adapter itself
- Most remaining value is blocked by host/product UX not consuming what the
  runtime already emits

Implication:

- Pi is the easiest path to a high-signal live progress experience

### Auggie

What is already true today:

- Final structured result is preserved
- Post-turn session updates and usage can be resolved

What is still unused:

- There is no meaningful live mid-turn signal in the current adapter path

Implication:

- Auggie should be treated as a post-turn inspection provider until it offers
  a richer live stream

## What Upper Layers Are Currently Leaving on the Table

Even when the runtime already normalizes useful mid-turn events, upper layers
still tend to collapse them into a final-message UX.

The clearest examples are:

- `Pi`
- `Goose`
- `Copilot`
- `Junie`

That means there are two separate follow-up slices:

1. **Runtime mining**
   - promote more upstream signals into normalized events
   - especially for `Codex`, `Claude`, and `Gemini`
2. **Host consumption**
   - expose the normalized events already present today
   - especially for `Pi`, `Goose`, `Copilot`, and `Junie`

## Best Next Slices

### Slice 1: Codex Event Mining

Highest return on effort.

- Normalize some currently-dropped Codex notifications into:
  - `progress`
  - `tool_result`
  - maybe a bounded `content_block` or `activity` model later

This is the best path to reducing the "official CLI feels much more alive"
gap.

### Slice 2: Host-Facing Event Tape for Existing Rich Providers

No deep provider refactor required.

Use already-normalized events from:

- `Pi`
- `Goose`
- `Copilot`
- `Junie`

This closes a large product feel gap quickly.

### Slice 3: Gemini and Claude Block/Tool Enrichment

Medium difficulty.

- Preserve more structure than plain text flattening
- Stop treating all non-text middle layers as `raw` or ignorable

### Slice 4: Capability Truth Surface

Add provider-target capability truth for:

- stepwise text
- tool use
- tool result
- progress
- block-level structure confidence

This would help products adapt per provider instead of pretending every target
is equally rich.

## Relationship to Roadmap and Gap Closure

This audit sharpens the remaining gap behind `OPT-2: Provider-Agnostic Progress
Events`.

That roadmap item is correctly marked as delivered at the event-contract level,
but not at the provider-depth level.

What remains is:

- deeper mining for high-value providers (`Codex`, `Claude`, `Gemini`)
- product/host consumption of already-normalized rich providers
- capability truth so products can make honest UX decisions per provider

That work is directly relevant to narrowing the "official CLI feels alive,
while cats products mostly wait for a big final reply" gap seen against
Paperclip/OpenClaw/OpenManus-style expectations.

## Suggested Follow-Up Questions

1. Which providers should `cats` treat as rich enough for a live event tape
   today?
2. Which providers should stay on final-message UX for now?
3. Should `cats-runtime` add explicit provider capability metadata so upper
   layers stop guessing?

---

*Research completed: 2026-03-27*
*Author: Codex*
