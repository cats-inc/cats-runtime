# Provider catalog soft patches

A compatible installed Runtime can change model lists, labels, defaults, ordered
controls and fixed combinations without rebuilding or changing its version. The
factory source is `config/curated-model-catalogs.yaml.example` (schema 2). The
optional local file is `config/curated-model-catalogs.yaml` below the Runtime root;
when a custom `providers.yaml` path is selected, the override is its sibling.

## Replacement rules

- A scope is `(provider, backend, transport)`. CLI scopes omit transport; an ACP
  scope does not replace the same provider's CLI or API scope.
- A local scope replaces its entire factory scope. Keep its complete intended
  model list, control definitions, execution bindings and provenance.
- Omitted scopes inherit factory data. `models: []` intentionally empties a scope.
  Removing a scope or the override file restores factory data after activation.
- Preserve every other existing local scope when delivering a one-scope patch.
  A candidate file replaces the previous override file; it is not merged into it.
- Full/shortlist scopes are authoritative, including order and removals. Discovery
  scopes retain their separate live discovery/config behavior.
- Only explicitly evidenced defaults get `(default)`. First-row initialization
  and fixed controls do not imply a provider default. Custom model input remains.

## Prepare and apply

Use absolute paths for the actual installed package and profile. Desktop-bundled
and globally installed Runtime packages can differ. The selected package must
expose `@cats-inc/cats-runtime/catalogs` with schema 2, binding version 1 and local
override support. Unsupported installations need a software update first.

```text
node <package>/build/runtime/bin/catalogs.js inspect --package-root <package> --runtime-root <profile>
node <package>/build/runtime/bin/catalogs.js preview --package-root <package> --runtime-root <profile> --file <candidate.yaml>
node <package>/build/runtime/bin/catalogs.js apply --package-root <package> --runtime-root <profile> --file <candidate.yaml> --expected-digest <preview.expectedDigest>
```

Add `--config <absolute-providers.yaml>` to every command for a custom config
location. Use `absent` when `expectedDigest` is null. `validate` accepts the same
arguments as `preview`. Neither reads credentials nor probes CLIs. Apply validates
the complete candidate, checks the current file digest, creates a unique backup,
and atomically replaces the file. A conflict requires another preview.

The installed binding registry defines control keys and serialization. A new model
ID using those bindings is data-only; new flags/transports/control types require
code support. See [the schema](../src/catalogs/types.ts) and [binding registry](../src/catalogs/bindings.ts).
Data cannot introduce shell scripts, arbitrary arguments or credential overrides.

## Activate and verify

Read `GET /providers/catalogs` from the matching running Runtime. POST
`{"expectedRevision":"<catalogRevision>"}` to `/providers/catalogs/reload` using
the configured bearer authentication. Use null for an unavailable initial revision.
HTTP 409 means read status again; HTTP 400 rejects the candidate and preserves the
accepted snapshot. Restarting the same Runtime also activates valid data.

Basic and advanced model responses carry `catalogRevision` and
`catalogActivationId`. Consumers must use a coherent pair. The status endpoint also
reports origins, digests and diagnostics. Editing the file alone does not change a
running snapshot. Model discovery refresh and local-file reload are separate actions.

New sessions resolve against the active revision. Stale structured requests are
rejected before launch. Existing sessions keep their recorded executable model,
provider and controls; a new catalog never silently changes a resumed session.
Unknown custom strings preserve their exact transport semantics.

Desktop uses Runtime observations for executable choices. Its local read-only
projection can show informational labels while disconnected; it does not create
usable targets or prove that a candidate was activated. Remote connections never
read the local machine's patch. Desktop's model refresh updates mounted selectors
immediately; ordinary reads also revalidate automatically.

## Existing schema-1 files and rollback

