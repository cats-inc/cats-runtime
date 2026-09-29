# SPEC-035: Session MCP servers

Status: Draft (2026-09-29). Decision: [ADR-044](../decisions/044-configure-session-mcp-servers-for-provider-clis.md).
Delivery: [PLAN-046](../plans/PLAN-046-session-mcp-servers.md). First consumer: Platform
[SPEC-123](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-123-code-agent-artifact-preview.md).

## Request field

`mcpServers` is optional on `POST /sessions`, `POST /sessions/:id/resume` and
`POST /sessions/:id/messages`.

- **Omitted:** keep the session's current set.
- **`[]`:** clear the set.
- **Otherwise:** replace the set.

```ts
interface SessionMcpServer {
  name: string;          // /^[a-z][a-z0-9-]{0,31}$/, unique; host `cats`, Apps `app-<slug>`,
                         // plugins a slug derived from the plugin ID
  transport: 'http';     // Streamable HTTP; 'stdio' is reserved and rejected
  url: string;           // http(s), host 127.0.0.1 / [::1] / localhost; no userinfo or fragment
  auth: { kind: 'bearer_env'; token: string } | { kind: 'none' };
}
```

| ID | Requirement |
| --- | --- |
| SMCP-01 | At most 8 entries. Unknown keys, reserved kinds (`stdio`, `oauth_ref`) and invalid values return 400. Error text never contains a token. |
| SMCP-02 | A `bearer_env` token is 1–4096 visible ASCII characters with no whitespace. Runtime exposes it to the child only as `CATS_MCP_<NAME>_TOKEN`, where hyphens in the name become underscores. |
| SMCP-03 | Descriptors live only in an in-memory map keyed by session ID. They never appear on `SessionInfo`, `sessions.json`, session reads, logs, argv or `ProviderSpawnOptions` secrets. Adapters receive `{ name, transport, url, bearerTokenEnvVar? }` without the token. |
| SMCP-04 | Descriptors survive worker kill/close and are removed when the session is removed. A fork starts with none. After a Runtime restart the host must supply them again on resume or create. |
| SMCP-05 | A set is used only when the CLI instance runs in `native` mode and the adapter declares `capabilities.sessionMcpServers`. Otherwise the worker launches without MCP and the report is `unsupported`. Non-CLI backends and peer-routed turns report `unsupported`. |
| SMCP-06 | The report is `{ status: 'delivered' \| 'unsupported' \| 'failed', servers: { name, connection: 'connected' \| 'failed' \| 'unknown' }[] }` and is omitted when the set is empty. `delivered` means the live worker was launched with the current set. `failed` means a supporting worker is not running the current set. |
| SMCP-07 | Create and resume JSON responses include `mcpServers` (the report). A send stream starts with `progress` `metadata.kind: 'mcp_servers'` carrying the same report as `metadata.mcpServers`, emitted before any guardrail warning. |
| SMCP-08 | For a supporting adapter, a send that changes a live worker's set recycles the worker through resume at the turn boundary. This is PLAN-046 R2. |
| SMCP-09 | The Runtime `/mcp` facade does not accept the field in v1. ACP client `mcpServers` is unrelated. |

## Provider reads (PLAN-046 R4)

`GET /providers/config`, `GET /providers/:provider/tools`, `GET /diagnostics/providers`
and session `providerTarget` reads report `continuity.sessionMcpServers` for each
target. It applies the SMCP-05 gate: `true` only when a CLI adapter declares
support and the instance runs in `native` mode, otherwise `false`. It tells a host
whether to send the field; delivery is still read from the SMCP-06 report, which
also covers peer-routed turns.

## Adapter mappings (PLAN-046 R2/R3)

- **Claude Code (implemented in R2):** inline `--mcp-config` JSON with
  `type: 'http'`, the URL and `Authorization: Bearer ${CATS_MCP_<NAME>_TOKEN}`.
  Claude Code expands the variable from its own environment, which was verified
  on 2.1.284. `mcp__<name>` is appended to `--allowedTools` in `default` and
  `whitelist` modes. `system:init.mcp_servers` supplies the `connection`
  evidence, starting with the first turn's init.
- **Codex (implemented in R3):** `-c mcp_servers.<name>.url="…"`,
  `-c mcp_servers.<name>.bearer_token_env_var="CATS_MCP_<NAME>_TOKEN"` and
  `-c mcp_servers.<name>.default_tools_approval_mode="approve"` after `app-server`.
  The last setting approves that server's tools only; elicitations stay declined.
  `mcpServer/startupStatus/updated` supplies the `connection` evidence.
- **GitHub Copilot CLI (implemented in F3):** inline
  `--additional-mcp-config` JSON with `type: 'http'`, the URL,
  `Authorization: Bearer ${CATS_MCP_<NAME>_TOKEN}` and `tools: ['*']`. The flag
  adds the servers to that run only, on top of the user's own MCP config.
  Copilot expands the variable from its own environment, which was verified on
  1.0.89. The adapter already passes `--allow-all-tools` (or `--yolo` in `skip`
  mode) on every run, which covers the servers' tools. Each turn is a new
  process, and every process receives the set. `session.mcp_server_status_changed`
  and `session.mcp_servers_loaded` supply the `connection` evidence:
  `connected` maps to `connected`, `needs-auth` and `failed` to `failed`, and
  `pending` to `unknown`. Do not add `--secret-env-vars` for the token
  variable: on 1.0.89 it also strips the variable from header expansion, and
  the server then receives the literal placeholder.

