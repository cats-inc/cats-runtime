# Kiro 2.24's v2 engine ignores `--model` without a terminal

Date: 2026-09-28. Scope: how Cats launches `kiro-cli` (`src/backends/cli/providers/kiro.ts`).
Kiro CLI 2.24.1 on native Windows. The operator asked for the cause to be found and chose the
v1-engine fix.

## Symptom

A Cats room set to `claude-opus-5.5` (effort low) sent `--model claude-opus-5.5 --effort low`,
and the runtime log showed that model. Kiro's own session record for the turn gave `auto`
everywhere:
- each turn's `user_turn_metadatas[].model`;
- `rts_model_state.model_info.model_id`, with a 200,000-token context window;
- the thinking blocks' `modelId`.

## Evidence

- **Kiro's record is truthful.** The operator ran interactive `kiro-cli chat` and chose
  `claude-opus-5.5` with `/model`. That turn was recorded as `claude-opus-5.5` in the same three
  places, with the model's 1,000,000-token window and a 0.258-credit turn.
- **Four minimal probes**, each `kiro-cli chat --no-interactive ... "Reply with the single word
  OK."` in its own scratch directory, about 0.4 credits in total:
  - **Default v2 engine, `--model claude-opus-5.5`:** stderr printed
    `[warn] failed to set model 'claude-opus-5.5': Method not found`. The turn still succeeded
    and was recorded as `auto` (0.035 credits).
  - **`--agent-engine v1`, same model:** recorded as `claude-opus-5.5` in `data.sqlite3`
    `conversations_v2`, `history[].request_metadata.model_id` (0.23 credits).
  - **`--agent-engine v1 --effort low`:** also `claude-opus-5.5`, at 0.09 credits. The v1 record
    has no effort field, so the lower cost is the only sign that effort applied.
  - **`--agent-engine v1 --resume`**, in the same directory: a second turn in the same
    conversation, again `claude-opus-5.5`.
  - `--agent-engine v3` answered, but its session was in neither store and was not pursued.
- **The v1 output matches the adapter.** The reply is `> OK` on stdout, which the Kiro parser
  already strips, and the credits footer goes to stderr.
- Cats never showed the warning, because the worker does not log Kiro's stderr.

## Change

- `KiroProvider` and the Kiro compatibility profile add `--agent-engine v1` to every
  non-interactive run.
- The primary compatibility profile now requires `--agent-engine` in `kiro-cli chat --help`. A
  Kiro without it falls back to the best-fit profile, and a run fails with Kiro's own error
  rather than silently using another model.
- Cats' Kiro sessions return to `data.sqlite3`. Discovery still reads v2 sessions from
  `~/.kiro/sessions/cli`, for example interactive ones.
- Each turn's recorded model is also reported on the run log line as `reported=`, and flagged
  when it differs from the request.

## Open

- If a later Kiro removes the v1 engine or fixes v2's `--model`, revisit this choice.
- The v2 failure is Kiro's to fix; it has not been reported upstream from here.
