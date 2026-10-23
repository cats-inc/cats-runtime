# Muse bounded image acceptance

Date: 2026-10-23 (Asia/Taipei).

The owner authorized live calls for Muse, Antigravity and Codex generation, starting with
generation only. These two Muse calls went through the Runtime bounded runner
(`executeMuseImage`), not Chat. The runner used the configured native instance and the
`muse-generate` profile. Raw session logs, account data and local paths stay outside Git.

## Setup

- CLI: Muse Code 1.4.12 (native, Windows launcher resolved by Runtime).
- Agent: `muse-spark-1.3`, effort `xhigh`.
- Prompt: Studio's sample description of one seated orange cat on a light blue background,
  with no text.
- Limits:
  - `--max-model-steps 1` and `--no-parallel-tool-calls`
  - shell and web tools off; approval prompts disabled
  - reminders, request-user-input and foreign personal context off
  - session ID chosen by Runtime
  - an empty attempt workspace as the working directory

## Attempt 1: no image

The first invocation also passed `--disable-write`. The model's single step answered with
text only, and the turn completed in 13.7 s. No tool was proposed and no file was written.

Muse's own session log showed why. The toolset offered to the model lacked `image_generation`,
and the model replied that the tool was unavailable. Two earlier Chat sessions that generated
images had all tools enabled, and their toolsets included `image_generation`. The CLI describes
`--disable-write` as disabling "non-shell workspace filesystem writes", and the image tool saves
into the workspace.

The offline `echo` provider never offers the image tool, with or without the disable flags.
It therefore cannot separate the flags; only the Meta provider can.

## Attempt 2: verified image

Without `--disable-write` (writes confined to the attempt workspace), the stream showed this
sequence, then the runner ended the process tree:

1. Session start with the Runtime session ID.
2. Model configuration and status lines.
3. One `task.lifecycle.proposed` for `image_generation`.
4. One `tool.result` reading `Saved generated image to generated_images/<call id>.png`.

| Property | Result |
| --- | --- |
| Elapsed | 18.6 s |
| Execution outcome | `stopped_after_image` |
| Encoding / dimensions | PNG, 1920 x 1280 (3:2), opaque |
| Bytes | 1,242,589 |
| SHA-256 | `bbcf2c079111bc91db218217aec40c60bcb2365f3529ebd36a6d1d33a814d8f0` |
| Content | One seated orange cat, light blue background, no visible text |

The PNG was decoded completely with CRC checks and inspected visually. No Muse process
remained afterwards.

## Limits of this evidence

- It shows one bounded Muse generation route with these flags and this CLI version.
- It does not show reliability, quality, cost, cancellation against the live CLI, or the HTTP
  server or Desktop path. Platform and Studio integration have their own acceptance.
- The single-step limit, the parallel-call flag and the absent shell/web tools are CLI
  settings. The runner's stop on any other proposal is a second guard, not the primary bound.
