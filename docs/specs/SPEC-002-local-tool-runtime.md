# SPEC-002: Shared Local Tool Runtime

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Owner** | Codex |
| **Reviewer** | User-approved via implementation kickoff |

## Summary

`cats-runtime` needs a shared local tool runtime so API-backed and future
hybrid sessions can operate on workspaces with the same policy surface that
users expect from coding agents. This runtime should not live under one backend;
it should be a core facility that enforces workspace boundaries, permission
policies, navigation/materialization helpers, and transcripted tool execution
across providers.

## Goals

- Provide a backend-neutral tool runtime for local filesystem and shell actions
- Enforce workspace-scoped path and permission policy centrally
- Emit normalized tool-call and tool-result events that can be streamed and
  persisted in runtime-managed transcripts
- Make tool behavior reusable for API, Ollama, and future mixed execution modes

## Non-Goals

- Replacing provider-native tools inside existing CLI subprocesses
- GUI/browser automation or computer-use control in the first version
- Network-capable tools beyond explicitly approved future additions
- Full MCP server hosting inside the initial tool runtime

## User Stories

- As a developer using API-backed sessions, I want the model to read and modify
  files safely inside my workspace so that the API backend can behave like a
  coding agent instead of a plain chat endpoint.
- As an operator, I want tool permissions enforced in one place so that backend
  differences do not create inconsistent security behavior.

## Requirements

### Functional Requirements

1. The runtime shall provide core tools for file read, file write, patch apply,
   glob/list, grep/search, and shell execution.
2. The runtime shall enforce `workspaceMode` and permission policies before any
   tool mutates files or executes commands.
3. The runtime shall reject path access outside the allowed workspace boundary.
4. The runtime shall emit normalized tool call and tool result records that can
   be streamed to clients and persisted in transcripts.
5. The runtime shall support per-turn limits including timeout, cancellation,
   and max-step guardrails.
6. The runtime shall be backend-neutral so API/Ollama backends call the same
   policy and handler layer.

### Non-Functional Requirements

- **Performance**: Common read/search tools should add minimal latency relative
  to model response time; handlers should avoid unnecessary process spawning.
- **Security**: Mutating tools must be policy-gated; shell execution must be
  workspace-scoped and explicitly controllable.
- **Scalability**: The design should allow more tools or policy profiles
  without requiring route-level changes.

## Design Overview

The shared tool runtime lives under `src/core/tools` and is composed of:

- a registry that exposes tool definitions to backend orchestrators
- policy helpers that evaluate workspace/path/permission constraints
- tool handlers that execute the approved action
- transcript/event helpers that normalize tool activity for streaming/history

Backend-specific orchestrators remain responsible for converting provider tool
requests into calls into this shared runtime.

## Current Implementation Notes

- Workspace-relative path checks are now shared across direct tool handlers and
  structured patch application, so `apply_patch` cannot bypass the same
  boundary rules as `read_file` / `write_file`.
- The shared tool surface now includes machine-readable path inspection,
  bounded multi-file read inspection, and proposed-file diff inspection plus
  explicit directory materialization helpers so hosts do not need ad hoc shell
  fallbacks for common
  navigation/setup/planning tasks.
- Mutating flows now reject symbolic-link/junction alias paths and existing
  hardlinked mutation targets to reduce accidental writes through aliased
  filesystem paths.
- The runtime now performs bounded rollback for multi-file `apply_patch`
  failures so earlier file content/presence changes are restored when a later
  hunk aborts the patch.
- Single-file `write_file` and `edit_file` now stage sibling temp files and
  atomically replace the target so failed commit paths restore the previous
  file contents instead of leaving partially written text behind.
- The safety model still does **not** yet guarantee full transactional
  rollback for general `write_file` / `edit_file` operations, inode-level
  metadata restoration, or empty parent-directory cleanup.

## Dependencies

- [ADR 005: Introduce a Backend-Neutral Runtime Facade for CLI and API Backends](../decisions/005-backend-neutral-runtime-and-api-backend.md)
- [PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama](../plans/PLAN-003-api-backend.md)

## Open Questions

- [ ] Should shell execution use one generic command tool or separate read-only
      and write-capable profiles?
- [ ] Should transcript compaction/summarization be aware of tool activity in
      the first version, or only in a later optimization pass?
- [ ] Which additive network-aware tools, if any, should be allowed later?

## References

- [PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama](../plans/PLAN-003-api-backend.md)

---

*Created: 2026-03-16*
*Author: Codex*
*Related Plan: [PLAN-003](../plans/PLAN-003-api-backend.md)*
