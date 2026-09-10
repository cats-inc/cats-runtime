# Evidence and Scope

Use this reference for every refresh, review, or audit.

## Evidence priority

When sources conflict, prefer:

1. account-resolved machine-readable enumeration from the installed CLI;
2. operator-pasted output from the authenticated interactive picker;
3. static extraction from the installed shipped artifact, labeled as a possible superset;
4. version/help output, which proves only that surface and version.

Vendor documentation may explain how to obtain evidence, but it does not replace account-resolved
evidence for entitlement-, rollout-, region-, or account-dependent catalogs. Never fill ids,
labels, defaults, limits, or options from model memory.

Record for each observation:

- provider and command/screen;
- installed CLI version when actually observed;
- observation date;
- machine-readable, picker, static-artifact, version/help, or documentation source class;
- account/platform/channel scope;
- complete, partial, truncated, or unknown completeness;
- evidence artifact or conversation provenance.

An unknown version remains `unknown-version`. Do not substitute another machine's version.

## Scope rules

- Inspect `git status --short --branch` first and preserve unrelated edits.
- A provider-scoped refresh changes only that provider section and directly required runtime/tests.
- If a global comment becomes inaccurate but is outside an explicit section-only scope, report it
  rather than expanding scope silently.
- A full-file refresh must make global provenance comments distinguish refreshed and untouched
  sections.
- Observation of drift does not authorize adapter, parser, compatibility, install, schema, or
  accepted-evidence changes. Request explicit scope before making those broader changes.
- Authentication, paid probes, or quota-consuming calls require explicit authorization.

## Freshness and partial evidence

Advance `last_updated` only when the model list for the edited catalog/provider scope was re-read or
confirmed complete. A complete model-list-only paste qualifies even when option screens were not
re-read. A version-only, partial, scrolled, truncated, or completeness-unknown observation does not.

Option axes retain their own source and observation date in `notes`; do not invent a per-option
schema field. Evidence for one level leaves other levels and their prior provenance intact. Absence
from a paste is not removal evidence because scrolling, entitlement, or truncation may hide a row.

## Identity and defaults

- Preserve raw selectable ids and picker-visible labels separately.
- Preserve visible generation/version text; do not strip it to resolve ambiguity.
- Do not map an option label such as `Extra high` to a token such as `xhigh` without an observed
  mapping or the relevant normalizer proving it.
- A selection marker is not an account default until its meaning is confirmed. It may identify only
  the current session selection.
- Never copy one model's observed option set to another model. Shared options in YAML require
  evidence that the axis is genuinely shared across the represented scope.

## Conflicts and projection

When curated input, runtime output, and a test assertion disagree, determine which is authoritative
before editing. A passing test is not proof that its asserted behavior is correct. A curated default,
option, or limit that runtime resolution ignores is a candidate runtime defect; inspect the
resolution code rather than rewriting the assertion or adding a comment that declares the mismatch
intentional.

Before editing YAML:

1. inspect the typed schema;
2. inspect the provider's normalization path;
3. project the observation tree explicitly;
4. list every discarded, merged, detached, or guessed branch;
5. stop if loss affects the proposed edit.

A representable subset may be written within scope. An unsupported row is omitted and reported, or
normalizer/runtime/schema work is performed only after separate authorization with corresponding
tests and docs.

## Evidence storage and redaction

Once an update is authorized, material pasted evidence that supports it belongs under
`docs/research/fixtures/<cli>-<version>/` with a capture-specific name containing `.redacted`.
Cite it from the affected catalog's `notes`. Capture/preview alone does not authorize creating that
fixture or any other repository file. Short confirmations may remain in the conversation and be
summarized in notes after an update is authorized.

Before saving or echoing evidence, replace account identifiers, email addresses, organization names,
and authenticated session material with visible placeholders such as `<redacted-email>` or
`<redacted-organization>`. Never leave a silent gap. The normalization helper catches common token,
email, and context-labelled UUID identifier shapes while preserving an unlabelled UUID that could be
a legitimate model id. `manualRedactionRequired: true` means the agent must still inspect names,
paths, and provider-specific identifiers.

## Report checklist

- selected mode and interaction policy;
- authorized scope and untouched dirty files;
- evidence source, version, date, scope, and completeness;
- observations versus inferences;
- unknowns and gaps;
- omitted or retained rows and why;
- conflict choices and operator confirmations;
- changed files;
- validation commands/results and unrelated failures;
- external mutations not performed.
