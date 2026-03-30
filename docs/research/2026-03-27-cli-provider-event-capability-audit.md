# Research Log: CLI Provider Event Capability Audit

Date: 2026-03-27
Topic: Current-truth audit of what each CLI-backed provider now emits into `cats-runtime`, and what `cats` currently consumes
Last updated: 2026-03-29

## Sources

- Provider registration and shared contract:
  - `cats-runtime/src/backends/cli/providers/types.ts`
  - `cats-runtime/src/backends/cli/pool/WorkerPool.ts`
  - `cats-runtime/src/core/types.ts`
- CLI provider adapters and parser layers:
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
  - `cats-runtime/src/backends/cli/goose/parser.ts`
  - `cats-runtime/src/backends/cli/junie/parser.ts`
  - `cats-runtime/src/backends/cli/pi/parser.ts`
- Adapter tests and instrumentation:
  - `cats-runtime/src/backends/cli/providers/claude.test.ts`
  - `cats-runtime/src/backends/cli/providers/codex.test.ts`
  - `cats-runtime/src/backends/cli/providers/copilot.test.ts`
  - `cats-runtime/src/backends/cli/providers/cursor.test.ts`
  - `cats-runtime/src/backends/cli/providers/gemini.test.ts`
  - `cats-runtime/src/backends/cli/providers/goose.test.ts`
  - `cats-runtime/src/backends/cli/providers/junie.test.ts`
  - `cats-runtime/src/backends/cli/providers/kiro.test.ts`
  - `cats-runtime/src/backends/cli/providers/opencode.test.ts`
  - `cats-runtime/src/backends/cli/providers/pi.test.ts`
  - `cats-runtime/src/backends/cli/providers/auggie.test.ts`
  - `cats-runtime/src/backends/cli/providers/providerEvolutionInstrumentation.test.ts`
- Runtime streaming surface:
  - `cats-runtime/src/http/routes/messages.ts`
  - `cats-runtime/src/http/routes/observe.ts`
  - `cats-runtime/src/http/streaming.ts`
- `cats` host consumption:
  - `cats-platform/src/products/chat/api/resources/channelRoutes.ts`
  - `cats-platform/src/products/chat/renderer/hooks/useLiveIndicator.ts`
  - `cats-platform/src/products/chat/renderer/components/ChatView.tsx`
  - `cats-platform/src/runtime/client.ts`

## Verification

The current provider-suite verification run used:

```bash
npm test -- src/backends/cli/providers
```

Result on 2026-03-29:

- 13 test files passed
- 200 tests passed

## Summary

The March 27 exploration is now partially stale.

The current truth is:

1. All 11 CLI providers are wired into `cats-runtime`.
2. The shared runtime event contract already supports:
   - `init`
   - `text`
   - `tool_use`
   - `tool_result`
   - `progress`
   - `result`
   - `error`
   - `raw`
3. `Claude`, `Cursor`, and `Gemini` are now materially richer than the earlier audit claimed.
4. `Codex` still has the highest-value "official CLI feel" upside, but it is no longer just text plus tool-start. It already mines plan, reasoning, command, diff, thread-status, and model-reroute progress.
5. `Goose`, `Pi`, `Copilot`, and `Junie` already provide enough normalized signal for a good live operator UX.
6. `Kiro`, `OpenCode`, and `Auggie` remain the shallow providers for different reasons.
7. The main remaining gap is now higher-layer consumption, not basic adapter wiring.

## Scope and Definitions

This note is a code-truth audit, not a vendor-marketing summary.

Definitions used in the matrix:

- "Stepwise text" means `cats-runtime` can emit one or more non-terminal `text` events before the turn ends.
- "`tool_use`" means the runtime emits a normalized `tool_use` event.
- "`tool_result`" means the runtime emits a normalized `tool_result` event.
- "`progress`" means the runtime emits a normalized `progress` event with provider metadata.
- "Current host surface" means what `cats` actually uses today, not what the runtime could theoretically expose.

