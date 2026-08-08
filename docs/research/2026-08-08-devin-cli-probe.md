# Devin CLI Probe — 3000.3.27

Date: 2026-08-08
Scope: SPEC-027 / PLAN-034 Phase 1 for the `devin` provider family, and Probe Item P1
(the ADR-023 classification question).
Host: Windows 11, `devin.exe` at `%LOCALAPPDATA%\devin\cli\bin\devin.exe`.
Account: signed in (`devin auth status` → "Logged in (via Devin)").

## P1 resolved — Devin executes locally and stays a CLI family

ADR-033 §8 registered `devin` as a CLI provider family on the strength of the upstream
description, and recorded the reversal condition: if a probe showed it only orchestrates
remote sessions, it would move to a management adapter under ADR-023.

**It does not.** `devin --help` opens with "A fast and minimal agent that lives both in your
terminal and in the cloud", and the local agent surface is substantial:

- `-p/--print [PROMPT]` — non-interactive local turn
- `--permission-mode` — `auto` | `accept-edits` | `smart` | `dangerous`
- `--sandbox` — OS-level process sandboxing for the exec tool (macOS seatbelt, Linux bwrap+seccomp)
- `--model`, `--agent-config`, `--export`, `-c/--continue`, `-r/--resume [SESSION_ID]`

The remote surface is a *separate* `cloud` subcommand ("Manage Devin Cloud resources"). So
the two concerns are cleanly split in the CLI itself, and the ADR-023 reclassification is
not triggered. No follow-up ADR is needed.

## The blocking finding — there is no machine-readable output mode

`devin --print` emits **plain prose only**:

```
$ devin --respect-workspace-trust false -p "Reply with exactly: OK"
OK
```

There is no `--output-format`, no `--json`, and no stream flag anywhere in the long help.
The only JSON mentions are `--config` (a config file path) and `--agent-config` (a
declarative agent definition) — both inputs, not outputs.

This is decisive for the CLI backend. Without structured output the runtime cannot recover
tool calls, tool results, token usage, or session identity; it would get a single opaque
string per turn. That is materially worse than Grok's `streaming-json` or Cline's `--json`
NDJSON, and it is not a gap a parser can close.

**`devin` therefore ships install-tier only on the CLI backend, and its execution adapter
refuses.** This is not a "not yet probed" refusal like Antigravity's — it is a probed and
settled one.

## The structured path is ACP, which is an agent-backend concern

`devin acp` runs "an ACP (Agent Client Protocol) server over stdio", with `--agent-type`
(`summarizer`, `review`) and `--model` options. That is the transport the runtime should use
for Devin execution, and it belongs under ADR-031's agent backend, not the CLI backend.

One structural difference from every existing ACP profile: the current profiles in
`src/backends/agent/adapters/acp/profiles.ts` all key on a **separate binary**
(`agy-acp`, `junie-acp`, `cursor-acp`, …). Devin exposes ACP as a **subcommand of the same
binary** (`devin acp`). Adding a Devin profile therefore needs command+arg detection rather
than the binary-name matching the existing profiles rely on.

Not attempted in this slice: no ACP handshake was performed, so no profile is added yet.

## Install tier

- Binary `devin`. Windows `%LOCALAPPDATA%\devin\cli\bin\devin.exe`; Unix `~/.local/bin/devin`
  with versions under `$XDG_DATA_HOME/devin/cli/_versions`.
- `devin --version` → `devin 3000.3.27 (0becb483)`. Note the **`devin ` prefix and trailing
  commit hash** — this is not a bare semver string, unlike Cline's `3.0.51`. Any exact-version
  pinning must parse it rather than compare literally.
- Installers: `irm https://static.devin.ai/cli/setup.ps1 | iex` (Windows, PowerShell-only)
  and `curl -fsSL https://cli.devin.ai/install.sh | bash` (Unix).

### Authentication — correcting SPEC-027 §5

SPEC-027 §5 specified the auth hint should name `devin setup`. That is incomplete. The CLI
has both:

- `devin auth login` / `logout` / `status` — the actual authentication commands.
- `devin setup` — a broader interactive setup wizard.

`devin auth status` reports the credential file (`%APPDATA%\devin\credentials.toml` on this
host), the API server, and the webapp/API endpoints. The knowledge entry now names
`devin auth login` first and mentions the wizard second, and `devin auth status` is the
cheap way to check state after a packaged install stripped the interactive step.

Environment variables observed in help: `DEVIN_MODEL`, `DEVIN_PERMISSION_MODE`,
`DEVIN_SANDBOX`. None is a credential, so `auth.envVars` stays empty.

### Workspace trust — a real spawn hazard

`--respect-workspace-trust` defaults to true in every mode, and the help is explicit:

> Non-interactive (print) mode cannot show the trust prompt and fails in an untrusted
> directory; pass `--respect-workspace-trust false` to skip the check.

The runtime spawns into arbitrary workspaces, including fresh worktrees, which will not be
trusted. Any future Devin execution path — CLI or ACP — has to decide this explicitly rather
than inherit the default, and the probe run above needed the flag to work at all.

## Models

`devin models list` enumerates **37 model families** with aliases, context windows, and
per-MTok pricing (e.g. `claude-opus-5` with alias `opus`, variants
`claude-opus-5-{low,medium,high,xhigh,max}` and `-fast` counterparts). This is real
enumerable catalog evidence, unlike Cline.

No ids are bundled yet: the runtime cannot execute Devin through the CLI backend, so
bundling a selectable-looking model list would imply a capability that does not exist. The
playground exposes only the `devin-default` sentinel. When the ACP path lands, this command
is the source to populate from.

## Not probed

- The ACP handshake and session lifecycle over `devin acp`.
- `--permission-mode` behavior per level, and how `--agent-config` expresses tool visibility.
- `-c/--continue` and `-r/--resume` semantics, and where session ids are exposed.
- `devin list` (sessions in the current directory) output shape.
- `--export` conversation format, which may be the only structured transcript available.
- `--sandbox` (research preview; macOS/Linux only).
- Cancellation behavior.

## Related

- ADR-033 §8 (classification reversal condition, now resolved as "no change")
- ADR-031 (ACP inside the agent backend)
- SPEC-027 §5, Probe Item P1
- PLAN-034 Phase 1
