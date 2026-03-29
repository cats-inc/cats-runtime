# 2026-03-30: Sibling Collaboration Baseline Alignment

## Goal

Confirm that `cats` can consume the repo-owned collaboration baseline extracted
under `PLAN-023` without relying on `project-bootstrap` as a product-time
dependency, while also recording the intentional divergences between the
runtime-side and product-side pilot artifacts.

## Validation Performed

Checked the following mirrored file families across `cats-runtime/` and
`cats/`:

- `docs/a2a/*`
- `scripts/windows/Sync-AgentSkills.ps1`
- `scripts/linux/sync-agent-skills.sh`
- `scripts/macos/sync-agent-skills.sh`

Also searched the mirrored repos for direct product-flow references to:

- `project-bootstrap`
- `Initialize-Project`
- `Update-Project`

## Results

### File-set parity

Both repos currently ship the same A2A example file set:

- `docs/a2a/README.md`
- `docs/a2a/agent-card.public.json.example`
- `docs/a2a/agent-card.public.yaml.example`
- `docs/a2a/agent-card.authenticated.json.example`
- `docs/a2a/agent-card.authenticated.yaml.example`
- `docs/a2a/jsonrpc-send-message.request.json.example`
- `docs/a2a/jsonrpc-send-message.response.json.example`
- `docs/a2a/jsonrpc-send-streaming-message.request.json.example`
- `docs/a2a/jsonrpc-send-streaming-message.response.sse.example`
- `docs/a2a/jsonrpc-get-task.request.json.example`
- `docs/a2a/jsonrpc-cancel-task.request.json.example`
- `docs/a2a/jsonrpc-get-extended-agent-card.request.json.example`

Both repos also ship the same cross-platform skill-sync entrypoints:

- `scripts/windows/Sync-AgentSkills.ps1`
- `scripts/linux/sync-agent-skills.sh`
- `scripts/macos/sync-agent-skills.sh`

### Exact-match assets

The skill-sync scripts are byte-identical between `cats-runtime` and `cats`.
This is the collaboration helper surface that most directly replaced the
bootstrap-only `Sync-AgentSkills` dependency.

### Intentional divergences

The A2A example set is not byte-identical across the two repos, and that is
intentional.

- `docs/a2a/README.md`
  - `cats-runtime` frames the pilot around a future runtime-boundary adapter.
  - `cats` frames the same pilot around a future suite-host or orchestrator
    boundary.
- `docs/a2a/agent-card.public.json.example`
  - `cats-runtime` names runtime diagnostics/session orchestration skills.
  - `cats` names suite/product/operator-oriented skills.
- `docs/a2a/jsonrpc-send-message.request.json.example`
  - `cats-runtime` uses runtime-health/provider-diagnostics style prompts.
  - `cats` uses operator-inbox/suite-recovery style prompts.
- `docs/a2a/jsonrpc-cancel-task.request.json.example`
  - `cats-runtime` still includes a pilot metadata reason.
  - `cats` keeps the request simpler and only sends `id`.

These are repo-identity and product-surface differences, not evidence that the
mirrored baseline still depends on `project-bootstrap`.

### Dependency posture

No direct `project-bootstrap/scripts/*` product flow is required for the
mirrored A2A examples or the skill-sync entrypoints now present in `cats`.

The remaining `project-bootstrap` mentions in the A2A README files are
candidate-input citations, not runtime dependencies. They document where the
pilot drew inspiration from and remain acceptable as historical context.

## Conclusion

`cats` is already consuming the extracted collaboration baseline through
repo-owned copies of the A2A pilot file set and repo-owned skill-sync helpers.
The remaining differences are intentional repo-specific rewrites, not missing
ports.

This closes the `PLAN-023` question of whether sibling consumption still
depends on monorepo-local bootstrap access for the current mirrored baseline.
