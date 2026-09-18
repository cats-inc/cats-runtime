# Cline / ClinePass Catalog Refresh

Reuse the implemented shortlist and execution path. Current selected models, versions and
operator decisions belong in the
[Cline evidence note](../../../../docs/research/2026-09-18-cline-shortlist.md), not this guide.

## Resolve missing mappings without expanding the menu

- Use the supplied picker and retained mappings first. The observed CLI has no model-list
  command; do not guess a subcommand that could become a prompt. Check installed package/help
  evidence only when a missing mapping or changed invocation requires it.
- For static mapping evidence, locate the installed `cline` package and its bundled
  `@cline/llms` dependency. Record both versions. The observed `dist/models.js` contains a
  provider-keyed catalog; extract only the selected `cline-pass` block's IDs and names using
  bounded text or an AST parser. The repository's TypeScript parser can inspect object literals
  without executing the bundle. This static source may be a superset of account availability.
- Minified files can put megabytes on one line. Find filenames with `rg -l`, then return bounded
  excerpts or selected fields; `rg -n` with a small match count does not bound output size.
  Do not dump the package tree, full catalog, user provider settings or session histories.
- Static model IDs/capability enums do not override the operator's effort choices. In particular,
  a generic or another provider's `reasoningOptions` list does not redefine ClinePass's picker.
- A raw-ID-looking display name may be the upstream label itself. Preserve it until an explicit
  display projection is authorized. Retain the original in evidence and keep the execution ID
  unchanged; one approved friendly name is not permission to prettify other rows.

## Reuse the provider and fixed-effort execution path

- The Cats provider family remains `cline` on `cli/native`; ClinePass is the CLI's selected
  provider `cline-pass`, not another Cats backend. A qualified model ID alone does not establish
  that the CLI switches provider. The existing adapter passes `--provider cline-pass` alongside
  `--model <verbatim ID>` for this namespace.
- Approved fixed effort is transported separately as `--thinking <token>`. Reuse the singleton
  curated option and internal `cline.reasoning_effort` defaults without an editable effort menu
  or a provider-default label. Keep UI first-item selection separate from default claims.
- Check `src/core/models/clineModelCatalog.ts`, the Cline curated overlay in
  `providerAdvancedKnowledge.ts`, and `src/backends/cli/providers/cline.ts` together. Both
  structured selection and known plain model strings must execute the approved combination;
  static fallback knowledge and `getClineFixedEffort` must agree with the refreshed catalog.
- Custom strings keep their exact case. Other `cline-pass/` models select ClinePass but do not
  inherit a shortlist effort. Other custom strings retain the CLI's configured provider; do not
  infer a new `--provider` value from an arbitrary slash prefix. An omitted model stays omitted.
- Routine data refreshes reuse this support. Do not reopen resume/fork/parser investigation,
  rewrite user Cline settings, or send inference requests merely to refresh a catalog. Changed
  execution requirements still follow the separate scope gate in the main skill.

## Validate the affected paths

Use the generic [catalog checks](../catalog-surfaces.md#curated-catalog-checks), the focused
`clineModelCatalog.test.ts` suite, and affected Playground/Desktop fallback consumers. Cover the
curated and static paths, all approved combinations' final argv, first-row selection without a
default suffix, and custom strings after refresh. When execution changes, include adapter tests
and ensure unsupported user control overrides are rejected rather than exposing fixed controls.

Help, static mappings and argv tests establish selection/transport behavior, not successful paid
inference or account entitlement. Identify the running Runtime before using a live response as
verification, following [live-check limits](../catalog-surfaces.md#report-live-check-limits-precisely).
