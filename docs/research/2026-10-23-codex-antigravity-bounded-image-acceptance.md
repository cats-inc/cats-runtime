# Codex and Antigravity bounded image acceptance

Date: 2026-10-23 (Asia/Taipei).

The owner asked to open Grok, Muse, Antigravity and Codex generation for testing. Neither the
Codex nor the Antigravity CLI offers a limit on media calls before a run starts, so the owner
accepted runner-enforced bounds. One image each went through the Runtime bounded runner, not
Chat, with the configured native instance. Both used Studio's sample description of one seated
orange cat on a light blue background, with no text. Raw streams, session folders, account data
and local paths stay outside Git.

## Codex

- CLI: codex-cli 0.163.0. Agent: `gpt-6.1-sol`, effort `xhigh`.
- Invocation: `codex exec --json` with:
  - read-only sandbox;
  - user config and rules not loaded;
  - shell, browser, computer, multi-agent and apps features disabled.
- The stream showed `thread.started`, `turn.started` and one `agent_message` item. The image
  call itself is not an item in `exec --json`.
- The runner found the image in `generated_images/<thread>/` and ended the process tree.

| Property | Result |
| --- | --- |
| Elapsed | 27.0 s |
| Execution outcome | `stopped_after_image`, no warnings |
| Encoding / dimensions | PNG, 1254 x 1254, opaque |
| Bytes | 1,289,218 |
| SHA-256 | `694abe13d18368355351a4e484aceae96347bdcb6562e2b94df6f2cf7d3f9c11` |
| Content | One seated orange tabby cat, light blue background, no visible text |

## Antigravity

- CLI: agy 1.4.6. Agent: `gemini-3.8-flash-high`.
- Invocation: `agy -p` with stream-json output, skipped permission prompts (print mode cannot
  run a tool otherwise) and `--sandbox`. The prompt asked for one delegation to the built-in
  `image-generator` with AspectRatio "1:1".
- The stream showed `init`, one `invoke_subagent` and reply text. The child's own calls do not
  reach the parent stream.
- The runner found the image in this conversation's `brain/<conversation>/` folder and ended the
  process tree.

| Property | Result |
| --- | --- |
| Elapsed | 27.1 s |
| Execution outcome | `stopped_after_image`, no warnings |
| Encoding / dimensions | JPEG, 1024 x 1024 |
| Bytes | 319,386 |
| SHA-256 | `8abd0960b53ac3a7711e381489e0dce9e241bed203c151fdb49b4ece80733116` |
| Content | One seated orange cat in profile, light blue background, no visible text |

Both images were decoded completely and inspected visually. No Codex or agy process remained
afterwards.

## Limits of this evidence

- The bounds are the runner's, not the CLI's. A second image started before the stop could
  still be generated and charged. It is not kept; the receipt warns
  `additional_image_generated` only if that file already existed when the first was collected.
- It shows one route per provider with these flags and CLI versions. It does not show
  reliability, quality, cost, live cancellation, or the HTTP server or Desktop path.
