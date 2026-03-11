# System Architecture

> Phase 1 architecture for the `cats-runtime` thin facade.

## Overview

`cats-runtime` sits between product-facing applications and execution backends.
It provides a stable contract while keeping backend-specific transport logic inside
small adapters.

In phase 1, the only backend is `agent-fleet`.

## Architecture Diagram

```text
┌──────────────────────┐
│ cats-inc / crew-chat │
└──────────┬───────────┘
           │ stable HTTP contract
           ▼
┌──────────────────────┐
│     cats-runtime     │
│  route + auth layer  │
│  backend adapters    │
└──────────┬───────────┘
           │ backend adapter
           ▼
┌──────────────────────┐
│     agent-fleet      │
│ CLI provider runtime │
└──────────────────────┘
```

## Components

### HTTP Server

- **Purpose**: expose the public `cats-runtime` contract
- **Technology**: Node.js built-in `http`
- **Responsibilities**:
  - route matching
  - optional inbound auth
  - upstream response relay
  - local health reporting

### `agent-fleet` Adapter

- **Purpose**: encapsulate upstream transport to `agent-fleet`
- **Technology**: Node.js built-in `fetch`
- **Responsibilities**:
  - upstream auth injection
  - timeout handling
  - health probing
  - raw response passthrough for JSON and NDJSON streams

## Data Flow

1. A caller sends a request to `cats-runtime`
2. `cats-runtime` validates the inbound request and auth
3. The `agent-fleet` adapter forwards the request to the configured upstream backend
4. `cats-runtime` relays the upstream response back to the caller

## Design Rules

- `cats-runtime` MUST NOT source-import `agent-fleet` internals
- Adapters own backend-specific headers, URLs, and timeout policy
- Upper layers should depend on the `cats-runtime` contract, not on `agent-fleet`

## Future Shape

The intended internal structure is:

```text
src/
  core/
  adapters/
    agentFleetBackend.ts
    apiRuntimeBackend.ts   # future
```

When the second backend lands, upper layers should still keep the same contract.

## Key Decisions

- [001: Use an HTTP adapter around agent-fleet first](./decisions/001-agent-fleet-http-adapter.md)

---

*Last updated: 2026-03-11*
