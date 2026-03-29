---
name: project-memory-sync
description: Keep durable repo memory synchronized with actual implementation and validation outcomes during multi-agent collaboration.
family: orchestration
slug: project-memory-sync
role: project_memory_sync
packageKind: role
version: 1.0.0
capabilityTags:
  - documentation
  - governance
  - synchronization
  - collaboration
productTags:
  - runtime
  - docs
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - a2a-handoff
---

# Project Memory Sync

Update durable repo memory when implementation truth changes.

## Authority Boundary

`AGENTS.md` and `docs/AGENT-GUIDE.md` remain the baseline authority for
mandatory collaboration rules.

Use this skill as a focused workflow wrapper for syncing durable markdown
project memory after implementation or validation changes. It is not a second
governance source of truth.

## When To Use

- You finished a slice that changed the real status of a spec, plan, ADR, or
  progress document.
- A review, validation run, or external research materially changed the
  understanding of the task.
- Another agent could be misled unless the markdown memory layer is updated.

## Required Reads

Before syncing project memory:

1. Read `AGENTS.md`.
2. Read your agent-specific file.
3. Read `docs/AGENT-GUIDE.md`.
4. Read the currently governing spec/plan/ADR before editing their status.

## Sync Rules

- Update the smallest durable artifact that truthfully captures the change.
- Prefer updating an existing spec/plan/research note over creating ad-hoc
  scratch markdown.
- Keep protocol examples in `docs/a2a/` focused on interoperability only.
- Keep procedural guidance in skills focused on workflow only.

## Write Targets

- `docs/research/`: external protocol findings, validation notes, comparison
  results, and pilot observations
- `docs/decisions/`: accepted architectural or governance decisions
- `docs/specs/`: what the project is trying to achieve and current delivery
  stage
- `docs/plans/`: how the current implementation track is sequenced and what is
  done
- `PROGRESS.md`: only when overall governance truth materially changed

## Synchronization Checklist

1. Confirm what changed in implementation reality.
2. Update the governing plan/spec status and progress log.
3. Add or update research notes if the change depended on external facts or
   validation evidence.
4. Update indexes such as `docs/README.md`, `docs/specs/README.md`,
   `docs/plans/README.md`, or `docs/research/README.md` when new artifacts are
   added or statuses changed.
5. Make sure another same-environment agent can recover the task state by
   reading repo docs, not by reading chat history.

## Do Not

- do not duplicate long-lived facts inside `SKILL.md`
- do not treat a commit message as a substitute for updating project memory
- do not mark a plan/spec complete until the validation for that slice actually
  ran