## Shared Contract vs Product Reality

There are three separate layers:

1. Provider-native output shape
2. `cats-runtime` normalized `StreamEvent` surface
3. `cats` product/UI consumption

Layer 2 is now in better shape than the earlier exploration suggested.

Layer 3 is still intentionally thin:

- `cats-runtime` already streams via SSE and NDJSON.
- `cats` chat currently listens to `progress`, `text`, `tool_use`, `tool_result`, `result`, `error`, and `session_closed`.
- The UI still collapses that into a typing indicator with:
  - one progress line
  - a few outstanding tool chips
- `cats` does not yet render a first-class content-block transcript or rich live event tape.

So "can the provider emit it?" and "does the current UI show it richly?" are different questions.

## Updated Matrix

### Current Runtime Truth

| Provider | Runtime wiring | Stepwise text in runtime today | `tool_use` | `tool_result` | `progress` | `result` | Current truth |
|----------|----------------|--------------------------------|------------|---------------|------------|----------|---------------|
| Claude | Yes | Yes, via `assistant` blocks and `content_block_delta` | Yes | Yes | Yes | Yes | Much richer than the earlier audit; still no first-class content-block model |
| Codex | Yes | Yes, via `item/agentMessage/delta` | Yes | No | Yes | Yes | Major progress mining now exists; normalized `tool_result` is still missing |
| Copilot | Yes | Yes, via `assistant.message_delta` or final-message fallback | Yes | Yes | Yes | Yes | Strong runtime signal set already exists |
| Cursor | Yes | Yes, via timestamped partial assistant chunks | Yes | Yes | Yes | Yes | No longer just text-only; assistant-content tool/reasoning normalization now exists |
| Gemini | Yes | Partial, not token delta but assistant/message text is stepwise enough for the shared contract | Yes | Yes | Yes | Yes | Multipart tool blocks are normalized, but block structure is flattened into shared events |
| Goose | Yes | Yes, message-by-message | Yes | Yes | Yes | Yes | Already a good event-tape candidate |
| Junie | Yes | Final stdout text plus polled session-driven progress | Yes | Yes | Yes | Yes | Tool lifecycle and progress are reconstructed from session-event polling |
| Kiro | Yes | Yes, line-based stdout | No | No | No | Yes | Still shallow and mostly plain-text |
| OpenCode | Yes | No incremental text; post-call text only | Yes | No | No | Yes | Native service path works, but live event richness is still low |
| Pi | Yes | Yes, via RPC updates and message updates | Yes | Yes | Yes | Yes | Still the richest overall adapter family |
| Auggie | Yes | No live text; only final structured text/result | No | No | No | Yes | Still effectively post-turn only |

### Current `cats` Host Surface

| Provider bucket | What `cats` can currently show | What it still does not show |
|-----------------|--------------------------------|-----------------------------|
| Rich providers (`Pi`, `Goose`, `Copilot`, `Junie`, `Claude`, `Cursor`, `Gemini`, `Codex`) | Progress text, a limited live indicator, and outstanding tool chips | A first-class event tape, persistent tool transcript, block-level rendering, or full streaming content blocks |
| Shallow providers (`Kiro`, `OpenCode`, `Auggie`) | Basic waiting/finalizing behavior and whatever final text/result reaches the shared stream | A convincing live trace because the runtime itself still has limited signal to work with |

## Corrections vs the Earlier Exploration

The most important corrections are:

- `Claude` should no longer be classified as "text only, non-text left as raw".
  - It now normalizes `tool_use`, `tool_result`, and reasoning/progress from assistant blocks, content-block start frames, and thinking deltas.
- `Cursor` should no longer be classified as "timestamp text only".
  - It now normalizes `thinking`, assistant-content `tool_use`, and assistant-content `tool_result`.
- `Gemini` should no longer be classified as "full message only, no tool-result surface".
  - It now normalizes multipart assistant tool calls, multipart function responses, top-level `tool_result`, and provider progress.
