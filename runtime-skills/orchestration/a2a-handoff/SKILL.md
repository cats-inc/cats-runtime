---
name: a2a-handoff
description: Prepare a reviewable same-environment handoff that separates protocol artifacts, durable project memory, and procedural next steps.
family: orchestration
slug: a2a-handoff
role: collaboration_handoff
packageKind: role
version: 1.0.0
capabilityTags:
  - handoff
  - a2a
  - collaboration
  - project-memory
productTags:
  - runtime
  - collaboration
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - project-memory-sync
---

# A2A Handoff

Prepare a bounded handoff for another agent working in the same repo and
environment.

## When To Use

- A task is changing owners between agents.
- A long-running implementation needs a resumable checkpoint.
- A protocol-facing review needs durable references rather than chat-only memory.

## Required Reads

Before writing a handoff:

1. Read `AGENTS.md`.
2. Read your agent-specific file.
3. Read `docs/AGENT-GUIDE.md`.
4. Read the active spec/plan/ADR files that govern the current task.

Do not assume another same-environment agent can skip those reads just because
you already performed them.

## Handoff Workflow

1. State the exact task boundary being handed off.
2. Record the current implementation state in durable project-memory docs if the
   information should survive chat/session loss.
3. Link the canonical project-memory artifacts the next agent must read.
4. Summarize the next concrete step, blocker, or decision gate.
5. Distinguish clearly between:
   - protocol-layer artifacts in `docs/a2a/`
   - durable project memory in repo markdown
   - procedural guidance in skills

## What To Preserve

- active branch or commit context if it matters
- modified files and why they changed
- validation already run and its outcome
- unresolved blockers, assumptions, or review points
- the exact docs that now hold the durable state

## Where To Write Durable State

- external facts or source comparisons: `docs/research/`
- architecture or boundary decisions: `docs/decisions/`
- approved feature requirements: `docs/specs/`
- implementation sequencing and progress: `docs/plans/`
- delivery truth when governance status changed materially: `PROGRESS.md`

## Do Not

- do not store durable state only in the handoff skill text
- do not rewrite protocol examples to carry repo status
- do not treat `SKILL.md` as the canonical source for progress or decisions
- do not hand off work without naming the next required read set
