# Aider CLI Probe — 0.86.2

Date: 2026-08-09
Scope: SPEC-027 / PLAN-034 Phase 1 for the `aider` provider family.
Host: Windows 11, `aider.exe` at `~/.local/bin/aider.exe`.

## Verdict — install tier only, with no path to execution at this version

Aider is the first of the four with **no structured interface at all**. Grok has
`streaming-json`, Cline has `--json` NDJSON, Devin has an ACP server. Aider has none of
these, and the gaps are not incidental — several are actively hostile to being driven by a
runtime.

`devin` at least had a second surface to fall back to. Aider does not.

## No machine-readable output

The full `--help` (522 lines) contains no JSON, stream-format, or structured-output flag.
The only near-misses are inputs or display settings:

- `--stream / --no-stream` — whether the LLM response is rendered incrementally in the
  terminal, not a data format.
- `--pretty / --no-pretty` — terminal formatting.
- `--config`, `--model-settings-file`, `--model-metadata-file`, `--api-key`,
  `--env-file` — all inputs.

There is also no `acp`, `mcp`, `serve`, or protocol mode, and no subcommands at all — Aider
is a flat flag-based CLI. `--gui` / `--browser` launches a human-facing browser UI, not an
API.

A successful one-shot turn (`--message`, `--no-pretty`) produced:

```
Aider v0.86.2
Model: openrouter/deepseek/deepseek-chat with diff edit format
Git repo: .git with 0 files
Repo-map: using 4096 tokens, auto refresh

OK
Tokens: 2.3k sent, 1 received. Cost: $0.00033 message, $0.00033 session.
```

Usage *is* printed, but as a rounded human display string (`2.3k sent`). It is a
presentation format, not a contract, and parsing it would both lose precision and break on
any cosmetic change.

## Exit code is 0 even on total failure

A run whose model call failed outright still exited `0`:

```
litellm.NotFoundError: NotFoundError: OpenrouterException - {"error":{"message":"This model
is unavailable for free ...","code":404}}
```

`echo $?` → `0`. So the runtime cannot use the exit code to detect failure either. Combined
with unparseable stdout, there is no channel left that reports whether a turn succeeded.

## It runs `git init` in the working directory

Pointed at a non-repo directory with `--yes-always`, Aider:

- created a git repository in that directory,
- wrote `.gitignore` containing `.aider*`,
- left `.aider.chat.history.md`, `.aider.input.history`, and `.aider.tags.cache.v4/` behind.

The runtime spawns providers into arbitrary workspaces, including fresh worktrees and
directories the user never intended to be repositories. Silently initializing a repo there
is a side effect no provider should have.

## Authentication — correcting SPEC-027 §6 and D3

**SPEC-027 §6 specified `interactive: false`, and D3 defined readiness as "at least one of
the configured model env keys is present". The probe falsifies both.**

On this host, **no** model API key was set — verified in the shell environment and in the
Windows user environment for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, and `XAI_API_KEY`. There is no
`~/.aider.conf.yml`. Yet Aider started and reported:

> Using openrouter/deepseek/deepseek-r1:free model with API key from environment.

The credential came from `~/.aider/oauth-keys.env`, which contains `OPENROUTER_API_KEY=…`.
Aider writes that file after an **OpenRouter browser sign-in it offers on first run** — a
flow that appears nowhere in `--help` (grepping the help for `oauth`, `sign in`, `login`, or
`openrouter` returns nothing).

Consequences for the runtime:

1. `interactive: false` was wrong. Aider does have an interactive sign-in; it is just
   triggered implicitly rather than by a `login` subcommand. The knowledge entry now sets
   `interactive: true`, matching how Claude Code is modeled ("sign in on first launch or set
   a key").
2. Readiness cannot be derived from environment variables. Aider consults at least four
   sources — environment, `.env`, `.aider.conf.yml`, and `~/.aider/oauth-keys.env` — so an
   env-only check would have reported this fully working host as not ready. The auth hint
   now says so explicitly rather than implying an env-var check is sufficient.

D3's underlying instinct — don't claim which key Aider will use — was right. What it got
wrong was assuming environment variables enumerate the credential space.

## Other operational notes

- `aider --version` → `aider 0.86.2`. Prefixed, like Devin's `devin 3000.3.27 (…)`, not bare
  semver like Cline's `3.0.51`.
- Under a non-Windows-console terminal it prints
  `Can't initialize prompt toolkit: Found xterm-256color, while expecting a Windows console`
  before continuing. It initializes an interactive prompt toolkit even in `--message` mode,
  which indicates TTY coupling.
- Uninstall is `uv tool uninstall aider-chat`; `~/.local/bin/aider` is a uv tool shim, so
  deleting it leaves the tool installed.

## Not probed

- Whether a future version adds a structured output mode; this verdict is version-scoped.
- `--gui` browser mode internals.
- Whether `--message-file` plus `--exit` could produce a narrower, more parseable surface —
  unlikely to change the verdict, since exit codes and usage formatting are the blockers.

## Related

- SPEC-027 §6 and Decision D3 (both corrected by this probe)
- ADR-033
- PLAN-034 Phase 1
