# PLAN-016: Management Adapter Subsystem

## Objective

Implement the first complete slice of the management adapter subsystem as
specified in SPEC-019 and decided in ADR-023. The subsystem integrates
management-type CLIs (GitHub CLI, Zeabur CLI) as runtime-owned control-plane
adapters, not session providers.

## Motivation

Products, skills, and orchestrators need to drive actions such as pull-request
creation, review-check waiting, deployment triggering, and preview registration
through stable runtime contracts. These tools do not fit the session-provider
model and need their own architectural home.

## Scope

- Review domain: `audit_review_target`, `open_pull_request`,
  `inspect_pull_request`, `wait_review_checks`
- Deployment domain: `audit_deployment_target`, `create_deployment`,
  `inspect_deployment`, `read_deployment_logs`
- GitHub CLI adapter (review)
- Zeabur CLI adapter (deployment)
- HTTP routes at `/management/*`
- MCP tools (8 new tools)
- Local tools (8 new tools)
- Diagnostics at `GET /management/diagnostics`
- Config at `config/management.yaml`
- Long-running operation model for `wait_review_checks`

## Implementation Status

- [x] Core types (`src/core/management/types.ts`)
- [x] Adapter interface (`src/core/management/adapters/types.ts`)
- [x] Config loader (`src/core/management/config.ts`)
- [x] CLI runner utility (`src/core/management/cli.ts`)
- [x] Stub adapter (`src/core/management/adapters/stub/StubAdapter.ts`)
- [x] Operation store (`src/core/management/operations.ts`)
- [x] Core service (`src/core/management/RuntimeManagementService.ts`)
- [x] GitHub review adapter
- [x] Zeabur deployment adapter
- [x] Diagnostics
- [x] HTTP routes
- [x] App wiring
- [x] MCP tools (8 tools)
- [x] Local tools (8 tools)
- [x] Tests: all passing (890 tests, 92 files)
- [x] Docs: architecture, api, SPEC-019, ADR-023, terminology

## Design Decisions Made

- HTTP namespace: `/management/{domain}/{action}` (dedicated, not `/delivery/`)
- Config: `config/management.yaml` (separate from `providers.yaml`)
- Diagnostics: `GET /management/diagnostics` (separate from provider diagnostics)
- `wait_review_checks`: bounded long-poll + resumable operation ID
- Authorization: `actorClass` + `approvalRef` (product-neutral)

## Related

- [SPEC-019](../specs/SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md)
- [ADR-023](../decisions/023-treat-management-clis-as-runtime-owned-control-plane-adapters-not-session-providers.md)
- [SPEC-009](../specs/SPEC-009-executable-delivery-and-governance-primitives.md)

---

*Created: 2026-03-25*
*Author: Claude*
