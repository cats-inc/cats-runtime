# Scripts

> Project automation scripts live here.

## Layout

```
scripts/
├── windows/   # PowerShell (.ps1)
├── linux/     # Bash (.sh)
├── macos/     # Bash (.sh)
└── testing/   # Test helpers (shared)
```

## Standards

Follow `docs/SCRIPT-STANDARDS.md` for naming and documentation rules.

## Packaging Helpers

Local npm package smoke tests are available on each desktop platform:

| Script | Platform | Purpose |
|--------|----------|---------|
| `scripts/linux/pack-install.sh` | Linux | Build, pack, and optionally install the local `.tgz` globally |
| `scripts/macos/pack-install.sh` | macOS | Build, pack, and optionally install the local `.tgz` globally |
| `scripts/windows/Pack-Install.ps1` | Windows | Build, pack, and optionally install the local `.tgz` globally |
| `scripts/windows/Invoke-WorkspaceSubstrate.ps1` | Windows | Wrap the repo-owned workspace substrate helper for audit/init/update preview or apply flows |
| `scripts/linux/workspace-substrate.sh` | Linux | Wrap the repo-owned workspace substrate helper for audit/init/update preview or apply flows |
| `scripts/macos/workspace-substrate.sh` | macOS | Wrap the repo-owned workspace substrate helper for audit/init/update preview or apply flows |

## Collaboration Helpers

| Script | Platform | Purpose |
|--------|----------|---------|
| `scripts/sync-agent-skills.mjs` | Cross-platform | Reconcile canonical `developer-skills/` into ignored agent discovery mirrors |
| `scripts/windows/Sync-AgentSkills.ps1` | Windows | Invoke the shared reconciler from PowerShell |
| `scripts/linux/sync-agent-skills.sh` | Linux | Invoke the shared reconciler from Bash |
| `scripts/macos/sync-agent-skills.sh` | macOS | Invoke the shared reconciler from Bash |

The canonical repository-maintenance packages live under `developer-skills/`. The reconciler writes
them to `.claude/skills/` for Claude Code and `.agents/skills/` for Codex, Antigravity, and Grok.
It tracks repository-managed skill names in each target, removes stale managed mirrors, preserves
unrelated local skills, refuses to overwrite an unmanaged name collision, and rejects linked
source trees or discovery paths before writing. `--clean` / `-Clean` recreates only
repository-managed entries. Runtime-delivered packages under `skills/` are not synced.

`--agent antigravity` and `--agent grok` are explicit aliases for the same `.agents/skills/` target
as `--agent codex`; they do not create additional copies.

The runtime's `WorkspaceSubstrateService` intentionally continues to generate generic `skills/`
sync helpers for arbitrary new workspaces. Those generated templates and this repository-specific
`developer-skills/` workflow have different canonical roots by ADR-036's implementation amendment.

Shared behavior:

- interactive mode prompts for global install with a default of yes; if install proceeds, tarball deletion also defaults to yes
- `--pack-only` creates the tarball and prints the later `npm install -g` command
- `--install` skips prompts, installs the tarball globally, and deletes it afterward
- `--clean` explicitly forces tarball deletion after a successful install
- `--skip-build` assumes `npm run build` has already been run

## Workspace Substrate Wrappers

The repo-owned workspace substrate helper is also available through
platform-specific wrapper scripts:

- Windows:
  `.\scripts\windows\Invoke-WorkspaceSubstrate.ps1 -Operation audit -WorkspacePath .`
- Linux:
  `./scripts/linux/workspace-substrate.sh --operation audit --workspace-path .`
- macOS:
  `./scripts/macos/workspace-substrate.sh --operation audit --workspace-path .`

## Merged-Branch Sweep

- `scripts/windows/Remove-MergedBranches.ps1`

This project squash-merges and lets GitHub delete the head branch, so every
landed PR leaves a local branch behind. Because a squashed commit has a
different SHA than the branch it came from, `git branch -d` reports "not fully
merged" and refuses. The script keys off upstream state instead: a branch counts
as merged once it had an upstream and that upstream is gone.

```powershell
.\scripts\windows\Remove-MergedBranches.ps1 -WhatIf
.\scripts\windows\Remove-MergedBranches.ps1 -ReturnToDefault
```

It refuses to run on a dirty working tree, never sweeps a branch that was never
pushed, and skips branches checked out in another worktree. Run
`git config --global fetch.prune true` once so the `gone` markers it reads
appear without remembering `--prune`.

Three copies of this script exist and are meant to stay in step:

- here
- `cats-platform` at the same path
- `project-bootstrap` at `templates/base/scripts/windows/`, which is where new
  projects inherit it from

The template copy is the one to treat as canonical when they disagree, since it
has to work in a repository whose default branch and remote are unknown.
