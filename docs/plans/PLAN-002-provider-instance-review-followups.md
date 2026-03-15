# PLAN-002: Provider Instance Review Follow-ups

> Post-review implementation plan for the provider-instance flow completed in commit `97d9c4d`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | External agent review |

## Related Spec

N/A. This plan tracks follow-up fixes and hardening after the provider-instance rollout.

## Overview

The provider-instance architecture is functionally complete, but review of commit
`97d9c4d` identified a small set of correctness and maintainability issues that
should be addressed before further expansion.

This plan records the findings that are accepted as valid, splits them into
near-term fixes versus deferred refactors, and defines the minimum regression
coverage expected for each change.

## Agreed Findings

### Must Fix

1. Duplicate discovered sessions are possible when two instances of the same
   provider resolve to the same discovery directory.
2. Discovery bootstrap relies on non-null assertions for optional resolvers in
   `AppContext`, which is fragile for tests and direct helper reuse.
3. YAML configuration currently accepts `wsl` environments without requiring a
   `distro`, leaving the failure to surface later at runtime.
4. The dashboard create modal can briefly render stale provider-instance data
   before the async catalog refresh finishes.
5. Static provider ordering in the modal does not match `PROVIDER_ORDER`,
   causing a visible reorder flash.

### Accepted Technical Debt

1. `config.ts` is too switch-heavy and should eventually move toward a more
   table-driven provider metadata model.
2. `ProviderInstanceConfig` is becoming a bag of provider-specific optional
   fields and should eventually be narrowed.
3. Legacy top-level fields such as `cursorRuntime` and `kiroRuntime` still
   exist for compatibility and remain slightly misleading.

These debt items are recorded here but are not bundled into the immediate bugfix
pass unless a targeted fix naturally reduces complexity without expanding scope.

## Implementation Phases

### Phase 1: Correctness and Guardrails

- [x] Deduplicate file-based watchers per provider when multiple instances
      resolve to the same discovery directory.
- [x] Emit a warning when overlapping provider-instance discovery directories
      are detected.
- [x] Remove discovery-controller non-null assertions by using explicit
      resolver fallbacks.
- [x] Validate YAML `wsl` environments and inline `wsl` instance runtimes so a
      missing `distro` fails during config load.

**Deliverables**: No duplicate discovered sessions from overlapping watch roots,
safer discovery bootstrap, and earlier config validation failures.

### Phase 2: Dashboard Polish

- [x] Make create-modal provider-instance initialization wait for catalog
      refresh completion or otherwise suppress the stale intermediate render.
- [x] Align static provider select ordering with runtime-driven ordering to
      avoid reorder flicker.

**Deliverables**: Stable provider/instance controls in the dashboard modal.

### Phase 3: Deferred Cleanup

- [x] Evaluate a table-driven provider config parser and keep it deferred to a
      focused follow-on refactor.
- [x] Evaluate whether legacy top-level runtime/session path fields can be
      reduced and retain them as compatibility shims for now.
- [x] Evaluate a cleaner per-provider instance settings shape and defer it to a
      later type-shape cleanup.

**Deliverables**: A scoped refactor proposal, not an implicit requirement for
the immediate bugfix commit.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/server.ts` | Modify | Deduplicate overlapping watchers and remove fragile resolver assertions |
| `src/backends/cli/config.ts` | Modify | Add WSL distro validation and, if practical, reduce repeated config glue |
| `public/index.html` | Modify | Fix modal refresh race and select-order flicker |
| `src/backends/cli/pool/SessionRegistry.test.ts` | Modify | Add regression coverage if registry behavior changes indirectly |
| `tests/runtime-server.test.ts` | Modify | Add discovery bootstrap overlap coverage |
| `src/backends/cli/config.test.ts` | Modify | Add YAML validation tests for invalid WSL definitions |

## Technical Decisions

- Prevent duplicate discovery at bootstrap time instead of letting the registry
  absorb ambiguous duplicate sessions.
- Keep backward compatibility with legacy env-based config in this pass.
- Treat parser cleanup and type-shape cleanup as separate refactors unless a
  small local simplification falls out of the bugfix work.

## Testing Strategy

- **Unit Tests**: Config validation for invalid `wsl` definitions; any new
  helper that canonicalizes or deduplicates watcher inputs.
- **Integration Tests**: Runtime server discovery setup with overlapping
  provider-instance directories; dashboard-adjacent behavior if covered by
  existing UI smoke tests.
- **Manual Testing**: Open the create modal before and after provider catalog
  refresh, and verify no duplicate discovered sessions appear when two
  instances intentionally point at the same directory.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Over-aggressive dedupe could hide intentionally distinct instances | Medium | Dedupe only identical provider + normalized watch directory pairs and log warnings |
| Validation changes could break permissive existing YAML files | Medium | Limit new validation to explicit `wsl` usage and keep legacy env fallback untouched |
| UI race fixes could regress modal initialization | Low | Cover the provider/instance defaulting path with targeted regression checks |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-16 | Plan created to track accepted findings from post-commit review of `97d9c4d` |
| 2026-03-16 | Phase 1 and Phase 2 fixes implemented; deferred cleanup items explicitly kept out of this patch set |

---

*Created: 2026-03-16*
*Author: Codex*
