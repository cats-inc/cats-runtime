# Grok CLI Install-Tier Probe

Date: 2026-08-08

## Scope

This note records the evidence used for the Grok-only slice of cats-runtime
PLAN-034 and cats-platform PLAN-102. It supports installation, detection,
configuration, and refusal-tier UI. It does not approve session execution.

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

The Windows host had `C:\Users\sammy\.grok\bin\grok.exe`. No login, prompt,
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

## Open Evidence Gaps

- No authenticated headless prompt was run, so neither NDJSON format has an
  observed fixture in this repo.
- Event ordering, terminal records, error records, tool approval behavior,
  cancellation, and process exit semantics remain unverified.
- Resume and fork flags are documented but have not been exercised against a
  real session.
- The `models` command contract and returned ids remain unprobed.

## Implementation Decisions From This Probe

- Register Grok at the install/check tier with a `cli/native` config target and
  an actionable execution refusal until a separate authenticated probe records
  stable subprocess and stream fixtures.
- Keep the bundled model catalog empty. User-curated entries may be supplied
  explicitly, but Cats does not fabricate ids from product names.
- Detect only the `grok` binary and the fixed `~/.grok/bin/grok{,.exe}` path.
- Packaged uninstall removes only the fixed `grok` executable and its adjacent
  installer-owned `agent` alias. Auth, sessions, configuration, and unrelated
  PATH commands remain untouched.
