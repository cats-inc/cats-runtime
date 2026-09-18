# Cline 3.0.62 ClinePass shortlist

Date: 2026-09-18. Mode: refresh; interaction policy: confirm uncertainty.
Scope: Cline only, Runtime catalog/execution/Playground and Desktop fallback.

## Evidence and operator decisions

- [Operator transcription](./fixtures/cline-3.0.62/operator.redacted.txt): complete
  six-entry Cats shortlist, not the complete upstream catalog. All six fixed at
  Medium, with execution support separately authorized. No model or effort default
  was observed; first-row initialization is a Cats UI choice.
- [Selected ID mappings](./fixtures/cline-3.0.62/model-mappings.redacted.json):
  local installed `cline@3.0.62`, `@cline/llms@0.0.83` static `models.js` ClinePass
  block. This may be an upstream superset; only the requested six mappings were
  retained. It does not establish account entitlement or per-model effort menus.
- [Invocation help](./fixtures/cline-3.0.62/invocation.redacted.txt):
  `--provider`, `--model` and `--thinking medium` are supported by the installed CLI.
  No inference request was sent. Unrelated resume/fork/parser behavior was not re-probed.
- ClinePass's actual Qwen label is the raw ID. The operator explicitly authorized
  `Qwen3.8 Max` as the Cats display name. Other labels retain their original spelling.
- The decision helper classified the six combinations, placeholder replacement,
  shortlist freshness and approved display projection as ready; no hierarchy is lost.
- The operator authorized adding only Cline to the personal curated document after
  a backup. That document takes precedence as a whole and previously lacked Cline.

| Cats label | Executable model ID | Fixed effort |
|---|---|---|
| GLM-5.3 — Medium | `cline-pass/glm-5.3` | `medium` |
| Kimi K3 — Medium | `cline-pass/kimi-k3` | `medium` |
| Qwen3.8 Max — Medium | `cline-pass/qwen3.8-max` | `medium` |
| DeepSeek V4 Pro — Medium | `cline-pass/deepseek-v4-pro` | `medium` |
| MiniMax-M3 — Medium | `cline-pass/minimax-m3` | `medium` |
| MiMo-V2.5-Pro — Medium | `cline-pass/mimo-v2.5-pro` | `medium` |

## Implementation

Curated lookup and verbatim normalization now accept Cline. Static fallbacks in
Runtime, Playground and Desktop match this shortlist. Refresh does not enumerate
or expand it. The placeholder was replaced with the first real model; no default
suffix is synthesized. The existing custom action remains separate from six slots.

Singleton effort metadata resolves internally as `cline.reasoning_effort`, with no
editable effort menu or public control default. Execution passes
`--provider cline-pass --model <qualified ID> --thinking medium`. ClinePass is a
separate CLI provider, so selecting its model must select that provider too.
Known plain-string selections also use the fixed combination when advanced metadata
is unavailable. Static fallback knowledge supplies the same execution defaults.

Custom strings retain exact case. Other `cline-pass/` models select ClinePass but
inherit no shortlist effort; other custom strings use the CLI's configured provider
without injecting a provider flag or effort. An omitted model remains omitted.
No global user Cline provider settings are rewritten.

## Validation

- Focused Runtime Vitest: 112 passing tests across catalog loading/normalization,
  advanced knowledge, model service, Cline adapter/stream fixtures and Playground
  (8 files, 8.46 seconds including the initial UI artifact failure).
- UI build passed. The artifact check initially failed only its Git unstaged-output
  assertion; source/output equality already passed. After staging the generated
  Playground asset, the isolated check passed (1 test, 1.74 seconds).
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passed.
  The npm wrapper's redundant UI build hit sandbox `spawn EPERM`; the existing
  successful UI build and direct compiler check cover both phases.
- Personal file: backed up, added only Cline, byte-exact readback and parsed equality
  of all other provider sections passed.
- Desktop: server build, renderer/test TypeScript checks and UI test bundle passed;
  91 focused tests passed
  (35 catalog/selection/execution-label and 56 selector/audience/workspace tests).
- Read-only port 3110 check returned the old empty Cline catalog. The listener
  command line identifies the installed Cats Desktop bundled Runtime, not this
  checkout. Local source verification requires stopping that app and starting
  this checkout with `npm run dev`; restarting the old installed bundle cannot
  load these source changes. The installed process was left running.
- No paid inference or packaged Desktop visual check. Full suites remain CI gates.

## Maintenance observations

The installed static catalog can prove raw ID/label mappings even when the CLI
has no enumeration command. Extract bounded selected fields; minified bundles can
put megabytes on one line. Keep the operator's observed Medium separate from static
capability enums. A provider-qualified model string does not by itself prove the
CLI switches its selected provider. Preserve that routing boundary in execution tests.

These lessons are now routed through the canonical
[Cline provider reference](../../skills/maintain-provider-model-catalogs/references/providers/cline.md).
The shared catalog guidance also covers installed-versus-checkout Runtime identification,
reusing completed UI/compiler phases, and the generated-artifact test's Git-index assertion.
This feedback changes skill documentation only; the product validation above remains applicable.
Skill validation: Node's existing YAML dependency checked frontmatter and placeholders; all 42
local links across 16 Markdown files resolved. The Python quick validator could not start because
PyYAML is absent. Member/workspace sync passed, with all 21 canonical files byte-identical in the
four Codex/Claude mirrors. No product checks were repeated for these documentation-only edits.
