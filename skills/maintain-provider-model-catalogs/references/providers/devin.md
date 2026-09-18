# Devin Catalog Refresh

Use the operator's selected combinations and retained mappings first. Current model values and
the observed transport behavior belong in the
[Devin evidence note](../../../../docs/research/2026-09-18-devin-shortlist.md).
The shortlist and ACP execution path are already implemented; an ordinary model refresh should
reuse them instead of repeating the original adapter investigation.

## Resolve only missing executable mappings

- Distinguish a model family from its executable variant `model_uid`. Fixed effort is encoded in
  the observed variant UID; a family slug alone loses that choice. Do not construct a UID by
  concatenating a model name and effort without evidence of the mapping.
- The verified read-only enumeration is `devin models list --format json`. When fresh mapping
  evidence is needed, parse the output in-process and retain only the selected families' public
  IDs, labels and relevant variants before returning it to the agent. The full enumeration is
  verbose enough to truncate tool output. Inspect output shape before assuming a JSON schema.
- Enumeration resolves IDs; it does not expand the approved shortlist or override the operator's
  visible names, efforts or default claims. Unselected variants remain mapping evidence. An
  enumeration label containing Thinking does not authorize another UI control or suffix.
- `devin help acp` was verified to exit after showing help. Do not assume `devin acp --help` is
  harmless: older builds can enter the ACP server. Reuse retained help evidence where sufficient;
  bound any necessary invocation without creating a session or sending a prompt.

## Follow the existing agent/ACP path

- Cats executes Devin through `agent/acp` with `acp_stdio` transport. Inspect
  `src/core/models/devinModelCatalog.ts` and `isDevinAcpModelTarget`; the empty CLI fallback is
  intentional and does not mean the ACP shortlist is missing. Verify both basic and advanced
  curated routing for the actual target. Do not enable another backend as a catalog side effect.
- Reuse verbatim UID normalization, `selection_mode: shortlist`, and entry-only advanced choices.
  The fixed effort belongs to the UID, not an independently editable control. Follow the generic
  shortlist checks for order, refresh, custom-input serialization/restoration and both UI fallbacks.
- The existing profile declares `modelConfigId: 'model'`. `AcpAdapter` applies a requested UID via
  `session/set_config_option` after `session/new` **or** `session/load` and permission-mode pinning,
  before `session/prompt`. A launch-time model default alone does not establish resume behavior.
  Reuse this implementation; changing it requires separately authorized execution scope.
- Keep the current omission/error contract: no requested model leaves the provider's saved/default
  model alone; rejected model selection prevents the prompt. Do not revive a synthetic default
  placeholder or claim that an accepted custom string guarantees account entitlement.
- A nonexistent-session configuration probe that reaches model validation proves method dispatch
  only. It does not prove a successful model change, entitlement or a usable response. Such a probe
  is not a routine refresh requirement, and it does not authorize live inference.

## Validate the changed layer

For data-only updates, use the focused catalog/selection checks in
[catalog surfaces](../catalog-surfaces.md#new-shortlist-rollout-checks), including the Devin catalog
suite and affected Desktop fallback consumers. Check personal-file precedence using
[evidence and scope](../evidence-and-scope.md); reusing an existing supported path does not require
another adapter implementation, live session, or full local test run.

When separately authorized work changes ACP execution or response handling:

- Cover selected preset/custom UIDs on both new and loaded sessions, request ordering and refusal
  before prompt when the provider rejects the model. Other ACP profiles must not gain unverified
  configuration requests.
- Use protocol-shaped fixtures: message/thought chunks carry
  `content: { type: 'text', text: '...' }`, not a bare string. Preserve whitespace-only text deltas
  and keep resumed-history replay out of the current turn. Do not make adapter mocks reproduce the
  same parsing mistake as the implementation.
- Follow output through the adapter, backend manager and affected UI consumer. In Playground,
  verify displayed text and `NEXT` handoff, genuine result-only replies, and an explicit empty-output
  error. `ACP stop reason: ...` is completion metadata, not an assistant reply.
- Keep evidence claims separate: a valid menu, an applied model, transported text and displayed
  output each prove a different part. Existing authorized session evidence can help locate a gap;
  read only necessary model/output fields and redact identifiers, rather than dumping native
  histories or system prompts. Do not send a new paid turn just to make a catalog check look complete.
