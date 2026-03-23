# PLAN-015: MCP Mutation Tools and Stdio Facade

> Add the next runtime-owned MCP slice without replacing the direct HTTP API.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | Pending |

## Related Spec

- [cats ADR-008: Expose cats-runtime via Direct API and MCP Facade](../../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)
- [cats SPEC-015: Cat Capability Registry and Runtime Skill MCP Mapping](../../../cats/docs/specs/SPEC-015-cat-capability-registry-and-runtime-skill-mcp-mapping.md)
- [cats SPEC-021: Contextual MCP Profiles and Lazy Tool Activation](../../../cats/docs/specs/SPEC-021-contextual-mcp-profiles-and-lazy-tool-activation.md)

## Overview

Freeze a first mutation-capable MCP tool plane for orchestrator hosts while
keeping `cats-runtime` direct HTTP APIs as the primary product boundary. Reuse
the existing runtime session, workspace, and delivery contracts instead of
introducing a second execution path.

## Implementation Phases

### Phase 1: Freeze Tool Contract

- [x] Define the additive mutation tool set for the next MCP slice
- [x] Keep MCP tool inputs aligned with existing runtime HTTP/service contracts
- [x] Preserve the current read-mostly tools

**Deliverables**: Stable tool names and input schemas for Team 5 consumption.

### Phase 2: Implement Tool Execution

- [x] Add in-process route bridging for session and delivery mutations
- [x] Add direct workspace init execution through the runtime substrate service
- [x] Return machine-readable structured content that mirrors runtime/session contracts

**Deliverables**: Mutation tools for create/send/fork/init/commit without a
parallel runtime stack.

### Phase 3: Add Stdio Transport and Coverage

- [x] Add a standalone stdio MCP entrypoint
- [x] Support framed JSON-RPC requests over stdin/stdout
- [x] Add HTTP + stdio tests plus docs/PROGRESS updates

**Deliverables**: External MCP hosts can attach over stdio or HTTP JSON-RPC.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `cats-runtime/src/mcp/runtimeRequests.ts` | Create | In-process request bridge for MCP tools |
| `cats-runtime/src/mcp/stdio.ts` | Create | Stdio framing/parser and server loop |
| `cats-runtime/src/bin/mcp.ts` | Create | Standalone stdio MCP entrypoint |
| `cats-runtime/src/mcp/tools.ts` | Modify | Add mutation tools and shared schemas |
| `cats-runtime/src/mcp/server.ts` | Modify | Add small protocol compatibility improvements |
| `cats-runtime/src/http/mcpRoutes.test.ts` | Modify | Cover new tool schemas and mutation tools |
| `cats-runtime/src/mcp/stdio.test.ts` | Create | Verify stdio framing and tool calls |
| `cats-runtime/package.json` | Modify | Publish the MCP stdio binary |
| `cats-runtime/docs/api.md` | Modify | Document HTTP and stdio MCP usage |
| `cats-runtime/docs/mcp-config.md` | Modify | Document host configuration for stdio |
| `cats-runtime/docs/architecture.md` | Modify | Note stdio transport and mutation plane |
| `cats-runtime/README.md` | Modify | Update capability summary |
| `cats-runtime/PROGRESS.md` | Modify | Mark the next MCP slice delivered |
| `cats/docs/mcp-config.md` | Modify | Update external client guidance for runtime MCP |

## Technical Decisions

- Reuse in-process Hono requests for session and delivery mutations so MCP and
  direct HTTP APIs stay aligned by construction.
- Keep workspace substrate mutation direct to the service because there is no
  separate HTTP workspace route to mirror today.
- Add a dedicated `cats-runtime-mcp` stdio binary instead of overloading the
  main HTTP runtime executable.

## Testing Strategy

- **Unit Tests**: Cover stdio framing and request parsing.
- **Integration Tests**: Exercise HTTP MCP tool listing/calls and mutation
  flows against the same runtime app used by direct routes.
- **Required Suite**: Run `cd cats-runtime && npm test`.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP mutation tools drift away from direct routes | High | Route-bridge session/delivery calls through the existing Hono app |
| Stdio framing bugs break external hosts | High | Add parser tests for initialize/list/call flows with Content-Length framing |
| Mutation tools become a back door around product policy | Medium | Keep scope limited to runtime-owned session/workspace/delivery primitives |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and completed alongside the stdio + mutation MCP slice |

---

*Created: 2026-03-23*
*Author: Codex*
