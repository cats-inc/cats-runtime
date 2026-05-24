# Antigravity CLI Phase 0 Probe

Date: 2026-05-24

## Scope

This note records the evidence used by cats-platform PLAN-100 and cats-runtime
PLAN-033 before replacing the Gemini CLI setup path with Antigravity CLI.

## Local Installer Evidence

Sources inspected:

- `environment-bootstrap/platform/windows/Install-AntigravityCLI.ps1`
- `environment-bootstrap/platform/macos/install-antigravity-cli.sh`
- `environment-bootstrap/platform/linux/install-antigravity-cli.sh`
- `environment-bootstrap/platform/windows/Check-Installation.ps1`
- `environment-bootstrap/platform/{macos,linux}/check-installation.sh`

Findings:

- Windows installer flags are `-Upgrade`, `-Force`, and `-NonInteractive`.
- macOS/Linux installer flags are `-upgrade` and `-force`.
- There is no upstream uninstall mode. Cats Desktop wrappers must own
  binary-only uninstall behavior.
- Windows installs `agy.exe` under `%LOCALAPPDATA%\agy\bin\agy.exe` and updates
  user PATH. The script does not self-elevate and is user-scoped.
- macOS/Linux install `agy` under `$HOME/.local/bin/agy`, update shell rc PATH,
  and do not use `sudo`.
- Upgrade / force remove the existing binary before rerunning the official
  installer because the official installer skips when the binary already exists.
- The retry behavior is idempotent at the wrapper level: a failed or interrupted
  run can be retried because the scripts re-check command/path presence and the
  force/upgrade modes remove the binary before reinstalling.

## Official Product Evidence

Sources:

- <https://antigravity.google/docs/cli-getting-started>
- <https://antigravity.google/docs/cli-using>
- <https://antigravity.google/docs/cli-features>
- <https://antigravity.google/docs/gcli-migration>
- <https://antigravity.google/docs/models>

Findings:

- Official install commands are `curl -fsSL https://antigravity.google/cli/install.sh | bash`
  on Mac/Linux and `irm https://antigravity.google/cli/install.ps1 | iex` on
  Windows PowerShell.
- Antigravity CLI stores settings in `~/.gemini/antigravity-cli/settings.json`.
- Plugins are staged under `~/.gemini/antigravity-cli/plugins/<plugin_name>/`
  and can contain skills, agents, rules, MCP servers, and hooks.
- The Gemini CLI migration page says `agy plugin import` handles installed
  extensions and notes that Antigravity CLI does not currently have an
  equivalent to the `gemini skills` command for terminal-managed Agent Skills.
  Therefore Cats skills sync should drop Gemini and not add an Antigravity
  skills target in this migration.
- The models page documents Antigravity reasoning-model display names:
  `Gemini 3.1 Pro (high)`, `Gemini 3.1 Pro (low)`, `Gemini 3 Flash`,
  `Claude Sonnet 4.6 (thinking)`, `Claude Opus 4.6 (thinking)`, and
  `GPT-OSS-120b`.

## Open Evidence Gaps

- `agy` is not installed on this Windows host, so no live `agy --help`,
  `agy --version`, session-storage, or model-selection CLI contract was probed.
- The official docs identify selectable reasoning-model display names but do
  not expose a CLI model-list command or raw model-id strings. Code must not
  claim that `agy models` or a stable model-id API exists until a live probe
  proves it.
- Raw `agy` ACP behavior was not proven here. Runtime ACP support should stay
  tied to `agy-acp` evidence, not inferred from the interactive CLI.

## Implementation Decisions From This Probe

- Packaged setup wrappers use the Cats Desktop host-facing lifecycle flags and
  translate only install / upgrade / force to environment-bootstrap.
- Packaged uninstall is binary-only by default and does not delete auth,
  session, plugin, or settings state under `~/.gemini/antigravity-cli`.
- `setupAssets.ts` should mark Antigravity helpers as user-scoped
  (`requiresElevation: false`) and resumable, based on the local wrapper
  re-check / retry semantics.
- Runtime bundled static catalog should stay empty for Antigravity until a live
  CLI model-list contract proves raw `agy` model ids. User-curated YAML may
  still supply local entries explicitly, but the bundled runtime must not lock
  documented display names as canonical ids.
