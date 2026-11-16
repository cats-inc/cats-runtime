# SPEC-045: Catalog bases per channel, region and plan

## Metadata

| Field | Value |
|---|---|
| Status | Approved 2026-11-16 with the proposed defaults; not implemented |
| Owner | Runtime catalog workstream; Platform owns its consumers |
| Reviewer | User |
| Decision | [ADR-056](../decisions/056-offer-one-basis-selector-over-captured-catalog-bases.md) |
| Amends | [SPEC-031](./SPEC-031-provider-catalog-data-and-local-overrides.md) FR-2.4, FR-4, FR-8, FR-9; [SPEC-028](./SPEC-028-provider-model-catalog-maintenance-skill.md) basis amendment |
| Plan | To be written after approval |

## Summary and goals

A CLI target can carry the model lists of several channels, regions or plans side by side. Each
list is one basis with its own capture date and evidence, and is refreshed on its own schedule.
Playground and Desktop add at most one select per target to choose among them. A new selection
starts on the basis that matches the local sign-in when Runtime can tell without credentials.

Goals:

- Add a plan, region or channel list without touching the others.
- Keep every existing catalog, override and saved selection valid without migration.
- Show how fresh the selected list is.

## Non-goals

- A select per axis, or any combination that was not captured.
- An "Auto" or "Default" basis option.
- Reading CLI credentials or calling provider APIs to learn a plan or region (ADR-038).
- Credential kind as an axis: subscription versus API key, and API-key providers a user adds
  inside a CLI. They stay custom model strings.
- Admin or organization model policies.
- Changing execution arguments for a plan or region basis.
- A scheduled refresh job.

## FR-1: Basis data

- A target is `provider/backend/transport`. It holds one or more scopes. Each scope is one basis.
- `basis` fields:
  - `id`: a stable lowercase slug. Only a target's first scope may omit it; every later scope
    needs one.
  - `channel: { id, label }`: unchanged from SPEC-031 FR-8.
  - `region: { id, label }`: new. `id` is the CLI's own region token. `label` is the name the CLI
    shows.
  - `plan: { label, id? }`: `id` is new and optional. It holds the CLI's own plan token where the
    CLI exposes one, for detection.
- A basis needs at least one of `channel`, `region` or `plan`.
- Scope identity is the target plus `basis.id`. One rule covers scopes, overrides and
  selections: **without an id, it means the target's first basis.**
- Each scope keeps its own `cli_version`, `last_updated`, `notes` and models.
- Data order is display order. A target's pre-existing scope stays first when a second basis is
  added, so saved selections without a basis id keep resolving to it (FR-4).

Illustrative Kimi data, if a mainland capture differs:

```yaml
  - provider: kimi
    backend: cli
    selection_mode: full
    cli_version: 2.5.3
    last_updated: 2026-11-16
    basis:
      id: global
      region: { id: global, label: global (kimi.ai) }
    models: [ ... ]
  - provider: kimi
    backend: cli
    selection_mode: full
    cli_version: <captured version>
    last_updated: <capture date>
    basis:
      id: mainland-cn
      region: { id: mainland-cn, label: mainland-cn (kimi.com) }
    models: [ ... ]
```

## FR-2: Validation

- All SPEC-031 FR-8 checks still apply, including the channel-to-entry check.
- Reject an empty `id` or label, a duplicate `basis.id` within a target, and an id-less scope
  that is not its target's first.
- Model ids are unique within a scope, not across a target. Two bases may list the same id.

## FR-3: Local overrides

- Override identity is the target plus `basis.id`. An override scope replaces only the matching
  basis, as SPEC-031 FR-2.5 replaces a scope.
- An override without `basis.id` replaces the target's first basis, whatever id the factory
  gives it. An existing override therefore keeps replacing the same scope after the factory adds
  a second basis.
- An override with a `basis.id` the factory does not have adds that basis after the factory's
  bases, in override order. A local capture of another plan can then be added by soft patch.

## FR-4: Selection and execution

- `ProviderModelSelection` and `ProviderModelResolution` gain an optional `basisId`. The session
  binding records the resolved `basisId` with the model, provider, controls and revision.
