# Claude Code Host Control Protocol — 2026-10-28

## Scope and provenance

This note records the evidence for adding Claude Code as the second provider of
[SPEC-039](../specs/SPEC-039-provider-session-capabilities-and-interactions.md).
It complements the [Codex investigation](2026-10-28-codex-host-capability-gaps.md).
It is not Chrome-operation or desktop-operation acceptance.

| Component | Inspected baseline |
| --- | --- |
| Runtime | `e043d5b2`, package 0.6.2; `ClaudeProvider` declares no interactions or session capabilities |
| Local Claude Code | 2.1.312, native Windows executable, subscription sign-in |
| Probe | A host script spoke `-p --input-format stream-json --output-format stream-json --verbose` directly in an empty scratch directory |

Turns used `--model haiku` and `--no-session-persistence`; each cost under one cent.
No probe went through Runtime or a Bot. The user's account details, paths, tokens
and form answers are not retained here.

## Control frames observed

The CLI accepts host requests on stdin as
`{"type":"control_request","request_id":"<id>","request":{"subtype":"<name>", ...}}`
and answers each one with
`{"type":"control_response","response":{"subtype":"success","request_id":"<id>","response":{...}}}`.
CLI-initiated requests use the same envelope in the other direction; the host
answers with a `control_response` carrying the CLI's `request_id`.

| Request | Direction | Observation |
| --- | --- | --- |
| `initialize` | host → CLI | Works before any user message. Reply includes `current_permission_mode`, commands, agents, models, account summary and `capabilities`. No `system/init` frame is emitted until the first user message |
| `mcp_status` | host → CLI | Works with or without `initialize` and mid-session without a model turn. Each server has `name`, `status`, `scope`, `source`, `serverInfo`, `config` and `tools` |
| `can_use_tool` | CLI → host | Fields: `tool_name`, `display_name`, `input`, `tool_use_id`, optional `description`, `permission_suggestions`, `mcp_server: {name, source}`, `requires_user_interaction`. Reply `{behavior: "allow", updatedInput}` or `{behavior: "deny", message}` |
| `elicitation` (form) | CLI → host | `mcp_server_name`, `message`, `mode: "form"`, `requested_schema`, `property_order`. Reply `{action: "accept", content}` reached the MCP server unchanged |
| `elicitation` (URL) | CLI → host | `mcp_server_name`, `message`, `mode: "url"`, `url`, `elicitation_id`. Reply `{action: "accept"}` reached the server |

`can_use_tool` is sent only when the CLI is launched with
`--permission-prompt-tool stdio`. With `--permission-prompts host` alone, a
`Write` that needed approval was denied immediately with a
`system/permission_denied` frame, and `AskUserQuestion` was absent from the tool
list. With the stdio prompt tool:

- `Write` produced `can_use_tool`; the allow reply created the file.
- `AskUserQuestion` produced `can_use_tool` with `requires_user_interaction: true`;
  the answer is `updatedInput.answers`, keyed by question text. The model
  continued with the chosen option.
- An MCP tool call produced `can_use_tool` with `mcp_server` and an `addRules`
  suggestion whose `destination` was `localSettings`. Forwarding that suggestion
  as `updatedPermissions` would write the user's project settings file.
- `echo` ran without a request; its result recorded `permission_decision.source:
  "config"`. Command approval therefore follows the same path but was not provoked.

## Existing defect: elicitation without a host

Launched as Runtime launches Claude today — no prompt tool, the MCP tool
pre-approved through `--allowedTools` — the CLI still sent a `control_request`
with subtype `elicitation`. Nobody answered: the tool waited with 30-second
heartbeats until the probe closed stdin, which the CLI reported to the server
as `cancel`. Runtime keeps stdin open for the life of the worker, so the turn
would wait until an outer timeout. The adapter must answer elicitation even
for sessions without an interaction host.

## Permission mode reporting

`initialize` reported these `current_permission_mode` values:

