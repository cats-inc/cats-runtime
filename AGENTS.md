# AGENTS.md

> Cross-agent guidelines following [AAIF](https://aaif.io) standards.
> All AI agents (Claude, Gemini, Codex, etc.) MUST read this file first.

## Instruction Priority and Compliance

### RFC 2119 Keywords

This document uses RFC 2119 keywords to indicate requirement levels:

| Keyword | Meaning | Compliance |
|---------|---------|------------|
| **MUST** / **REQUIRED** | Absolute requirement | Mandatory - failure to comply is a critical error |
| **MUST NOT** / **SHALL NOT** | Absolute prohibition | Mandatory - violating this is a critical error |
| **SHOULD** / **RECOMMENDED** | Strong suggestion | Highly recommended unless good reason not to |
| **SHOULD NOT** / **NOT RECOMMENDED** | Strong discouragement | Should be avoided unless good reason |
| **MAY** / **OPTIONAL** | Truly optional | Use discretion |

### Instruction Priority Hierarchy

When instructions appear to conflict, follow this priority order (highest to lowest):

1. **Security and Safety**: Never compromise security or user data
2. **MUST/MUST NOT directives**: Absolute requirements from this file
3. **Agent-specific file directives**: Requirements from your `<AGENT>.md` file
4. **SHOULD/SHOULD NOT recommendations**: Strong suggestions
5. **Best practices**: General guidance
6. **User preference**: Explicit user instructions override lower priorities but not security

### Common Mistakes to Avoid

**DO NOT:**
- Edit other agents' specific files (each agent owns their own file)
- Skip reading AGENTS.md when starting a new session
- Ignore the `dyu` command - always confirm you've read instructions
- Make architectural decisions when a Conductor is assigned
- Commit without updating related documentation
- Mix multiple unrelated changes in one commit
- Modify core architecture without documenting in ADR

**DO:**
- Read AGENTS.md and your agent-specific file at the start of every session
- Confirm understanding when asked "dyu"
- Check for existing documentation before creating new files
- Update tests when modifying code
- Follow the Development Workflow for all changes
- Ask for clarification when instructions are unclear
- Respect file ownership boundaries

### Enforcement and Validation

Agents SHOULD self-validate compliance by:
1. Re-reading critical sections of AGENTS.md before major actions
2. Checking that file modifications align with file ownership rules
3. Verifying that changes follow the Development Workflow
4. Confirming that MUST/MUST NOT directives are being followed

If an agent realizes it has violated a MUST/MUST NOT directive:
1. **Stop immediately**
2. **Inform the user of the violation**
3. **Propose corrective action**
4. **Do not proceed until correction is approved**

---

## Project Metadata

- **Type**: single-project
- **Subprojects**: N/A

> **Monorepo Detection Rule**: If a first-level subdirectory contains its own `AGENTS.md`, that directory is considered a subproject, and this project is treated as a monorepo.

---

## Project Overview

**Purpose**: Unified runtime service for upper-layer products, with embedded CLI
execution today and API backends later.

**Background**: This project separates product-facing applications from
provider-specific execution details while keeping the runtime itself in one
service. The CLI runtime now lives directly in this repo under `src/backends/cli`.
Future phases will add API-native and local-model backends behind the same
contract.

**Key Features**:
- Stable health and session endpoints for upstream apps
- Streamed turn output over SSE and NDJSON
- Embedded dashboard at `/`
- Backend-specific execution isolated behind `core + backends/* + http`

---

## Tech Stack

| Category | Technology | Version |
|----------|------------|---------|
| Language | TypeScript | 5.x |
| Runtime | Node.js | 22+ |
| HTTP | Built-in `http` + `fetch` | Node native |
| Testing | Vitest | 3.x |
| Build | TypeScript compiler | 5.x |

**Additional Tools**:
- Local provider CLIs such as `claude`, `codex`, `gemini`, `cursor-agent`, `kiro-cli`, `opencode`

---

## Development Workflow

<!-- Overview of the development process. See detailed sections below for specific rules. -->

```
1. Plan     → Create spec in docs/specs/ (for complex features)
2. Branch   → Create feature/fix branch
3. Implement→ Follow Coding Conventions
4. Test     → Run tests (see Testing Protocols)
5. Commit   → Use Conventional Commits format
6. PR       → Submit PR (see PR Guidelines)
7. Review   → Peer review + CI checks
8. Merge    → Squash and merge
```

**Quick Reference**:
- Specs & Plans: `docs/specs/`, `docs/plans/`
- Decisions: `docs/decisions/` (ADR)
- Shortcuts: `cnp` (commit & push), `umd` (update docs)

---

## Agent Reading Order

**CRITICAL**: All agents MUST follow this reading order before taking any action:

1. **MUST read this file first** (`AGENTS.md`) - Stop after reading and confirm understanding
2. **MUST read your agent-specific file**:
   - Claude → `CLAUDE.md`
   - Gemini → `GEMINI.md`
   - Codex → `CODEX.md`
3. **MUST consult `docs/AGENT-GUIDE.md`** for project-specific SOPs before performing tasks
4. **MUST NOT read other agents' specific files**

### Document Responsibilities

| Document | Contains | When to Consult |
|----------|----------|-----------------|
| `AGENTS.md` | Rules, conventions, structure | Always read first |
| `CLAUDE.md` / `GEMINI.md` / `CODEX.md` | Agent-specific configs | After AGENTS.md |
| `docs/AGENT-GUIDE.md` | Project SOPs, domain knowledge, common task procedures | When performing tasks |

---

## Command Aliases

When the user uses these shortcuts, you MUST execute the corresponding action exactly as specified:

| Alias | Meaning | Required Action |
|-------|---------|----------------|
| `dyu` | Do you understand | **MUST** read project root `AGENTS.md`, then read your agent-specific file (e.g., `CLAUDE.md`). **MUST** respond with exactly: "I am [Agent Name], and I understand." to confirm reading completion. Do NOT take any other action until confirmation is given. |
| `cnp` | Commit and push | **MUST** stage all changes with `git add .`, create a commit with an appropriate message following Conventional Commits format, and push to remote. |
| `umd` | Update markdown docs | **MUST** review and update all relevant markdown documentation affected by recent changes. |
| `rlc` | Review last commit | **MUST** review the last commit for potential issues (logic errors, missing files, incorrect changes, etc.) and report findings. |

### Command Execution Rules

1. **Execute immediately**: When a command alias is given, execute it before asking clarifying questions
2. **Complete execution**: Do not partially execute - complete the full action sequence
3. **Confirm completion**: After execution, report what was done

---

## Project Structure Convention

### Required (Root Level)

```
project-root/
├── README.md              # Project overview + Current Status
├── ROADMAP.md             # Long-term planning
├── PROGRESS.md            # Work packages and implementation status
├── CONTRIBUTING.md        # Contribution guide
├── LICENSE                # MIT License
│
├── AGENTS.md              # This file - cross-agent rules
├── CLAUDE.md              # Claude-specific
├── GEMINI.md              # Gemini-specific
├── CODEX.md               # Codex-specific
│
├── .gitignore
├── .gitattributes
├── .editorconfig
├── .env.example
│
├── src/                   # Source code (required)
├── tests/                 # Test files (required)
└── docs/                  # Documentation (required)
```

### Optional Directories

```
├── skills/                # Agent Skills (see Agent Skills section)
│   ├── README.md
│   └── <skill-name>/
│       └── SKILL.md
│
├── scripts/               # Build/deployment scripts
│   ├── windows/           # PowerShell (.ps1), Batch (.bat, .cmd)
│   ├── linux/             # Bash (.sh)
│   └── macos/             # Bash (.sh), Zsh
│
├── config/                # Configuration files
│   └── *.yaml.example     # Config templates
│
└── assets/                # Static resources
    └── images/, fonts/, etc.
```

### For Monorepo Subprojects

Each subproject directory should contain:
- `AGENTS.md` (subproject-specific rules)
- `README.md`
- `CLAUDE.md`, `GEMINI.md`, `CODEX.md` (if needed)
- `.gitignore` (if different from root)
- `docs/` (subproject documentation)

---

## Agent Skills

This project supports [Agent Skills](https://agentskills.io), an open standard adopted by Claude Code, Codex, and Gemini CLI for structured, reusable agent instructions.

### How It Works

Skills live in `skills/` (version-controlled) and are synced to each agent's discovery path via `Sync-AgentSkills.ps1`. Each agent automatically discovers skills from its own directory.

| Agent | Discovery Path |
|-------|---------------|
| Claude Code | `.claude/skills/<name>/SKILL.md` |
| Codex | `.agents/skills/<name>/SKILL.md` |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` |

### Syncing Skills

After adding or modifying skills, run:
```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

See `skills/README.md` for full details on the SKILL.md format and available skills.

---

## Naming Conventions

### Directories

| Rule | Convention | Example |
|------|------------|---------|
| All directories | lowercase + kebab-case | `user-service/`, `api-gateway/` |

### Files by Type

| Type | Convention | Example |
|------|------------|---------|
| Python | snake_case | `user_service.py`, `test_user.py` |
| JavaScript/TypeScript | camelCase or kebab-case | `userService.ts`, `user-service.ts` |
| React Components | PascalCase | `UserProfile.tsx`, `NavBar.jsx` |
| Configuration | lowercase | `.env`, `config.yaml` |
| Example files | `*.yaml.example` | `config.yaml.example` |

### Scripts by Platform

| Platform | Convention | Example |
|----------|------------|---------|
| Windows (PowerShell) | PascalCase Verb-Noun | `Setup-Environment.ps1` |
| Linux/macOS (Bash) | kebab-case | `setup-environment.sh` |

---

## Coding Conventions

<!-- TODO: Customize based on your tech stack -->

### General Principles

- **DRY** (Don't Repeat Yourself): Extract common logic into reusable functions
- **KISS** (Keep It Simple, Stupid): Prefer simple solutions over complex ones
- **Single Responsibility**: Each function/class should do one thing well

### Code Style

> **Note**: This project uses `.editorconfig` for consistent formatting. All agents MUST respect `.editorconfig` settings (indentation, line endings, final newline, etc.).

| Aspect | Convention |
|--------|------------|
| Indentation | [Spaces (2/4) or Tabs] |
| Line length | [80 / 100 / 120 characters] |
| Quotes | [Single / Double] |
| Trailing commas | [Yes / No] |
| Semicolons (JS/TS) | [Yes / No] |

### Language-Specific Rules

<!-- Uncomment and customize the section for your language -->

<!--
#### Python
- Use type hints for function signatures
- Use `async/await` for I/O operations
- Prefer f-strings over `.format()` or `%`
- Use dataclasses or Pydantic for data structures
-->

<!--
#### TypeScript
- Always use strict mode
- Prefer `interface` over `type` for object shapes
- Use `async/await` over raw Promises
- Avoid `any` type; use `unknown` if type is uncertain
-->

<!--
#### C# (.NET)
- Use PascalCase for public members, _camelCase for private fields
- Prefix interfaces with "I" (e.g., `IUserService`)
- Use `async/await` with "Async" suffix for async methods
- Use dependency injection via constructor
-->

### Error Handling

- [Describe your error handling strategy]
- [e.g., Use custom exception classes, Always log errors with context]

### Dependency Injection

- [Describe your DI approach]
- [e.g., Constructor injection preferred, Avoid service locator pattern]

---

## Testing Protocols

<!-- TODO: Customize based on your testing strategy -->

### Testing Framework

- **Unit Tests**: [pytest / Jest / NUnit / xUnit]
- **Integration Tests**: [pytest / Supertest / etc.]
- **E2E Tests**: [Playwright / Cypress / Selenium]

### Test Structure

```
tests/
├── unit/           # Unit tests (isolated, fast)
├── integration/    # Integration tests (with dependencies)
└── e2e/            # End-to-end tests (full system)
```

### Testing Rules

1. **Before Commit**: All unit tests must pass (`npm test` / `pytest` / `dotnet test`)
2. **Coverage Target**: [e.g., Minimum 80% code coverage]
3. **Naming Convention**: `test_<function_name>_<scenario>` or `describe/it` blocks
4. **Mocking**: Use [Mock library] for external dependencies
5. **CI Requirement**: All tests must pass before merge

### What to Test

| Layer | Test Type | Coverage |
|-------|-----------|----------|
| Domain/Core | Unit tests | High (90%+) |
| Application/Service | Unit + Integration | Medium (80%+) |
| Infrastructure | Integration | As needed |
| API/Controllers | Integration + E2E | Critical paths |

---

## Pull Request Guidelines

### PR Title Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

Examples:
feat(auth): add OAuth2 login support
fix(api): resolve null pointer in user endpoint
docs(readme): update installation instructions
```

### PR Checklist

Before submitting a PR, ensure:

- [ ] Code follows project coding conventions
- [ ] All tests pass locally
- [ ] New code has appropriate test coverage
- [ ] Documentation is updated (if applicable)
- [ ] No secrets or credentials in code
- [ ] PR title follows conventional commit format

### Review Process

1. **Self-review**: Author reviews their own changes first
2. **Peer review**: At least one approval required
3. **CI checks**: All automated checks must pass
4. **Merge**: Squash and merge (or your preferred strategy)

### PR Size Guidelines

- **Small PRs preferred**: Aim for < 400 lines changed
- **Single purpose**: One feature or fix per PR
- **Break large changes**: Split into smaller, reviewable chunks

---

## Script Standards

All scripts MUST include help documentation describing parameters and usage.

### PowerShell (.ps1)

Use comment-based help at the top of the script:

```powershell
<#
.SYNOPSIS
    Brief description of what the script does.

.DESCRIPTION
    Detailed description of the script's purpose and behavior.

.PARAMETER ParamName
    Description of the parameter.

.EXAMPLE
    .\Script-Name.ps1 -ParamName "value"
    Description of what this example does.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ParamName
)
```

Users can view help with: `Get-Help .\Script-Name.ps1 -Full`

### Bash (.sh)

Include a usage function or header comments:

```bash
#!/bin/bash
#
# Script: script-name.sh
# Description: Brief description of what the script does.
#
# Usage: ./script-name.sh [OPTIONS] <ARGUMENTS>
#
# Options:
#   -h, --help     Show this help message
#   -v, --verbose  Enable verbose output
#
# Arguments:
#   <arg1>         Description of argument
#
# Examples:
#   ./script-name.sh -v "value"
#

usage() {
    echo "Usage: $0 [OPTIONS] <ARGUMENTS>"
    echo "  -h, --help     Show this help message"
    exit 1
}
```

---

## Agent Capabilities & Collaboration

### Project Roles

| Role | Assigned Agent | Responsibilities |
|------|----------------|------------------|
| **Conductor** | Unassigned | Orchestration, Planning, Status Tracking |
| **Architect** | Unassigned | System Design, Tech Stack Decisions |
| **Security Specialist** | Unassigned | Security Audits, Compliance, Vulnerability Management |
| **UX Lead** | Unassigned | User Experience, Frontend Standards |
| **Specialist** | All others | Implementation, Testing, Documentation |

> **Note**: Assign roles by filling in the "Assigned Agent" column.

### Capability Matrix

| Agent | Write Code | Review | Test | Docs |
|-------|------------|--------|------|------|
| Claude | Yes | Yes | Yes | Yes |
| Gemini | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | Yes | Yes |

### Collaboration Rules

1.  **Hierarchy Protocol**: If a Conductor is assigned in the **Project Roles** table, other agents MUST act as Specialists. Specialists MUST prioritize tasks assigned by the Conductor and MUST align all architectural decisions with the Conductor's plan. Specialists MUST NOT make independent architectural decisions without Conductor approval.
2.  **Task Assignment**: The Conductor assigns tasks via `docs/plans/` (using "Assigned To" field) or explicitly in conversation. Specialists MUST acknowledge task assignment before beginning work.
3.  **Status Tracking**: The Conductor is responsible for maintaining the "Current Status" section in `README.md` as the single source of truth for project progress. Other agents MUST NOT modify this section without Conductor approval.
4.  **Self-review prohibited**: An agent MUST NOT review code it wrote itself. This is a strict security requirement.
5.  **Cross-review recommended**: Important changes SHOULD be reviewed by a different agent when possible.
6.  **Documentation sync**: The agent modifying code is responsible for updating related docs. This MUST be done in the same session/PR.
7.  **File ownership**:
    *   Each agent MUST maintain ONLY its own specific file
    *   Claude maintains `CLAUDE.md` only
    *   Gemini maintains `GEMINI.md` only
    *   Codex maintains `CODEX.md` only
    *   All agents MAY update `AGENTS.md` but MUST provide clear justification in commit message

### Handoff Protocol

When completing a task or handing off to another agent:

1. Use **git commit message** to record what was done (include agent name if relevant)
2. Clearly state what was done and what remains in conversation
3. Update `README.md` Current Status section if applicable

> **Note**: Do NOT add agent annotations in source code or documentation files.

### Conflict Resolution

- When agents disagree, ask the human for decision
- Document the decision in `docs/decisions/`

---

## Service & Port Management

### Port Registration Rules

1. **MUST** check `docs/services.md` to understand this project's port usage
2. **SHOULD** check the bootstrap project's `docs/port-registry.md` for cross-project port conflicts before assigning new ports
3. **MUST** update `docs/services.md` when adding or changing services that listen on ports
4. **SHOULD** update the bootstrap project's `docs/port-registry.md` when registering new ports
5. **MUST** warn the user if a port conflict is detected (do NOT treat as error)
6. **SHOULD** suggest the next available port when a conflict is found

### When Adding a New Service

1. Pick a port from the suggested ranges in `docs/port-registry.md`
2. Verify the port is not already in use by checking both `docs/services.md` and the central registry
3. Make the port configurable via an environment variable
4. Document the service in `docs/services.md`

---

## Security Guidelines

### Prohibited Actions

- Never commit secrets, API keys, or credentials
- Never execute `rm -rf /` or similar destructive commands
- Never modify files outside the project directory without explicit permission

### Sensitive Data Handling

- Use `.env` for secrets (never commit)
- Provide `.env.example` with placeholder values
- Check for accidental secret commits before pushing

---

## Documentation Standards

### Required Documents

**Root Level:**

| Document | Purpose |
|----------|---------|
| `PROGRESS.md` | Work packages and implementation status |
| `ROADMAP.md` | Long-term planning and milestones |

**In `docs/`:**

| Document | Purpose |
|----------|---------|
| `README.md` | Documentation index + expected documents list |
| `AGENT-GUIDE.md` | Agent-specific collaboration guide |
| `terminology.md` | AAIF/A2A/MCP terminology |
| `a2a/` | A2A agent card and task templates |
| `requirements.md` | Requirements specification |
| `architecture.md` | System architecture |
| `api.md` | API specification (REST/WebSocket/GraphQL) |
| `setup-guide.md` | Environment setup |
| `testing.md` | Testing strategy |
| `deployment.md` | Deployment instructions |
| `security-guidelines.md` | Security policies |
| `SCRIPT-STANDARDS.md` | Script standards and naming conventions |
| `research/` | External research notes and sources |
| `specs/` | Feature specifications (SPEC-NNN-title.md) |
| `plans/` | Implementation plans (PLAN-NNN-title.md) |
| `decisions/` | Architecture Decision Records (ADR-NNN-title.md) |

### Document Creation

- Agents should create documents as needed
- Follow templates in `docs/`
- Update `docs/README.md` index when adding new documents

### Architecture Decision Records (ADR)

**Purpose**: Record important technical decisions so all agents understand *why* choices were made.

**When to create ADR**:
- Choosing a framework, library, or technology
- Making architectural decisions (patterns, structure)
- Any decision with multiple valid alternatives

**Rules for Agents**:
1. **Before making a decision**: Check `docs/decisions/` for existing relevant records
2. **After making a decision**: Create ADR in `docs/decisions/NNN-title.md`
3. **Numbering**: Use sequential numbers (001, 002, 003...)
4. **Template**: Follow `docs/decisions/000-template.md`

**Benefits**:
- Future agents understand past decisions without re-discussing
- Prevents conflicting suggestions from different agents
- Creates institutional memory across sessions

### Feature Specifications

**Purpose**: Define *what* to build before implementation begins.

**When to create Spec**:
- New features with multiple components
- Changes that affect multiple files or systems
- Features requiring user/stakeholder approval

**Rules for Agents**:
1. **Before implementing**: Create spec for complex features
2. **Location**: `docs/specs/SPEC-NNN-title.md`
3. **Numbering**: Use sequential numbers (001, 002, 003...)
4. **Template**: Follow `docs/specs/000-template.md`
5. **Review**: Get approval before proceeding to implementation

### Implementation Plans

**Purpose**: Define *how* to build a feature - actionable tasks and phases.

**When to create Plan**:
- After spec is approved
- For features requiring multiple implementation phases
- When coordinating work across multiple agents/developers

**Rules for Agents**:
1. **After spec approval**: Create implementation plan
2. **Location**: `docs/plans/PLAN-NNN-title.md`
3. **Link to spec**: Reference the related SPEC document
4. **Template**: Follow `docs/plans/000-template.md`
5. **Update progress**: Mark tasks complete as you work

---

## Git Conventions

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: restructure code
test: add tests
style: formatting changes
chore: maintenance tasks
```

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Refactoring

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.2.1 | 2026-01-05 | Normalize compliance headings and template guidance |
| 1.2.0 | 2025-01 | Add Development Workflow overview, Feature Specifications, Implementation Plans (CDD support) |
| 1.1.0 | 2025-01 | Add Project Overview, Tech Stack, Coding Conventions, Testing Protocols, PR Guidelines (AAIF compliance) |
| 1.0.0 | 2025-01 | Initial framework |

---

*This file follows [AAIF AGENTS.md](https://agents.md) standard.*
