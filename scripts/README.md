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
| `scripts/windows/Sync-AgentSkills.ps1` | Windows | Sync `skills/` into `.claude/skills` and `.agents/skills` |
| `scripts/linux/sync-agent-skills.sh` | Linux | Sync `skills/` into the same agent discovery paths on POSIX hosts |
| `scripts/macos/sync-agent-skills.sh` | macOS | Sync `skills/` into the same agent discovery paths on POSIX hosts |

Antigravity CLI is intentionally not a skill sync target yet. Its repo/project
skill discovery path has not been verified, so these helpers do not create an
`.antigravity/skills` convention.

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