| Launch | Reported |
| --- | --- |
| no flag | `auto` (this account's configured default) |
| `--permission-mode manual` | `default` |
| `--permission-mode acceptEdits` / `auto` / `dontAsk` / `plan` | the same name |
| `--permission-mode bypassPermissions` or `--dangerously-skip-permissions` | `bypassPermissions` |

## Inventory and dependencies

Without `--strict-mcp-config`, a headless run loads the account's claude.ai
connectors. Seven were `pending` immediately after start and `connected` about
20 seconds later, exposing 73 tools, including mail send, file share/trash and
calendar delete operations. Runtime does not restrict this today; it is the
Claude counterpart of Codex `codex_apps`.

`--chrome` adds a `claude-in-chrome` server (22 tools, `connected`) in `-p` mode.
A turn invoked `list_connected_browsers` and received `[]` because no Chrome or
Edge process was running; the interactive Claude Code session on the same
machine returned the same `[]`. Server connection therefore does not prove a
browser connection. Runtime already accepts `--chrome` through instance
`launch.args`.

No `computer-use` server appeared. Anthropic documentation states that Claude
Code computer use is a macOS research preview for interactive sessions; on
Windows it is offered only through the Claude desktop application. The same
documentation states that Claude Code's sandbox runs on macOS, Linux and WSL2,
not native Windows. The [computer use gate note](2026-10-28-claude-computer-use-remote-devices-gate.md)
traces that desktop-app path and why a local launch cannot reach it.

## Design consequences

- Interaction hosting needs `--permission-prompt-tool stdio`, an adapter mapping
  of `can_use_tool` / `elicitation`, and an answer for every CLI request,
  including hostless elicitation.
- Most Claude tool approvals, including every Chrome tool, are neither commands
  nor file changes. A distinct `tool_approval` kind is needed; otherwise a host
  that requires approval would have to deny them.
- `permission_suggestions` must never be forwarded with a persistent destination,
  and `setMode` suggestions would change the verified policy mid-session.
- Without a native-Windows sandbox, Claude cannot enforce a read-only,
  workspace-write or offline ceiling. Only the full-access/network ceiling can be
  admitted; narrower policies must be rejected rather than reported as parity.
- `mcp_status` gives turn-free MCP inventory; `system/init.tools` lists built-in
  tools after the first message. Correlation uses `request_id`, not JSON-RPC `id`.

## Runtime and Bot acceptance, 2026-10-28

After PLAN-050 P1/P2 merged, Runtime `e38e56bf` was packed and pinned by the
standalone Bot. A fresh test Bot with an isolated data root ran Claude Code
2.1.312 (haiku) in a scratch directory, with the owner's normal sign-in, an
explicit full-access/network/on-request policy and Claude in Chrome enabled.
The whole run took 23 seconds.

| Turn | Request the owner received | Answer | Outcome |
| --- | --- | --- | --- |
| Ask a color | `user_input`, one field | Blue | Reply `Blue` |
| Write `probe.txt` | `file_approval`: path and size only | Allow once | File written |
| Bot's `schedule_list` MCP tool | `tool_approval`, server `cats-bot`, input `{}` | Allow once | Tool ran |
| `echo … > declined.txt` | `command_approval` with the command | Decline | `NOT ALLOWED`; no file |

The capability snapshot reported the policy `verified` (mode `default`, reviewer
`user`), `cats-bot` as session-injected, `claude-in-chrome` (22 tools) and seven
claude.ai connectors as provider-configured, 34 built-in tools, browser `unknown`
and computer use `unavailable`. Saving a workspace-write policy was refused.

Not exercised for real: a browser action through Claude in Chrome (no browser was
running) and MCP form/URL elicitation (scripted and direct-CLI evidence only).

## Official sources consulted on 2026-10-28

- [Headless mode](https://code.claude.com/docs/en/headless.md) and
  [CLI reference](https://code.claude.com/docs/en/cli-reference.md): permission
  prompts, `--permission-prompts`, `--permission-prompt-tool`.
- [Agent SDK user input](https://code.claude.com/docs/en/agent-sdk/user-input.md):
  `AskUserQuestion` answers.
- [MCP](https://code.claude.com/docs/en/mcp.md): declared elicitation modes.
- [Chrome](https://code.claude.com/docs/en/chrome.md),
  [computer use](https://code.claude.com/docs/en/computer-use.md) and
  [sandboxing](https://code.claude.com/docs/en/sandboxing.md): platform limits.

*Created / last updated: 2026-10-28*