## Provider matrix (PLAN-046 F3)

Surveyed on 2026-09-30 (Windows). A provider qualifies only when one CLI
invocation can take an MCP server definition without writing to the user's
workspace or global config, and the bearer can come from an environment
variable. The survey used the installed CLI's help, a loopback stub server
(`scripts/testing/session-mcp-stub-server.mjs`) and the official docs. Cursor,
Junie and Muse are not installed here, so their rows rest on docs only.

| Provider | Decision | Evidence |
| --- | --- | --- |
| Claude Code | Supported (R2) | See the mappings above. |
| Codex | Supported (R3) | See the mappings above. |
| GitHub Copilot CLI 1.0.89 | Supported (F3) | `--additional-mcp-config <json>` augments `~/.copilot/mcp-config.json` for one session. The stub received the expanded bearer, and neither the token nor the variable name appeared under `~/.copilot`. |
| Antigravity (`agy`) 1.2.12 | Unsupported | No MCP flag or environment variable in print mode. `agy mcp add` writes user config. `ANTIGRAVITY_APP_DATA_DIR` would relocate all app data, including sign-in. |
| Auggie 0.36.0 | Unsupported | `--mcp-config` takes inline JSON, but headers are sent literally. The stub received the unexpanded `${VAR}` and `${env:VAR}` forms. The [docs](https://docs.augmentcode.com/cli/integrations) expand only `${workspaceFolder}`. The token would have to go into argv or a file. |
| Cline 3.0.65 | Unsupported | No per-run MCP flag. MCP servers come from `cline_mcp_settings.json` under the data dir. `--config` and `--data-dir` would relocate the whole config or state directory, including `providers.json` (sign-in) and sessions. |
| Cursor CLI | Unsupported (unverified, not installed) | The [docs](https://cursor.com/docs/cli/mcp) load MCP only from `.cursor/mcp.json` (project) and `~/.cursor/mcp.json`. They document `${env:NAME}` in headers, but no per-run config for `-p`. `--plugin-dir` is not documented to carry MCP servers in print mode. |
| Devin 3000.11.3 | Unsupported | The CLI adapter does not execute (`--print` has no machine-readable output). Devin runs through ACP on the agent backend, where SPEC-035 reports `unsupported`. |
| Goose 1.52.0 | Unsupported | `--with-streamable-http-extension` takes a URL and timeout only. Its parser sets empty headers. Headers with variable substitution exist only in config and recipe extensions. A recipe replaces the user's extension profile, and a resumed run, which the adapter uses for every later turn, restores the session's saved extensions instead. |
| Grok 1.0.41 | Unsupported for now | `-p` has no MCP flag. `GROK_CONFIG` overlays cannot set `mcp_servers`, and `GROK_HOME` relocates sign-in and sessions. `--agent <file>` frontmatter `mcpServers` accepts `bearer_token_env_var`, and the stub received the bearer. However, `--agent` replaces the model-bound primary agent (`grok-4.7` requires `grok-build-plan`), which changed the system prompt and tool definitions in debug snapshots. Header `${VAR}` expansion does not apply to agent frontmatter. |
| JetBrains Junie | Unsupported (unverified, not installed) | `--mcp-location <dir>` and `JUNIE_MCP_LOCATIONS` add servers per run ([docs](https://junie.jetbrains.com/docs/parameters.html)). `mcp.json` has no environment interpolation ([JUNIE-2173](https://youtrack.jetbrains.com/issue/JUNIE-2173), open), so the token would have to be in the file. |
| Kilo 7.8.1 and OpenCode 1.18.33 | Unsupported | The adapters drive one shared `serve` process on a fixed port, which may also be a server the user started. The CLI accepts `OPENCODE_CONFIG_CONTENT` with `{env:VAR}` ([docs](https://opencode.ai/docs/config/)), but only per process. Dynamic `POST /mcp` affects the whole server, so a session's grant would reach other sessions. |
| Kiro 2.24.1 | Unsupported | `chat` has no MCP flag. The adapter pins `--agent-engine v1` so that `--model` applies. Under v1, `--agent` with the undocumented `KIRO_AGENT_CONFIG_DIR` reported "no agent found". Under the default v2 engine the same route loaded a temp agent and expanded both `${VAR}` and `${env:VAR}`. That route would give up model selection and replace the default agent. |
| Meta Muse | Unsupported (unverified, not installed) | The [docs](https://dev.meta.ai/docs/muse-code/configuration) load MCP only from `~/.config/muse/settings.json` or a trusted project `.mcp.json`. `muse exec` has no config flag. |
| Pi 0.87.1 | Unsupported | Pi has no MCP client. Its docs and help do not mention MCP. Support would need a Runtime-supplied pi extension that implements an MCP client. |

## Acceptance

- Create with descriptors on a provider without support returns 201 with
  `unsupported`. No token appears in `sessions.json`, `GET /sessions`,
  `GET /sessions/:id`, the response, logs or spawn arguments.
- Invalid inputs return 400 without echoing the token. A non-native instance
  reports `unsupported`.
- Claude and Codex (R2/R3): a live isolated smoke lists the tools of a stub
  loopback server, calls one and receives its result.
- Copilot (F3): a live isolated smoke connects with the expanded bearer and
  lists the tools. The first turn reports `delivered`, and the second reports
  `connection: connected`. `tools/call` was not exercised: the account's
  Copilot quota rejected every model call (HTTP 402).

*Created: 2026-09-29*
