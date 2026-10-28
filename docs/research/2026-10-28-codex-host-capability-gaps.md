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

## Runtime implementation observation, 2026-10-28

The candidate Runtime adapter was exercised against the same installed Codex
0.164.0 executable through `WorkerProcess`, using an empty dedicated workspace
and an ephemeral thread. No `turn/start` or tool invocation was allowed by the
probe. Both runs ended their own app-server/code-mode host processes.

- Provider inheritance with an explicitly unrestricted admission ceiling observed
  read-only, network disabled, `on-request`, reviewer `auto_review`.
- Explicit workspace-write/offline/`on-request` observed workspace-write,
  network disabled and reviewer `user`, with canonical cwd verification.
- Both runs discovered `codex_apps` (279 tools, connected, bearer auth), `cua_repl`
  (3 tools, connected, auth mechanism unsupported), `node_repl` (4 tools, connected,
  auth mechanism unsupported), and disabled `codex_app` (0 tools).
- Configuration provenance categories were `user` and `system`. Raw configuration,
  endpoints, credentials, tool schemas and errors were excluded from probe output.

This validates native policy mapping and same-worker catalog reads only. It is not
evidence of Chrome navigation, desktop actions, either product's integration, or
packaged/macOS/Linux acceptance. The inherited auto-reviewer cannot be used to
enforce a restrictive host ceiling; admission now rejects that combination.

## Actual Terminal and Bot tool calls, 2026-10-28

The normal Windows user environment and installed Codex 0.164.0 were used with
the same dedicated cwd and explicit workspace-write/offline/on-request policy,
reviewer `user`. Terminal used `codex exec --ephemeral`; standalone Bot used its
real core and the exact Runtime `b75da37b` packed artifact. The Bot additionally
injected its own four-tool MCP server. Neither run modified an existing browser
tab or another application's data.

Both runs actually invoked `mcp__cua_repl.js` to create a single Chrome tab at an
example.com test URL. Both received `Browser is not available: chrome`, before
any tab was created. For the owned WinForms window titled `Cats Native Acceptance`,
Terminal's computer-use `@oai/sky` listing through `mcp__node_repl__js` and Bot's
native window listing through `mcp__cua_repl.js` both failed because the native
pipe was unavailable (OS error 2). No verification button was clicked.

Bot's same-worker observation verified the requested policy and found the same
279/3/4 configured tool counts above, plus its injected Bot tools. This establishes
that those calls passed through Cats to the native tools. It does **not** establish
successful Chrome/desktop operation: the upstream helper is unavailable even in
Terminal. Helper installation/reconfiguration and macOS/Linux remain unverified.

Platform's first matched native probe exposed a separate Runtime discovery race
before tool invocation. Only the dedicated test cwd was used. The regression fix
retains the release-content gate, waits for Codex's exact thread ID and preserves
native transcripts on failed admission; it does not infer identity from cwd.
The fixed native Platform comparison is recorded separately after completion.

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
