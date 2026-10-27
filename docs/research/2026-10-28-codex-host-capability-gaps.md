# Codex Host Capability Gaps — 2026-10-28

## Scope and provenance

This note preserves the investigation that motivated [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md).
It separates source facts, an earlier read-only discovery probe, upstream
documentation and proposed work. It is not computer-use or Chrome acceptance.

| Component | Inspected baseline |
| --- | --- |
| Runtime | `7e92601a`, package 0.6.2; relevant behavior also checked in Bots' installed 0.6.1 dependency |
| Bots | `7951c28`, exact Runtime dependency 0.6.1 |
| Platform | `595e9ca2`; shared runtime client, permission mapping, approvals and plugin settings |
| Local Codex | `codex-cli 0.164.0`; executable selected through Runtime's native Windows resolver |

The native probe below occurred earlier in this investigation and was not repeated
for this documentation-only change. No raw credentials, environment values or
personal paths are retained here. Counts describe that observation, not a product
contract or a claim about every account.

## Local source findings

| Finding | Evidence / implication |
| --- | --- |
| Codex uses app-server | `src/backends/cli/providers/codex.ts` builds `app-server` invocation; spawning is not by itself a reduced-tool mode |
| User configuration can remain visible | Runtime's process environment and per-server overlays do not inherently replace global Codex configuration |
| Permissions are overridden | Adapter requests `never` for both legacy default/skip, and workspace-write for writable workspaces |
| Native interactions are not hosted | User-input gets empty answers; MCP elicitation gets decline; approval decisions follow adapter policy |
| `allowedTools` has bounded coverage | It participates in specific approvals and explicit read-tool bridging; it is not discovery or a universal native/MCP firewall |
| Injection is narrower than user config | SPEC-035 accepts bounded HTTP loopback descriptors; that restriction does not describe every server a provider can load itself |
| Bot owns additional context | Its cwd, instructions, bot MCP and permissions differ from an arbitrary terminal session; project skills/trust can differ too |
| Platform also needs integration | Existing task/supervision approvals do not answer native provider request IDs; managed-plugin inventory does not describe all live Codex tools |
| Platform permission wording is ambiguous | Its full draft mode maps to read_write + skip; the inspected Codex adapter still requests workspace-write |

Runtime's Windows code-mode companion and an upstream desktop computer-use helper
have different ownership and purposes. Successful code-mode startup cannot establish
browser/computer availability.

## Earlier discovery observation

The probe used the selected native CLI, Bot workspace context and the Runtime client
identity. It sent initialize, initialized, config/read and mcpServerStatus/list;
it did not create a thread, send a model turn or invoke a browser/computer tool.

The normal-user environment returned the expected global configuration and these
server summaries:

| Server | Tool count | Auth observation |
| --- | --- | --- |
| `codex_app` | 0, disabled | unsupported |
| `codex_apps` | 279 | bearerToken |
| `cua_repl` | 3 | unsupported |
| `node_repl` | 4 | unsupported |

`unsupported` here is the server's auth-mechanism field, not a tool execution
failure. An earlier probe inside the agent's restricted shell environment saw an
empty/default configuration; that result was not used to characterize the actual
normal-user launch. The successful probe stopped its owned app-server afterward.

This establishes discoverability for that launch. It does not establish identical
terminal/host inventories, live tool execution, approval forwarding, nested tool
coverage or helper availability after the upstream desktop application exits.

## Official sources consulted on 2026-10-28

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): structured
  server requests, permission/user-input handling, MCP form/URL elicitations,
  resolution notifications and paginated server/tool discovery. Host support and
  capability negotiation are necessary; executable fixtures must confirm variants.
- [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): provider
  configuration and authentication support are distinct from Cats' injection API.
- [Plugins](https://learn.chatgpt.com/docs/plugins): plugins can supply skills,
  MCP servers and browser extensions; Desktop-only plugins require the upstream
  desktop application. Account and surface availability can differ.

## Design inference and next evidence

The observed gap is partly Runtime's interaction/policy translation and partly the
host's presentation/dependency integration. App-server is a suitable structured
execution mode; changing process creation alone would not close those gaps.

Before claiming parity, match executable/account/configuration/cwd/trust/policy and
helper environment, then test a real request/reply and separate controlled Chrome
and desktop actions through each host. The proposed work is Runtime SPEC-039 /
PLAN-049, Platform SPEC-132 / PLAN-124 and Bots SPEC-004 / PLAN-004.

*Created / last updated: 2026-10-28*
