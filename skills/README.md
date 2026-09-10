# Developer Skills

This root follows the project-bootstrap convention: version-controlled skills
for agents developing and maintaining this repository. The product library is
separate, under `runtime-skills/`, and is the only skill root shipped with npm.

| Skill | Purpose |
| --- | --- |
| `maintain-provider-model-catalogs` | Refresh, audit and review provider model catalogs from evidence |

Edit the canonical package here, including its supporting resources, then run:

```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

Linux/macOS use `scripts/linux/sync-agent-skills.sh` or the macOS equivalent.
The reconciler updates `.agents/skills/` and `.claude/skills/`, removes only
obsolete repository-managed entries and preserves unrelated local skills.
Packages are direct children of this root. Generated mirrors are not editable
sources. From the Cats parent workspace, run cats-one's workspace sync as well.

See [ADR-036](../docs/decisions/036-separate-repository-maintenance-skills-from-runtime-delivered-skills.md)
for the developer/product boundary and the 2026-09-11 directory alignment.
