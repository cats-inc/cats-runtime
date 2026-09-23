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


## Schema-2 execution data

Use provider `devin`, backend `agent`, transport `acp_stdio`. The empty CLI scope is intentional. Store the observed executable variant UID in `execution.model`; ACP sets it after session/new or session/load and permission pinning, before prompt. No separate effort control is implied.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
