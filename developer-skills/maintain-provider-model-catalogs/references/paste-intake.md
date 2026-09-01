# Raw Picker Paste Intake

Read this whenever catalog evidence arrives as copied terminal output. The operator only needs to
paste what the CLI displayed and, when known, name the provider and command/screen. Never ask the
operator to author JSON/YAML, strip ANSI, align columns, remove picker chrome, or unwrap lines.

## 1. Establish intent without misrouting

- A bare paste believed to be catalog evidence selects **capture/preview** and authorizes no edit.
- An explicit catalog update defaults to **confirm uncertainty**.
- Plain language such as “show me everything before changing it” selects **confirm all**.
- Plain language such as “apply the clear parts without asking routine questions” selects
  **apply authorized**.
- If the paste is only for choosing or troubleshooting the active session model, stop this workflow.
- If provider/command context is absent and cannot be established from the conversation, ask one
  plain-language source question rather than guessing.

Record the selected policy, every material question, and the operator's answer.

## 2. Normalize mechanically

Use the portable helper from the canonical skill or its active mirror:

```text
node developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.mjs normalize raw.txt --output normalized.json
```

Use `-` instead of `raw.txt` to pipe or stream clipboard content without first persisting the raw
capture. The helper:

- normalizes line endings;
- removes ANSI/VT and non-visible terminal controls;
- preserves visible text, indentation, box drawing, selection markers, blank lines, and ordering;
- emits every line as `semanticStatus: unparsed` rather than guessing picker semantics;
- replaces common email/token and context-labelled UUID identifier shapes with visible
  placeholders, without erasing an unlabelled UUID that may be a model id.

`manualRedactionRequired: true` is a hard reminder: inspect the result for names, organizations,
paths, account ids, and provider-specific session material before echoing or writing it. Never save
an unredacted raw paste merely to run the helper.

## 3. Build an ordered observation tree

The agent—not the operator—creates an observation JSON document. Start from this shape and include
only values actually observed:

```json
{
  "schemaVersion": 1,
  "provider": "provider-name",
  "interactionPolicy": "capture-preview",
  "source": {
    "kind": "interactive-picker",
    "command": "/model",
    "artifact": "docs/research/fixtures/provider-version/models.redacted.txt"
  },
  "observations": [
    {
      "id": "model-list",
      "path": [],
      "completeness": "unknown",
      "nodes": []
    }
  ],
  "expectedPaths": []
}
```

Each node has:

```json
{
  "id": "model:stable-agent-key",
  "kind": "model",
  "parentPath": [],
  "rawText": "the full normalized source line",
  "rawId": null,
  "label": "Picker-visible label",
  "selection": "selected",
  "defaultClaim": "unknown",
  "completeness": "unknown",
  "sourceFragment": "model-list:4",
  "children": []
}
```

Allowed node kinds are `model`, `option`, `value`, `control`, and `unknown`. Completeness is
`complete`, `partial`, or `unknown`; selection is `selected`, `not-selected`, or `unknown`; default
claim is `default`, `not-default`, or `unknown`.

Use stable agent-local node ids only to correlate this observation; they are not upstream ids.
`rawId` remains `null` unless an id was directly observed. Preserve `rawText`, the visible label,
selection marker, claimed default, source fragment, and exact `parentPath`. Do not promote a label
into `rawId`.

A model list and every per-model option/dependent-option screen are separate observations. Set the
observation `path` to the exact selected context. Evidence captured under one model or option path
applies only to that path.

## 4. Compute gaps without inventing semantics

After the agent identifies expected capture paths, add entries such as:

```json
{
  "path": ["model:alpha", "option:reasoning"],
  "captureAction": "Select Alpha, then open its reasoning picker",
  "selectFirst": ["model:alpha"]
}
```

Then run:

```text
node developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.mjs gaps observation.json
node developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.mjs summary observation.json
```

The helper validates parent paths, renders a redacted compact summary, and compares declared expected
paths with observed paths. It does not decide which models ought to have an option or infer a missing
hierarchy. The agent derives `expectedPaths` from the observed picker flow and current evidence.

When more capture is useful, ask for the smallest next action: name the model/option to select first
and the screen to copy. The operator may stop at any round. Remaining gaps stay explicit.

