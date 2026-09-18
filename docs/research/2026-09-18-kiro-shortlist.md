# Kiro CLI 2.22.0 shortlist

## Scope and evidence

Refresh, Kiro only, confirm-uncertainty. The operator supplied version 2.22.0 and
the complete desired six-entry Cats shortlist on 2026-09-18, under the established
six-plus-custom policy. This is not a complete upstream/account model enumeration.

[Operator-supplied strings](./fixtures/kiro-2.22.0/operator.redacted.txt) provide
both the raw IDs and display text, in this order:

1. `claude-opus-5`
2. `claude-sonnet-5`
3. `gpt-5.6-sol`
4. `gpt-5.6-terra`
5. `gpt-5.6-luna`
6. `claude-haiku-4.5`

The exact picker command, account, platform and installation channel were not
specified. Version is operator-reported, not independently probed. No CLI launch,
login, inference or paid probe was needed. The supplied raw IDs have no label-to-ID
ambiguity; no display projection is applied. No default, effort or context values
were supplied. Earlier global `--effort` help is not per-model option evidence.

Agent-owned normalized, observation and decision artifacts are kept in temporary
storage. Intake assessment permits the six-entry replacement and freshness update
for this shortlist scope; no unresolved mapping or hierarchy gates. The prior
12-row menu, including `auto`, is superseded by the explicitly selected six rows.
Historical evidence and independent tests remain historical rather than being
rewritten as current account observations.

## Implementation

- Curated Kiro uses the existing `selection_mode: shortlist` contract. Refresh
  re-reads the selected list without adding configured defaults or discovery rows.
- Replace the old Native/WSL-specific fallbacks with the same approved six IDs.
  This is a Cats menu policy, not proof of entitlement on either platform.
- Kiro normalization now retains raw IDs verbatim instead of restricting them
  to an obsolete hard-coded set or converting case. Model IDs remain separate
  from any display labels supplied by a future catalog.
- Playground and Desktop preserve the exact lower-case strings, initialize the
  first row without a default claim, and offer custom model-string input.
  Playground joins the existing shortlist custom-action, serializer, visibility
  and saved-selection paths.
- Existing entry-only advanced selection and `kiro-cli chat --model <id>` apply
  each selection. No effort argument or new execution capability is introduced.
- `providers.yaml.example` contains no Kiro model list/default requiring changes.
- The dedicated Kiro HTTP model endpoint consumes static fallback data; its
  Native and WSL fixture expectations now follow the approved six rows.

## Validation and personal configuration

- Runtime: 105 distinct focused tests pass across ten files, with unchanged
  passing cases reused after targeted retries. Coverage includes typed YAML
  loading with no warnings, normalization, refresh, advanced selection,
  Native/WSL fallbacks, exact arguments, Playground custom input, Kiro session
  management, the Kiro model HTTP route and generated UI consistency.
- `npm run build:ui` and direct `tsc --noEmit -p tsconfig.json` pass. The direct
  compiler avoids repeating the UI phase in the npm typecheck wrapper.
- Desktop: server and UI-test builds pass; 80 catalog, selection, execution-label
  and UI consumer tests pass. Test TypeScript checking passes.
- Exact old-ID and bundled-example searches distinguish historical inline
  fixtures from current bundled consumers. The Kiro freshness assertion now
  follows the new observation. Historical IDs remain unchanged; their basic
  catalog expectations no longer inherit synthetic `default: false` from the
  removed static default. Advanced overlay behavior remains unchanged.
- Entry-only advanced metadata intentionally has `defaultSelection: null`;
  first-row initialization belongs to the UI and is verified separately.
  No provider default or effort is inferred to satisfy a test expectation.
- Final source inspection caught a temporary edit targeting the color table's
  Kiro key instead of the model table. The color row was restored, the model row
  corrected, and the Playground regression now reads only `PROVIDER_MODELS` so
  another same-named table cannot create a false pass. Generated UI was rebuilt
  and both Playground/generated-output checks passed again.
- Diff whitespace and new research links pass. Tests use isolated temporary
  state; no real Kiro inference or installed Desktop visual test was performed.
  Full CI is reserved for a separately authorized PR.

The operator explicitly approved synchronizing only the personal Kiro block.
It now exactly matches the bundled 2.22.0 / six-row block. Before writing, the
file was checked against the prepared preview and backed up with suffix
`.bak-kiro-2026-09-18T07-41-37-085Z`. Exact readback and parsed equality of every
other provider were verified. The previous personal 2.19.2 / 12-row block would
otherwise override the bundled document.

Version bumps, publication and PR creation are outside this update request.

## Maintenance feedback

The follow-up updates the canonical skill in `cats-runtime/skills/`:

- Route Kiro to the supplied raw-ID shortlist fast path, preserving account/effort evidence limits.
- Record the existing verbatim normalizer, shared Native/WSL fallback and dedicated model route
  so future refreshes reuse the current path rather than rediscovering its prior gaps.
- Keep entry-only metadata defaults separate from UI first-row initialization, and classify
  historical/basic/advanced test expectations before editing them.
- Bound Playground edits and test extraction to the actual model table. This directly addresses
  the mistaken color-table edit caught during this change.

This feedback is documentation-only. Validation covers skill frontmatter, local references,
diff whitespace and Codex/Claude mirror synchronization; the product checks above are reused.

PR preparation found a residual generated CSS removal from the temporary color-table edit.
The existing Tailwind config scans public HTML before the build copies source pages into it,
so HTML equality had not established CSS freshness. Regenerating from synchronized HTML
restores the color class and removes the unintended CSS change; shared skill guidance now
records this ordering caveat. The builder itself is unchanged.