- `Goose` should no longer be treated as a final-message-only provider.
  - The parser already exposes `text`, `tool_use`, `tool_result`, `progress`, and `result`.
- `Junie` should no longer be described as "progress only, no tool events".
  - The polling parser reconstructs `tool_use` and `tool_result` from session events.
- `Codex` should no longer be described as "mid-turn text preserved, rich notifications explicitly ignored".
  - Many of the previously ignored notifications are now normalized into `progress`.

## Provider-by-Provider Notes

### Claude

What is true today:

- Progressive text is preserved from assistant blocks and `content_block_delta`
- Tool-start is normalized into `progress` plus `tool_use`
- Tool-completion is normalized into `progress` plus `tool_result`
- Thinking/reasoning is normalized into `progress`
- Final result and usage are preserved

What is still missing:

- The runtime does not preserve a first-class Claude-specific content-block tree
- Upper layers only see the shared event projection

Implication:

- Claude is now good enough for a meaningful live operator UX
- Claude is not yet modeled as a true block-native provider in the shared contract

### Codex

What is true today:

- Progressive text is preserved
- Tool-start is preserved
- Progress now includes:
  - command output deltas
  - plan deltas
  - reasoning deltas
  - item completion
  - diff updates
  - plan updates
  - thread status changes
  - model reroute notices
- Final result and errors are preserved

What is still missing:

- There is still no normalized `tool_result`
- The shared contract still collapses Codex richness into generic `progress`

Implication:

- Codex remains the best place to invest if the goal is "feel like the official CLI"
- The gap is now narrower than the earlier audit claimed

### Copilot

What is true today:

- Stepwise text is preserved
- Tool requests become `progress` plus `tool_use`
- Tool results become `progress` plus `tool_result`
- Reasoning and model-change events become `progress`
- Final result is preserved

What is still missing:

- Host layers still do not present Copilot as a rich event tape

Implication:

- Runtime-side work is already good
- Product-side consumption is the main remaining gap

### Cursor

What is true today:

- Partial assistant chunks are preserved
- Top-level `thinking` becomes reasoning progress
- Assistant reasoning blocks become reasoning progress
- Assistant content tool blocks become `tool_use` / `tool_result`
- Final result is preserved

What is still missing:

- No first-class block model
- No separate top-level Cursor `tool_result` channel outside assistant-content blocks
- Runtime output is still a shared event projection, not a provider-native transcript

Implication:

- Cursor is now a viable live-progress provider, not merely a smoother text-stream provider

### Gemini

What is true today:

- Assistant message text is preserved
- Assistant multipart `functionCall` blocks become `progress` plus `tool_use`
- Assistant multipart `functionResponse` blocks become `progress` plus `tool_result`
- Top-level `tool_result` is normalized
- Final result and errors are preserved

What is still missing:

- The runtime flattens multipart content into shared events instead of preserving Gemini-specific block structure
- It still does not offer token-by-token text delta semantics

Implication:

- Gemini is now block-capable enough for a reasonable operator UX
- It is still not a first-class block-transcript provider inside the shared contract

### Goose

What is true today:

- Assistant text is preserved
- Tool requests become `progress` plus `tool_use`
- Tool responses become `progress` plus `tool_result`
- Final result is preserved

What is still missing:

- The main missing layer is host presentation, not adapter depth

Implication:

- Goose is already one of the easiest providers to surface as a rich live event tape

### Junie

What is true today:

- The CLI stdout result is still final-blob oriented
- Session polling reconstructs:
  - status updates
  - terminal activity
  - file-change activity
  - file-review activity
  - plan updates
  - thought updates
  - tool lifecycle
- Tool lifecycle can emit `tool_use` and `tool_result`
- Final result and aggregated usage are preserved

What is still missing:

- This is reconstructed progress, not native token streaming
- Host layers still mostly use it as a thin live indicator

Implication:

