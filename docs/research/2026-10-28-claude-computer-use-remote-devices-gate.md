# Claude Code Computer Use Gate on Windows — 2026-10-28

## Scope and provenance

This note explains why a terminal or Runtime-launched Claude Code session on
native Windows has no computer-use tools, while a conversation served through the
Claude desktop app on the same machine can use them. It refines the computer-use
paragraph of the [Claude host control note](2026-10-28-claude-host-control-protocol.md),
which says Windows offers computer use only through the desktop application, by
tracing what that path is. It is not computer-use acceptance: no click or
keystroke was sent.

| Component | Inspected baseline |
| --- | --- |
| Local Claude Code | 2.1.312, native Windows executable `~/.local/bin/claude.exe`, interactive terminal session |
| Claude desktop app | 3.6556.2.0, MSIX package, Computer use switched on in its settings and running during the checks |
| Method | Byte-string search of the CLI executable and the app's `resources/app.asar`; the asar header was parsed to map hits to packed files; nothing from either was executed |

The evidence falls into three classes, kept apart below:

- **Binary reads (first-hand).** Strings and minified code. Function names are
  minified, so where a call site is matched to a definition, the match is
  inferred from behavior and says so.
- **This terminal session (first-hand).** Tool-search results in a Claude Code
  2.1.312 terminal session on the same machine.
- **Relayed transcript (second-hand).** The operator's copy of a summary from a
  separate conversation, served through the desktop app, that did reach computer
  use. It was not reproduced here.

No account identifiers, tokens or session ids are retained.

## The terminal session had no computer-use tool

- Keyword searches for `computer`, `request_access`, `screenshot`, `list_apps`,
  `enable` and `remote-devices` returned only Claude in Chrome tools. Its
  `computer` tool operates Chrome tabs, not the desktop.
- An exact-name lookup of `enable__mcp__remote-devices__computer`,
  `mcp__remote-devices__computer_screenshot`,
  `mcp__remote-devices__computer_resolve_access`,
  `mcp__computer-use__request_access` and `mcp__computer-use__screenshot`
  matched nothing.

A running desktop app with Computer use on therefore does not, by itself, give a
terminal Claude Code session any computer-use tool.

## Where `enable__mcp__remote-devices__computer` lives

`enable__` occurs 0 times anywhere in the desktop app's install directory and 3
times in the Claude Code executable. In Claude Code it is one of four deferred,
read-only tools exported together as `ENABLE_STUB_TOOLS`:

- `enable__mcp__claude-in-chrome`
- `enable__mcp__remote-devices__Claude_Browser`
- `enable__mcp__remote-devices__computer`
- `request_computer`

### What the stub does when called

It connects nothing itself. It checks whether the session already has a tool or
MCP client whose name starts with `mcp__remote-devices__`:

- **None.** It returns text telling the model that the chat is not linked to a
  computer and that no tool here can link one.
