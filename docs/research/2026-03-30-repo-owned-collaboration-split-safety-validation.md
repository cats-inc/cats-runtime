# 2026-03-30 Repo-Owned Collaboration Split-Safety Validation

Date: 2026-03-30
Topic: Validate that the extracted collaboration baseline now works without
shelling out to `project-bootstrap`
Source:
- `cats-runtime/dist/bin/workspaceSubstrate.js`
- `cats-runtime/tests/workspace-substrate.test.ts`
- `cats-runtime/tests/workspace-substrate-bin.test.ts`
- `cats/scripts/windows/Sync-AgentSkills.ps1`
- `cats/scripts/linux/sync-agent-skills.sh`
- `cats/scripts/macos/sync-agent-skills.sh`
- `cats/tests/skill-sync-scripts.test.js`

## Validation Setup

Throwaway workspace path used for validation:

```text
C:\Users\sammy\AppData\Local\Temp\cats-runtime-split-safe-validation
```

Commands run:

```powershell
cd cats-runtime
npm run build
npx vitest run tests/workspace-substrate.test.ts tests/workspace-substrate-bin.test.ts --pool=threads --poolOptions.threads.singleThread
node dist\bin\workspaceSubstrate.js --operation init --workspace-path C:\Users\sammy\AppData\Local\Temp\cats-runtime-split-safe-validation --profile a2a-enabled --agent codex --apply --actor-role boss_cat
rg -n "project-bootstrap|Initialize-Project|Update-Project" C:\Users\sammy\AppData\Local\Temp\cats-runtime-split-safe-validation

cd ../cats
node --test --test-isolation=none tests/skill-sync-scripts.test.js
```

## Findings

### `cats-runtime` Repo-Owned Starter Flow Works Without Bootstrap

- `cats-runtime-workspace` created and applied a starter plan with 20 managed
  files in the throwaway workspace.
- The generated workspace included the repo-owned collaboration script baseline:
  - `scripts/windows/Sync-AgentSkills.ps1`
  - `scripts/linux/sync-agent-skills.sh`
  - `scripts/macos/sync-agent-skills.sh`
- The generated `scripts/README.md` points to repo-owned sync entrypoints and
  explicitly says those paths should not depend on bootstrap submodules.
- `rg -n "project-bootstrap|Initialize-Project|Update-Project"` returned no
  matches in the generated workspace, so the starter flow no longer leaves
  direct bootstrap references behind.

### Conservative Update Semantics Still Stay Local

- `tests/workspace-substrate.test.ts` and
  `tests/workspace-substrate-bin.test.ts` still pass after the sync-script
  extraction.
- That keeps the previously landed review-copy semantics (`*.bootstrap`) and
  legacy A2A retirement coverage intact while the collaboration starter family
  grows.

### `cats` Now Carries the Same Skill-Sync Baseline

- `cats` now ships:
  - `scripts/windows/Sync-AgentSkills.ps1`
  - `scripts/linux/sync-agent-skills.sh`
  - `scripts/macos/sync-agent-skills.sh`
- `tests/skill-sync-scripts.test.js` passed, confirming the cross-platform sync
  entrypoints and their README contract exist in the sibling repo.

## Summary

This validation passed the narrow split-safety check for the extracted
collaboration baseline:

- `cats-runtime` can seed a starter workspace through repo-owned helpers only
- the generated starter workspace no longer carries direct
  `project-bootstrap` script references
- `cats` now mirrors the extracted skill-sync baseline instead of keeping that
  collaboration script knowledge Windows-only

This does **not** mean the full collaboration stack is production-default
ready. It means the first repo-owned starter/update flow now survives without
bootstrap shell-outs for the currently extracted baseline.

## Relevance

This closes the first `PLAN-023` split-safety validation gate:

- repo-owned starter/update flow is now evidence-backed
- the remaining work is mirrored sibling consumption depth, intentional
  divergence recording, and later production-default decisions

## Action Items

- Keep expanding `cats` mirrored consumption only where the split truly needs
  the same collaboration baseline.
- Record any remaining intentional divergence from upstream bootstrap as later
  evidence, not as an implicit dependency.
