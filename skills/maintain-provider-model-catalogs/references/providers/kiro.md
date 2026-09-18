# Kiro Catalog Evidence

## Supplied shortlist fast path

An operator-selected list of exact model IDs can supply both IDs and display text. Preserve the
strings and order, label the version as operator-reported, and use the established six-plus-custom
policy. A complete desired shortlist does not claim a complete upstream/account catalog. Do not
launch Kiro or request another capture merely to corroborate unambiguous supplied IDs.

Reuse `selection_mode: shortlist`, the verbatim Kiro normalizer and entry-only selection. Check the
current normalizer before adding data: the retired hard-coded ID allowlist dropped new rows even
when YAML loaded successfully. Do not reinstate that list or convert raw IDs to lower/title case.

When fresh account evidence is actually needed, use authenticated `kiro-cli model list` output if
it succeeds. Logged-out or account-gated output proves only the gate; a newer `--version` does not
refresh the model list.

## Options and execution

`kiro-cli chat --effort` exposes an effort control, but a help-declared value range alone does not
prove picker visibility, per-model applicability, or the current default. Capture option behavior in
the selected model context before projecting it, and do not promote a CLI-wide flag declaration into
shared YAML when models may differ. A model-only shortlist adds no effort/default claim and leaves
the existing adapter's `--model <id>` invocation intact. Later effort support needs its own evidence
and scope if it changes execution.

For entry-only Kiro metadata, `defaultSelection: null` is valid. Verify that the UI initializes and
submits the first entry; do not invent a provider default or a new advanced manifest to make a
first-row test pass. Keep arbitrary custom strings verbatim through saved-value reconciliation and
execution, without inferred controls.

## Surfaces and focused validation

- Trace both Native and WSL fallbacks. They now share the approved Cats shortlist; this menu policy
  does not prove identical account entitlement on both installations.
- Inspect the dedicated `/kiro/models` route as well as generic provider catalogs: it reads static
  fallback data, and its Native/WSL HTTP tests can retain old list expectations.
- Check Runtime curated/basic/advanced catalogs and both UI fallbacks. Playground needs the
  existing shortlist custom-action, visibility, serialization and saved-selection paths; Desktop
  already has generic custom input. Reuse those paths for future data-only refreshes.
- Search bundled freshness assertions as well as exact old IDs. A previously version-only Kiro
  observation must stop being asserted as stale after a new complete shortlist is supplied.
  Retain independent historical model IDs. If default metadata differs, trace basic catalog and
  advanced overlay behavior separately before changing assertions: omitted and explicit `false`
  can originate in different layers.
- Reuse the isolated `kiroModelCatalog.test.ts`, Playground shortlist checks and affected Kiro HTTP
  tests. Argument checks establish model transport, not login, entitlement or successful inference.

Keep native/WSL, channel, account, and CLI-version scope explicit. If runtime static fallback and the
account list disagree, report both and inspect resolution behavior rather than silently replacing one
with the other.
