# ADR 004: Resolve File-Backed Provider Paths on the Host

## Status

Accepted

## Date

2026-03-16

## Context

Provider instances made it possible to model one provider across multiple
execution environments, including several WSL distros on one Windows host.

That introduced an ambiguity for file-backed providers such as Claude, Codex,
Copilot, Gemini, and Auggie:

- the runtime discovers their sessions by reading files directly from the host
  process
- provider config examples still used shorthand paths such as `~/.codex/sessions`
- for WSL-backed instances on Windows, `~/.codex/sessions` is a guest-relative
  path, not a host-accessible path

Without an explicit rule, the runtime could accept configuration that looked
valid but could not be read correctly from the host.

## Decision

`cats-runtime` will treat file-backed provider paths as host filesystem paths.

This applies to:

- `claude.projects_dir`
- `codex.sessions_dir`
- `copilot.sessions_dir`
- `gemini.sessions_dir`
- `auggie.sessions_dir`

The runtime resolves and validates these paths before creating scanners,
watchers, or Auggie file-backed session services.

On Windows, when one of those providers is configured with `runtime: wsl`,
guest-relative Linux paths such as `~/.codex/sessions` or
`/home/user/.codex/sessions` are rejected. Callers must use a host-accessible
path, for example:

- `\\wsl$\Ubuntu\home\user\.codex\sessions`
- a Windows path if the provider stores data on the Windows filesystem

Cursor and Kiro are different: their `chats_dir` and `db_path` are consumed by
runtime-aware native services that execute inside the selected runtime, so those
paths remain runtime-side rather than host-side discovery paths.

## Rationale

- keeps file-backed discovery semantics aligned with the actual implementation
- fails fast on configurations that the host process cannot read
- avoids silent cross-environment misrouting or accidental watcher deduplication
  on ambiguous paths
- makes WSL support explicit without forcing a new environment-specific path
  syntax into the config model

## Consequences

### Positive

- file-backed discovery paths now mean the same thing everywhere they are used
- invalid Windows+WSL file-backed paths fail during bootstrap instead of
  degrading later at watch/scan time
- watcher deduplication can key off resolved host paths with clearer semantics

### Negative

- Windows users configuring WSL-backed file providers must use more explicit
  host paths such as `\\wsl$\...`
- setup docs and examples must explain the distinction between host-side
  file-backed providers and runtime-side native providers

## Follow-up

- keep Docker out of file-backed discovery until container filesystem semantics
  and persistence are defined
- revisit whether provider-specific path metadata should eventually be expressed
  through a more generic config shape
