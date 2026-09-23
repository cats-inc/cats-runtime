# Catalog data and consumers

## Authoritative surfaces

| Surface | Location | Maintenance rule |
|---|---|---|
| Factory | `config/curated-model-catalogs.yaml.example` | Single authored schema-2 model/option source |
| Generated projection | `config/curated-model-catalogs.generated.json` | Run generator; never edit directly |
| Scoped personal replacement | Config sibling `curated-model-catalogs.yaml` | Explicit authorization, backup, digest check, reload |
| Types/validation/bindings | `src/catalogs/{types,schema,bindings}.ts` | Generic schema/serializers; no model-ID allowlists |
| Resolver/activation | `src/catalogs/{resolver,store}.ts` | Immutable accepted revision, origins and diagnostics |
| Local host export | `@cats-inc/cats-runtime/catalogs` | Read-only informational projection; no process startup |
| Basic/advanced projections | `src/core/models/provider{ModelCatalog,AdvancedKnowledge}.ts` | Consume the accepted data; no authored tables |
| Execution | `providerSelectionResolution.ts`, adapters, session binding | Actual provider/model/controls; recorded bindings survive reload |
| Playground | `src/http/ui` → `public` | Runtime-served menus, custom input, explicit default markers |
| Desktop | Platform `providerCatalogClient`, `useProviderCatalogState`, label registry | Runtime-observed choices; scoped cache and coherent revisions |
| Desktop offline labels | Platform `localCatalogProjection.ts` | Same Runtime read-only resolver; never fabricates usable targets |
| Migration evidence | `config/catalog-schema1-migration.json` | Frozen schema-1 conversion mappings, not a second current catalog |

## Data mapping

Scope key is `(provider, backend, transport)`; CLI omits transport. `full`/`shortlist` are
authoritative even on Refresh. `discovery` explicitly retains the target's discovery/config path.
Scopes absent from overrides inherit factory. `models: []` is an intentional empty list.
An omitted model `controls` inherits `shared_controls`; `controls: []` disables inheritance.

Each model has `id`, exact `label`, and `execution.model`. Optional `execution.provider` selects a
CLI provider where supported. `execution.fixed_controls` stores approved fixed combinations.
Selectable `controls` carry token/label pairs and only evidenced `default`. Exhaustive
`execution.variants` map option tuples to exact wire IDs. Do not guess suffixes or shared options.
Preserve provenance in notes/source fields. The schema rejects unknown fields, unsupported
bindings, duplicate IDs/defaults and incomplete/overlapping variants as one whole candidate.

## Factory checks

From the Runtime root:

```text
npm run catalog:generate
npm run catalog:check
npx vitest run tests/catalog-data.test.ts tests/catalog-runtime.test.ts --pool=threads --poolOptions.threads.singleThread
node --test skills/maintain-provider-model-catalogs/tests/normalize-picker-paste.node-test.mjs
```

Routine data refreshes should not change production TS/JS/HTML. The AST boundary guard rejects
model literals, authored tables, model-keyed branches and non-data generator imports. When adding
a binding, include an unknown-ID test that changes actual argv/request data without new model code.
Use isolated profile/config fixtures; never depend on the maintainer's personal override or login.
Select `discovery` explicitly in discovery tests; an empty override document inherits factory.

For runtime/UI implementation changes, run affected selection, adapter, HTTP and UI tests plus
TypeScript checks. Regenerate public assets with `npm run build:ui`. For Platform behavior changes,
build server/host/test UI once, then run the affected node tests. Serialize heavy cross-repo builds
and rerun only failures or newly changed surfaces. Distinguish source tests, packaged smoke tests
and real installed UI checks in the report. Routine data changes do not require every Desktop test.

## Cache and package checks

Basic/advanced must share catalog revision, activation and target. Connection/auth/selection
changes invalidate observations, and late replies cannot overwrite newer ones. Removed models
stay removed; saved unknown strings become custom choices. Preserve exact case and `(recommended)`;
only the explicit default status suffix is normalized. Local informational labels never establish
picker availability. Remote/disconnected hosts do not read a local factory for remote labels.

The factory, generated digest, read-only module and catalog CLI must come from one Runtime build.
Check the npm payload and both Desktop sidecar layouts when packaging code changes. A local scope
replacement survives factory upgrades; unpatched scopes adopt the new factory. Do not auto-seed a
whole personal factory snapshot. Follow [local patches](./local-soft-patch.md) for installed users.

## Skill source and mirrors

Edit only `cats-runtime/skills/maintain-provider-model-catalogs`. Run Runtime's
`scripts/windows/Sync-AgentSkills.ps1`, then parent `cats-one/scripts/windows/Sync-WorkspaceSkills.ps1`
and its `-Check` mode (or OS equivalents). Compare `.agents` and `.claude` copies. Provider
references hold evidence acquisition and protocol facts, not current model lists or fallback maps.
