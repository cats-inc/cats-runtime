# Provider catalog data cutover acceptance — 2026-09-23

## Delivery boundary

This records implementation of [SPEC-031](../specs/SPEC-031-provider-catalog-data-and-local-overrides.md)
and [PLAN-040](../plans/PLAN-040-provider-catalog-data-and-local-overrides.md).
The operator authorized staged commits and pushes directly to both repositories'
`main` branches. Runtime remains `0.1.27`; Platform remains `0.3.7`. This work does
not publish a package, Desktop installer or preview release. The version alone
does not prove catalog support: inspect the selected package's `./catalogs` export.

Schema 2 contains 23 exact provider/backend/transport scopes. Binding version is
1. The generated resource records this SHA-256 of the authored factory YAML:

```text
e9ef164bde0157645b41d8a01ca52596cf656da826450a63b618d738bab3dac7
```

All mutation, migration and execution tests use temporary profiles and fake
transports. The operator's personal catalog was neither converted nor replaced;
actual provider authentication, account probes and paid inference were not used.

## Acceptance evidence

| Scenario | Executed evidence |
|---|---|
| AC-01 fixed-build patch | The npm tarball contract installs once, records artifact hashes, then runs `tests/fixtures/catalog-soft-patch-smoke.mjs` without rebuilding. An unfamiliar Pi entry changes projected labels and the captured adapter invocation. Mounted Desktop and Playground projection tests exercise the same contract separately; no installed Electron UI session is claimed. |
| AC-02 unknown ID | `Future.Unknown-ID` maps explicitly to `--provider test-subscription --model Opaque.CaseSensitive --thinking medium`; Runtime selection and Desktop mounted-picker tests accept the unfamiliar ID without production-code edits. |
| AC-03 scope isolation | `tests/catalog-data.test.ts` covers CLI/API/ACP identities and scope replacement. The independent skill exercise preserved all 22 non-Pi scopes, including an existing local Codex replacement. |
| AC-04 removal/rollback | Resolver and installed-package tests cover row removal, `models: []`, scope/file removal and backups. The independent CLI exercise restored its schema-2 baseline and then removed just Pi to adopt factory data. |
| AC-05 atomic rejection | Schema tests reject invalid YAML, unknown fields/bindings, duplicate/default errors and ambiguous/incomplete variants. Store/HTTP tests retain accepted data on failed reload or persistence, enforce revision conflicts, and prevent partial activation. Apply tests check a stale file digest before mutation. |
| AC-06 restart identity | Store tests cover valid startup, compatible accepted snapshots, missing accepted data, incompatible factory/config identity, unreadable overrides and corrupt mandatory package resources. |
| AC-07 session stability | Runtime HTTP tests capture actual fake-process spawn parameters, reject stale selections before launch and retain recorded model/provider/control bindings across reload and subsequent turns. Resume/wakeup tests retain recorded/native values instead of resolving them through new catalog data. |
| AC-08 policy/defaults | Data and selection tests cover all factory scopes, per-entry controls, explicit defaults versus first-row initialization, fixed combos, authoritative curated membership and custom input. Prior model-name-specific tests were replaced by data-projection and generic adapter assertions. |
| AC-09 coherent consumers | Runtime basic/advanced projections carry revision and activation identity. Mounted Desktop tests withhold mixed pairs, reject late replies, refresh mounted selectors immediately and expose no editable controls for fixed combos. Playground generated-source and UI tests pass. |
| AC-10 offline/remote | Local-host package fixtures import the readonly module with explicit paths and no profile writes. Remote connections do not inspect local files. Label/selector tests cover connection resets, observed-choice retention, scoped label replacement and raw fallback labels. |
| AC-11 package/upgrade | npm installation and Desktop split/bundle staging tests import the resolver and CLI, check resource digests and exercise relocated/read-only resources. Factory-upgrade tests retain local replacements and update only unpatched scopes. Native coverage limits are below. |
| AC-12 migration/capability | Frozen schema-1 conversion preserves source scopes and rejects unresolved mappings. Built-CLI tests reject missing or incompatible selected-package exports before touching candidate/profile bytes. Conversion writes a new preview; applying an old schema-1 backup is deliberately unsupported. |
| AC-13 prevention | `catalog:check` verifies deterministic generation and the AST boundary guard. Regression fixtures reject production model/effort tables, model-name branches and forbidden generator imports while allowing data fixtures and generic serializers. |
| AC-14 skill workflow | Canonical Runtime skill and all 16 provider references now describe schema-2 data. Runtime and parent Codex/Claude mirrors were synchronized and checked. An independent agent completed 11 built-CLI operations plus `catalog:check`, including unknown-model execution, preview, stale-digest rejection, exact backup, rollback and custom-config sibling resolution. |

## Checks and timings

Run repository-relative commands in the owning checkout. Heavy builds were
serialized; the installed-package and independent-agent experiments kept the
tested build fixed between baseline and patch.

| Check | Result before CI |
|---|---|
| Runtime `npm run build` and `npm run typecheck` | Passed, including generated Playground assets and catalog checks. |
| Runtime package contract | 4/4 passed; approximately 163 seconds. Includes installed tarball soft-patch smoke. |
| Runtime full Vitest run excluding the separately checked package contract | 2,260 passed, 10 skipped, one scan callback timing failure. The test now waits for the actual callback handshake; its entire 28-test bootstrap file then passed. |
| Runtime focused catalog/HTTP verification | 123/123 passed. Later upgrade/guard additions passed; the two built-CLI capability cases passed after correcting test cleanup registration. |
| Platform affected catalog/label/picker/server/package checks | 338/338 passed, approximately 31 seconds. |
| Platform initial broad Node run | 3,952 cases reported; 16 failures exposed old static-label/default expectations and a local renderer-build assumption. These were corrected and included in the passing affected set. The runner retained an open handle after reporting every case, so this initial run is not recorded as a successful full-suite run. |
| Independent skill exercise | 11 CLI operations and one factory check passed in approximately 18 seconds. Eighteen selected build/factory hashes were unchanged. The expected stale-digest failure left the override unchanged. |
| Skill tooling | Six intake-helper tests, YAML frontmatter validation, Runtime sync and parent workspace sync/check passed. |

The independent agent's machine-local evidence is under
`tmp/skill-workflow-plan040-independent-5efb8c-run-7d335f59/artifacts/`:
`summary.json`, `commands.json` and `fake-transport-argv.json`. Those temporary
artifacts are not shipped; the repeatable package smoke and regression tests are
tracked. CI results and final validation will be appended after the staged pushes.

## Review and platform limits

Independent reviews covered the schema/store foundation, Runtime/Platform contract,
mixed revisions, invalidation, offline reads, packaging and the skill procedure.
Findings were corrected, including explicit refresh notification for mounted
selectors and the inactive-picker loading state.

Windows source/build, npm installation and Desktop package-staging fixtures ran
locally. This is not a signed/unsigned installer release, native macOS/Linux
installer smoke, or a live provider interoperability run. CI supplies the normal
Linux source-suite coverage; native installer checks remain part of release work.

The new loader requires schema 2. Existing personal schema-1 files require an
explicit conversion and review using [the soft-patch guide](../provider-catalog-soft-patches.md).
Until converted, a new loader reports the catalog unavailable if it has no
compatible accepted snapshot. No automatic migration or new full-file seed hides
that condition.
