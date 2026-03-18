# Codex-Specific Instructions

> **If you are NOT Codex (OpenAI Codex CLI), please ignore this file.**

## Prerequisites

**MUST** read `AGENTS.md` first for cross-agent guidelines before reading this file.

## Role Awareness

Check the **Project Roles** table in `AGENTS.md`.
- If a **Conductor** is assigned (and it is not you), act as a Specialist: prioritize their tasks and strictly follow their architectural plans.
- If **you** are the Conductor, you are responsible for orchestration, task management, and status tracking.

## Command Aliases

| Alias | Action |
|-------|--------|
| `dyu` | **MUST** confirm you have read `AGENTS.md` and this file. **MUST** respond with exactly: "I am Codex, and I understand." |

## About This File

This file contains Codex-specific configurations and instructions that should not be applied by other AI agents (Claude, Gemini, etc.).

Only Codex should read and maintain this file.

---

## Codex-Specific Configurations

### Behavioral Guidelines

- **MUST** read AGENTS.md at the start of every session
- **MUST** follow the Development Workflow defined in AGENTS.md
- **MUST NOT** skip testing when code changes are made
- **MUST NOT** modify other agents' files (CLAUDE.md, GEMINI.md)
- **SHOULD** ask for clarification when requirements are ambiguous
- **SHOULD** make minimal, focused edits

### Conductor Responsibilities

If assigned as Conductor in Project Roles table:
- **MUST** maintain README.md "Current Status" section
- **MUST** create and assign tasks in `docs/plans/`
- **MUST** document major decisions in `docs/decisions/`
- **MUST NOT** make unilateral architectural decisions without documentation

### Code Modification Rules

- **MUST** update tests when modifying code
- **MUST** update documentation when changing public APIs
- **MUST** follow coding conventions specified in AGENTS.md
- **MUST** respect `.editorconfig` settings (LF line endings, final newline, trim rules)
- **SHOULD** make minimal, focused changes
- **SHOULD** commit frequently with clear messages

### Agent Skills

Codex discovers skills from `.agents/skills/<name>/SKILL.md`. The canonical source is the `skills/` directory at the project root.

To sync skills after changes:
```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

### Search and Navigation Preferences

- **SHOULD** prefer `rg` (ripgrep) for searching text content
- **SHOULD** use `fd` for finding files by name patterns
- **MAY** use `grep` or `find` as fallbacks if other tools unavailable

### Preferred Behaviors

- **Precision**: Keep edits minimal and surgical
- **Testing**: Validate all changes work correctly
- **Configuration compliance**: Always respect `.editorconfig`
- **Documentation**: Keep docs synchronized with code

### Project-Specific Context

- Fill this section in generated projects with ports, entrypoints, and key paths.
- Keep it concise and specific to the project (e.g., main service port, core modules, test command).
- `cats-runtime` default HTTP port is `3110`; restart helper is `scripts/windows/Restart-Server.ps1`.
- When invoking `scripts/windows/Restart-Server.ps1` from Codex, **MUST** pass `-NoRedirect`.
- Reason: `Start-Process` with `-RedirectStandardOutput/-RedirectStandardError` keeps `shell_command` attached to the long-lived `node dist/index.js` process, so the command appears hung even after the server is healthy.

---

## Maintenance

This file is maintained by Codex only. Other agents should not modify this file.

Last updated: 2026-01-05
