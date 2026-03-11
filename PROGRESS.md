# Progress

> Implementation status for the `cats-runtime` migration track.

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Core | In Progress | Thin facade boundary and adapter shape defined |
| API | In Progress | Session and message passthrough endpoints implemented |
| Tests | In Progress | Adapter and streaming coverage added with mock upstream |
| Docs | In Progress | README, API, architecture, and service registry updated |

**Legend**: Not Started | In Progress | Completed | Blocked

## Work Packages

### WP-1: agent-fleet Adapter

**Status**: In Progress  
**Assigned**: Codex  
**Priority**: P0

#### Tasks

| Task | Status | Notes |
|------|--------|-------|
| Bootstrap `cats-runtime` subproject | [x] | Generated from `../project-bootstrap` |
| Define runtime boundary | [x] | HTTP facade, no source imports from `agent-fleet` |
| Implement agent-fleet adapter | [x] | Health, sessions, messages, close, Kiro models |
| Add adapter tests | [x] | Mock backend + streaming passthrough coverage |
| Prepare first consumer migration | [ ] | `crew-chat-poc` switch happens in phase 2 |

#### Acceptance Criteria

- [x] `cats-runtime` can run without importing `agent-fleet` internals
- [x] `cats-runtime` can proxy streamed turn output from `agent-fleet`
- [x] Kiro model discovery is available through `cats-runtime`
- [ ] `crew-chat-poc` consumes `cats-runtime`

## Completion Notes

### WP-1: agent-fleet Adapter

**Updated**: 2026-03-11

#### Key Decisions

- Use a thin HTTP adapter first, not a source-level integration
- Keep the public surface intentionally small for the first consumer migration
- Use Node built-ins only for the first cut to avoid framework lock-in

#### Remaining Items

- [ ] Repoint `crew-chat-poc` to `cats-runtime`
- [ ] Add the future `api-runtime` backend

---

*Last updated: 2026-03-11*
