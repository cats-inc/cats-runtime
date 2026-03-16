# PLAN-003: API and Ollama Backend for Claude, OpenAI, Gemini, and Ollama

> Implementation plan for adding API-key and local-model execution under `src/backends/api`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Claude |
| **Reviewer** | Gemini |

## Related Spec

N/A. This plan is the delivery blueprint for the next major backend track already
called out in the README, ADR 002, and PROGRESS.

## Overview

`cats-runtime` already exposes the correct public HTTP contract for session
management, streaming, history, and dashboard integration. The missing piece is
an API-native execution path that can sit beside `src/backends/cli` without
forking the inbound API surface.

The implementation should add `src/backends/api` as a sibling backend and make
backend selection an instance-level concern. A caller should keep sending
`provider + instance`; the runtime should decide whether that instance is backed
by a local CLI process or a remote API transport.

Initial scope:

- `claude` via Anthropic API
- `openai` via OpenAI Responses API
- `gemini` via Google Gemini API
- `ollama` via local HTTP transport

The API backend should match or exceed current CLI ergonomics by combining:

- streaming text and tool events over the existing SSE / NDJSON contract
- runtime-managed session state, resume, fork, and history
- local workspace-aware tools hosted by `cats-runtime`
- optional provider-native optimizations where they are clearly better than the
  local fallback

## Goals

1. Preserve the existing public HTTP contract for upstream apps and the
   embedded dashboard.
2. Let one provider expose both CLI and API instances without adding a new
   request dimension beyond `instance`.
3. Support `create`, `message`, `resume`, `fork`, `close`, `delete`, `history`,
   and `observe` for API sessions.
4. Keep secrets out of `providers.yaml`; configuration should reference env var
   names, not inline API keys.
5. Deliver a provider-neutral local tool loop so API and Ollama sessions can perform
   workspace operations comparable to CLI agents.

## Non-Goals for the First Delivery

- External discovery for API sessions
- Audio / realtime / multimodal live transports
- GUI computer-use automation from `cats-runtime` itself
- Full parity with every provider-native hosted tool on day one

## Target Capability Matrix

| Capability | Claude API | OpenAI API | Gemini API | Ollama | Plan |
|------------|------------|------------|------------|--------|------|
| Streamed text responses | Yes | Yes | Yes | Yes | MVP |
| Tool / function calling | Yes | Yes | Yes | Yes | MVP |
| Runtime-managed resume | Yes | Yes | Yes | Yes | MVP |
| Runtime-managed fork | Yes | Yes | Yes | Yes | MVP |
| Local workspace tools | Yes | Yes | Yes | Yes | MVP |
| Provider-native caching optimizations | Prompt caching | Response continuation / background mode | Context caching | Model warm state only | Phase 4 |
| Provider-native hosted tools | Server tools | Built-in tools | Google Search / code execution / URL context | Native tool schema only | Phase 4 |
| Model discovery / lifecycle | N/A | N/A | N/A | Yes | Phase 3 |
| External session discovery | No | No | No | No | Out of scope |

## Planned Configuration Model

Keep `providers.yaml` as the topology source, but make each instance declare
which backend kind it uses.

Example target shape:

```yaml
version: 1

providers:
  claude:
    default_instance: api
    instances:
      native:
        backend: cli
        environment: native
        command: claude
        runner: auto
        projects_dir: ~/.claude/projects
      api:
        backend: api
        transport: anthropic
        api_key_env: ANTHROPIC_API_KEY
        model: claude-sonnet-4-5
        max_output_tokens: 32000
        tool_profile: standard

  openai:
    default_instance: api
    instances:
      api:
        backend: api
        transport: openai
        api_key_env: OPENAI_API_KEY
        model: gpt-5
        tool_profile: standard

  gemini:
    default_instance: api
    instances:
      api:
        backend: api
        transport: google
        api_key_env: GEMINI_API_KEY
        model: gemini-2.5-pro
        tool_profile: standard

  ollama:
    default_instance: local
    instances:
      local:
        backend: api
        transport: ollama
        base_url: http://127.0.0.1:11434
        model: qwen3:latest
        tool_profile: standard
```

