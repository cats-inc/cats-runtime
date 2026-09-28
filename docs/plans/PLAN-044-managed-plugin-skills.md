# PLAN-044: Managed Plugin instruction pilot

User authorization: 2026-09-29, continue Desktop installation/removal and Runtime integration.

- [x] Durable registry, exposure ledger, generation fencing and bounded leases.
- [x] Authenticated management API and instruction-only catalog resolution.
- [x] Re-entry/fork/dispatch admission, durable CLI lifetime receipts and actual process-close evidence.
- [x] Focused tests, type checks and independent review.
- [x] Coordinate Platform Agency artifact installer and settings acceptance.
- [ ] Remote integration delivery and CI; release remains separately authorized.

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