- Runtime resolution is deterministic: the selection's `basisId`, otherwise the first basis.
  Runtime never applies detection, so a saved selection without `basisId` keeps resolving to the
  scope it used before.
- Runtime only reports which basis is detected (FR-5, FR-6). Playground and Desktop use it when
  they initialise a new selection, and then send that `basisId` explicitly. Other callers, such as
  Bot, MCP and plain HTTP clients, get the first basis unless they send `basisId`.
- `entryId` and controls are validated within the resolved basis.
- A plain model string, which SPEC-031 FR-4 resolves through the catalog, is looked up in the
  selection's basis when `basisId` is given. Otherwise the bases are searched in data order and the
  first match decides. The resolved `basisId` is recorded either way.
- A plan or region basis never changes execution arguments. A channel basis executes through its
  channel, as today.
- A saved `basisId` that no longer exists stays an explicit unmappable selection, like a removed
  entry in SPEC-031 FR-4. It never silently switches to another basis.
- The revision conflict rules of SPEC-031 FR-4 are unchanged.

## FR-5: Catalog API

- `GET /providers/:provider/models/advanced` accepts `basis=<id>`. An unknown id returns 400 with
  `code: catalog_basis_unknown`. Without `basis`, it returns the first basis.
- The result gains:
  - `basisId` when the target has two or more bases;
  - `bases`, present only then: `[{ id, label, channel?, region?, plan?, cliVersion?,
    lastUpdated?, detected }]`. Runtime composes `label` by joining the channel, region and plan
    labels with ` · `, so both UIs show the same text;
  - `capture: { cliVersion?, lastUpdated? }` for the returned scope, whether or not it has a basis.
- The basic model list returns the first basis. Label registries key entries by target and
  basis, because two bases may list the same id with different labels.
- `catalogCapabilities` gains `catalogBases: true`. Desktop sends `basisId` only to a Runtime that
  advertises it.
- The local read-only host projection carries the same fields.

## FR-6: Detecting the local sign-in

- Detection reads only CLI output or non-secret local markers. It never reads a credential file,
  uses a token or API key, or calls a provider API (ADR-038). The owner decided on
  2026-11-16 that `catalog:logins` sign-in checks follow the same rule and report `unknown`
  where only a credential file could tell; see the skill's catalog probe reference.
- A detection source is added for one CLI at a time, with evidence in that provider's reference.
  Initial source: Kimi, the `region` file in `KIMI_CODE_HOME` (default `~/.kimi-code`), matched
  against `basis.region.id`. Every other target reports no detected basis until a source is
  verified.
- `detected: true` marks at most one basis per target. No match or no source means none is marked.
- `npm run catalog:logins` reports the detected basis id where one is found.

## FR-7: Playground and Desktop display

- A target with two or more bases shows one select labeled "List basis", placed before the Model
  select, with `bases[].label` as option text in data order. A single-basis target shows no select.
- No option is added, renamed or marked by Cats: no "Auto", "Default" or "(detected)" suffix.
- The information icon stays beside the Model label. Its tooltip gains the selected basis's CLI
  version and capture date from `capture`. It still appears only when a basis exists.
- When the selected basis differs from the detected one, a non-blocking hint under the selects
  says the list is for another plan or region than the CLI sign-in on the Runtime's host, so some
  models may fail. The turn is never blocked and the basis is never switched.
- Changing the basis reloads the Model select from that basis. A saved entry that is missing
  from the new basis follows SPEC-031 FR-4's unmappable handling.
- Desktop's select follows its current label rules: the information icon remains a focusable
  image, not a button inside the label. Platform SPEC-013 picker recovery rules apply to the new
  select.

## FR-8: Maintenance and the catalog probe

This section amends the SPEC-028 basis amendment.

- A refresh names the basis it updates. It never edits another basis of the same target.
- A new basis needs a complete capture and evidence of the sign-in's plan, region or channel
  (for Kimi, the `region` file; for a plan, the CLI's own statement or the owner's confirmation).
- A captured list identical to an existing basis is not added. The existing basis's notes record
  the matching capture and its plan or region.
- Before a target gets its second basis, its existing scope must record the plan, region or
  channel it was captured on. If that is unknown, ask the owner before adding anything.