Rules:

- `backend` defaults to `cli` for backward compatibility when omitted.
- `api_key_env` is required for `backend: api`.
- API instances may optionally define `base_url`, `base_url_env`,
  `organization_env`, `project_env`, `headers`, `timeout_ms`, `max_retries`,
  `max_output_tokens`, and `tool_profile`.
- `transport: ollama` does not require an API key for the default local runtime,
  but may still use one if targeting `ollama.com/api` or a secured remote host.
- Secrets stay in `.env` or host env; YAML only stores references and non-secret
  defaults.

## Required Architecture Changes

### 1. Separate Shared Runtime Contracts from CLI Internals

The current HTTP layer imports `CliRuntimeConfig`, `SessionRegistry`,
`WorkerPool`, and `ProviderName` directly from `src/backends/cli`. That makes
`cli` the de facto core.

Refactor target:

- move stable session and capability contracts into `src/core`
- keep CLI-only discovery and subprocess logic inside `src/backends/cli`
- introduce a backend-neutral execution seam that both CLI and API backends
  implement

Suggested core abstractions:

```ts
interface ExecutionHandle {
  readonly alive: boolean;
  readonly busy: boolean;
  streamMessage(message: string): AsyncGenerator<StreamEvent>;
  kill(): void;
  on(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
  off(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
}

interface BackendAdapter {
  kind: 'cli' | 'api';
  getCapabilities(provider: RuntimeProviderName, instanceId?: string): ProviderCapabilities;
  createExecution(
    sessionId: string,
    provider: RuntimeProviderName,
    opts: ProviderSpawnOptions,
    instanceId?: string,
  ): ExecutionHandle;
}
```

This allows the current pool-driven routes to stay mostly unchanged while the
implementation underneath becomes backend-aware.

### 2. Make Provider Instances Backend-Aware

`resolveProviderInstance()` should return either a CLI instance config or an API
instance config. The HTTP layer should not care which one it received beyond
metadata needed for display and capability checks.

Recommended config typing:

- `CliProviderInstanceConfig`
- `ApiProviderInstanceConfig`
- `ProviderInstanceConfig = CliProviderInstanceConfig | ApiProviderInstanceConfig`

### 3. Add an API Session Runtime

`src/backends/api` should own:

- provider transport clients
- canonical transcript storage
- active turn lifecycle and stream fan-out
- tool loop orchestration
- API rate limit / retry policy
- provider-specific response normalization
- Ollama model inspection and local-runtime health integration

Suggested layout:

```text
src/backends/api/
  config.ts
  types.ts
  transports/
    anthropic.ts
    openai.ts
    gemini.ts
    ollama.ts
    sse.ts
  runtime/
    ApiExecution.ts
    ApiSessionManager.ts
    ApiTurnRunner.ts
    transcriptStore.ts
    eventBus.ts
  tools/
    registry.ts
    policies.ts
    handlers/
      readFile.ts
      writeFile.ts
      applyPatch.ts
      glob.ts
      grep.ts
      exec.ts
```

## Implementation Phases

### Phase 1: Backend-Neutral Runtime Seam

- [ ] Move stable session, capability, and stream contracts out of
      `src/backends/cli` into `src/core`.
- [ ] Introduce backend-aware provider instance types with `backend: cli | api`.
- [ ] Add `openai` and `ollama` to the provider catalog, dashboard ordering,
      and provider metadata responses.
- [ ] Generalize `AppContext` and routing helpers so they no longer hard-depend
      on CLI-only classes.

**Deliverables**: The server can resolve provider instances without assuming
they are subprocess-backed, and the public HTTP contract remains unchanged.

### Phase 2: API Transport Foundation

- [ ] Build `src/backends/api/transports` for Anthropic, OpenAI, Gemini, and
      Ollama.
- [ ] Normalize provider streams into the existing `StreamEvent` envelope.
- [ ] Create `ApiExecution` objects that behave like worker handles for active
      turns.
- [ ] Persist canonical runtime-managed transcripts for every API session.
- [ ] Support `create`, `message`, `resume`, `fork`, `close`, `delete`, and
      `history` for API sessions.

