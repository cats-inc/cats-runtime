# Native provider host protocols — 2026-11-02

Implementation evidence for SPEC-040 / PLAN-051. Tests used disposable homes,
workspaces, an HTTP MCP fixture and fake/echo model configuration. They did not
read real credentials or send prompts to an owner's Bot conversation.

## Muse

Installed Muse 1.4.14-R7309.1 exported stable and experimental MSP JSON schemas.
`muse serve --provider echo` supports the stable `sessionMcp` capability and
experimental permission-profile observation. Initialize requires an `initialized`
notification before subsequent requests. Mutation command IDs are UUIDv7 and
are distinct from JSON-RPC request IDs.

The actual Runtime WorkerProcess initialized without a model prompt, started one
echo turn, terminated, resumed the exact native session and completed one further
turn without replayed text. Both starts authenticated the fixture's MCP
initialize/tools-list requests. Scanning the disposable native home found no
fixture bearer token. Echo cannot demonstrate model-selected file/shell actions;
those remain protocol fixtures rather than a paid-model acceptance claim.

`approval/request` gets a receipt `{}`; `approval/decide` carries the immutable
current requirement identity and selected offered choice. `approval/updated`
supersedes an older requirement. Decision acknowledgement is not resolution.
Persistent rule amendments are excluded. Network host/port/protocol and file
read/write scope must be visible on approval cards. User-input free text is
bounded to 500 characters; multiple choices enforce native count bounds.

The permission catalog reports `:read-only`, `:ask-me`, `:auto-review` and
`:unrestricted`. The default isolated profile was `:auto-review`, not a human
reviewer. `:ask-me` reports a sandboxed baseline but can request escape; it is
not proof of a hard workspace ceiling. Its network picker value `off` corresponds
to native `proxy_only`, not a network-denial promise. `--sandbox-network` accepts
`restricted`, `enabled`, `proxy-only`; `unrestricted` is not a valid value.

Experimental `mcpServer/list` provides configured names/auth metadata, enough to
reject injected-name collisions before opening a session. It does not expose
tool discovery or successful invocation, so the Runtime tool inventory remains
explicitly unobserved for MSP.

## Grok

Installed Grok 1.0.70 (`f50904eaee6c`) initializes ACP v1 using
`grok agent --no-leader stdio`. It reports HTTP/SSE MCP, load/resume and
`_meta.x.ai/mcp/sdk`. Configured server names appear in initialize metadata.
File/terminal client capabilities are not advertised: Grok owns its native IO.

Grok initializes session MCP asynchronously. An immediate call can see a server
still initializing; the adapter exposes that state instead of treating delivered
configuration as discovery. The wire methods are `_x.ai/mcp/list` and
`_x.ai/mcp/call` (leading underscore), with an extension `{result: ...}` envelope.
The real Runtime worker discovered the fixture tool and called it successfully,
then terminated and cold-resumed the same native session and called it again.
Both calls reached the fixture with the intended bearer credential. No fixture
credential was found in the disposable home. No model prompt was required for those MCP checks.

A separate isolated fake Responses API probe exercised actual model-turn transport
without an external model request. New and cold-resumed sessions emitted text,
then `_x.ai/session/prompt_complete`, then the prompt RPC `end_turn` response
(12 ms / 6 ms later). Runtime emitted exactly one result; a fake API error also
ended the turn. No notification-only busy hang was reproduced, so the RPC remains
the terminal authority.

That probe found a real control bug: starting with low effort and cold-resuming
with `--reasoning-effort xhigh` retained low effort in both `configOptions` and
the outgoing API request. `session/set_config_option` with `configId:
reasoning_effort`, `value: xhigh` corrected it; its result confirmed `currentValue:
xhigh`, and the main API request used xhigh. The adapter sets and reads back that
option before admitting a prompt whenever the observed value does not match.

Upstream typed protocols define native questions and implementation-plan review.
They are mapped to owner interactions, not silently accepted. ACP `allow_always`
can persist a rule, so only `allow_once` is offered. Unknown host methods fail
explicitly; unsupported filesystem/terminal delegation is not advertised.

The sandbox documentation distinguishes child-process networking from native web
tools and differs by OS. Session metadata permission overrides lack sufficient
effective-mode readback for the existing explicit-policy contract. The initial
adapter therefore inherits native configuration under the full ceiling.

## Google Antigravity

The official ACP registry lists Google LLC's `antigravity-acp` 1.4.5. The Linux
ARM64 archive SHA-256 was verified as
`7d64246633ae094f67e3bbcd2d679e89048f91346d5339313336e7483f40f056`.
It contains `agy_acp_server.par` and its accompanying harness; Linux launch uses
`--uid=`. This is a separate executable from raw `agy` and third-party `agy-acp`.

On this Raspberry Pi the official executable aborts before handshake:
`Compile-time page size does not match runtime page size` (16384 versus 4096).
No real ACP authentication, MCP persistence, tool call or raw-history continuation
could be verified on this machine. Standard ACP scripted fixtures exercise the
adapter; they do not resolve the upstream platform limitation. Diagnostics name
the actual official executable and explain the page-size failure. Session MCP
capability is false and overlays are rejected before spawn, pending native
credential-persistence and collision verification on a compatible host.

Desktop X authorization was also reported broken by the owner. Desktop acceptance
is deferred; headless protocol and Bot queue tests remain applicable.

## Sources

- [Muse SDK documentation](https://meta-models.github.io/muse-code-sdk/next/)
- [Grok MCP extension implementation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/mcp.rs)
- [Grok sandbox guide](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md)
- [Grok question wire types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/implementations/grok_build/ask_user_question/types.rs)
- [Official ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json)
- [Google IDE extensions and authentication](https://antigravity.google/docs/ide/extensions)
