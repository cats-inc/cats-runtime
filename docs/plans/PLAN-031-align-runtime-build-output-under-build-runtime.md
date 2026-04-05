# PLAN-031: Align Runtime Build Output Under `build/runtime`

Status: In Progress

## Related Decisions

- [030-use-structured-cats-home-runtime-storage](../decisions/030-use-structured-cats-home-runtime-storage.md)

## Related Plans

- Coordinating platform layout plan: `cats-platform` `PLAN-039`

## Related Spec

N/A

## Spec Requirement

No separate SPEC is required for this slice.

This is a runtime package layout cleanup, not a new user-facing runtime
capability. The accepted direction is already explicit:

- `cats-runtime` should stop using `dist/` as the lone special-case output root
  while `cats-platform` moves to a coherent `build/...` layout.
- because `cats-runtime` has not shipped, the migration should remove the old
  path instead of preserving a compatibility alias.

## Scope

This plan covers:

- moving the TypeScript output root from `dist/` to `build/runtime/`
- updating runtime package metadata and runtime-owned scripts to match
- updating tests and current docs that still reference `dist/`
- coordinating with `cats-platform` where desktop packaging stages a built
  runtime

This plan does not cover:

- changing runtime package names, CLI names, or `~/.cats` storage layout
- moving generated source files out of `src/`
- broader UI or API redesign work unrelated to the output-root rename

## Hard Constraints

- Do not emit to both `dist/` and `build/runtime/` in parallel.
- Do not keep compatibility shims for `dist/`.
- Do not leave package metadata, helper scripts, or tests pointing at `dist/`
  after the migration lands.

## Target Layout

```text
cats-runtime/
  src/
  build/
    runtime/
  public/
```

## Phases

### Phase 1: Freeze the Runtime Output Contract

- [ ] Confirm `build/runtime/` as the only compiled runtime output root.
- [ ] Audit current references to:
      - `dist/index.js`
      - `dist/bin/*`
      - `dist/index.d.ts`
      - repo-local docs or scripts that still describe `dist/`
- [ ] Freeze the no-legacy-shim rule for the runtime output migration.

**Deliverables**: one explicit runtime output contract and an inventory of all
affected references.

### Phase 2: Move Package Metadata to `build/runtime`

- [ ] Change `tsconfig.json` `outDir` from `dist` to `build/runtime`.
- [ ] Update `package.json`:
      - `main`
      - `types`
      - `exports`
      - `bin`
      - `files`
- [ ] Rename cleanup script vocabulary as needed
      (`clean-dist` -> `clean-build`) so runtime scripts no longer advertise
      the old layout.

**Deliverables**: package metadata and compiler output agree on
`build/runtime/`.

### Phase 3: Update Runtime-Owned Scripts and Tooling

- [ ] Update restart/start/pack/install helpers that execute:
      - `dist/index.js`
      - `dist/bin/*`
- [ ] Update release-check and verification helpers that assume `dist/`.
- [ ] Update `.gitignore` and cleanup scripts to cover `build/runtime/` and
      remove stale `dist/` assumptions.

**Deliverables**: runtime-owned operational scripts all execute the new output
root.

### Phase 4: Sweep Tests, Docs, and Cross-Package Consumers

- [ ] Update tests and fixtures asserting `dist/`.
- [ ] Update current docs and release guidance so they no longer describe
      `dist/` as the compiled runtime root.
- [ ] Coordinate with `cats-platform` `PLAN-039` so desktop packaging and
      sidecar staging stop assuming the runtime still emits to `dist/`.

**Deliverables**: current runtime docs, tests, and platform consumers all
reflect the same `build/runtime/` contract.

## Candidate File Areas

| Area | Action | Why |
|------|--------|-----|
| `tsconfig.json` | Modify | `outDir` must move to `build/runtime` |
| `package.json` | Modify | Runtime entrypoints and published files still point at `dist/` |
| `scripts/**` | Modify | Runtime helpers execute `dist/index.js` and `dist/bin/*` |
| `.gitignore` | Modify | Old `dist/` assumptions should be replaced by `build/runtime/` |
| `tests/**` | Modify | Runtime tests and fixtures may assert old output paths |
| `docs/**` | Modify | Current docs still describe `dist/` as the compiled runtime root |

## Testing Strategy

Use targeted, package-level validation.

- run runtime package build/typecheck after output-root changes
- run path-bearing helper tests or smoke checks that execute compiled runtime
  entrypoints
- run targeted test files that assert runtime package metadata or script paths
- do not widen to unrelated full-suite runs unless the migration crosses beyond
  runtime output ownership

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Runtime package metadata and compiler output drift apart | High | Update `tsconfig.json` and `package.json` in the same slice |
| Scripts still execute `dist/index.js` after the rename | High | Treat operational-script updates as first-class migration tasks |
| Platform packaging still stages the old runtime output path | High | Coordinate the final slice with `cats-platform` `PLAN-039` |
| Cleanup or ignore rules preserve stale outputs | Medium | Update `.gitignore` and cleanup helpers during the same migration |

## Progress Log

| Date | Update |
|------|--------|
| 2026-04-06 | Plan created to move `cats-runtime` from `dist/` to `build/runtime/` under runtime package ownership |
| 2026-04-06 | Phase 2/3 slice 1 landed: moved runtime package metadata and compiler output to `build/runtime`, renamed the cleanup script to `scripts/clean-build.mjs`, updated runtime-owned restart/autostart/workspace-substrate helpers plus package-contract/workspace-substrate/autostart tests to the new compiled entrypoints, and hardened startup version resolution so both `tsx src/*` dev runs and compiled `build/runtime/*` entrypoints resolve the package root correctly; validation included `npm run build`, `node build/runtime/index.js --help`, and `npx vitest run tests/package-contract.test.ts tests/workspace-substrate-bin.test.ts tests/linux-autostart.test.ts tests/macos-autostart.test.ts --pool=threads --poolOptions.threads.singleThread` |

---

*Created: 2026-04-06*
*Author: Codex*