- Junie is richer than it first appears
- It is a good operator-progress provider even without native token streaming

### Kiro

What is true today:

- Text arrives line-by-line
- Final result is reconstructed after the turn

What is still missing:

- No normalized `tool_use`
- No normalized `tool_result`
- No normalized `progress`

Implication:

- Kiro remains a plain live-stdout provider with a final checkpoint

### OpenCode

What is true today:

- The runtime integrates it through a native service path rather than JSONL parsing
- Tool uses are preserved
- Final text and result are preserved
- Pending permissions/questions are auto-handled internally

What is still missing:

- No incremental text stream
- No normalized `tool_result`
- No normalized live progress for pending states

Implication:

- OpenCode is integrated, but still not a rich live-trace provider

### Pi

What is true today:

- Progressive text is preserved
- Thinking is normalized into reasoning progress
- Tool execution start becomes `progress` plus `tool_use`
- Tool execution end becomes `tool_result`
- Final usage/result metadata is preserved

What is still missing:

- Very little in the adapter itself
- The main gap is still host/UI presentation

Implication:

- Pi remains the strongest baseline for a high-signal live progress experience

### Auggie

What is true today:

- Final structured result is preserved
- Final text is preserved if the print-mode JSON includes it
- Post-turn session updates and usage can be resolved

What is still missing:

- No meaningful live mid-turn signal
- No normalized tool/progress lifecycle

Implication:

- Auggie should still be treated as a post-turn inspection provider

## What `cats` Is Still Leaving on the Table

Even after the adapter improvements, `cats` still uses the stream conservatively.

Current `cats` behavior:

- The chat channel proxy streams runtime SSE through `/api/channels/:id/stream`
- The renderer listens to:
  - `progress`
  - `text`
  - `tool_use`
  - `tool_result`
  - `result`
  - `error`
  - `session_closed`
- The visible UI currently renders:
  - one progress line
  - a set of unfinished tool chips

Important limitation:

- `text` updates only advance the indicator while it is still in the "waiting" phase
- Once the indicator is already in streaming mode, the UI does not become a full live transcript

So the runtime is already ahead of the current product presentation.

## Recommended Follow-Up Slices

### Slice 1: Host-Level Event Tape

Highest immediate product value.

Use already-normalized events from:

- `Pi`
- `Goose`
- `Copilot`
- `Junie`
- `Claude`
- `Cursor`
- `Gemini`
- `Codex`

Build:

- a persistent live event list
- tool lifecycle rows
- progress history rather than one mutable line

### Slice 2: Capability Truth Surface

Add explicit provider capability truth for upper layers, for example:

- stepwise text
- tool use
- tool result
- progress
- block-model confidence
- native-vs-derived progress confidence

This lets products adapt honestly per provider instead of pretending all providers are equally rich.

### Slice 3: Codex-Specific Deepening

Still the highest-value adapter refinement area.

Most likely next improvements:

- normalized `tool_result`
- better grouping of command / plan / reasoning progress
- possibly a higher-level activity model on top of raw `progress`

### Slice 4: Block-Oriented Contract Work

Only do this after the event-tape UI proves insufficient.

Today the shared contract is event-first, not content-block-first.

That is good enough for:

- progress indicators
- tool chips
- operator timelines

It is not yet good enough for:

- faithful provider-native content blocks
- a transcript that mirrors each CLI's native structure

## Bottom Line

The integration question for the 11 CLI providers is mostly solved at the runtime layer.

The current state is:

- provider registration: solved
- normalized shared streaming events: mostly solved
- provider richness: highly uneven but now better than the old audit claimed
- `cats` rich live transcript / content-block UX: not solved yet

So the honest current reading is not "are the providers connected yet?"

It is:

- "Yes, they are connected."
- "Several of them are already rich enough for a better live UX."
- "The next bottleneck is host presentation and capability truth, not basic adapter wiring."

---

*Research completed: 2026-03-29*
*Author: Codex*
