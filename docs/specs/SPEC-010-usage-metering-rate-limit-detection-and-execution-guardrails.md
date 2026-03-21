# SPEC-010: Usage Metering, Rate-Limit Detection, and Execution Guardrails

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft (Pending Review) |
| **Owner** | Codex |
| **Reviewer** | User / metering workstream |

## Summary

`cats-runtime` already captures some usage data today, but it does so
inconsistently across backends and without a unified guardrail layer.

The runtime now needs a shared subsystem that can:

- normalize usage across `api`, `cli`, and `agent` backends
- detect rate-limit and quota events
- expose aggregates and incidents machine-readably
- enforce execution-side warnings, cooldowns, or blocks when configured

This subsystem should not own long-horizon budget policy. It should provide the
execution facts and controls that upper-layer products such as `cats-inc` use
for budget governance.

## Goals

- normalize runtime usage telemetry across all backend families
- make rate-limit and quota incidents first-class runtime signals
- support execution-side guardrails without moving budget policy into runtime
- expose machine-readable metering data suitable for dashboards, approvals, and
  future Cats Work control-plane surfaces

## Non-Goals

- owning company/workspace budget policy or approval workflows
- requiring exact token or dollar cost from every CLI provider
- replacing product-owned cost dashboards with a runtime-only UI
- importing Paperclip company budget semantics into `cats-runtime`

## User Stories

- As a runtime host, I want to know how much usage a session or workspace is
  consuming without parsing provider-specific raw logs.
- As a Boss Cat or system layer, I want runtime to tell me when a provider is
  rate-limited or temporarily blocked.
- As a product integrator, I want one usage and incident API across API, CLI,
  and agent runs.
- As an operator, I want Cats Work or another dashboard to show runtime usage,
  alerts, and cooldowns from normalized runtime data.

## Requirements

### Functional Requirements

1. `cats-runtime` shall normalize usage telemetry across `api`, `local`,
   `cli`, and `agent` backends.
2. The runtime shall define a shared usage-record model in runtime-owned core
   types or services rather than only inside `src/backends/api`.
3. Usage records shall be able to retain at least:
   - provider family
   - provider instance
   - backend family
   - session identity
   - workspace identity when available
   - time of observation
   - normalized usage metrics
   - usage source confidence
4. Usage source confidence shall distinguish at least:
   - `reported`
   - `aggregated`
   - `estimated`
   - `unknown`
5. The normalized usage model shall support at least:
   - input tokens
   - output tokens
   - total token count when derivable
   - optional cost or quota metadata when a provider exposes it
6. The runtime shall support partial usage records when some providers omit one
   or more metrics.
7. The runtime shall not invent false precision for unsupported providers.
   When exact token or cost data is unavailable, the runtime should prefer
   `estimated` or `unknown` over pretending the value is exact.
8. The runtime shall detect rate-limit or quota incidents across backend
   families.
9. Rate-limit detection inputs may include:
   - structured API error payloads
   - normalized transport response metadata
   - CLI compatibility/error signatures from `SPEC-007`
   - agent-adapter incident events
10. Rate-limit or quota incidents shall be normalizable into explicit runtime
    classifications such as:
    - `rate_limited`
    - `quota_exhausted`
    - `cooldown_active`
    - `concurrency_limited`
11. Rate-limit incidents should retain retry or cooldown hints when available,
    including:
    - retry-after timestamp or duration
    - provider instance
    - incident scope
    - original evidence summary
12. The runtime shall expose usage aggregation suitable for later product
    control-plane reads.
    Aggregation should be able to group by at least:
    - provider family
    - provider instance
    - backend family
    - session
    - workspace key
    - caller-provided opaque tags or labels when available
13. The runtime shall support execution-side guardrails that can warn, cool
    down, or block when configured thresholds are hit.
14. Guardrail scopes should be able to include at least:
    - session
    - provider instance
    - workspace
    - runtime-global
15. Guardrail metrics should be able to include at least:
    - token usage
    - estimated cost when available
    - rate-limit incident count
    - active concurrency
16. Runtime guardrail results shall be surfaced machine-readably and should
    include whether an operation is:
    - `allowed`
    - `warned`
    - `blocked`
    - `cooldown`
