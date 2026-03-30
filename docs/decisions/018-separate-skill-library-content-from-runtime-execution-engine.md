# ADR-018: Separate Skill-Library Content from Runtime Execution Engine

> Keep the internal role/skill library as runtime-owned content and taxonomy,
> while runtime-managed skill execution remains a distinct subsystem.

## Status

Accepted

## Date

2026-03-24

## Context

`cats-runtime` now has a first slice of runtime-managed skills:

- requested/resolved/applied session metadata
- backend-aware delivery modes
- explicit clearing support
- shared hydration across create/resume/fork

At the same time, the product direction now calls for a much broader internal
skill pool:

- orchestrator/coordinator roles
- company/work roles
- multiple companion roles
- advanced programmer roles

If these concerns are merged too early, the project will blur two very
different responsibilities:

1. **skill content library**
   - role taxonomy
   - package naming
   - reusable instruction assets
   - family/group metadata
2. **runtime execution engine**
   - resolve requested skills
   - materialize delivery bundles
   - inject skills into sessions
   - report requested/resolved/applied results

The team needs a clear decision before growing the library.

## Decision

`cats-runtime` will separate internal skill-library content from the
runtime-managed skill execution engine.

This decision includes:

1. The internal skill library is a runtime-owned content catalog.
   - it defines families, package shape, naming, and metadata
   - it does not by itself define execution behavior
2. Runtime-managed skill execution remains a distinct subsystem.
   - it resolves requested skills
   - it materializes bundles or instruction overlays
   - it injects skills into backend execution
   - it reports requested/resolved/applied results
3. Product shells may request skills or skill profiles, but they should not
   need to understand the full on-disk content taxonomy.
4. The skill library may evolve faster than the execution engine, as long as
   library packages remain compatible with the validator and delivery contract.
5. External inspiration or source material may inform the library, but the
   shipped runtime should own its final content and taxonomy.

## Consequences

### Positive

- avoids conflating role taxonomy with execution semantics
- lets the role library grow without destabilizing session execution contracts
- makes it easier to version content-library changes separately from delivery
  mechanics
- supports multiple products referencing the same internal runtime library

### Negative

- more documentation is needed to explain the boundary
- teams must coordinate library metadata and execution contract changes instead
  of assuming one subsystem owns everything

### Neutral

- this ADR does not require a visible product skill browser
- this ADR does not prevent future bundle composition or profile mapping
- this ADR does not require every library skill to be execution-ready on day
  one

## Alternatives Considered

### Alternative 1: Treat the Role Library as Just More Runtime Execution Logic

- **Pros**: fewer concepts on paper
- **Cons**: every taxonomy change risks becoming an execution-engine change
- **Why rejected**: content-library growth and execution semantics evolve at
  different speeds

### Alternative 2: Make the Role Library Product-Owned Instead of Runtime-Owned

- **Pros**: product teams may find the naming more intuitive
- **Cons**: breaks the accepted direction that runtime owns skill hosting and
  delivery
- **Why rejected**: role/skill packages still need one canonical runtime-side
  home

## References

- [SPEC-005](../specs/SPEC-005-runtime-managed-skills-v0.md)
- [SPEC-013](../specs/SPEC-013-internal-skill-library-and-role-taxonomy.md)
- [cats ADR-018](../../../cats-platform/docs/decisions/018-separate-product-skill-intent-from-runtime-skill-hosting.md)

---

*Drafted: 2026-03-24*
*Decision makers: user + Codex*
