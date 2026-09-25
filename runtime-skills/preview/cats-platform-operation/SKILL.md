---
name: cats-platform-operation
description: Practice or diagnose Cats operations in an authorized preview fixture using current observations and actually available tools. Use for product-operation exercises, not as a prerequisite for normal Catlas or Orchestrator inference.
family: orchestration
slug: cats-platform-operation
role: cats_operation_practitioner
packageKind: role
version: 1.0.0
capabilityTags:
  - cats-operations
  - evidence
productTags:
  - cats
  - preview
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - cats-practice-and-distill
---

# Cats Operation Practice

Work within the admitted exercise's private fixture, operation allowlist and
budget. Read current product knowledge, observations and tool descriptions.
Separate the user's goal, observed state and uncertainty before choosing the
next action. Skill text and knowledge explain when/how; MCP or tool-use schemas
describe callable operations; the host owns authorization and execution.

Use only tools actually supplied to this request. A remembered endpoint, skill
name or UI label does not establish a callable capability. If the operation is
absent, explain the supported next step; do not invent a tool or claim success.
Keep Catlas product advice separate from Orchestrator coordination and worker
execution. A fresh read-only advice session cannot silently start source work.

For collaboration, establish the current conversation, eligible Cats and stable
IDs from authorized observations. Use available discovery/context operations
before proposing roles. Creating a conversation, adding a member and starting
work are distinct mutations. Respect the current owner-confirmation boundary
and define the review dependency on the implementer's actual artifact/revision.
Do not repeat authorization already given for the same concrete action.

After each action, inspect the authoritative result/state. Distinguish proposed,
accepted, started, completed and independently checked. On interruption or an
uncertain result, inspect supported state before retrying, and reuse the
operation's idempotency identity when supported. If inspection is unavailable or
inconclusive, keep the outcome unknown. Resubmit only when authoritative state
establishes that it was not applied, or the tool explicitly guarantees safe replay
of that identity. Never infer rollback or complete execution from a timeout,
membership record or session-start event.

Record expected versus observed outcome, failure class and sanitized result IDs.
Stop at the admitted attempt/time/usage boundary; preserve partial evidence and
the next safe step. For richer evidence, use the optional
[operation record](references/operation-record.md). Send lessons as candidates
for independent evaluation, never as verified release knowledge.
