# Testing Strategy

> Testing approach, standards, and procedures for `cats-runtime`.

## Overview

`cats-runtime` uses Vitest for both unit-level modules and HTTP-level route
tests. The goal is to keep provider adapters, session orchestration, discovery,
and public routes covered inside this repo so runtime changes are verified
locally in the same service that ships them.

## Test Types

### Unit Tests

- **Location**: `src/backends/cli/**/*.test.ts`
- **Framework**: Vitest
- **Scope**: provider parsers, runtime adapters, worker helpers, discovery, session registry, native services

### Integration Tests

- **Location**: `src/http/*.test.ts`, `tests/runtime-server.test.ts`
- **Framework**: Vitest
- **Scope**: route behavior, auth, session lifecycle, native session management, server bootstrap

### End-to-End Tests

- **Location**: manual for now
- **Framework**: N/A
- **Scope**: local verification against installed provider CLIs and the embedded dashboard

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Suite

```bash
npx vitest run src/backends/cli/runtime/runtime.test.ts
npx vitest run src/http/cursorManagement.test.ts
npx vitest run tests/runtime-server.test.ts
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

## CI/CD Integration

- Tests run automatically on:
  - [x] Local pre-commit verification
  - [ ] Pull requests
  - [ ] Main branch commits
  - [ ] Scheduled (nightly)

---

*Last updated: 2026-03-11*
