# Cursor image runner — 2026-10-24

## Evidence boundary

The owner requested Cursor in Studio, with Codex / Antigravity / Grok / Muse / Cursor order
and Grok selected on entry. The initial profile uses GLM 5.3 / max. The
[Apps cross-CLI probe](../../../cats-apps/docs/research/2026-10-24-chinese-model-cross-cli-reprobe.md)
verified a native `cursor.GenerateImage` JPEG at 1024 x 1024 through Chat. Cursor/Kimi K3
also generated an image, but its image-understanding turn failed. Neither observation isolates
effort, identifies the media backend or proves native GLM vision.

The owner selected the Studio/Desktop release and its one-image acceptance, then explicitly
allowed one additional image after the failed save below. The corrected runner succeeded and
the profile is enabled under
[ADR-047](../decisions/047-generalize-bounded-image-generation-to-provider-profiles.md).

## Implementation evidence

The installed Cursor distribution `2026.10.22-27dcf5f` documents print/stream-json, parameterized
model, explicit workspace and sandbox switches. Its local implementation reads `CURSOR_DATA_DIR`
for project assets and serializes native `tool_call` started/completed events with
`generateImageToolCall`. Live startup also established the narrowly scoped
`getMcpToolsToolCall` schema lookup and framing metadata (`hookAdditionalContexts`, `toolCallId`,
timestamps), including a toolCallId inside lookup arguments. One lookup for cursor/GenerateImage
is allowed; another server, another tool, a broad pattern or a second lookup is refused.
The recorded distribution is provenance, not a version gate.

The runner pins `glm-5p3[reasoning=max]`, requests one square image, denies ordinary tools in
attempt-local project permissions and isolates generated project assets beneath the attempt
workspace. Auth/config and native chat history remain in their normal locations. macOS/Linux
use the native sandbox; Windows explicitly disables it because this CLI rejects sandbox mode
there before model initialization. Windows relies on project permissions and runner tool checks.
Only its matching completed native call can name a generated source under
that attempt's project assets. Original bytes undergo containment, stable single-link file checks
and full image decoding. A PNG request may return JPEG, as the earlier probe demonstrated.

## Native acceptance observations

- Initial Windows startup refused the unsupported sandbox switch: zero tool calls.
- Two bounded startup checks stopped at schema discovery while the native frame metadata was
  being corrected: zero image tool calls.
- One subsequent invocation made one schema lookup and one GenerateImage call. Its completed
  result was an error: `Failed to save generated image ... Blocked by permissions configuration`.
  The blanket Write deny had also blocked the image tool's save. No verified artifact or inline
  image payload was retained. This attempt is not successful collection evidence, and provider
  billing is unknown.
- The corrected invocation omits `--force`, removes the blanket Write deny and explicitly allows
  Write only under this attempt's `.cursor-data/projects/**`; ordinary tool events still stop
  execution. The owner authorized one further image; no automatic generation retry is implemented.
- That extra invocation passed through `ImageGenerationService` and the native runner: one schema
  lookup, one GenerateImage, zero other tool calls, 25.0 seconds, process stopped after collection.
  Native session `2db1277e-78f6-4f23-8bb2-f897de4b89c2`, receipt
  `42875b69-4cad-4712-b229-74ff9c67b146`. The tool requested `studio-image.png` and returned
  `assets/studio-image.jpg` inside its isolated project root. Retained original: JPEG,
  **1024 x 1024**, **90,500 bytes**, opaque, SHA-256
  `207d70095e5080d94d2618970ef765dac510fbc28d8b81125e35d577124d8079`.
  Complete Runtime decode and visual inspection passed; there was no format conversion or
  replacement with an earlier sample. This validates the native Windows runner/service seam,
  not a live paid Desktop SDK end-to-end call. Host/SDK coverage below uses fixtures.

The four image regression files passed 33 tests. Cursor-specific fixtures cover explicit
model/transport/capabilities, completion correlation, foreign tools and paths, extra calls,
missing/corrupt output, output caps and cancellation. Runtime TypeScript passed. Platform's
isolated actual Studio package/SDK/host fixture check passed five-card order and centered/default
Grok, Cursor JPEG submission/download, reopening without generation and narrow layout; zero CLI
calls. Successful native runner acceptance passed; independent review was unavailable. Runtime keeps
its existing package version and is selected by exact source SHA for Desktop, without npm publication.
