# Claude-Specific Instructions

> **If you are NOT Claude, please ignore this file.**

## Prerequisites

**MUST** read `AGENTS.md` first for cross-agent guidelines before reading this file.

## Role Awareness

Check the **Project Roles** table in `AGENTS.md`.
- If a **Conductor** is assigned (and it's not you), act as a Specialist: prioritize their tasks and strictly follow their architectural plans.
- If **you** are the Conductor, you are responsible for orchestration, task management, and status tracking.

## Command Aliases

- `dyu` - **MUST** confirm you have read `AGENTS.md` and this file. **MUST** respond with exactly: "I am Claude, and I understand."
- `mbf` - **Merge Bootstrap Files**:
  1. Find all `*.bootstrap` files in the project
  2. For each `.bootstrap` file, compare with its corresponding file and merge appropriate content
  3. Delete each `.bootstrap` file after successful merge
  4. Find all `.gitkeep` files and check if their parent directory contains other files - if so, delete the `.gitkeep` file
  5. Report summary of changes when complete

## Output Formatting Rules

- **MUST** 使用條列式 (bullet list) 而非表格，除非是模擬圖表或表格真正必要
- **MUST NOT** 濫用表格語法（`|` 和 `-----`）
- **SHOULD** 用縮排條列取代多欄表格
- 例外情況：比較多個選項的優缺點、數據對照表、API 參數規格等真正需要表格的場景

## About This File

This file contains Claude-specific configurations and instructions that should not be applied by other AI agents (Gemini, Codex, etc.).

Only Claude should read and maintain this file.

---

## Claude-Specific Configurations

### Behavioral Guidelines

- **MUST** read AGENTS.md at the start of every session
- **MUST** follow the Development Workflow defined in AGENTS.md
- **MUST NOT** skip testing when code changes are made
- **MUST NOT** modify other agents' files (GEMINI.md, CODEX.md)
- **MUST NOT** use compound commands with `cd` and `git`（例如 `cd submodule && git log`）。對 submodule 操作時，使用 `-C` 參數或指定完整路徑
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

### Agent Skills

Claude Code discovers skills from `.claude/skills/<name>/SKILL.md`.

```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

It copies. The three platform entrypoints are thin wrappers over one reconciler,
`scripts/sync-agent-skills.mjs`, whose canonical source is
`developer-skills/<name>/SKILL.md` — direct children, matching the actual layout.
Today that is `maintain-provider-model-catalogs`.

What a run does and does not touch:

- it records what it owns in `.claude/skills/.cats-runtime-managed-skills`, so a
  renamed or deleted canonical skill loses its mirror on the next run
- a skill you installed into `.claude/skills/` yourself is left alone
- it refuses to overwrite an unmanaged directory that shares a canonical name,
  rather than clobbering it
- `-Clean` recreates repository-managed mirrors only; it no longer wipes the
  target directory
- re-running with no canonical change reports `unchanged` and writes nothing
- a default run also refreshes `.agents/skills/`, the shared
  Codex/Antigravity/Grok path; `-Agent claude` limits it to yours

`skills/` stays the runtime-owned, npm-shipped skill library (ADR-018), and
`developer-skills/` stays out of both paths to users: the runtime skill catalog
resolves only `skills/` roots, and `package.json` `files` ships `skills` and not
`developer-skills`. That separation is
[ADR-036](docs/decisions/036-separate-repository-maintenance-skills-from-runtime-delivered-skills.md),
delivered by
[PLAN-037](docs/plans/PLAN-037-provider-model-catalog-maintenance-skill.md).

One divergence is deliberate, per that ADR's implementation amendment: the
helpers `WorkspaceSubstrateService` generates into other people's workspaces
still sync a generic `skills/` root, because `developer-skills/` is a
cats-runtime convention while those templates are product surface. Tests pin both
roots. Do not "fix" one to match the other.

### MCP Server Configurations

None. This repo does not require a Claude-specific MCP server to work on it.

Note the direction of the relationship: `cats-runtime` *publishes* an MCP facade
(`POST /mcp`, plus the `cats-runtime mcp` stdio proxy) for hosts to consume. That is
product surface under `src/mcp/`, not tooling for the agent editing this repo. See
`docs/mcp-config.md` when wiring an external host against it.

### Preferred Behaviors

- **Precision over speed**: Take time to understand requirements fully
- **Test before commit**: Always validate changes work as expected
- **Document decisions**: Use ADRs for architectural choices
- **Communicate clearly**: Report progress and blockers promptly

### Project-Specific Context

#### Layer boundaries

- `src/core/` — runtime-wide contracts, config, session registry, workspace/worktree
  handling, skills, hydration, usage metering, peers, management adapters
- `src/backends/{cli,api,agent,browser}/` — provider-specific execution. Provider quirks
  belong **inside** the owning adapter; they must not leak up into `core/` or `http/`.
- `src/http/` — the inbound HTTP contract plus the embedded dashboard, playground, and
  provider-setup pages
- `src/mcp/` and `src/acp/` — the MCP and (bounded) ACP facades over that same core

ACP under `src/acp/` is the **client-to-runtime** layer. Peer/A2A execution routing is a
separate **runtime-to-peer** concern that sits below it. Do not collapse the two, and do not
add a second client-facing transport when an existing one can carry the case
(`docs/architecture.md` → "Protocol Layering").

#### Generated files that are committed

`npm run build:ui` regenerates `src/http/ui/generated/runtimeTailwind.ts` and copies
`src/http/ui/pages/*.html` into `public/`. Both outputs are tracked in git.

- **MUST** run `npm run build:ui` and commit the regenerated output after touching
  `src/http/ui/**`. `tests/runtime-ui-build.test.ts` fails when `public/*.html` drifts from
  its source page or is left uncommitted.
- This is also why `npm run typecheck` runs `build:ui` first — the generated module has to
  exist before `tsc` sees it.

#### Tests

- Vitest, single-threaded. `npm test` runs a full `npm run build` first, so it is slow.
  For a focused run use `npx vitest run tests/<name>.test.ts`, building once beforehand if
  that test asserts against `build/runtime/**`.
- Tests **MUST NOT** touch the real `~/.cats/runtime`. Use `createRuntimeTestEnv` /
  `createRuntimeTestPaths` from `tests/support/runtimeTestPaths.ts`; they redirect `HOME`,
  `USERPROFILE`, and `CATS_RUNTIME_DIR` at a temp root.
- `npm run verify:skills` validates the runtime-owned `skills/` library. `npm run
  release:check` (verify:skills + test + `npm pack --dry-run`) is what CI preflight runs.

#### Runtime state

Default listener is `127.0.0.1:3110` (`CATS_RUNTIME_PORT`). Persistent state lives under
`~/.cats/runtime/{config,data,sessions}` (`CATS_RUNTIME_DIR`). A missing `management.yaml`
or `curated-model-catalogs.yaml` falls back to the bundled `config/*.yaml.example`, so
deleting one changes behavior instead of failing loudly.

#### Code style

See `AGENTS.md` → Coding Conventions and Testing Protocols. The rule most likely to bite:
`NodeNext` module resolution means relative imports carry a `.js` extension even when the
file on disk is `.ts` (`import { loadConfig } from '../backends/cli/config.js'`).

#### Pre-release policy

Per `AGENTS.md`, this runtime has never had a stable release. When a route, payload shape,
event format, env var, or backend adapter contract changes, delete the superseded path in the
same change — no aliases, fallbacks, or compatibility shims — and update its consumers, tests,
and docs to the current contract.

---

## Maintenance

This file is maintained by Claude only. Other agents should not modify this file.

Last updated: 2026-09-02