**Deliverables**: API-backed and Ollama-backed sessions work end to end for
text-only turns, with streaming and durable history.

### Phase 3: Local Tool Runtime and Workspace Policy

- [ ] Implement runtime-hosted tools for filesystem inspection, search, patch
      application, and shell execution.
- [ ] Enforce `workspaceMode` and `permissionMode` against those tools.
- [ ] Emit normalized tool events and persist tool calls/results in history.
- [ ] Add per-turn timeout, cancellation, and max-step guardrails.
- [ ] Add Ollama-specific model catalog and health queries so the dashboard can
      validate local availability before session creation.

**Deliverables**: API and Ollama sessions can operate on local workspaces with a
runtime policy that is comparable to CLI agent workflows.

### Phase 4: Provider-Specific Optimizations

- [ ] Anthropic: prompt caching and selectively enabled server tools where they
      improve quality over local tools.
- [ ] OpenAI: `previous_response_id`, background mode, and chosen built-in tools
      where they lower latency or token replay cost.
- [ ] Gemini: context caching, file upload support, and selective Google Search
      or URL-context integration.
- [ ] Ollama: optional native `/api/chat` path, model warm-up hints, and local
      model lifecycle operations such as list / pull / running-model checks.
- [ ] Add per-instance spending, rate-limit, and concurrency guardrails.

**Deliverables**: API providers and Ollama are cheaper, faster, and more
capable than a pure history-replay MVP.

### Phase 5: Dashboard, Docs, and Verification

- [ ] Extend `GET /providers/config` so the dashboard can display backend kind,
      transport, and default model for each instance.
- [ ] Consider an additive `GET /ollama/models` endpoint or fold model listing
      into provider metadata for local-model selection.
- [ ] Update setup, API, architecture, and security docs.
- [ ] Add `providers.yaml.example` entries for API instances and `.env.example`
      placeholders for the required keys.
- [ ] Add a regression matrix for stream parsing, tool calls, resume, fork,
      abort, and rate-limit retries.

**Deliverables**: API instances are understandable, configurable, and covered by
tests and operator documentation.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Move shared session / provider / stream contracts out of CLI |
| `src/core/config.ts` | Modify | Export backend-neutral runtime config and load API settings |
| `src/backends/cli/config.ts` | Modify | Support backend-aware provider instances without breaking CLI config |
| `src/backends/cli/pool/WorkerPool.ts` | Modify | Depend on generalized execution contracts or become a CLI adapter |
| `src/backends/api/config.ts` | Create | Parse API instance settings and env-backed secrets |
| `src/backends/api/types.ts` | Create | API transport, transcript, and tool-loop types |
| `src/backends/api/transports/*.ts` | Create | Anthropic, OpenAI, Gemini, Ollama streaming clients |
| `src/backends/api/runtime/*.ts` | Create | API execution lifecycle, event bus, transcript store |
| `src/backends/api/tools/**/*.ts` | Create | Local tool runtime and policy enforcement |
| `src/http/app.ts` | Modify | Carry backend-neutral context and adapters |
| `src/http/routes/providers.ts` | Modify | Return backend metadata for each provider instance |
| `src/http/routes/sessions.ts` | Modify | Route create/resume/fork/close semantics through backend-neutral adapters |
| `src/http/routes/messages.ts` | Modify | Support API execution handles and canonical transcript writes |
| `src/http/routes/history.ts` | Modify | Read canonical API transcripts in addition to CLI-native sources |
| `src/http/routes/observe.ts` | Modify | Observe active API turns through the same SSE surface |
| `src/http/routes/ollama.ts` | Create/Modify | Optional Ollama model-health and model-listing routes if kept separate from generic providers |
| `src/server.ts` | Modify | Wire CLI and API backends into one runtime app |
| `config/providers.yaml.example` | Modify | Add example API instances for Claude, OpenAI, Gemini, and Ollama |
| `docs/api.md` | Modify | Document API-backed and Ollama-backed provider instances and any additive stream events |
| `docs/setup-guide.md` | Modify | Document API key env vars, `OLLAMA_BASE_URL`, and provider instance setup |
| `docs/architecture.md` | Modify | Reflect the mixed CLI/API/local-model backend model |
| `src/**/*.test.ts` | Modify/Create | Add transport, tool-loop, and route integration coverage |