- The probe compares the live list against the detected basis. With no detection, it compares
  against the first basis and marks each finding `basis-unconfirmed`. `--basis <id>` overrides
  both. The handoff, snapshot rows and acknowledgements carry the basis id.
- SPEC-031 FR-8's statement that first-party CLIs record no plan is lifted for a plan whose
  captured list differs from another basis.

## FR-9: First data change

- The Kimi scope gains `basis: { region: { id: global, label: global (kimi.ai) } }`. As the first
  basis it may omit `id`.
- It lands in the same Runtime release as region display in Playground and Desktop, not before.
  Both build their text from channel and plan only today: Playground would hide the icon, and
  Desktop would show it with an empty tooltip.
- No other basis is added by this specification. Each later basis is its own owner-authorized
  refresh.

## Compatibility and upgrade

- All changes are additive inside schema 2. Existing catalogs, overrides and saved selections
  remain valid and resolve to the same scope as before. No persisted data is migrated.
- An older Runtime rejects an override that uses `basis.id`, `region` or `plan.id`, as it rejected
  `basis` in 2026-09. Under the pre-release policy no shim is added.
- An older Desktop ignores `bases` and keeps using the first basis. A newer Desktop sends
  `basisId` only to a Runtime that advertises `catalogBases`.
- An older Desktop connected to a newer Runtime, for example a remote one, shows a region-only
  basis as an information icon with an empty tooltip until Desktop is updated. Under the
  pre-release policy no shim is added; FR-9 keeps Desktop's own bundled pairing correct.
- Within the 0.x line this is additive. It does not by itself require a minor version bump.

## Acceptance scenarios

1. A single-basis catalog with no `basis.id` loads unchanged, and every existing test pin passes.
2. A Kimi target with `global` and `mainland-cn` bases shows one "List basis" select with two
   options. With the `region` file reading `global`, a new agent starts on `global`.
3. An agent saved before the change, without `basisId`, resolves to the first basis even when
   the detected basis is another one.
4. Choosing `mainland-cn` on a `global` sign-in shows the hint, and the turn still runs with the
   same `--model` argument.
5. A local override adding a `pro-plus` basis to Copilot, whose factory scope has no id, appears
   after the factory basis. A second id-less override scope for the same target is rejected and
   the last accepted revision stays active.
6. An existing id-less Copilot override still replaces the first basis after the factory adds a
   second basis with an id.
7. Basis detection for Kimi reads only the `region` file. A test with a throwaway
   `KIMI_CODE_HOME` whose `credentials/` directory is unreadable still reports `global`.
8. A Bot or MCP request without `basisId` on a multi-basis target runs on the first basis.
9. The probe, run without detection on a multi-basis target, reports findings as
   `basis-unconfirmed` against the first basis.

## Owner decisions (2026-11-16)

The owner chose the proposed default for questions 1 to 5 and deferred question 6.

1. Select label: "List basis" (「清單依據」), matching the icon's existing "Model list basis"
   wording.
2. Kimi region labels: the CLI help's own spelling, `global (kimi.ai)` and
   `mainland-cn (kimi.com)`.
3. Many bases on one target: a flat list until a target has more than eight bases, then options
   grouped by channel inside the same select.
4. Mismatch hint (FR-7): shown.
5. CLI version and capture date in the icon on targets without a basis: not now; the icon keeps
   appearing only where a basis exists.
6. Which bases to capture first: none for now. Candidates when it is reopened: Kimi
   `mainland-cn`, and the free tiers of Copilot, Cursor and Antigravity, whose plan names and
   lists are not captured yet.

## References

- [ADR-038](../decisions/038-separate-execution-usage-from-provider-account-quota.md) decision 10
- [ADR-040](../decisions/040-use-data-driven-provider-catalogs-and-local-overrides.md)
- [ADR-054](../decisions/054-drive-kimi-code-through-print-mode-stream-json.md)
- [SPEC-031 basis amendment](./SPEC-031-provider-catalog-data-and-local-overrides.md#amendment-2026-09-29-catalog-basis)
- [Model-setting survey](../research/2026-09-26-cli-model-setting-dimensions.md)
- [Kimi Code CLI provider](../research/2026-11-16-kimi-code-cli-provider.md)