- **Some.** It returns text telling the model to load the
  `mcp__remote-devices__computer_` tools through tool search ("there is no
  separate enable step"). If the session is in an active relay state that is not
  marked as carrying automation tools, the call also ends that relay with reason
  `device_tool_requested`, logged as `cli_teleport_relay_ended`.

The relayed transcript fits the second branch. The call returned "NOT RUN", and
the session was then told that `mcp__remote-devices__computer_*` tools had been
added. That is consistent with the relay ending and the serving side attaching
the bridge tools on the next turn; it is not a reproduction.

### When the stub is listed

The stub's `isEnabled()` is
`Vle() !== null || (ZW() && HS() && Rn("tengu_merry_tide", false) === true)`.
Definitions with those minified names elsewhere in the binary test:

- **Remote session.** `CCR_SESSION_PROFILE` is set, `SESSION_INGRESS_URL` is an
  https origin, `CLAUDE_CODE_REMOTE_SESSION_ID` matches `cse_…`, and
  authentication is first-party.
- **Chat-originated cowork launch.** A diskless launch whose derived surface is
  `remote_cowork`, with `CLAUDE_CODE_SESSION_ORIGIN=claude_ai_chat`, behind the
  `tengu_merry_tide` feature flag.

Minified names are per chunk, and the stub chunk's import list was not traced,
so this binding is inferred from behavior and from the stub's own text. A local
terminal launch meets neither branch, which matches the empty tool search above.

Because the stub exists only in Claude Code, whatever served the relayed
conversation was running Claude Code under one of these two conditions, and the
desktop app was the computer it linked to. This note does not identify the
product surface beyond that.

## What the desktop app holds

- `.vite/build/index.chunk-D3Vgsaog.js` in `app.asar` handles computer-use calls
  that arrive over an internal MCP server named `remote-devices`. It records
  `session_type: "cowork-remote"` and refuses a call without a server-asserted
  session id ("Computer-use tools require a server-asserted session id, which
  the remote-devices bridge did not supply"). Sibling chunks apply the same rule
  to `device_bash` and the browser pane, and one states that the id is injected
  server-side by CCR's mcpproxy.
- `.vite/build/index.chunk-CIsKxfLj.js` defines the bridge constants
  (`computer_`, `computer_request_access`, `computer_resolve_access`) and a
  tool-name filter that treats `mcp__remote-devices__computer_` separately.
- `computer-use` appears 96 times in the archive. Part of that is the app's own
  computer-use surface for sessions running inside the app (the
  `mcp__computer-use__*` naming), which this note did not separate from the
  bridge. The relayed conversation used `mcp__remote-devices__computer_*` names,
  that is, the bridge.

The traced path is: a remote Claude Code session, then the serving side's MCP
proxy, which injects the session id, then the `remote-devices` bridge in the
desktop app on the user's computer.

## Relayed transcript observations

As reported from the other conversation, on Windows with a zh-TW display
language:

- `computer_list_granted_applications` returned an empty list. It was the first
  call that succeeded.
- `computer_resolve_access` did not find `Notepad` and suggested the localized
  `記事本`; `File Explorer` returned nothing. Application names follow the OS
  display language.
- The resolve response gave a `full` tier and listed 11 applications to hide
  while Claude holds the screen, including Chrome, PowerShell and the terminal.
  `computer_request_access` raised the approval dialog on the computer.
- `computer_open_application` reported `Opened`, but no Notepad window appeared
  in the following screenshots, and the cause was not found. No click or
  keystroke was sent before `computer_release_lock` returned control.

## Consequences for Runtime

- Runtime launches Claude Code as a local process, outside both gate branches by
  construction. Reporting computer use as `unavailable` in the session-capability
  snapshot ([SPEC-039](../specs/SPEC-039-provider-session-capabilities-and-interactions.md),
  [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md))
  is correct, not a missing flag or launch argument.
- There is no counterpart to `--chrome`. Claude in Chrome is a local MCP server
  that Runtime can enable through launch arguments; computer use on Windows
  reaches the desktop only through the serving side's proxy and the desktop
  app's bridge.
- Forcing the stub into the tool list would not help: it returns text only, and
  the bridge refuses calls without a server-injected session id.
- Do not set `CCR_SESSION_PROFILE`, `SESSION_INGRESS_URL` or a `cse_` session id
  to flip the gate. It would surface a stub that returns text and would present a
  local process as a first-party remote session.
- Desktop operation from a Runtime- or Bot-hosted session needs a separate,
  locally owned tool; it is not a Claude Code capability to negotiate.

## Re-checking on a new version

Chunk hashes and byte offsets change with every build, so search by string:

- In the CLI executable, find `enable__mcp__remote-devices__computer` and read
  the `isEnabled` of the module that exports `ENABLE_STUB_TOOLS`.
- In the app's install tree, confirm `enable__` is still absent and find
  `server-asserted session id`.
- In a terminal session, look up the exact tool names listed above.

*Created / last updated: 2026-10-28*
