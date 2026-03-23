# Runtime Skill Library

> Runtime-owned skill content catalog for `cats-runtime`.

## Purpose

`cats-runtime/skills/` is the canonical library of execution-ready `SKILL.md`
packages that the runtime can validate, resolve, materialize, and report in
session metadata.

This directory is:

- runtime-owned content
- family-organized for authoring and review
- compatible with the existing runtime skill validator

This directory is not:

- a second product-side skill catalog
- the runtime injection/materialization engine
- a runtime dependency on any sibling or submodule role library

## Authoring Reference Boundary

`agency-agents/` may exist at the monorepo root as an authoring/reference
source, but shipped `cats-runtime` skills must remain local packages owned by
this repo. Do not import from `agency-agents` at runtime.

## Layout

```text
skills/
  orchestration/
    coordinator/
      SKILL.md
  work/
    product-manager/
      SKILL.md
  chat/
    companion/
      SKILL.md
  code/
    advanced-programmer-runtime/
      SKILL.md
```

Requested runtime skill ids remain the leaf package names such as
`coordinator`, `product-manager`, or `advanced-programmer-runtime`.

## Frontmatter Contract

All shipped runtime-owned skills should declare this richer metadata:

```yaml
---
name: product-manager
description: Product management skill for scope control and requirements framing.
family: work
slug: product-manager
role: product_manager
packageKind: role
version: 1.0.0
capabilityTags:
  - scope-control
  - requirements-framing
productTags:
  - product
  - planning
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - companion-mentor
---
```

Field notes:

- `name`: required skill id and directory name
- `family`: taxonomy grouping used by the runtime catalog
- `slug`: stable role/library slug
- `role`: machine-readable role identifier
- `packageKind`: `base`, `role`, or `bundle`
- `version`: content package version
- `capabilityTags`: what the skill is good at
- `productTags`: contexts/products likely to consume it
- `deliveryHints`: preferred runtime delivery shapes
- `recommendedCompanions`: optional pairing hints for higher-level products

Custom local skills may omit the richer metadata and still pass the baseline
runtime-managed skills validator, but runtime-owned library packages should not.

## Families

### `orchestration`

| Skill | Package Kind | Focus |
|-------|--------------|-------|
| `orchestrator` | `role` | high-level decomposition and delegation |
| `coordinator` | `role` | sequencing and dependency management |
| `dispatcher` | `role` | work routing and capability matching |
| `incident-commander` | `role` | degraded-state stabilization and evidence-first triage |
| `delivery-auditor` | `base` | delivery/readiness verification |

### `work`

| Skill | Package Kind | Focus |
|-------|--------------|-------|
| `ceo` | `role` | executive direction and tradeoffs |
| `sales` | `role` | qualification and next-step control |
| `product-manager` | `role` | scope and requirements |
| `project-manager-agile` | `role` | iterative delivery hygiene |
| `project-manager-waterfall` | `role` | milestone sequencing |
| `ux` | `role` | interaction and flow clarity |
| `art-designer` | `role` | visual direction |
| `architect` | `role` | system boundaries and long-lived design |
| `coder` | `role` | implementation and debugging |
| `automation-tester` | `role` | regression automation |
| `code-reviewer` | `role` | bug/risk review |
| `qa` | `role` | acceptance and release risk |
| `marketer` | `role` | positioning and messaging |
| `hr` | `role` | people/policy communication |
| `secretary` | `role` | administrative follow-through |
| `intern` | `role` | bounded support work |

### `chat`

| Skill | Package Kind | Focus |
|-------|--------------|-------|
| `companion` | `base` | memory continuity and daily presence |
| `companion-gentle` | `role` | calm, low-pressure support |
| `companion-playful` | `role` | lightness and energy |
| `companion-guardian` | `role` | boundaries and protective support |
| `companion-mentor` | `role` | reflective growth-oriented guidance |

### `code`

| Skill | Package Kind | Focus |
|-------|--------------|-------|
| `repo-maintainer` | `base` | safe narrow-scope code changes |
| `advanced-programmer-backend` | `role` | backend contracts and production safety |
| `advanced-programmer-frontend` | `role` | UI/state implementation integrity |
| `advanced-programmer-systems` | `role` | hosts, packaging, and process supervision |
| `advanced-programmer-runtime` | `role` | runtime seams and lifecycle integrity |

## Syncing Skills

If agent-discovery mirrors need refresh after editing library content:

```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

---

*This directory follows the [Agent Skills](https://agentskills.io) standard while adding runtime-owned library metadata for `cats-runtime`.*
