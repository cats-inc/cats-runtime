# Kilo Catalog Evidence

Distinguish two different artifacts:

- the interactive picker, which includes Kilo routing/virtual rows and is account-facing;
- `kilo models` (and its verbose form), which enumerates the broader gateway catalog.

The gateway list is valid evidence for the runtime dynamic discovery seam, but it is not proof that
every entry appears in the interactive picker. Do not replace a picker-scoped curated section with
the gateway list unless the operator explicitly changes that catalog's scope and provenance.

Read `src/backends/cli/kilo/models.ts` and its tests before relying on parsed ids. Preserve gateway
ids separately from picker-visible labels. `--refresh` changes acquisition behavior, not evidence
priority, and may require account/network access; obtain authorization before a credentialed or
quota-bearing live call.
