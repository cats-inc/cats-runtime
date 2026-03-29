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

Shared behavior:

- interactive mode prompts for global install, then whether to delete the generated tarball
- `--pack-only` creates the tarball and prints the later `npm install -g` command
- `--install` skips the install prompt and installs the tarball globally
- `--clean` deletes the tarball after a successful install
- `--skip-build` assumes `npm run build` has already been run
