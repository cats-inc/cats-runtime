# Testing Strategy

> Testing approach, standards, and procedures for `cats-runtime`.

## Overview

`cats-runtime` uses Vitest for both unit-level modules and HTTP-level route
tests. The goal is to keep provider adapters, session orchestration, discovery,
and public routes covered inside this repo so runtime changes are verified
locally in the same service that ships them.

## Test Types

### Unit Tests

- **Location**: `src/backends/cli/**/*.test.ts`, `src/core/peers/**/*.test.ts`, `src/core/tools/**/*.test.ts`, `src/core/skills/catalog.test.ts`
- **Framework**: Vitest
- **Scope**: provider parsers, runtime adapters, worker helpers, discovery, peer registry/routing/trust/execution helpers, session registry, family-aware skill catalog metadata/validation, native services, and local tool contracts including alias-safety guards for symlink/junction and hardlink edge cases

### Integration Tests

- **Location**: `src/http/*.test.ts`, `tests/runtime-server.test.ts`, `tests/runtime-peer-routing.test.ts`, `tests/workspace-substrate.test.ts`
- **Framework**: Vitest
- **Scope**: route behavior, auth, peer discovery/read routes, peer execution routing, session lifecycle, native session management, server bootstrap, startup/readiness diagnostics, and runtime-neutral workspace substrate planning/apply behavior

### End-to-End Tests

- **Location**: manual for now
- **Framework**: N/A
- **Scope**: local verification against installed provider CLIs and the embedded dashboard

## Running Tests

### All Tests

```bash
npm test
```

### Skill Catalog Verification

```bash
npm run verify:skills
```

### Specific Test Suite

```bash
npx vitest run src/backends/cli/runtime/runtime.test.ts
npx vitest run src/http/cursorManagement.test.ts
npx vitest run src/http/peerExecutionRoutes.test.ts tests/runtime-peer-routing.test.ts --pool=threads --poolOptions.threads.singleThread
npx vitest run tests/runtime-server.test.ts
npx vitest run tests/runtime-process.test.ts --pool=threads --poolOptions.threads.singleThread
npx vitest run src/core/compatibility/providerEvolution.test.ts src/core/compatibility/providerEvolutionProbe.test.ts src/backends/cli/providers/providerEvolutionInstrumentation.test.ts --pool=threads --poolOptions.threads.singleThread
npx vitest run tests/workspace-substrate.test.ts src/core/tools/LocalToolRuntime.test.ts --pool=threads --poolOptions.threads.singleThread
```

### API / Local Backend Regression Matrix

When changing `src/backends/api/**`, `src/core/models/providerSelectionResolution.ts`,
or API/local provider diagnostics/read models, keep this minimum matrix green:

| Concern | Suggested verification |
|---------|------------------------|
| Transport parsing and provider-specific request shaping | `npx vitest run src/backends/api/transports/transports.test.ts --pool=threads --poolOptions.threads.singleThread` |
| Runtime-managed execution, strategy loops, resume/fork continuity | `npx vitest run tests/api-backend.test.ts src/backends/api/runtime/ApiBackendManager.test.ts --pool=threads --poolOptions.threads.singleThread` |
| Provider diagnostics/config read models, live auth/model probes | `npx vitest run src/http/providerDiagnostics.test.ts tests/runtime-server.test.ts --pool=threads --poolOptions.threads.singleThread` |
| Model catalog and advanced selection request patches | `npx vitest run src/core/models/providerModelCatalog.test.ts src/core/models/providerSelectionResolution.test.ts src/core/models/providerAdvancedKnowledge.test.ts --pool=threads --poolOptions.threads.singleThread` |

The highest-value behaviors to keep covered are:

- OpenAI `previous_response_id` reuse and fallback
- Gemini cached-content create/reuse/fallback
- Ollama `keep_alive` hints plus installed/running model inspection
- runtime-local tool loops for Anthropic/OpenAI/Gemini/Ollama
- resume/fork/history continuity for API/local sessions
- degraded live probe behavior when credentials are absent or endpoints time out
- request-patch controls such as `openai.reasoning_effort` and
  `ollama.keep_alive`
- rate-limit / retry-after propagation through API/local execution and
  diagnostics where applicable
- abort and step-limit handling in runtime-hosted strategy loops

## Test Naming Conventions

```javascript
describe('ComponentName', () => {
  it('should expected behavior when condition', () => {
    // ...
  });
});
```

## Mocking Guidelines

- Mock provider-native services in HTTP route tests instead of shelling out to real CLIs
- Keep provider parser tests deterministic with inline sample payloads
- When changing provider-evolution probe logic, cover the shared collector,
  snapshot/compare helpers, and provider-specific instrumentation separately so
  manual probe behavior stays stable without requiring real provider binaries
- Prefer temp directories for discovery/history tests so file layout stays realistic
- For workspace substrate tests, assert machine-readable `contract`, `plan`, and `approval` payloads rather than only final file writes
- Cover the read-only `audit-workspace` boundary separately from mutable `init-workspace` / `update-workspace` flows
- Cover child-process startup failure and shutdown lifecycle paths when changing `src/index.ts`, `src/server.ts`, or `src/startup.ts`
- Cover peer discovery registry, trust gates, and execution-route auth separately from caller-facing `/sessions` behavior when changing `src/core/peers/**`, `src/http/routes/peerExecutions.ts`, or `src/http/routes/messages.ts`
- Cover both NDJSON and SSE for peer execution changes; do not assume one merged wire format
- Keep at least one two-runtime integration test around caller-owned observe/stream behavior for peer-routed turns
- Cover path alias rejection separately from plain `..` traversal so symlink/junction and hardlink regressions stay caught
- Cover skill-library metadata normalization and duplicate-id rejection when changing `src/core/skills/catalog.ts` or `skills/`
- Cover skill-catalog route/MCP query echoes when changing `src/http/routes/skills.ts` or `src/mcp/tools.ts`, especially filters, sorting, and pagination

## CI/CD Integration

- Tests run automatically on:
  - [x] Local pre-commit verification
  - [ ] Pull requests
  - [ ] Main branch commits
  - [ ] Scheduled (nightly)

---

*Last updated: 2026-03-27*
