# Agent Collaboration Guide

> Detailed guide for AI agents working on this project.

## Quick Reference

1. Read `../AGENTS.md` first (required)
2. Read your agent-specific file (`CLAUDE.md`, `GEMINI.md`, or `CODEX.md`)
3. Follow this guide for detailed collaboration procedures

## Project-Specific Context

- `cats-runtime` is the future stable runtime boundary for upper-layer products
- The CLI runtime is now embedded under `src/backends/cli`
- Keep `agent-fleet` references limited to historical ADRs and migration notes
- Default listener: `http://127.0.0.1:3110`
- The dashboard UI is served directly from `GET /`

## Current API Surface

- `GET /`
- `GET /playground`
- `GET /health`
- `GET /diagnostics/health`
- `GET /diagnostics/runtime`
- `GET /diagnostics/providers`
- `GET /providers/config`
- `GET /providers/:provider/models`
- `GET /browser/drivers`
- `GET /browser/sessions`
- `GET /browser/sessions/:id`
- `POST /browser/sessions`
- `POST /browser/sessions/:id/pages`
- `POST /browser/sessions/:id/close`
- `POST /delivery/audit`
- `POST /delivery/artifacts/publish`
- `POST /delivery/repo/status`
- `POST /delivery/repo/commit`
- `POST /delivery/repo/push`
- `GET /skills/catalog`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /sessions/:id/lineage`
- `POST /sessions`
- `POST /sessions/:id/messages`
- `POST /sessions/:id/close`
- `POST /sessions/:id/compact`
- `POST /sessions/:id/resume`
- `POST /sessions/:id/fork`
- `DELETE /sessions/:id`
- `GET /sessions/:id/history`
- `GET /sessions/:id/stream`
- `GET /wakeups`
- `POST /wakeups`
- `POST /wakeups/:id/cancel`
- `POST /wakeups/:id/trigger`
- `GET /pool/status`
- `GET /browse`
- `GET /kiro/models`

## Working Rules

- Favor the smallest public contract that keeps upper layers decoupled
- Keep inbound transport details in `src/http`, not in backend modules
- Keep CLI-specific logic in `src/backends/cli`
- Treat `GET /health` as the authoritative runtime readiness boundary
- Treat `GET /diagnostics/health` as the host-facing aggregate for runtime + provider health
- Treat `GET /diagnostics/providers` as the runtime-owned provider availability surface for hosts
- Treat delivery routes and delivery tools as runtime-owned execution
  primitives; keep delivery-governance policy in upper-layer products
- Update `docs/api.md` and `docs/architecture.md` when changing the public surface
- Add or update tests for every route change

## Project Context

(Add project-specific context that agents should know)

- What this project does
- Key architectural decisions
- Important constraints or requirements

## A2A Collaboration (Optional)

If this project uses Agent-to-Agent (A2A) integration:

1. Define an Agent Card in `docs/a2a/agent-card.(json|yaml).example` and keep it aligned with actual capabilities.
2. Define the task payload format in `docs/a2a/task.(json|yaml).example` and keep runtime tasks consistent.
3. Document transport, auth, and discovery details in `docs/a2a/README.md`.
4. Keep `AGENTS.md` and agent-specific files consistent with the Agent Card.
5. Update `docs/terminology.md` when new terms are introduced.

## Common Tasks SOP

### Adding a New Feature

1. Check `requirements.md` for related requirements
2. Review `architecture.md` for design patterns
3. Implement in `src/`
4. Add tests in `tests/`
5. Update documentation as needed
6. Follow git conventions from `AGENTS.md`

### Fixing a Bug

1. Reproduce the issue
2. Identify root cause
3. Implement fix
4. Add regression test
5. Document in commit message

### Updating Documentation

1. Identify which doc needs update
2. Follow existing format/style
3. Update `docs/README.md` index if adding new doc
4. Add "Last updated" date

## Output Standards

### Code Output

- Follow naming conventions in `AGENTS.md`
- Include appropriate comments
- Write tests for new functionality

### Documentation Output

- Use clear, concise language
- Include examples where helpful
- Keep formatting consistent
- Follow script standards in `docs/SCRIPT-STANDARDS.md`
- Log external sources in `docs/research/`

## Handoff Checklist

Before completing a task or handing off:

- [ ] Code compiles/runs without errors
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Commit message follows conventions
- [ ] Status in README.md updated (if applicable)

---

*Last updated: 2026-03-23*
