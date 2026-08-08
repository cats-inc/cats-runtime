# Grok CLI Install and Authenticated Lifecycle Probe

Date: 2026-08-08

## Scope and conclusion

This note records the evidence for the Grok execution slice of cats-runtime
PLAN-034 and cats-platform PLAN-102. An authenticated, isolated probe of Grok
CLI 1.0.0 closed the success, tool, error, permission, cancellation, model,
resume, and fork gaps needed for a native adapter. Cats therefore enables Grok
1.0.0 session execution and refuses unverified Grok versions.

Every prompt ran with a newly created temporary directory as `--cwd`; the CLI
was never pointed at a Cats checkout. Repository fixtures are sanitized copies.
Raw captures and probe-created working files were deleted after validation.
After implementation, a live `WorkerProcess` plus `GrokProvider` smoke returned
the exact requested text with progress, terminal result, and session identity.

## Install and authentication contract

- Windows installs with `irm https://x.ai/cli/install.ps1 | iex`; macOS and
  Linux use `curl -fsSL https://x.ai/cli/install.sh | bash`.
- The executable is `~/.grok/bin/grok.exe` on Windows and
  `~/.grok/bin/grok` on macOS/Linux.
- The installer creates an adjacent generic `agent` alias. Cats detects only
  `grok` and never resolves an arbitrary `agent` from PATH.
- `grok login` writes `~/.grok/auth.json`; `XAI_API_KEY` is the non-interactive
  alternative. Existing OAuth credentials take precedence over an injected API
  key. An isolated profile with no credentials fails before session creation
  and returns an actionable sign-in error.

## Verified CLI and model contract

- `grok --version`: `grok 1.0.0 (3cd0d0cbce)`.
- Native headless output: `--output-format streaming-json`.
- Verified model catalog: `grok models` reports only `grok-4.5`, marked as the
  default. The adapter and both product catalogs use that exact id.
- The execution profile fixes `--max-turns 100`, `--disable-web-search`,
  `--no-memory`, `--no-subagents`, and `--verbatim`.
- `--resume <session-id>` continues the same session. `--fork-session
  <session-id>` preserves context under a new session id.

## Stream lifecycle

The native NDJSON stream uses these records:

- `thought` and `text` deltas;
- `tool_call` with `pending` status and a stable `toolCallId`;
- zero or more `tool_call_update` records followed by `completed` or `failed`;
- `usage`; and
- terminal `end` with `stopReason`, `sessionId`, `requestId`, and usage.

The adapter emits native text and reasoning deltas, derives progress from tool
records, pairs tool results by id, normalizes usage, and treats a process killed
by runtime cancellation as complete cancellation even when the partial stream
has no terminal event. A failed tool may still be followed by a successful
`end_turn`; tool failure and process failure are therefore separate states.

Invalid model, missing auth, and invalid toolset initialization each emit a
native `error` record and exit non-zero. The adapter classifies those errors and
does not treat them as assistant text.

## Permission findings

Grok 1.0.0 has several permission flags that are not safe enforcement
boundaries:

- `--permission-mode dontAsk` still executed an edit.
- `--permission-mode plan` still executed an edit.
- `--deny search_replace`, its namespaced form, and a list containing all 24
  observed built-in tools still allowed a requested tool to execute.

A non-empty `--tools` allowlist was the only observed hard boundary. With only
`read_file`, a requested write did not run. Consequently:

- Cats maps a whitelist to `--tools` and refuses an empty whitelist instead of
  pretending it means no tools.
- `search_replace` requires `read_file`; Cats rejects that invalid whitelist
  before spawn.
- Skip mode uses `--permission-mode auto --always-approve`.
- Default mode uses the proven hard allowlist with only `read_file`; it does not
  rely on `dontAsk` itself to prevent mutation.

These limitations are pinned to Grok 1.0.0 and are covered by regression
fixtures so a future compatibility profile cannot silently weaken the policy.

## Redacted fixtures

`fixtures/grok-1.0.0/` contains complete sanitized captures for:

- native and Messages-compatible success streams;
- successful and failed tool lifecycles;
- a read-only hard allowlist;
- plan mode and full disallowed-tool lists still executing tools;
- invalid toolset, model, and authentication failures;
- cancellation without a terminal event;
- model enumeration; and
- resume seed, resume, and fork flows.

Sanitization replaces working paths, credential source, identifiers,
signatures, reasoning, command/tool/skill catalogs, durations, token counts,
and costs while preserving record order, field names, enum values, text chunk
boundaries, model labels, booleans, nulls, and collection shapes.

## Compatibility decision

`grok-cli-streaming-json-1.0.0` is an exact compatibility profile, not a range.
Only parsed version 1.0.0 may execute. Missing, malformed, older, or newer
versions retain the actionable compatibility refusal until their complete
lifecycle is probed and a new fixture-backed profile is reviewed.

The alternate `streaming-messages-json` fixture remains evidence only. The
native stream is the adapter contract because it exposes the tool lifecycle
directly and avoids duplicate delta plus terminal assistant text.
