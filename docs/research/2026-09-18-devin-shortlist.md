# Devin 3000.10.31 fixed shortlist and ACP execution

## Scope and evidence

Refresh, Devin only, confirm-uncertainty. The operator selected six fixed combinations and
separately authorized the ACP execution change. Adaptive has no specified effort. The list is
complete for the Cats shortlist, not for the upstream/account catalog. No provider default was
supplied. Existing Setup diagnostics and installation-count fixes are preserved.

- [Operator text](./fixtures/devin-3000.10.31/operator.redacted.txt): supplied version, names,
  order and fixed efforts. The existing fixed-combination display convention adds a separator
  before the effort; names retain their supplied spelling and case.
- [Installed CLI mappings](./fixtures/devin-3000.10.31/model-mappings.redacted.json): Windows
  Devin reports 3000.10.31 (b98cc431). Read-only `devin models list --format json` enumerated
  48 families; only the six relevant families and public ID/label fields were retained. The first
  unbounded capture was truncated; a bounded in-process capture resolved all six mappings.
  Enumeration alternatives are mapping evidence, not additional approved menu entries.
- Astra's enumeration variant label includes `Thinking`; the operator's approved display
  projection remains `GPT-6 Astra — Medium`. No extra thinking control or default is inferred.
- `devin help acp` says its `--model` sets the default for new ACP sessions. It does not establish
  how to override a loaded session. Unlike `devin acp --help` on older versions, this help form
  exits without starting the server.
- Installed artifact strings include `session/set_config_option` and its model handler.
  A [nonexistent-session probe](./fixtures/devin-3000.10.31/acp-method-probe.redacted.json)
  initializes protocol v1 and reaches model validation, returning `Model not found` with an empty
  available-model list. It establishes dispatch support, not successful model selection or account
  entitlement. Data/state directories were isolated; no session/new, session/load or prompt was sent.
