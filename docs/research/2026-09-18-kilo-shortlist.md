# Kilo Code 7.7.3 shortlist

Last updated: 2026-09-18.

## Scope and evidence

Refresh, Kilo only, confirm-uncertainty. The operator supplied the complete desired six-entry
Cats shortlist and explicitly requested Thinking for the last two entries. This replaces the old
13-entry picker selection; it does not claim the gateway has only six models. Existing uncommitted
OpenCode work is preserved in both repositories.

- [Operator transcription](./fixtures/kilo-7.7.3/models.redacted.txt): names, order, version,
  and the final two fixed Thinking choices. No default or extra controls were supplied.
- [ID mappings](./fixtures/kilo-7.7.3/model-id-mappings.redacted.json): installed Windows Kilo
  reports 7.7.3; read-only `kilo models kilo --verbose --pure` supplied exact ID/name mappings
  and the final two `thinking` variants. The gateway does not override picker membership.
- [Transport evidence](./fixtures/kilo-7.7.3/variant-transport.redacted.txt): installed help says
  `--thinking` displays thinking blocks; `--variant` selects the model variant. The shipped
  SDK's native prompt method accepts a top-level `variant` body property.
- No login, inference, live session creation, or quota probe was performed. The bounded mapping
  fixture omits unrelated gateway entries and metadata. No account entitlement claim is added.
- Agent-owned observation/decision artifacts passed normalization, gap detection and assessment:
  complete shortlist, no unresolved raw mappings, no projection loss.

| Exact display name | Raw model ID | Fixed variant |
| --- | --- | --- |
| DeepSeek: DeepSeek V4.1 Flash | `kilo/deepseek/deepseek-v4.1-flash` | Unspecified |
| Z.ai: GLM 5.3 Flash | `kilo/z-ai/glm-5.3-flash` | Unspecified |
| MoonshotAI: Kimi K3 | `kilo/moonshotai/kimi-k3` | Unspecified |
| MiniMax: MiniMax M3 | `kilo/minimax/minimax-m3` | Unspecified |
| ByteDance Seed: Seed 2.1 Turbo Thinking | `kilo/bytedance-seed/seed-2-1-turbo` | `thinking` |
| Google: Nano Banana Pro (Gemini 3 Pro Image) Thinking | `kilo/google/gemini-3-pro-image` | `thinking` |

## Implementation

Runtime, Playground and Desktop fallbacks use the six supplied names and order. Existing shortlist
routing prevents refresh, gateway enumeration or configured defaults from expanding the menu.
Custom model-string input remains available. UI initializes the first row without a provider-default
flag or label. No new context/effort menu is introduced; the first four variants remain unspecified.

The existing typed option schema stores the final two fixed variants. The Kilo overlay resolves them
into internal `kilo.variant` defaults, excluded from public editable controls/default labels.
KiloProvider now forwards that variant to the native session service, which serializes it in the
prompt body. This directly implements the operator's explicit Thinking request; the previous code
sent only the model. No shared public schema or generic provider protocol was changed.

Old label normalizations and independent inline fixtures remain as historical inputs. The bundled
freshness assertion no longer treats Kilo as version-only; Kiro and Junie retain their older dates.
`providers.yaml.example` has no Kilo model list/default requiring an update.

## Validation

- Focused Runtime loader, normalization, advanced knowledge, catalog service, Playground and Kilo
  provider/shortlist suites: 84 tests pass across seven files, reusing unchanged passing cases
  after focused corrections. The new integration test loads real YAML, checks refresh stability,
  resolves every selection, and inspects the final native HTTP body through a mocked transport.
- Existing Kilo HTTP catalog/advanced route: passes. Initial failures were obsolete freshness and
  optional default-field assertions; the advanced response still emits explicit false values for
  historical nondefault entries. Both response shapes remain covered.
- Runtime typecheck and generated Playground assets: pass. Full CI and live model inference are
  not claimed. Desktop server build and 27 selection/execution-label tests pass.
- Exact old-ID and bundled-example consumer searches completed in both repositories. Historical
  independent fixtures and package-path checks are retained.

The operator explicitly approved the prepared personal Kilo-only diff. The old 7.4.23/13-entry
section was backed up and replaced with 7.7.3/six entries and two fixed Thinking variants.
Exact readback and parsed equality of every other provider passed.

Version bumps and releases are outside this update.

## Maintenance feedback

The canonical Kilo skill reference now distinguishes the display-only thinking flag from an
execution variant, calls for inspecting the actual native transport, and reuses fixed execution
options without inventing extra picker controls. Both agent mirrors must be synchronized.
