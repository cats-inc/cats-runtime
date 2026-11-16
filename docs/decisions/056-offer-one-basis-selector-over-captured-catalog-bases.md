# ADR-056: Offer one basis selector over captured catalog bases

Date: 2026-11-16
Status: Accepted 2026-11-16; not implemented. The owner chose the proposed defaults for every
open question in SPEC-045 and deferred capturing any new basis. It amends the scope identity of
[ADR-040](./040-use-data-driven-provider-catalogs-and-local-overrides.md) and the basis rules of
[SPEC-031](../specs/SPEC-031-provider-catalog-data-and-local-overrides.md#amendment-2026-09-29-catalog-basis).
Contract: [SPEC-045](../specs/SPEC-045-catalog-bases-per-channel-region-and-plan.md).

## Context

- Every target (provider, backend, transport) has exactly one curated scope. Each of the
  seventeen CLI scopes was captured from one sign-in: the owner's channel, plan and region. The owner wants to add the
  lists of other channels and plans as evidence becomes available. Those lists refresh on
  different schedules: a Free list may change every week while a Pro list is captured rarely.
- Scope identity is `provider/backend/transport` (SPEC-031 FR-2.4, `catalogScopeKey` in
  `src/catalogs/schema.ts`), so two lists for one target cannot coexist. Duplicate keys are
  invalid.
- `basis` (SPEC-031 amendment, 2026-09-29) records a scope's `channel { id, label }` or
  `plan { label }` for display only, as an information icon beside the Model label. Six CLI
  scopes carry it today: a channel for Pi, Goose, OpenCode, Kilo and Cline, and a plan for
  Copilot. The other eleven CLI scopes record none.
- Kimi Code 2.5.3 has a third axis. `kimi login --region` accepts `mainland-cn` (kimi.com, the
  default) and `global` (kimi.ai). The two regions use separate OAuth hosts (`auth.kimi.com`,
  `auth.kimi.ai`) and API bases (`api.kimi.com/coding/v1`, `api.kimi.ai/coding/v1`). At sign-in
  the CLI itself fetches the managed aliases from its region's `/models` and writes them to
  `config.toml`. The current Kimi scope was captured on `global` (the CLI's non-secret
  `~/.kimi-code/region` marker), but the scope does not record it. Whether the mainland list
  differs is unverified: no mainland account has been captured.
- Region fits neither existing field. Both regions run the same `kimi-code/...` model ids, and
  channel validation requires `channel.id` to equal the entries' executable prefix, so a channel
  cannot tell the regions apart. `plan` has a label but no id.
- The axes differ in kind:
  - A **channel** changes what is executed: the provider argument or the model prefix.
  - A **plan** or **region** is a fact of the CLI's own sign-in. Choosing one in Cats changes
    nothing that is sent. A model outside the signed-in plan fails inside the CLI.
- [ADR-038](./038-separate-execution-usage-from-provider-account-quota.md) decision 10: Cats never
  reads CLI credentials or uses them in provider API calls. Sign-in and upstream access belong
  to the CLI. Any detection of the local plan or region must use CLI commands or non-secret local
  markers.
- The [model-setting survey](../research/2026-09-26-cli-model-setting-dimensions.md) also found a
  hidden credential kind (subscription or API key behind one channel id) and admin policies that
  gate models (Copilot Business and Enterprise).

## Decision

1. **A target may hold several scopes, one per captured basis.** Scope identity becomes
   `provider/backend/transport` plus `basis.id`. One rule covers scopes, overrides and
   selections: without an id, it means the target's first basis. Only the first scope may omit
   the id, so all existing data, overrides and selections stay valid.
2. **Basis fields.** `basis` gains `id`, required on every scope after a target's first, and
   a new `region { id, label }`. `plan` gains an optional `id` for detection. `channel` keeps its
   current validation. A basis may combine channel, region and plan.
3. **One selector, flat combinations.** When a target has two or more bases, Playground and
   Desktop show one "List basis" select before the Model select. Its options are the captured
   bases in data order. Each label joins the channel, region and plan labels. There is never one
   select per axis and never a synthesized combination that was not captured. There is no "Auto"
   or "Default" option. A single-basis target keeps only today's information icon.
4. **Each basis is refreshed on its own.** It carries its own `cli_version`, `last_updated`,
   notes and evidence. Refreshing one basis never edits another. The information icon shows the
   selected basis's labels with its CLI version and capture date.
5. **Which basis is selected.**
   - Runtime resolution is deterministic: the selection's basis id, otherwise the first basis,
     which is the pre-existing scope. Runtime never applies detection, so it never moves an
     existing selection.
   - Runtime only reports which basis matches the CLI sign-in on its host. Playground and Desktop
     start a new selection on that basis and send its id explicitly; without a match they start
     on the first basis. Bot, MCP and plain HTTP callers get the first basis unless they send an id.
6. **Detection never uses credentials.** It reads only CLI output or non-secret local markers,
   such as Kimi's `region` file. Where neither exists, the target reports no detected basis.
7. **Plan and region bases never change execution arguments.** Channel bases execute through
   their channel, as today. When the chosen basis differs from the detected one, the selector
   shows a non-blocking hint. It never blocks the turn or switches the basis.
8. **Not an axis.**
   - Credential kind, including user-added API-key providers inside a CLI (for example Kimi's
     `moonshot-cn` and `moonshot-ai` platforms). These stay reachable as custom model strings.
   - Admin or organization policy, which cannot be enumerated.
9. **Evidence rules.** A basis is added only from a complete capture whose plan, region or
   channel is evidenced. A list identical to an existing basis is not duplicated: the existing
   basis's notes record the matching capture. SPEC-031 FR-8's rule that first-party CLIs record
   no plan is lifted for a plan whose captured list differs from another basis.
10. **First data change.** The Kimi scope records `region: { id: global, label: global (kimi.ai) }`,
    in the same release that teaches Playground and Desktop to display a region. A mainland basis
    waits for a mainland capture.

## Alternatives considered

- **One select per axis.** Rejected. It offers combinations nobody captured and presents plan
  and region as choices, although the sign-in fixes them.
- **One merged list with per-row plan badges.** Rejected. Plans are captured on different dates,
  so a merged row's freshness is ambiguous. A rename or removal seen in one plan would contradict
  another, and partial evidence must not remove existing data.
- **Detection only, no selector.** Rejected. Most CLIs expose no plan without credentials, and a
  remote Runtime or a second machine still needs to show another basis.
- **Keep one scope per target.** Status quo. It cannot hold a second plan or region.

## Consequences

### Positive

- Each plan, region or channel list is maintained, dated and reviewed on its own schedule.
- Existing catalogs, overrides and saved selections keep working without migration.
- The selector stays one control for all seventeen CLIs, however many axes a basis combines.

### Negative

- Scope identity, overrides, the advanced catalog API, structured selections, session bindings,
  the catalog probe and `catalog:logins` all gain a basis dimension.
- Every new basis needs a real account of that plan or region to capture. The owner's own
  sign-ins cover only one basis per CLI.
- A rarely captured basis becomes stale. The date in the information icon makes this visible but
  does not prevent it.

### Neutral

- Custom model input is unchanged and remains the path for credential-kind channels.
- The pre-release policy applies: an older Runtime rejects an override file that uses the new
  fields, and an older Desktop connected to a newer remote Runtime shows a region-only basis with
  an empty tooltip. No compatibility shim is added.