- The [ACP configuration contract](https://agentclientprotocol.com/protocol/v1/session-config-options)
  defines `session/set_config_option` with sessionId, configId and value. No deprecated
  session/set_model method is used.
- No login flow, live inference, paid/quota probe or real session creation was performed.
  Agent-owned observation and decision artifacts passed normalization, gap detection and assessment.

| Display | Exact executable model_uid |
| --- | --- |
| Adaptive | `adaptive` |
| Claude Fable 5.1 — Medium | `claude-fable-5-1-medium` |
| Gemini 3.8 Flash — Medium | `gemini-3-8-flash-medium` |
| GPT-6 Astra — Medium | `gpt-6-astra-medium` |
| Grok 4.6 — Medium | `grok-4-6-medium` |
| Nemotron 3 Ultra — High | `nemotron-3-ultra-high` |

## Implementation

The curated document and Runtime/Playground/Desktop fallbacks retain exactly these six entries.
The first row initializes an empty UI selection; none carries a provider-default flag or suffix.
Refresh cannot expand the curated shortlist, append a configured model or launch an ACP discovery
session. Custom model strings remain available and survive selection normalization/reload.
The obsolete Desktop `devin-default` placeholder is removed.

Devin's verified profile names `model` as its configuration ID. The ACP adapter sends the selected
raw ID after session/new or session/load and permission-mode pinning, before session/prompt.
Model-setting errors stop the turn; an omitted model leaves the provider's saved/default model
alone. Fixed effort is encoded in the model UID, so there is no separate editable effort control.
Other ACP profiles do not acquire unverified model-setting behavior. Catalog support is scoped
to Devin agent/acp_stdio; unsupported CLI/HTTP execution is not enabled by this refresh.

The operator approved adding Devin to the personal curated document. A timestamped backup was
created; exact readback and parsed equality of every other provider passed.

## Validation

- Runtime focused catalog/normalizer/advanced-knowledge, ACP and Playground tests pass: 153 tests
  across seven files. New tests cover every fixed UID plus custom input on both new/load, request
  ordering, rejected-model refusal, shortlist-preserving refresh and unsupported-target isolation.
- Runtime TypeScript check, generated UI build and generated-page synchronization test pass.
- Desktop server build, renderer TypeScript check and 34 catalog/selection/execution-label tests pass.
  The first Node test attempt hit the sandbox's subprocess restriction; the repository's
  `--test-isolation=none` mode ran the same tests successfully.
- Two additional Devin API/workspace-target regressions pass after updating consumers of the
  removed placeholder (36 Desktop tests total). The UI test artifacts were rebuilt first.
- Local port 3110 had no listener at final verification, so a running-user-Runtime HTTP readback
  was unavailable. The personal YAML readback and isolated catalog/transport checks passed.
- Full CI, paid inference and packaged Desktop visual testing are not claimed.

Exact old-label/ID and bundled-example consumer searches completed in both repositories. The
remaining Runtime match describes permission defaults, not a model placeholder. Independent
package-path and historical research fixtures retain their original meaning.

## Maintenance observations

Keep provider family slugs separate from executable variant UIDs: in Devin, choosing the family
would lose the fixed effort. Follow the actual backend path; CLI-only curated routing previously
hid this agent/ACP catalog. A new-session launch default alone cannot cover resume. Bound verbose
enumeration before returning it to the agent, and test custom-input restoration through the shared
normalizer as well as the visible form.

## Follow-up: invisible Playground response

The operator's 07:38 screenshot showed a completed but empty Devin CEO turn, with Cursor never
receiving a handoff. Read-only inspection of that existing session established:

- Runtime routed it through agent/acp, with `gemini-3-8-flash-medium` selected.
- Devin's native database independently recorded the same model and a complete assistant response,
  ending in `NEXT: Agent-2`. It performed workspace file operations and finished normally.
- Runtime's persisted history contained the input/tool events but no assistant text. Authentication
  and catalog selection were not the cause of this missing response. No new inference was requested
  during diagnosis, and the existing session/database/history was not modified.

The ACP adapter incorrectly treated `agent_message_chunk.content` and
`agent_thought_chunk.content` as strings. The [ACP content contract](https://agentclientprotocol.com/protocol/v1/content)
uses a text ContentBlock (`{ type: "text", text: "..." }`). Existing mock peers used the same
incorrect string shape, so earlier model-selection tests did not establish working text transport.
Correcting the fixtures first reproduced failures in both the adapter and backend manager.

The adapter now reads standard text blocks, preserves whitespace-only deltas and ignores non-text
blocks. Replay from session/load remains suppressed. Playground forwards normalized progress,
labels Devin as ACP, excludes `ACP stop reason: ...` metadata from assistant-result fallback, and
renders real result-only replies even when no streamed bubble exists. A genuinely empty turn now
reports the existing missing-output error rather than silently returning idle.

Validation: 95 adapter/manager/Playground tests and TypeScript checking pass. The regression sequence
covers text/whitespace reconstruction, reasoning, NEXT handoff to Cursor, return to the CEO,
result-only display and empty-turn refusal. These are isolated protocol/DOM tests, not another live
paid model call or a browser-driven reproduction. Generated UI and its served-page readback are
checked separately. The connected browser service had no available browser for visual inspection.

Maintenance lesson: model-setting success is narrower than end-to-end usability. Use protocol-shaped
event fixtures and verify emitted text plus its downstream consumer; an accepted model request or
normal stop reason alone cannot prove the response was displayed or delegated.

## Skill feedback

The canonical [Devin maintenance reference](../../skills/maintain-provider-model-catalogs/references/providers/devin.md)
now captures bounded variant-UID lookup, the existing ACP new/load path and conditional response
validation. The skill entrypoint marks Devin's shortlist as implemented, and shared surface guidance
requires tracing the actual backend/transport. Data-only refreshes reuse these supported paths;
this feedback adds no new product behavior or live-probe requirement.
