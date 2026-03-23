# Testing Strategy

> Testing approach, standards, and procedures for `cats-runtime`.

## Overview

`cats-runtime` uses Vitest for both unit-level modules and HTTP-level route
tests. The goal is to keep provider adapters, session orchestration, discovery,
and public routes covered inside this repo so runtime changes are verified
locally in the same service that ships them.

## Test Types

### Unit Tests

- **Location**: `src/backends/cli/**/*.test.ts`, `src/core/tools/**/*.test.ts`, `src/core/skills/catalog.test.ts`
- **Framework**: Vitest
- **Scope**: provider parsers, runtime adapters, worker helpers, discovery, session registry, family-aware skill catalog metadata/validation, native services, and local tool contracts including alias-safety guards for symlink/junction and hardlink edge cases

### Integration Tests

- **Location**: `src/http/*.test.ts`, `tests/runtime-server.test.ts`, `tests/workspace-substrate.test.ts`
- **Framework**: Vitest
- **Scope**: route behavior, auth, session lifecycle, native session management, server bootstrap, startup/readiness diagnostics, and runtime-neutral workspace substrate planning/apply behavior

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
npx vitest run tests/runtime-server.test.ts
npx vitest run tests/runtime-process.test.ts --pool=threads --poolOptions.threads.singleThread
npx vitest run tests/workspace-substrate.test.ts src/core/tools/LocalToolRuntime.test.ts --pool=threads --poolOptions.threads.singleThread
```

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
- Prefer temp directories for discovery/history tests so file layout stays realistic
- For workspace substrate tests, assert machine-readable `contract`, `plan`, and `approval` payloads rather than only final file writes
- Cover the read-only `audit-workspace` boundary separately from mutable `init-workspace` / `update-workspace` flows
- Cover child-process startup failure and shutdown lifecycle paths when changing `src/index.ts`, `src/server.ts`, or `src/startup.ts`
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

*Last updated: 2026-03-24*
