# 2026-03-29 A2A Pilot Second-Wave Validation

Date: 2026-03-29
Topic: Second-wave validation of the `SPEC-006` / `PLAN-023` pilot using
`project-bootstrap` tooling
Source:
- `project-bootstrap` git history on 2026-03-24:
  - `e4518e8` `feat(a2a): refresh v1.0 templates and upgrade flow`
  - `569ba7a` `fix(a2a): clarify v1.0 example details`
  - `6d98881` `docs(a2a): align v1.0 spec references`
- `project-bootstrap/scripts/linux/initialize-project.sh`
- `project-bootstrap/scripts/linux/update-project.sh`

## Validation Setup

Throwaway repo path used for validation:

```text
/tmp/cats-runtime-a2a-pilot-second-wave
```

Commands run:

```bash
bash project-bootstrap/scripts/linux/initialize-project.sh --target-path /tmp/cats-runtime-a2a-pilot-second-wave
bash project-bootstrap/scripts/linux/update-project.sh --target-path /tmp/cats-runtime-a2a-pilot-second-wave
```

Before `Update-Project`, the throwaway repo was intentionally drifted by:

- appending a local note to `docs/a2a/README.md`
- reintroducing legacy `docs/a2a/task.json.example`
- reintroducing legacy `docs/a2a/task.yaml.example`

## Findings

### Confirmed Candidate Inputs

- `Initialize-Project` now seeds a released A2A v1.0 example set rather than
  the older `agent-card.*` plus generic `task.*` baseline.
- `Update-Project` does conservatively stage `*.bootstrap` review copies for:
  - diverged `docs/a2a/README.md`
  - reintroduced legacy `task.json.example`
  - reintroduced legacy `task.yaml.example`
- The bootstrap-side A2A refresh is therefore real and observable in generated
  repos; it is not only present in documentation.

### Interpretation Drift Still Present

- Generated `AGENTS.md` remains a generic scaffold with unresolved project TODOs.
- Generated `docs/AGENT-GUIDE.md` now references the newer A2A file set, but it
  still lacks the stronger same-environment CLI agent contract used by the
  `cats-runtime` pilot:
  - no explicit three-layer protocol/project-memory/skill model
  - no explicit rule that every agent must independently read `AGENTS.md` and
    `docs/AGENT-GUIDE.md`
  - no explicit write-target guidance for `docs/research/`,
    `docs/decisions/`, `docs/specs/`, and `docs/plans/`
- Generated repos do not receive the runtime-owned collaboration skills added in
  this pilot, so bootstrap currently shapes files but does not teach the richer
  operating model.

### Style Drift Still Present

- Bootstrap `docs/a2a/README.md` is standards-aligned, but it is still a
  generic template, not a repo-truthful capability statement.
- The generated example set is suitable as a protocol-layer candidate input, but
  it does not prove that a real repo's auth model, operating model, or actual
  capabilities are described accurately.

## Summary

The second-wave validation passed the narrow repo-shape test:

- `project-bootstrap` really does ship a March 2026 A2A v1.0 refresh
- the initialize/update scripts behave as documented for A2A files

The second-wave validation did not justify treating bootstrap as a production
baseline:

- repo-shape enforcement works
- collaboration semantics still need pilot-owned adaptation in real repos

## Relevance

This confirms the `PLAN-023` framing is correct:

- `project-bootstrap` is a valid candidate input source
- it is not yet a proven baseline for same-environment collaboration behavior
- merge-back should stay deferred until more pilot loops exist

## Action Items

- Keep the pilot-owned `cats-runtime` docs and skills as the current validated
  collaboration baseline.
- Treat bootstrap merge-back as a later follow-up, not an immediate result of
  this slice.
- Mirror the first-wave pilot into `cats` only after the current `cats-runtime`
  slice proves stable enough to copy intentionally.