17. Runtime delivery, setup, session, and future dashboard/API surfaces should
    be able to consume the same metering subsystem rather than each maintaining
    separate counters.
18. The runtime may expose lightweight inspection endpoints or dashboard views
    for usage and incident telemetry, but those do not replace product-owned
    cost-control surfaces.
19. The runtime shall not own long-horizon budget approval orchestration.
20. The runtime shall remain compatible with product-owned budget policy and
    override flows by exposing stable telemetry and blocked-state contracts.

### Non-Functional Requirements

- **Boundary integrity**: runtime owns execution telemetry and guardrails;
  product owns budget policy and approvals
- **Safety**: unknown provider telemetry should degrade honestly rather than
  pretending precision
- **Observability**: incidents and usage aggregates must be machine-readable
- **Extensibility**: new providers and backends should plug into the same
  metering model without redesign

## Suggested Conceptual Model

Illustrative runtime-side types:

```ts
type UsageSourceConfidence =
  | 'reported'
  | 'aggregated'
  | 'estimated'
  | 'unknown';

interface RuntimeUsageRecord {
  provider: string;
  instance: string;
  backend: 'api' | 'local' | 'cli' | 'agent';
  sessionId?: string;
  workspaceKey?: string;
  callerTags?: Record<string, string>;
  observedAt: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
  sourceConfidence: UsageSourceConfidence;
}

interface RuntimeRateLimitIncident {
  provider: string;
  instance: string;
  backend: 'api' | 'local' | 'cli' | 'agent';
  classification:
    | 'rate_limited'
    | 'quota_exhausted'
    | 'cooldown_active'
    | 'concurrency_limited';
  observedAt: string;
  retryAfterMs?: number;
  evidenceSummary?: string;
}

interface RuntimeUsageGuardrail {
  scope: 'session' | 'provider_instance' | 'workspace' | 'runtime_global';
  metric:
    | 'total_tokens'
    | 'estimated_cost'
    | 'rate_limit_incidents'
    | 'active_concurrency';
  threshold: number;
  action: 'warn' | 'block' | 'cooldown';
}
```

## Flow

```text
provider / adapter execution
          |
          +--> usage signals
          +--> rate-limit or quota signals
          |
          v
runtime normalization layer
          |
          +--> usage record store / aggregation
          +--> incident record store / cooldown state
          +--> guardrail evaluation
          |
          v
machine-readable runtime responses
  + telemetry
  + warnings / blocked states
  + dashboard/API inspection
```

## Relationship to Product Budget Control

- runtime telemetry is the source of execution facts
- runtime guardrails enforce configured thresholds or cooldowns
- product hosts decide longer-horizon budget policy, approval, escalation, and
  operator presentation
- Cats Work or another product surface may render war-room cost dashboards from
  runtime telemetry without moving provider parsing into the product layer

## Dependencies

- [ADR-017](../decisions/017-own-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-007](./SPEC-007-provider-compatibility-and-evidence-engine.md)
- [SPEC-003](./SPEC-003-agent-backend.md)
- [cats-inc ADR-023](../../../cats/docs/decisions/023-own-budget-policy-and-cost-control-in-product.md)
- [cats-inc SPEC-025](../../../cats/docs/specs/SPEC-025-budget-policy-override-flows-and-war-room-dashboard.md)

## Open Questions

- [ ] Which parts of the first slice should surface over HTTP first, and which
      can start as internal runtime services or dashboard-only reads?
- [ ] Should estimated cost be normalized in the first slice, or should the
      first release expose token usage and optional provider-native cost fields
      before a broader pricing layer exists?
- [ ] Which CLI providers deserve provider-specific estimation logic in v1, and
      which should remain `unknown` until better evidence exists?

## References

- [Architecture](../architecture.md)
- [API](../api.md)
- [PLAN-003](../plans/PLAN-003-api-backend.md)
- [Paperclip Gap Assessment](../research/2026-03-19-paperclip-gap-assessment.md)

---

*Created: 2026-03-20*
*Author: Codex*
*Related Plan: TBD*
