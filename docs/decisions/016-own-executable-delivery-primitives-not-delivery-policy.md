# ADR-016: Own Executable Delivery Primitives, Not Delivery Policy

> Keep delivery-governance policy in upper-layer products, while `cats-runtime`
> owns the executable delivery primitives needed to inspect repo state, publish
> artifacts, and drive repo/CI/preview actions when asked.

## Status

Accepted

## Date

2026-03-20

## Context

Cats work can end in different kinds of delivery flows:

- artifact-only outputs such as reports or decks
- repo-backed work that should stop at a local commit
- branch push workflows
- PR and CI-gated workflows
- preview or deployment-backed workflows

The runtime already owns executable machinery for analogous concerns:

- skill materialization and delivery
- MCP/tool delivery and lazy activation
- preview/session/browser execution surfaces
- provider/runtime adaptation behind stable contracts

That makes it tempting either to:

- push delivery policy down into runtime, or
- leave all repo/CI execution entirely above runtime in product code

Both are the wrong boundary.

The product should decide required governance. The runtime should execute the
requested delivery actions and report capability gaps or blocked states.

## Decision

`cats-runtime` will own executable delivery primitives, but it will not own
delivery-governance policy.

1. `cats-runtime` owns headless delivery execution capabilities.
   - workspace/repo delivery audit
   - artifact publication or export primitives
   - git-oriented primitives such as commit or push where supported
   - PR/check/preview primitives where supported

2. Delivery policy remains outside runtime.
   - runtime may accept a delivery manifest or requested action set
   - runtime should not infer whether a workspace must use Git, PRs, or CI
     simply because those capabilities exist

3. Runtime delivery capabilities should be machine-readable and approval-aware.
   - hosts and products need structured status, warnings, and blocked reasons
   - runtime should expose capability gaps such as missing remote, missing auth,
     or unsupported provider/forge integration

4. Runtime delivery is separate from workspace substrate tooling.
   - substrate tools establish collaboration rules and project-memory entry
     points
   - delivery primitives govern how work outputs are finalized or published

5. Runtime delivery primitives should stay replaceable and provider-neutral
   where possible.
   - local git is not the only future target
   - GitHub-specific or CI-vendor-specific behavior should stay behind runtime
     adapters or optional integrations

## Rationale

- preserves the existing Cats split where products own intent and runtime owns
  execution
- keeps artifact-only workflows first-class instead of forcing every output
  through repo assumptions
- avoids turning `cats-runtime` into a policy engine while still giving the
  suite one reusable execution layer for repo/CI actions
- avoids inflating workspace substrate tools with delivery concerns

## Consequences

### Positive

- The same runtime can serve artifact-only, repo-backed, and CI-aware flows.
- Products keep explicit control over governance and approvals.
- Runtime integrations for git, preview, and CI can evolve without rewriting
  product policy logic.
- Capability probing and degraded states can be reported consistently.

### Negative

- Another product-to-runtime manifest seam is required.
- Some delivery integrations will be partial at first and need clear degraded
  behavior.
- Runtime now owns another family of executable primitives beyond sessions,
  tools, and previews.

### Neutral

- This ADR does not require every runtime deployment to support GitHub or CI.
- This ADR does not require CI template scaffolding to be part of runtime
  substrate initialization.
- This ADR does not require the first slice to automate every forge or preview
  host.

## Alternatives Considered

### Alternative 1: Let products manage git/CI execution directly

- **Pros**: products can see every step
- **Cons**: duplicates execution logic across hosts and weakens the runtime
  boundary
- **Why rejected**: repo/CI execution belongs behind reusable runtime seams

### Alternative 2: Put delivery governance and delivery execution both in
runtime

- **Pros**: fewer moving parts at first glance
- **Cons**: runtime becomes a policy engine and loses product-specific control
- **Why rejected**: governance intent belongs above runtime

### Alternative 3: Treat CI and repo actions as part of workspace substrate

- **Pros**: one workspace setup story
- **Cons**: mixes AAIF collaboration substrate with output-governance and
  delivery concerns
- **Why rejected**: substrate and delivery are different layers

## References

- [ADR-011](./011-runtime-owned-browser-and-preview-subsystem-with-pluggable-drivers.md)
- [ADR-015](./015-own-workspace-substrate-tools-in-cats-runtime.md)
- [cats ADR-019](../../../cats-platform/docs/decisions/019-normalize-runtime-previews-as-surfaces-not-provider-iframes.md)
- [cats ADR-020](../../../cats-platform/docs/decisions/020-own-mcp-intent-in-product-and-tool-delivery-in-runtime.md)
- [cats ADR-022](../../../cats-platform/docs/decisions/022-own-workspace-delivery-policy-in-product.md)

---

*Accepted: 2026-03-20*
*Decision makers: user + Codex*