## 5. Produce a decision artifact before editing

The operator never authors this structure. When the paste leads to a proposed edit, the agent
records its own decision facts in a temporary JSON document:

```json
{
  "schemaVersion": 1,
  "catalogIntent": true,
  "editRequested": true,
  "requestedPolicy": "confirm-uncertainty",
  "modelListCompleteness": "unknown",
  "changes": [
    {
      "id": "reasoning-token-for-alpha",
      "kind": "update",
      "confidence": "high",
      "inScope": true,
      "rawMappingRequired": true,
      "rawMappingObserved": false,
      "conflictingEvidence": false,
      "projectionLoss": false
    }
  ]
}
```

Run:

```text
node developer-skills/maintain-provider-model-catalogs/scripts/normalize-picker-paste.mjs assess decision.json
```

Omit `requestedPolicy` to select capture/preview for a paste without an edit request and confirm
uncertainty for an explicit update. Change kinds are `add`, `update`, `remove`, `record-default`,
`advance-last-updated`, and `other`. The optional booleans describe facts the agent already found:
`dependsOnSelectionMarkerAsDefault`, `selectionMarkerMeaningConfirmed`, `rawMappingRequired`,
`rawMappingObserved`, `conflictingEvidence`, `inScope`, `projectionLoss`, `confirmed`, and
`deletionConfirmed`. `inScope` defaults to `false`, confidence defaults to `low`, and the other
booleans default to `false`; state authorization and observations explicitly rather than relying on
defaults.

The result classifies each proposed change as `preview-only`, `ready`, `confirmation-required`,
`omitted-low-confidence`, or `not-applicable`. It derives the mandatory gate codes, keeps them
deferred during capture/preview, and sets `repositoryMutationAllowed` only when the selected policy
permits an immediately ready subset. Rebuild and reassess the artifact after receiving a material
answer. Set `confirmed` only for a reading the operator actually approved and `deletionConfirmed`
only for an explicit deletion answer. Resolve conflict facts, raw mappings, completeness, and scope
in the rebuilt document. A lossy proposal remains `projectionLoss: true`; confirmation does not turn
it into a lossless edit, so replace it with an authorized representable subset or separately scoped
schema/runtime work. Never translate this internal artifact into a formatting request for the
operator.

## 6. Apply interaction policy and hard gates

For **confirm all**, show the compact redacted summary before editing. For **confirm uncertainty**,
show the proposed in-scope delta and ask only material uncertainties. For **apply authorized**, omit
non-hard low-confidence readings and report them rather than guessing.

Always stop when an edit depends on:

1. interpreting a selection marker as an account default;
2. claiming completeness for removal or `last_updated`;
3. mapping a visible label to an unobserved raw model/option token;
4. resolving conflicting fragments or existing evidence;
5. deleting existing data, expanding provider/file scope, or accepting projection loss.

Capture/preview can defer those questions because it makes no edit.

## 7. Loss-check projection into YAML

Inspect the typed curated schema and normalizer before projection. Compare every observation-tree
branch against what YAML can represent. A branch is lossy if it would be:

- discarded;
- merged with a sibling;
- detached from its parent condition;
- generalized from one model to other models;
- reduced from distinct raw token and label into one guessed value.

Show the exact loss and stop. The operator may explicitly choose to omit the unsupported branch while
retaining it in redacted evidence/report, or separately authorize schema/runtime work. Authorization
to update a catalog alone does not authorize the broader change.

Partial evidence permits only a partial update. It never removes a missing row, never advances
`last_updated` without a complete scope-confirmed model list, and never overwrites unobserved option
provenance. Record unverified levels and dates in notes.

## 8. Preserve material evidence

After a catalog update is authorized, store material support as a `.redacted` artifact under
`docs/research/fixtures/<cli>-<version>/` and cite it from catalog notes. Capture/preview alone
authorizes no repository file creation. If the version was not observed, use `unknown-version`; do
not borrow the local machine's version. A short single-line confirmation may remain in conversation
provenance.

Before persisting or quoting, perform a final manual redaction pass and leave visible placeholders
for every removal. Report the parsed reading, gaps, selected policy, questions/answers, projection
loss, and any evidence deliberately kept out of YAML.
