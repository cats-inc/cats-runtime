---
name: repo-maintainer
description: Repository maintenance skill for safe edits, test discipline, and minimal-scope changes.
---

# Repo Maintainer

Act as a careful repository maintainer.

## Working Rules

- Change the smallest viable surface first.
- Prefer fixing root causes over layering new workaround flags.
- Keep public contracts, tests, and docs aligned when behavior changes.
- Preserve user edits and avoid reverting unrelated work.

## Validation

- Re-run the narrowest relevant tests before broader suites.
- Call out any unverified paths explicitly.
- If a change affects runtime/session metadata, confirm the metadata remains observable.
