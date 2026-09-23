# Local catalog soft patch

Use this for an installed machine, not a factory release. Work from the owning Runtime checkout
or the selected installation. Never assume the globally resolved CLI is the Desktop-bundled one.
Changing provider credentials, sessions or package versions is outside this workflow.

## Capability and preparation

1. Identify the actual package root and Runtime profile root. If a nonstandard providers config is
   used, pass that exact path with `--config`; the override is its sibling
   `curated-model-catalogs.yaml`. Resolve paths before editing and honor outside-project permission.
2. Use that package's `build/runtime/bin/catalogs.js`. Its `inspect` command verifies the selected
   `./catalogs` export reports schema 2, binding version 1 and localOverrides. A missing/unsupported
   export means this install needs a software update; writing a YAML file cannot enable the loader.
3. Read effective origins and the current override. Prepare a candidate containing all existing
   override scopes, replacing only the authorized `(provider, backend, transport)` scopes in full.
   A delivered one-scope patch must not overwrite other existing local replacements.
4. Preserve IDs, labels, provenance and exact execution bindings. A new model using existing
   bindings is data-only. Unsupported control/transport bindings require a separately authorized
   software change. A fixed option is `execution.fixed_controls`, not an advertised default.

## Commands

Run these with absolute paths substituted for the placeholders. These commands do not probe CLIs.

```text
node <package>/build/runtime/bin/catalogs.js inspect --package-root <package> --runtime-root <profile>
node <package>/build/runtime/bin/catalogs.js preview --package-root <package> --runtime-root <profile> --file <candidate.yaml>
node <package>/build/runtime/bin/catalogs.js apply --package-root <package> --runtime-root <profile> --file <candidate.yaml> --expected-digest <preview.expectedDigest>
```

Use `absent` for a null expectedDigest. `validate` accepts the same arguments as `preview`.
Preview is read-only and reports the whole effective candidate. Apply validates everything again,
compares the current file digest, writes a unique backup and atomically replaces the file. A digest
conflict means re-read/prepare/preview; never force overwrite a changed file.

Read `GET /providers/catalogs` from the matching running Runtime. Send its `catalogRevision` as
`{"expectedRevision":"..."}` to `POST /providers/catalogs/reload`, using the configured bearer auth.
For an unavailable initial catalog the expectedRevision is null. HTTP 409 requires a fresh status
read; HTTP 400 leaves the accepted catalog intact and supplies rejection diagnostics. Restarting
the same Runtime is also an activation path. File writes alone do not change a running snapshot.

Verify basic and advanced menus report the new revision/activation, exact labels/defaults and
supported execution bindings. Existing sessions retain their saved bindings; test a new selection
with fake transports unless paid/live execution is authorized. A stale new selection gets 409.

## Schema 1 and rollback

`convert --file <old.yaml> --output <new-preview.yaml>` with the same package/profile arguments
creates a **new** schema-2 preview. It never edits the source or activates it. Reviewed migration
mappings preserve known scopes/options; unresolved IDs/options stop conversion instead of guessing.
Inspect all preserved scopes: a former full snapshot will intentionally keep those scopes pinned.
Then use preview/apply/reload. Conversion is not authorization to modify a personal profile.

### Upgrade regression: a picker that never finishes loading

Inspect the **running installation's** `GET /providers/catalogs` before probing a
vendor or changing UI model data. `available: false` plus an unsupported-schema
diagnostic means reads cannot recover until the local file is converted. New model
routes identify this with `code: catalog_unavailable`; Desktop 0.3.8 originally
returned a generic model lookup failure and kept spinning. Do not fix this by
deleting the user's override, inserting hardcoded defaults, or ignoring a rejected
patch. Prepare the reviewed conversion, verify retained scopes/models/options,
apply it with backup and digest protection within authorization, then reload with
the current revision (null on this cold failure). Verify both model endpoints and
the consumer's subsequent reads; an HTTP health check alone is insufficient.

For schema/loader releases, test a previous-format profile through the complete
upgrade/recovery path in isolation. Converter unit tests and clean-install smokes
do not cover an installed picker with existing settings. Surface any required
personal-file conversion before calling that installation ready, not only in
release notes. Keep this lesson in the Runtime skill source and synchronize both
agent mirrors.

To adopt factory data again, remove the relevant scope from the candidate, preview/apply/reload.
`models: []` intentionally empties a scope; it does not mean inherit or discover. To restore a prior
replacement, copy that scope from a schema-2 backup into the latest candidate, preserving other
current scopes, then preview/apply against the current digest and reload. Restoring a whole backup
also restores every other scope to that backup's state; do so only when authorized. Removing the override
file restores all factory scopes after reload. Retain backups until the user approves removal.

The first conversion's raw backup is still schema 1 and cannot be applied to a schema-2 loader.
Keep the validated converted baseline preview for rollback; alternatively convert that old backup
to a new preview before preview/apply. Restoring raw schema-1 bytes is only useful with its original
software and makes the new loader report rejection/unavailability; do not call that a valid rollback.

Deliver the small scope data, required schema/binding capability, evidence, exact target paths,
preview/digest, activation and rollback steps. Do not claim support on unverified old binaries.
