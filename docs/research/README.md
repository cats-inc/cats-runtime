# Research Log

> Track external sources and findings that inform decisions.

## Index

| Entry | Topic | Focus |
|-------|-------|-------|
| [2026-08-24-grok-cline-version-drift-probe](./2026-08-24-grok-cline-version-drift-probe.md) | Grok 1.0.5 and Cline 3.0.57 version drift probe | Why the version whitelist refuses newer CLIs and blocks the probe that would clear them; the evidence admitting Grok 1.0.5; the single-turn `manual_tool` profile that reached Cline's tool path and found `content_update` drift; and the probe-timeout and workspace-cleanup defects found on the way |
| [2026-08-17-provider-upstream-drift-automation](./2026-08-17-provider-upstream-drift-automation.md) | Provider upstream drift automation | Why every drift signal today requires an already-installed CLI and a manual probe; the five drift classes; reviewed runtime observation delivery; durable watcher liveness; and where ChatGPT Work, Claude Cowork, and Claude Code cloud schedules fit |
| [2026-08-08-grok-cli-install-tier-probe](./2026-08-08-grok-cli-install-tier-probe.md) | Grok CLI install and authenticated lifecycle probe | Complete isolated Grok 1.0.0 success, model, tool, permission, error, cancellation, resume, and fork evidence; exact-version native adapter approved |
| [2026-05-24-antigravity-cli-probe](./2026-05-24-antigravity-cli-probe.md) | Antigravity CLI Phase 0 probe | Local environment-bootstrap installer contract, official Antigravity CLI docs, skills/plugin behavior, model display names, and remaining live-probe gaps before replacing Gemini CLI |
| [2026-04-15-acp-agent-backend-and-runtime-facade-alignment](./2026-04-15-acp-agent-backend-and-runtime-facade-alignment.md) | ACP agent backend and runtime facade alignment | Why ACP should land as `agent/acp` for provider targets, why IDE-facing ACP must stay a separate runtime facade, and how ACP complements A2A |
| [2026-04-07-advanced-provider-manifest-onboarding-checklist](./2026-04-07-advanced-provider-manifest-onboarding-checklist.md) | Advanced provider manifest onboarding checklist | The explicit evidence, wiring, regression, and documentation gates required before promoting any runtime target from conservative advanced catalogs to `verified_manifest` |
| [2026-04-07-npm-trusted-publishing-readiness](./2026-04-07-npm-trusted-publishing-readiness.md) | npm trusted publishing readiness | Which exact npm/GitHub repo-side and external settings `cats-runtime` needs before a real trusted publish can succeed, and which parts can land safely before any publish happens |
| [2026-04-07-advanced-provider-manifest-baseline](./2026-04-07-advanced-provider-manifest-baseline.md) | Advanced provider manifest baseline | Which provider targets currently count as verified advanced-catalog manifests, what public metadata each one is allowed to expose, and which repo evidence anchors that verification |
| [2026-03-30-openclaw-paperclip-openmanus-gap-audit](./2026-03-30-openclaw-paperclip-openmanus-gap-audit.md) | OpenClaw / Paperclip / OpenManus gap audit | Which remaining `cats-runtime` gaps are still materially visible when compared against the local submodule reference points, and which one should be cut next |
| [2026-03-29-project-bootstrap-collaboration-extraction-inventory](./2026-03-29-project-bootstrap-collaboration-extraction-inventory.md) | Project-bootstrap collaboration extraction inventory | Which template families and initialize/update semantics still need a repo-owned rewrite before `cats-runtime` and `cats` split into separate repos |
| [2026-03-29-a2a-pilot-second-wave-validation](./2026-03-29-a2a-pilot-second-wave-validation.md) | A2A pilot second-wave validation | What `project-bootstrap` actually generated/updated in a throwaway repo, which A2A v1 template behaviors were real, and which collaboration semantics still required pilot-owned adaptation |
| [2026-03-30-repo-owned-collaboration-split-safety-validation](./2026-03-30-repo-owned-collaboration-split-safety-validation.md) | Repo-owned collaboration split-safety validation | Evidence that the extracted workspace substrate and cross-platform skill-sync baseline now work without direct `project-bootstrap` shell-outs |
| [2026-03-30-sibling-collaboration-baseline-alignment](./2026-03-30-sibling-collaboration-baseline-alignment.md) | Sibling collaboration baseline alignment | Which repo-owned collaboration artifacts now align between `cats-runtime` and `cats`, and which A2A pilot differences are deliberate repo-identity divergences |
| [2026-03-19-aaif-a2a-and-skills-layering](./2026-03-19-aaif-a2a-and-skills-layering.md) | AAIF, A2A v1, and skill layering | Why `cats-runtime` should separate protocol artifacts, markdown project memory, and `SKILL.md` capability packages |
| [2026-03-17-paperclip-openclaw-pi-alignment](./2026-03-17-paperclip-openclaw-pi-alignment.md) | Paperclip alignment for OpenClaw and Pi | Why OpenClaw should push a new `agent` backend while Pi should remain a `cli` integration track |
| [2026-03-19-paperclip-gap-assessment](./2026-03-19-paperclip-gap-assessment.md) | Paperclip maturity-gap assessment | What lower-layer capabilities `cats-runtime` has already closed and what still lags in control plane, lifecycle, Pi depth, and observability |
| [2026-03-24-lan-mesh-worker-sharing](./2026-03-24-lan-mesh-worker-sharing.md) | LAN mesh discovery and worker sharing | Feasibility of mDNS-based peer discovery, mesh interconnection, and remote CLI worker sharing across LAN nodes |
| [2026-03-24-setup-diagnostic-report](./2026-03-24-setup-diagnostic-report.md) | First-run setup diagnostic report | One-shot environment scan for debugging CLI/WSL/Docker/Node.js issues during first-time installation |
| [2026-03-25-workspace-contract-terminology-and-semantics](./2026-03-25-workspace-contract-terminology-and-semantics.md) | Workspace contract terminology and semantics | Proposed replacement for `workspaceMode`/`workspaceIsolation`, including `workspaceKind`, `workspaceAccess`, room-vs-session semantics, and read-only sandbox corner cases |
| [2026-03-26-pluggable-execution-strategy-architecture](./2026-03-26-pluggable-execution-strategy-architecture.md) | Pluggable execution strategy architecture | ExecutionStrategy interface for swappable agent loops (ReAct, PDCA, ToT, DEPS, Reflexion), strategy resolution, and integration with streaming/tool contracts |
| [2026-03-27-cli-provider-event-capability-audit](./2026-03-27-cli-provider-event-capability-audit.md) | CLI provider event capability audit | Which CLI-backed providers already expose stepwise text, tool, and progress signals inside `cats-runtime`, and which valuable mid-turn signals are still unused |
| [2026-03-27-a2a-v1-agent-backend-alignment](./2026-03-27-a2a-v1-agent-backend-alignment.md) | A2A v1 agent backend alignment | Why A2A belongs inside the existing `agent` backend family, how it maps to `AgentAdapter`, and what A2A v1 means for future stream/evidence assumptions |
| [2026-03-27-provider-evolution-evidence-framework](./2026-03-27-provider-evolution-evidence-framework.md) | Provider evolution evidence framework | Why provider CLI upgrades, regressions, schema changes, and semantic drift should be tracked through manual-first runtime evidence rather than automatic self-adaptation |

## Entry Template

```
Date:
Topic:
Source:
Summary:
Relevance:
Action Items:
```

---

*Last updated: 2026-08-18*
