# PLAN-044: Managed Plugin instruction pilot

User authorization: 2026-09-29, continue Desktop installation/removal and Runtime integration.

- [x] Durable registry, exposure ledger, generation fencing and bounded leases.
- [x] Authenticated management API and instruction-only catalog resolution.
- [x] Re-entry/fork/dispatch admission, durable CLI lifetime receipts and actual process-close evidence.
- [x] Focused tests, type checks and independent review.
- [x] Coordinate Platform Agency artifact installer and settings acceptance.
- [x] Remote integration delivery and CI; release remains separately authorized.

No release/version bump, provider adapter, general hook SDK or marketplace service.

The immutable producer fixture is Agency 0.1.0 from cats-plugins, digest
`26afae3f0c5f551cc3bbce267c82d574963c4c2f94f48f9e8d3dcb0aa0ca07a5`.
Platform owns its installer, Settings UI, impact confirmation and desired state;
Runtime owns execution admission and observed process lifetime. Both new persistence
namespaces start at schema 1 without changing existing formats. Automatic orphan
recovery, live model quality and cross-OS process acceptance remain outside the pilot.

Validation on 2026-09-29: 47 focused tests passed across managedPlugins,
managedPluginProcess, runtimeSkills HTTP, WorkerProcess.codexHost and
windowsCodexHost; TypeScript passed. Tests distinguish child/guard close from
result/error/cancel and cover cancelled host startup without losing stop evidence.
Independent read-only review completed with no remaining actionable findings.

Platform's isolated Windows Candidate completed installation, enablement, Runtime
catalog registration of both skills, Cat draft selection, disable and removal.
No live model calls were made. The Candidate and its owned sidecars drained.
Launch `ac12449e8609876484e15b7ef61f14131c646773380b0b56a33a85a4894b8f87` captured Runtime
source digest `6090aca083e794196e5eef8b8a7658fec28b31bb9dc385782c60dc9fa325fccb`;
Platform PLAN-113 records the renderer evidence and scope.

Delivered through [PR #119](https://github.com/cats-inc/cats-runtime/pull/119),
merged as `81ea3de863d93d87386d69723c89af689abdfb12`.
[Full release preflight](https://github.com/cats-inc/cats-runtime/actions/runs/36463955137)
passed all 244 test files plus build, skill validation and package dry-run. No
publication occurred. Platform integration is tracked in
[PR #163](https://github.com/cats-inc/cats-platform/pull/163).
