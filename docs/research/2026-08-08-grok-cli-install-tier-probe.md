# Grok CLI Install and Authenticated Stream Probe

Date: 2026-08-08

## Scope

This note records the evidence used for the Grok-only slice of cats-runtime
PLAN-034 and cats-platform PLAN-102. It supports installation, detection,
configuration, refusal-tier UI, and success-stream parser development. It does
not yet approve session execution.

## Installer and Authentication Evidence

The reviewed upstream contract and the local installed layout agree on these
facts:

- Windows installation uses
  `irm https://x.ai/cli/install.ps1 | iex`; macOS and Linux use
  `curl -fsSL https://x.ai/cli/install.sh | bash`.
- The primary executable is `~/.grok/bin/grok.exe` on Windows and
  `~/.grok/bin/grok` on macOS/Linux.
- The installer also creates an adjacent generic `agent` alias. Cats detects
  only `grok`; it never treats an arbitrary `agent` on PATH as Grok.
- Grok supports `grok login` and the `XAI_API_KEY` environment variable. The
  login credential location is `~/.grok/auth.json`; install and uninstall
  helpers do not inspect, print, or delete that file.

## Local Read-Only Probe

The Windows host had `%USERPROFILE%\.grok\bin\grok.exe`. No login, prompt,
model request, session creation, or file-changing command was run.

- `grok --version` returned `grok 1.0.0 (3cd0d0cbce)`.
- `grok --help` completed successfully and documented headless output formats
  `plain`, `json`, `streaming-json`, and `streaming-messages-json`.
- Help describes `streaming-json` as native ACP session-update NDJSON and
  `streaming-messages-json` as Anthropic Messages API wire-format NDJSON.
- `--include-partial-messages` advertises incremental text/thinking
  `stream_event` records for `streaming-messages-json`.
- Resume-related flags include `--resume`, `--continue`, `--fork-session`, and
  `--session-id`. Permission controls include allow/deny rules and
  `--permission-mode`.
- A `models` command is advertised, but it was not executed, so no model ids
  are recorded as verified.

## Authenticated Headless Success Probe

With User authorization, two authenticated requests were run against the same
local Grok 1.0.0 binary. Each used a newly created empty temporary directory as
`--cwd`; the CLI was never pointed at a Cats checkout. The prompt was exactly
`Reply with exactly: CATS_GROK_STREAM_PROBE_OK`. Both requests also used
`--max-turns 1`, `--permission-mode plan`, `--disable-web-search`,
`--no-memory`, `--no-subagents`, an empty `--tools` value, and `--verbatim`.
Both exited zero with empty stderr and returned the expected text. No tool-use
event was emitted.

### Native `streaming-json`

The native stream contained 37 NDJSON records in this order:

- three `available_commands` metadata records;
- 21 `thought` deltas;
- 11 `text` deltas that concatenate to `CATS_GROK_STREAM_PROBE_OK`;
- one `usage` record carrying a signature; and
- one `end` record with `stopReason: end_turn`, session/request ids, usage,
  cost, turn count, and per-model usage.

The terminal record identified the usage bucket as `grok-4.5-build`. This is
evidence for that single run, not a probed model catalog.

### `streaming-messages-json` with partial messages

The Messages-compatible stream contained 42 NDJSON records:

- one `system/init` record identifying model `grok-4.5`;
- 39 `stream_event` records covering `message_start`, thinking and text block
  start/delta/stop events, `message_delta`, and `message_stop`;
- one complete `assistant` record; and
- one `result/success` record with the expected text and `end_turn` stop reason.

The 32 content-block deltas split into 21 thinking deltas and 11 text deltas.
The complete assistant and result records repeat the final text, so a future
adapter must choose delta or terminal text rather than emitting both.

### Redacted fixtures

The complete observed success sequences are stored in:

- `fixtures/grok-1.0.0/streaming-json.success.redacted.ndjson`
- `fixtures/grok-1.0.0/streaming-messages-json.success.redacted.ndjson`

Before the files entered the repository, the probe replaced the working
directory, auth source, session/request/message/event ids, signatures,
reasoning text, installed command/tool/skill catalogs, duration, token counts,
and cost values. Event order, field names, enum values, text chunk boundaries,
model labels, boolean/null values, and collection shapes remain intact. The raw
captures stayed in the temporary probe directory during inspection and are not
repository artifacts.

## Open Evidence Gaps

- Only the authenticated no-tool success path is captured. Error records, tool
  request/result and approval behavior, cancellation, timeouts, signals, and
  non-zero process exits remain unverified.
- Resume and fork flags are documented but have not been exercised against a
  real session, and the relationship between `sessionId` / `session_id` and
  resume lookup remains unverified.
- Passing an empty `--tools` value did not suppress the native
  `available_commands` metadata or the Messages-compatible init catalogs. No
  tool ran, but that flag must not be treated as a proven hard sandbox.
- Both fixtures come from Grok 1.0.0; compatibility across versions is not yet
  established.
- The `models` command contract and returned ids remain unprobed.

## Implementation Decisions From This Probe

- Register Grok at the install/check tier with a `cli/native` config target and
  an actionable execution refusal. The success-stream parser may now target
  native `streaming-json`, but execution stays disabled until tool, negative,
  cancellation, and resume lifecycle fixtures close the remaining safety gaps.
- Keep the bundled model catalog empty. User-curated entries may be supplied
  explicitly, but Cats does not fabricate ids from product names.
- Detect only the `grok` binary and the fixed `~/.grok/bin/grok{,.exe}` path.
- Packaged uninstall removes only the fixed `grok` executable and its adjacent
  installer-owned `agent` alias. Auth, sessions, configuration, and unrelated
  PATH commands remain untouched.
