# ADR-045: Drive Kiro through the V3 headless engine

Date: 2026-10-13
Status: Accepted
Evidence: [Kiro V3 headless contract](../research/2026-10-13-kiro-v3-headless-contract.md).

## Context

Kiro CLI is replacing its V1 and V2 agent engines with V3. Kiro 2.30.0 ships
V3 alongside V2, offers every V2 user the switch at startup, and Kiro has
announced that CLI 3.0 makes V3 the default at the end of October 2026 and
retires the Classic interface.

Cats drove Kiro with `--agent-engine v1`, because Kiro 2.24's V2 engine
ignored `--model` in non-interactive runs (research note of 2026-09-28). That
path had three structural costs:

- the reply was plain `> text` on stdout, so Kiro was the one provider with no
  tool, reasoning or usage events;
- sessions were read from a SQLite database and a V2 file store through python
  scripts, and a session could only be resumed while it was the newest one in
  its directory;
- the recorded model had to be read back from the session file after the run.

The operator asked for full V3 support with no V1 or V2 compatibility left in
the runtime.

## Decision

1. **Headless V3 on the CLI backend.** `KiroProvider` runs
   `kiro-cli chat --no-interactive --agent-engine v3 --output-format stream-json`
   per turn, sends the prompt on stdin and resumes with `--resume-id`. The
   stream's `sessionUpdate` frames are verbatim ACP `session/update` payloads;
   the adapter maps text, thought and tool updates to runtime events and ends
   the turn on `runFinished`, carrying Kiro's stop reason, credits, context
   usage and the model and effort its `config_option_update` reports.
2. **No interactive permissions.** Headless Kiro denies any tool call that
   would need approval, so the adapter declares `permissions: false`. `skip`
   passes `--trust-all-tools` and `whitelist` passes `--trust-tools=<ids>`.
3. **Sessions from the V3 store, deletion through the CLI.**
   `KiroNativeSessionService` enumerates `session.json` files under the store
   and reads `messages.jsonl` for transcripts and message counts, in the
   instance's runtime (host files natively; through the shell for WSL and
   Docker). `kiro-cli chat --list-sessions` was not usable for this: it covers
   only its current directory, and `--all-cwds` spans the V1/V2 stores alone on
   2.30.0. Deletion goes through `kiro-cli chat --delete-session`, which also
   maintains Kiro's session index. `sessions_dir` (`KIRO_SESSIONS_DIR`) names
   the store, defaulting to `~/.kiro/sessions`; `db_path` and `KIRO_DB_PATH`
   are gone.
4. **Store schema guard.** The transcript reader accepts `session.json`
   `schemaVersion` 1.x and fails loudly on anything else, because Kiro documents
   the layout as private.
5. **Ordinary logical session.** The `workspace_latest` ownership and the
   `latest_in_workspace` resume strategy existed only for Kiro and are removed
   from the session contract.
6. **Version drift.** Per ADR-035 the compatibility profile requires the
   `--agent-engine` and `--output-format` help tokens and never gates on an
   exact version. The first profile is `kiro-cli-chat-v3`.

## Consequences

### Positive

- Kiro streams tool calls, results, reasoning and credits like the richer
  providers, and its reported model comes from the run itself.
- Any Kiro session resumes by id, from any directory.
- No python, SQLite or V2 file parsing remains in the Kiro path.

### Negative

- A Cats permission prompt cannot reach a headless Kiro turn; `default` mode is
  "deny what needs approval" rather than "ask". ACP (`kiro-cli acp
  --agent-engine v3`) would provide real prompts and is the path if that
  becomes necessary.
- Session listing and transcripts depend on a store layout Kiro does not
  promise to keep. The schema guard turns a layout change into a visible
  failure rather than silent wrong data.

### Neutral

- `sessions_dir` replaces `db_path` in `providers.yaml` and
  `KIRO_SESSIONS_DIR` replaces `KIRO_DB_PATH`. This is a user-config contract
  change, so the next Runtime release is a `0.x` minor bump (0.5.0) under the
  release policy; the old keys are ignored, not migrated, because they named a
  file the runtime no longer reads.
- Kiro 2.30.0 is the first release the adapter was verified against. Older
  Kiro releases without V3 fall back to the best-fit profile and fail with
  Kiro's own error.

## Alternatives Considered

### Alternative 1: Kiro through the ACP agent backend

- **Pros**: real `session/request_permission` prompts, `session/list` and
  `session/load`, `_kiro/account/getUsage` for quota.
- **Cons**: Kiro would move from `cli/native` to `agent/acp`, which changes the
  provider target Platform, Desktop setup and the Usage app key on; V3 ACP
  rejects `--model` and `--effort` launch flags, so model and effort need a new
  `session/set_config_option` mapping.
- **Why rejected**: the headless path keeps every consumer unchanged and
  already carries the stream, model, effort and credits. ACP stays available
  as a configured `agent/acp` instance.

### Alternative 2: keep V1 or V2 as a fallback engine

- **Pros**: none once 3.0 ships.
- **Cons**: two parsers, two session stores and the V2 `--model` defect.
- **Why rejected**: the pre-release policy removes superseded paths in the same
  change, and the operator asked for no V2 baggage.

## References

- [Kiro V3 headless contract](../research/2026-10-13-kiro-v3-headless-contract.md)
- [Kiro 2.24's v2 engine ignores `--model`](../research/2026-09-28-kiro-v2-ignores-model.md)
- [ADR-035](035-never-block-provider-execution-on-exact-cli-version.md)
- Kiro: [What's new in V3](https://kiro.dev/docs/cli/v3/),
  [CLI V3 is rolling out as the default](https://kiro.dev/blog/cli-3/),
  [Headless mode](https://kiro.dev/docs/cli/headless/),
  [ACP migration](https://kiro.dev/docs/cli/v3/acp-migration/)

---

*Decision made: 2026-10-13*
*Decision makers: operator, Claude*
