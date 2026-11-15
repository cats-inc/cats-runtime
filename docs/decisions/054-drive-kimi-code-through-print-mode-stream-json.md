# ADR-054: Drive Kimi Code through print-mode stream-json

Date: 2026-11-16
Status: Accepted; no turn on a real Kimi Code plan has run yet
Evidence: [Kimi Code CLI provider](../research/2026-11-16-kimi-code-cli-provider.md).

## Context

The operator added Kimi Code CLI (Moonshot AI, `kimi`) to environment-bootstrap's Full mode
(4108ac8, 2026-11-13) and asked for complete Cats support: a Runtime provider usable from the
Playground, the Desktop provider and model menus, and Desktop packaged setup. Display order puts it
directly after Pi and before Kiro.

Kimi Code 2.5.3 is a Node single-executable application installed to
`~/.kimi-code/bin/kimi(.exe)`. Its flags resemble Claude Code's (`-p`, `--output-format
stream-json`, `-c`, `--add-dir`, Claude-like tool names), but its stream-json is a different
format: OpenAI-style chat messages, one per model step, rather than Claude's event stream. It also
has `kimi acp`, an ACP server over stdio.

## Decision

1. **CLI backend, print mode.** `KimiProvider` runs one process per turn:
   `kimi --output-format stream-json [--model <alias>] [--session <id>] --prompt <prompt>`.
   The compiled prompt travels in argv because print mode does not read stdin. Model values are
   Kimi's alias keys (`kimi-code/k3`).
2. **The adapter owns the turn (`streamTurn`).** Kimi writes an assistant step only after that
   step's tools finish, so a long shell command leaves stdout silent for longer than the worker's
   120-second idle timeout, and failures arrive on stderr after a stdout line was already seen. The
   adapter applies its own whole-turn limit (`CATS_KIMI_TURN_TIMEOUT_MS`, default 30 minutes, `0`
   disables), ends the process tree on abort, and classifies the exit itself.
3. **Completion and session identity.** The turn succeeds only when Kimi exits 0 after writing
   `session.resume_hint`; that hint supplies the session id. A failure is the
   `error: failed to run prompt: <message>` stderr line. `Session "<id>" not found.` and
   `... was created under a different directory.` during a resume become
   `provider_session_unavailable` (ADR-006 rule 8).
4. **Usage and served models from the wire journal.** Stream-json carries neither. For native
   runs the adapter reads the newest turn of
   `<KIMI_CODE_HOME>/sessions/*/<session>/agents/main/wire.jsonl` after the turn: `usage.record`
   lines (turn scope) and `llm.request` model names. Subagent journals are not counted.
5. **No permissions, no effort control.** Print mode always runs in Kimi's `auto` permission mode
   and rejects `--yolo`, `--auto` and `--plan`, so the adapter declares `permissions: false` and
   no session capabilities: an explicit execution policy is refused, as for Pi and Goose. Print
   mode has no per-invocation effort flag, so the catalog has no effort control; Kimi applies the
   effort in its own config.toml or the model's default.
6. **Updater off for Cats-started processes.** `KIMI_CODE_NO_AUTO_UPDATE=1` disables the update
   check, background install and the staged binary swap at startup for that process only.
7. **Install knowledge.** The fixed path `~/.kimi-code/bin/kimi(.exe)` is the expected path.
   Runtime resolves `kimi` on PATH first and falls back to that path, while Desktop's packaged
   helper detects only the fixed path (Platform ADR-153); the official installer prepends its bin
   directory to the user PATH and renames an archived Python kimi-cli to `kimi-legacy`, so both
   find the same binary after an official install. Git Bash is a Windows note, not a prerequisite
   check: a missing prerequisite would mark Kimi unavailable although Kimi finds `bash.exe`
   without `git` on PATH. The compatibility probe floor is 45 seconds because each launch takes
   seconds.
8. **Catalog.** A full catalog of the managed `kimi-code` aliases from `kimi provider list
   --json`, exact `displayName` labels, no default row. Version drift follows ADR-035; 2.5.3 is
   fixture provenance, not an allowlist.
9. **ACP as an agent target, not the CLI path.** A Tier 2 `kimi-acp` profile recognizes
   `kimi acp` for operators who configure an agent/ACP instance. The cli/native target stays on
   print mode, which matches its Pi, Goose and Junie neighbours and is the path whose output was
   captured.
10. **Native sessions managed like Kiro's.** `KimiNativeSessionService` lists, reads and deletes
    the sessions in Kimi's store, whether Cats or the user created them:
    - Listing: natively it reads `sessions/<workdir key>/<session>/state.json` and the main-agent
      `wire.jsonl` (user turns, first prompt and model, cached by size and mtime). Inside WSL or
      Docker it runs `kimi session list --all --json` and reads each journal through the shell.
    - Transcripts: user input and assistant text from the journal's `agent.message.appended`
      records, with Cats' compiled-prompt wrapper removed.
    - Deletion: through Kimi's own ACP `session/delete`. That removes the directory, the index
      entry and the file history, and journals the deletion in `session_index.jsonl`; removing
      the directory alone would leave those behind. `kimi acp` needs no sign-in and no
      matching workspace for this, and starting it does not register its cwd as a project.
    - Failures: an id Kimi no longer knows counts as deleted. If kimi cannot delete the
      session and it is still in the store, the Runtime session is retained.
    - Background discovery polls native instances; WSL and Docker instances use manual
      discovery like Cursor, Goose, Kiro, Kilo and OpenCode. `/kimi/sessions` and
      `/kimi/sessions/discover` match the other native providers.
    - All of these read the same Kimi home as turns: `KIMI_CODE_HOME`, else `~/.kimi-code`.

## Consequences

- Kimi appears in every Runtime provider list between Pi and Kiro, including the Playground,
  dashboard and provider setup page.
- The Runtime dashboard lists, opens and deletes Kimi sessions. Deleting a Cats conversation
  that used Kimi also deletes Kimi's own transcript, and that cannot be undone.
- The journal format is private: the transcript reader accepts `state.json` version 2 and wire
  protocol 1.x, and refuses anything else.
- A Desktop decision session that requires a read-only execution policy cannot use Kimi.
- Kimi is a seventh per-turn adapter that passes the composed prompt as an argument, so the
  native Windows limit of about 32,000 characters measured on 2026-11-11 applies to its prompt.
- `KIMI_SHELL_PATH` is both Kimi's own bash override and Runtime's `<PREFIX>_SHELL_PATH` runner
  shell variable. It matters to Runtime only with an explicit `KIMI_RUNNER` of cmd, pwsh or
  powershell.
- Until an account with a Kimi Code plan runs a turn, successful output is known from the shipped
  writer source and from Kimi 2.5.3 driven against a local OpenAI-compatible stub, not from Moonshot's
  service.
