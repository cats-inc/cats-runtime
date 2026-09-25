# Retiring Desktop-seeded catalog snapshots

## Symptom

On 2026-09-26 the operator reported that machines upgraded from Desktop 0.3.x to 0.5.0 still
showed old model menus, for example Claude without Opus 5.5. One machine also showed "模型清單設定需要修正"
("Model catalog settings need attention"). Desktop 0.5.0 bundles Runtime 0.3.0, whose factory
already carried Opus 5.5, so the bundled data was not stale. A machine without a personal catalog
file showed the current factory correctly.

## Root cause

- **Seeding (2026-04-14 onward).** Desktop copied the bundled
  `curated-model-catalogs.yaml.example` into the Runtime config directory as
  `curated-model-catalogs.yaml` on every packaged start (cats-platform `a5b7eaa9`, `a707bb65`). It
  refreshed the copy only while it matched the recorded or legacy template hashes kept in
  `.bundled-template-seeds.json` and a hash list in `processSupervisor.ts`.
- **Cutover (2026-09-23).** Desktop stopped seeding (cats-platform `7101d8d1`) and deleted its hash
  list, but did not retire copies that already existed.
- **Runtime upgrade.** Runtime treated each remaining copy as operator intent. Its automatic
  schema-1 upgrade either converted the copy, turning every provider scope into a personal
  replacement that pins the old factory forever, or failed. A failure leaves the catalog
  unavailable, so Desktop shows the configuration notice over its last observed choices.

This was not missing backward compatibility. An upgrade path existed and was tested, but it
decided the wrong owner for the file. The upgrade tests used a JSON profile, correctly treated as
operator-authored, and never exercised a shipped factory example, so the freeze went unnoticed.

Evidence gathered from this repository:

- All 53 distinct schema-1 factory examples in history were converted with the shipped mapping.
  Only the 4 versions from 2026-09-23 converted. The other 49 failed with "Conversion requires
  explicit mapping review" and would produce the configuration notice.
- The 18 hashes Desktop listed as legacy managed templates all match one of those 53 versions,
  as LF or CRLF.
- The capture machine had no personal `curated-model-catalogs.yaml`, and its
  `.bundled-template-seeds.json` listed only `management.yaml.example`.

The two affected machines were not inspected directly. The diagnosis above is the code path that
produces both reported symptoms.

## Fix

Before conversion, writable Runtime activation retires an unmodified app-seeded snapshot:

- a file whose normalized digest (byte-order mark removed, CRLF as LF) is one of the 53 frozen
  factory digests in `src/catalogs/legacyFactorySnapshots.ts`; or
- a file whose exact bytes match the hash Desktop recorded in `.bundled-template-seeds.json`,
  which covers bundles built outside this repository's history; or
- a schema-2 file that still exactly equals the conversion of such a snapshot kept in one of its
  `.bak` backups. This repairs machines that an earlier Runtime already froze.

Retirement takes the apply lock and rechecks the bytes. It writes a unique byte-for-byte backup,
then removes the file, so every scope adopts the factory. Status reports `upgrade.state:
retired` with `reason` and `backupPath`, and the capability export advertises
`factorySnapshotRetirement: true`.

Edited files are never retired: any change alters the digest, and a converted file edited after
the upgrade no longer equals the conversion. Such files keep the existing behavior. A lock held by
another writer or a failed backup keeps the file and reports `blocked`, and a later reload retries.
The digest list is frozen and must never include a schema-2 factory.

## Validation

- `tests/catalog-upgrade.test.ts` covers the shipped and CRLF snapshots, an edited seed kept on
  conversion failure, and the Desktop seed record matching or not. It also covers repair of an
  already converted profile, a converted profile edited afterwards, the lock, backup failure, and
  sticky status.
- `tests/runtime-server.test.ts` checks end to end that a seeded copy is retired and
  `/providers/claude/models` returns the current factory entries.
- The installed-package smoke (`tests/fixtures/catalog-soft-patch-smoke.mjs`, run by
  `tests/package-contract.test.ts`) retires a seeded profile using only installed resources, then
  confirms a restart is a no-op.

## Limitations and rollout

- The fix reaches Desktop users only through a Desktop build that bundles this Runtime. That
  release is a separate, operator-authorized step.
- If an earlier upgrade's `.bak` was deleted, a converted profile cannot be recognized
  automatically. Renaming `curated-model-catalogs.yaml` with Cats stopped restores the factory.
- A copy that the operator edited stays an operator override. If it cannot convert, it still
  needs manual review.
- After a restart, Desktop may briefly show cached choices until its catalog read revalidates.
