# Native workspace activity evidence

Captured on Windows on 2026-10-20 with native Claude Code 2.1.304, served model
`claude-fable-5-1`. This validates one native provider/mode/OS, not all CLI
providers, guest environments, ACP agents or nested native agents.

Two separate nonpersistent conversations ran with the same non-Git temporary
parent cwd. The parent contained a fourth-level source repo and its linked
worktree in `checkouts/review`. The fixtures did not use real Cats checkouts or
the user's Platform/Runtime profile. Git preparation was performed by the host.

Both native processes used `--output-format stream-json --verbose
--include-partial-messages --no-session-persistence --safe-mode
--strict-mcp-config --tools Read,Write,Edit --allowedTools Read,Write,Edit
--permission-prompts none --model fable --max-budget-usd 1`, with bounded
turn counts (4 and 6), a 120-second process deadline and auto-update disabled.
No skip-permissions flag, credential extraction or MCP tool was used.

| Conversation | Observed native action | Verified result |
| --- | --- | --- |
| Author | Read the fourth-level repo's `input.txt` | Successful native tool result |
| Author | Write `checkouts/review/output.txt` | File contained `NATIVE_WORKSPACE_OK` |
| Reviewer | Read that existing worktree file | Successful native tool result |
| Reviewer | Edit its contents | File contained `REVIEWED_NATIVE` |
| Reviewer | Read a nonexistent file in the source repo | Native `is_error: true`; file remained absent |

The second process streamed through the current `ClaudeProvider` and
`RuntimeSessionManager` during live execution. Its final snapshot had two
distinct checkout identities sharing one repository identity, read/write
successes on the unmanaged worktree, a failed read on the source repo, no
running operations, unchanged cwd and partial `native_tools_partial` coverage.
This is Runtime native acceptance; Platform attribution and renderer acceptance
remain pending under PLAN-120.

Relevant source frames are retained as redacted excerpts:

- [Author Read/Write](../../tests/fixtures/provider-captures/claude-2.1.304/workspace-read-write.redacted.ndjson)
- [Reviewer Read/Edit/failure](../../tests/fixtures/provider-captures/claude-2.1.304/workspace-review-failure.redacted.ndjson)
- [Live Runtime snapshot](../../tests/fixtures/provider-captures/claude-2.1.304/workspace-runtime-snapshot.redacted.json)

Excerpts retain tool-use/tool-result message envelopes, direct-call markers and
terminal outcome fields. Unrelated reasoning/text/usage/init frames and unused
envelope fields are omitted. Temporary roots and tool IDs are replaced with
stable placeholders; tool inputs, success/error markers and relative suffixes
retain the captured structure. Replay reconstructs isolated physical repos and
host-native absolute paths. These are captured excerpts, not fabricated whole
conversation streams.

The live snapshot additionally redacts machine, session, repository, checkout
and operation identities while preserving grouping and operation outcomes. It
is a consumer fixture, not a persisted session profile or authorization input.

## Admission and limits

Only complete direct assistant `tool_use` blocks with `caller.type: direct`, no
parent tool ID and a Read/Write/Edit `file_path` provide targets. The selected
CLI instance must be configured for native execution. Paths must be absolute
for the host OS; relative, drive-relative and foreign-OS paths do not inherit
startup cwd. Existing containment and alias checks still admit each target.

Direct user `tool_result` blocks correlate by bounded string tool ID. Missing
`is_error` on a structurally valid result means success in these captures;
`true` means failure. Malformed outcome payloads stay unknown. Nested and
unverified results cannot close direct operations. Runtime generates its own
operation and execution identities. Commands, arguments, file contents, result
prose and credential-shaped extra fields are absent from activity snapshots.

Correlation/tombstones are bounded to 1024 IDs per execution, with at most 32
queued observations and four unresolved identity probes per Runtime manager.
Native identity admission has a five-second deadline: cold Windows metadata
probes measured approximately 472 ms for the deep original checkout and
2987 ms for its worktree. Initial 500 ms and 1500 ms replay attempts truthfully
degraded coverage on timeout. The final deadline preserves the existing path
policy rather than bypassing validation. API/local tool budgets remain 500 ms
per target / 1500 ms per tool. Timeouts never admit late observations, and
cancel/replacement immediately invalidate the old observer's authority.

Read/Write/Edit support does not imply shell, Git or test inference. Generic
shell strings, nested callers, unverified providers, ACP targets, WSL/Docker and
unmapped peers remain unobserved/partial or unsupported. No version allowlist
gates execution; an unfamiliar event shape loses observation coverage while the
provider continues its existing execution path.

*Last updated: 2026-10-20*
