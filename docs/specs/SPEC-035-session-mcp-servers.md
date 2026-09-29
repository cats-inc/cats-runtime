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

## Acceptance

- Create with descriptors on a provider without support returns 201 with
  `unsupported`. No token appears in `sessions.json`, `GET /sessions`,
  `GET /sessions/:id`, the response, logs or spawn arguments.
- Invalid inputs return 400 without echoing the token. A non-native instance
  reports `unsupported`.
- Claude and Codex (R2/R3): a live isolated smoke lists the tools of a stub
  loopback server, calls one and receives its result.

*Created: 2026-09-29*
