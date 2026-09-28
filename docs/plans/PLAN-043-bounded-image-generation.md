# PLAN-043: Bounded image generation

Status: Implemented and locally validated, 2026-09-28. Runtime version remains 0.3.4;
the updated source is bundled in the authorized local Desktop update, not npm-published.

Related: [SPEC-033](../specs/SPEC-033-bounded-image-generation.md),
[ADR-042](../decisions/042-bound-native-image-generation.md).

- [x] Typed authenticated HTTP contract and durable receipts.
- [x] One native Grok invocation, whitelist, deadline, output and artifact validation.
- [x] Shared selection, pool admission/singleton/shutdown and usage/metering observation.
- [x] Idempotency, no replay, cancellation before success and confirmed exit semantics.
- [x] Isolated tests: image service/process/HTTP plus pool and Grok provider regressions.
- [x] Independent review; shell runner, admission and cancel-save findings corrected.
- [x] Local Desktop 0.5.11 bundle/install acceptance recorded by
      [Platform PLAN-111](../../../cats-platform/docs/plans/PLAN-111-app-image-generation.md).
- [x] Investigate the user's subsequent real Studio attempt: Grok saved one square JPEG,
      but collection failed because `~/.grok/sessions` was not expanded.
- [x] Correct host-path resolution and add collection-only recovery with receipt backup,
      bounded matching session evidence, and atomic writes; zero further CLI calls.
- [x] Installed Desktop 0.5.12 recollected the existing user work into Studio successfully;
      preview/enlargement and byte identity verified, with no further Grok execution.

Validation: image-generation 7 cases, WorkerPool 4, Grok adapter/fixtures 19. Type build
and full installer build also enforce catalog boundaries. No user's provider profile,
privacy setting or Runtime state was used for synthetic tests.

Correction validation: 9 image tests pass, including home-relative paths, legacy receipt
recovery, malformed/foreign/extra-tool evidence, oversized image, interrupted persistence,
unchanged cancellation semantics and zero execution on recovery. Read-only collection of
the user's existing image succeeds (1024 × 1024 JPEG, 446110 bytes). Installed acceptance
also confirms the original failed receipt backup, unchanged Grok event/usage/image files,
and one original task/run plus one saved artifact. The earlier fake-process fixture did
not cover configured `~` paths. Independent review findings about temporary-file cleanup
and partial-backup validation were fixed and tested before packaging.