Runtime builds advertising `automaticSchema1Upgrade: true` in `./catalogs` and
`GET /providers/catalogs` upgrade recognized schema-1 overrides on writable startup
or explicit reload. The converter uses shipped, reviewed mappings without probing
providers. It validates the complete candidate, saves a unique byte-for-byte backup,
checks the source digest under an apply lock, and atomically replaces the file.
All existing scopes stay pinned; labels, order, defaults and controls are preserved.
Missing overrides and schema 2 are no-ops, including repeat startup. Desktop no longer
seeds this file, and there is no second host-owned converter.

Desktop builds from 2026-04-14 until the cutover did copy the factory example here.
Builds advertising `factorySnapshotRetirement: true` retire such a copy before
conversion when it is unmodified, or when a schema-2 file is still exactly the
automatic conversion of one. They save a byte-for-byte backup and remove the file, so
every scope adopts the factory. An edited copy is an operator override and is kept.

Catalog status includes `upgrade.state`: `completed` (with schema numbers and
`backupPath`), `retired` (with `reason` and `backupPath`), `blocked` (with a message),
or `not_needed`. Setup & Repair shows
upgrade/recovery details and can retry by reloading the current revision after the
cause is corrected. A failed conversion/write or concurrent edit preserves the
existing file. An interrupted writer's lock is retained for verified recovery;
do not blindly delete it or run two writers. A completed conversion remains valid
if later snapshot persistence fails; its original is still in the recorded backup.
After restart, the now-current file needs no further migration or backup.

Read-only projections, inspect and preview never migrate or create personal files.
For older schema-2 installations without this capability, or reviewed manual
recovery of unresolved mappings, convert explicitly:

```text
node <package>/build/runtime/bin/catalogs.js convert --package-root <package> --runtime-root <profile> --file <old.yaml> --output <new-preview.yaml>
```

Conversion writes a new preview only and refuses unresolved mappings. Review every
retained scope: a former complete personal snapshot pins all of those scopes until
removed. Keep this validated schema-2 baseline for rollback, then preview/apply/reload.
An old schema-1 backup cannot be applied as a schema-2 patch; restoring it causes
a migration-capable Runtime to migrate again. Convert it to a validated candidate
before applying a rollback.

To roll back one scope, copy it from a validated schema-2 backup into the **latest**
candidate, preserving other scopes, then preview/apply/reload with the current
digest. A whole-file backup also reverts other scopes. To adopt factory values,
remove the intended scope instead. Retain backups until their deletion is approved.

Invalid candidates use a compatible last-accepted snapshot or report unavailable.
When no accepted snapshot exists, model reads return HTTP 503 with
`code: catalog_unavailable`. This is a configuration failure, not a pending model
discovery operation. `GET /providers/catalogs` contains the rejection diagnostics.
Consumers should distinguish it from a transient connection failure, retain any
previously observed choices, and check again after the configuration is repaired.
Compatibility includes the Runtime root, config/override paths, factory digest,
schema and bindings. Corrupt package assets are installation errors. Changing
software, connection or profile cannot borrow another identity's accepted snapshot.

An upgrade must cover an existing profile as well as a clean install. Desktop
0.3.8 exposed a missed transition: an existing schema-1 override left the catalog
unavailable while the picker kept spinning. That release requires the selected
package's explicit conversion sequence above; newer builds expose the automatic
upgrade capability. Verify the backup, both
model endpoints and their shared revision. A package health response or a passing
converter unit test alone does not establish that the upgraded picker works.

## Factory maintenance and validation

Edit the single authored YAML, run `npm run catalog:generate` and
`npm run catalog:check`, and review generated changes. Never reintroduce model,
default or effort lists in TypeScript, JavaScript or HTML. The canonical maintenance
skill is [maintain-provider-model-catalogs](../skills/maintain-provider-model-catalogs/SKILL.md);
its local-patch route uses the installed commands above, without requiring source
tests in a shipped package.

The [delivery plan](plans/PLAN-040-provider-catalog-data-and-local-overrides.md)
records fixed-build acceptance, exact scope isolation, rollback, session stability,
selector/cache tests and Windows/package coverage. Native macOS/Linux installers
require their normal release validation; this change does not publish a release.
