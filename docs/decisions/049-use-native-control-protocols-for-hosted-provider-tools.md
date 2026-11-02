# ADR-049: Use Native Control Protocols for Hosted Provider Tools

## Status

Accepted for implementation — 2026-11-02, following the owner's request to give
Antigravity, Grok and Muse working tools and to begin in isolated worktrees.
Protocol-specific support is subject to the evidence gates in PLAN-051.

## Context

The current raw CLI adapters cannot host the same approvals as Codex/Claude.
Grok's old default exposes only `read_file`; Muse's default disables writing,
shell and web tools. The Bot consequently excludes these providers and
Antigravity from Boss Cat MCP. Current upstream programs have native host
protocols that were absent from the original adapter probes.

Generic Runtime ACP currently has its own process owner, auto-decides permission
requests and provides no session MCP overlay. Merely changing Bot routing to it
would not implement the required interaction and secret-lifetime contracts.

## Decision

1. Implement Muse's stable MSP and Grok/official Google ACP through native CLI
   provider adapters using the existing WorkerProcess control path and
   InteractionStore. Keep provider wire schemas out of Bot and generic core.
2. Introduce hosted execution additively. Preserve explicit readonly/allowlist
   constraints and the legacy/media entry points; do not reinterpret every
   `default` caller as unrestricted execution. Unsupported policy combinations
   fail before a model turn.
   Selection is per CLI instance via `protocol: hosted`, never inferred from
   `interactionHost`. Initially all three accept only inherited provider policy
   with a full machine/network ceiling. This matches the native ability to
   approve sandbox escape without falsely promising a workspace-only boundary.
   ACP observations verify that ceiling and do not invent an effective approval
   mode. Muse reports its native baseline profile when the host exposes it.
3. Reuse session MCP construction/resume, not global config, agent replacement
   or prompt-only tool descriptions. Extend ADR-044's secret boundary to permit
   private stdin protocol messages where the native API requires literal HTTP
   headers: only the intended child receives them, they remain memory-only,
   and native persistence must be verified before enabling that mapping.
   This is verified for Muse/Grok; Antigravity session MCP remains gated while
   its official binary cannot initialize on the available 16 KiB-page host.
   Stdin-based adapters do not additionally export these grants to the child's
   environment. Worker diagnostics redact literal, JSON-escaped and URL-escaped
   grants, including stderr split across chunks, before capture or logging.
4. Advertise support from the resolved execution target and report delivery and
   observed inventory separately. Missing native executables, unsupported wire
   features and unverified tools remain visible rather than gaining nominal
   support from a provider-name list.
5. Keep native continuation identity. Where a raw CLI history is incompatible
   with a new host, refuse native resume clearly; use the product's existing
   transcript-preserving handoff, never pretend the old native session resumed.

## Consequences

- Bots use the established approval UI and keep one serialized live turn.
- Native transport implementations require bounded schemas, fixtures and
  executable probes; they cannot be implemented as permission flags alone.
- The official Antigravity ACP binary has separate setup/auth and may need a
  distinct installed target. Its absence must not be mistaken for `agy` absence.
- Hosted targets have their own protocol identity in diagnostics. Legacy media
  jobs remain on separate targets; Google ACP is never invoked with raw `agy`
  quota or image flags. Enabling Google ACP session MCP later also requires a
  verified collision boundary, since standard ACP lacks global name inspection.
- No new public listener, profile schema or package version is required by this
  decision. An unavoidable breaking contract requires a separate recorded boundary.

## Alternatives Considered

| Alternative | Reason not selected |
| --- | --- |
| Change all providers to skip/always-approve | Does not deliver tools, handle user questions or enforce requested ceilings |
| Implement the protocols in Bot | Duplicates provider/process authority and breaks the Runtime boundary |
| Switch to existing generic ACP unchanged | Lacks the required interaction and session MCP semantics |
| Use Muse's experimental ACP | Stable MSP already exposes the needed protocol with an exported schema |

## References

- [SPEC-040](../specs/SPEC-040-native-provider-tools-and-interactions.md)
- [PLAN-051](../plans/PLAN-051-native-provider-tools-and-interactions.md)
- [Session MCP](044-configure-session-mcp-servers-for-provider-clis.md)
- [Provider interactions](048-bridge-provider-interactions-and-report-effective-session-capabilities.md)
- [Muse developer documentation](https://meta-models.github.io/muse-code-sdk/next/)
- [Grok agent mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)
- [Official Google ACP distribution](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json)

*Decision made: 2026-11-02*
