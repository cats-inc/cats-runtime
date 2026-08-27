# Antigravity CLI Instructions

> **If you are NOT Antigravity (`agy`), please ignore this file.**

This file is named `GEMINI.md` because the Antigravity CLI (`agy`) looks for this filename as its project context file, having inherited the `.gemini` namespace from the Gemini CLI that ADR-032 replaced. Its audience is the Antigravity CLI (`agy`).

## Prerequisites

**MUST** read `AGENTS.md` first for cross-agent guidelines before reading this file.

## Role Awareness

Check the **Project Roles** table in `AGENTS.md`.
- If a **Conductor** is assigned (and it's not you), act as a Specialist: prioritize their tasks and strictly follow their architectural plans.
- If **you** are the Conductor, you are responsible for orchestration, task management, and status tracking.

## Command Aliases

| Alias | Action |
|-------|--------|
| `dyu` | **MUST** confirm you have read `AGENTS.md` and this file. **MUST** respond with exactly: "I am Antigravity, and I understand." |

## About This File

This file contains Antigravity-specific configurations and instructions that should not be applied by other AI agents (Claude, Codex, etc.).

Only Antigravity (`agy`) should read and maintain this file.

---

## Antigravity-Specific Configurations

### Behavioral Guidelines

- **MUST** read AGENTS.md at the start of every session
- **MUST** follow the Development Workflow defined in AGENTS.md
- **MUST NOT** skip testing when code changes are made
- **MUST NOT** modify other agents' files (CLAUDE.md, CODEX.md)
- **SHOULD** ask for clarification when requirements are ambiguous
- **SHOULD** propose approach before implementing major changes

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
- **SHOULD** make minimal, focused changes
- **SHOULD** commit frequently with clear messages

### Preferred Behaviors

- **Thoroughness**: Ensure all edge cases are considered
- **Test coverage**: Validate both happy path and error cases
- **Documentation**: Keep docs synchronized with code changes
- **Collaboration**: Coordinate with other agents when needed

### Project-Specific Context

(Add any project-specific context or conventions that Antigravity should be aware of)

### Agent Skills

Antigravity CLI does not support project-level skill discovery. There is no `.gemini/skills/` or `.antigravity/skills/` directory within a repository that is read or discovered by the CLI.

Skills reach Antigravity exclusively from user-level roots:
- Builtin skills: `~/.gemini/antigravity-cli/builtin/skills/<name>/SKILL.md`
- Plugin-installed skills: `~/.gemini/config/plugins/<plugin>/skills/<name>/SKILL.md`

The repository's skill sync helpers (`.\scripts\windows\Sync-AgentSkills.ps1`, `scripts/linux/sync-agent-skills.sh`, `scripts/macos/sync-agent-skills.sh`) do not target Antigravity and must not be run for its benefit. Delivering a repository-owned skill to Antigravity would require the plugin distribution mechanism; no decision has been made to do that.

### Personal Memory

(This section is for Antigravity to record long-term observations or preferences specific to this user/project)

---

## Maintenance

This file is maintained by Antigravity only. Other agents should not modify this file.

Last updated: 2026-08-28
