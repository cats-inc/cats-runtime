# A2A v1.0 Pilot Example Set

> Pilot-owned A2A protocol artifacts for `cats-runtime`.

## Pilot Posture

These files are the `cats-runtime` side of the `SPEC-006` / `PLAN-023` pilot
run.

- They were informed by the March 2026 `project-bootstrap` A2A refresh, but
  they are not a blind copy of that template set.
- They are rewritten to match `cats-runtime`'s real operating model:
  - protocol artifacts live in `docs/a2a/`
  - durable repo state lives in markdown project-memory docs
  - procedural collaboration behavior lives in `skills/`
- They document a future A2A-facing adapter shape for this runtime boundary.
  They do not claim that the current repo already serves a live A2A endpoint.

## Current Repo Truth

As of this pilot slice:

- `cats-runtime` does not yet publish a live `/.well-known/agent-card.json`
  endpoint.
- `cats-runtime` does not yet expose a public A2A JSON-RPC surface.
- The authoritative collaboration surfaces today are still:
  - `AGENTS.md` plus agent-specific files
  - `docs/AGENT-GUIDE.md`
  - project-memory docs such as ADRs, specs, plans, and research notes
  - runtime-owned procedural `SKILL.md` packages

## Contents

- `agent-card.public.json.example` / `agent-card.public.yaml.example`
  Public discovery-card examples for a future `cats-runtime` A2A adapter.
- `agent-card.authenticated.json.example` /
  `agent-card.authenticated.yaml.example`
  Authenticated extended-card examples with richer operational workflows.
- `jsonrpc-send-message.request.json.example`
  Pilot `SendMessage` request example using runtime-oriented task intent.
- `jsonrpc-send-message.response.json.example`
  Pilot `SendMessage` success response example with runtime-specific artifacts.
- `jsonrpc-send-streaming-message.request.json.example`
  Pilot `SendStreamingMessage` request example.
- `jsonrpc-send-streaming-message.response.sse.example`
  Pilot SSE stream example for status and artifact updates.
- `jsonrpc-get-task.request.json.example`
  Pilot `GetTask` request example.
- `jsonrpc-cancel-task.request.json.example`
  Pilot `CancelTask` request example.
- `jsonrpc-get-extended-agent-card.request.json.example`
  Pilot authenticated extended-card lookup example.

## Layering Rules

- `docs/a2a/` is the protocol layer. Keep standards-aligned discovery, auth,
  and JSON-RPC examples here.
- Project memory belongs in markdown docs such as `docs/research/`,
  `docs/decisions/`, `docs/specs/`, `docs/plans/`, `PROGRESS.md`, and
  `ROADMAP.md`.
- Procedural collaboration behavior belongs in skills such as
  `skills/orchestration/a2a-handoff/` and
  `skills/orchestration/project-memory-sync/`.

Do not turn this directory into a handoff log, a project status mirror, or a
dumping ground for local SOP.

## Legacy Retirement

Legacy `agent-card.json.example`, `agent-card.yaml.example`,
`task.json.example`, and `task.yaml.example` are retired in this repo.

- Do not reintroduce the generic standalone `task.*.example` shape as if it
  were normative A2A v1 guidance.
- If another repo still carries those files, replace them conservatively and
  explain the migration in that repo's local A2A README.

## References

- [SPEC-006](../specs/SPEC-006-a2a-protocol-project-memory-and-skill-layering.md)
- [PLAN-023](../plans/PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md)
- A2A Protocol specification: https://a2a-protocol.org/latest/specification/
- A2A Protocol definitions: https://a2a-protocol.org/latest/definitions/