## Technical Decisions

- Backend choice belongs to provider instances, not the request body. That keeps
  the upper-layer contract stable.
- Runtime-managed transcripts are the source of truth for API session resume and
  fork. Remote provider conversation IDs are optimizations, not required state.
- Local workspace tools should be hosted by `cats-runtime` for predictable
  parity across Anthropic, OpenAI, Gemini, and Ollama.
- Use `fetch` plus small stream parsers first instead of immediately adopting
  three vendor SDKs. Revisit SDKs only if files, live APIs, or auth flows become
  materially simpler through them.
- Treat Ollama as its own provider, not as an alias of `openai`. It can reuse an
  OpenAI-compatible parser in the MVP, but its config, health, model listing,
  and lifecycle are distinct enough to justify a dedicated provider boundary.
- Prefer runtime-managed resume/fork for Ollama because its OpenAI-compatible
  `/v1/responses` support is explicitly non-stateful.
- Additive stream-event expansion is acceptable, but existing `init`, `text`,
  `tool_use`, `result`, `error`, and `raw` events must remain valid.
- API keys must never be logged, persisted in session metadata, or written to
  `providers.yaml`.

## Testing Strategy

- **Unit Tests**: API config parsing, env-secret resolution, transcript store,
  tool policy checks, provider stream parsers, retry/backoff helpers, and
  Ollama model catalog parsing.
- **Integration Tests**: `POST /sessions`, `POST /messages`, `POST /resume`,
  `POST /fork`, `GET /history`, and `GET /stream` for each API provider using
  mocked HTTP streams, plus Ollama health/model endpoints if exposed.
- **Manual Testing**:
  1. Configure one API instance each for Claude, OpenAI, and Gemini, plus one
     local Ollama instance.
  2. Create shared, isolated, and read-only sessions from the dashboard.
  3. Send plain-text turns, then tool-using turns that read and modify files.
  4. Close and resume sessions; verify history replay and token accounting.
  5. Fork a session and confirm the child conversation and isolated workspace
     diverge from the parent as expected.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| HTTP layer is too coupled to CLI internals | High | Introduce backend-neutral contracts before shipping provider functionality |
| Provider APIs differ in tool semantics and conversation state | High | Make runtime transcript + local tool loop canonical, treat provider session IDs as optional accelerators |
| Ollama local availability and model presence are host-specific | Medium | Add health/model checks and fail fast before session creation |
| API costs spike when replaying long histories | Medium | Add transcript summarization hooks, prompt/context caching, and provider-specific continuation optimizations in Phase 4 |
| Secret leakage through logs or persisted config | High | Only reference env var names in YAML; redact headers and auth fields everywhere |
| Tool runtime becomes an unsafe shell wrapper | High | Enforce workspace-scoped paths, permission policies, timeouts, and explicit allowlists |
| Observe / stream semantics drift between CLI and API sessions | Medium | Reuse the same `StreamEvent` contract and active-turn event bus for both backends |

## Open Follow-Ups

1. Record a new ADR once the backend-neutral execution seam is finalized.
2. Decide whether billing / usage budget enforcement belongs in `src/core` or
   inside `src/backends/api`.
3. Decide whether transcript compaction / summarization should be provider
   specific or runtime generic.

## Reference Inputs

The phase ordering above is based on the current vendor API surfaces reviewed on
2026-03-16:

- Anthropic Messages API, streaming, tool use, prompt caching, and tool docs:
  `docs.anthropic.com`
- OpenAI Responses API, built-in tools, function calling, and background mode:
  `platform.openai.com/docs`
- Gemini API docs for function calling, Google Search grounding, code
  execution, files, and context caching: `ai.google.dev`
- Ollama API docs for local HTTP serving, tool calling, and OpenAI
  compatibility: `docs.ollama.com`

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-16 | Plan created for the `src/backends/api` delivery track covering Claude, OpenAI, and Gemini API-key execution |

---

*Created: 2026-03-16*
*Author: Codex*
