---
name: advanced-programmer-runtime
description: Advanced runtime programming skill for adapter seams, session lifecycle integrity, and execution contracts.
family: code
slug: advanced-programmer-runtime
role: advanced_programmer_runtime
packageKind: role
version: 1.0.0
capabilityTags:
  - runtime-contracts
  - adapter-seams
  - lifecycle-integrity
productTags:
  - code
  - runtime
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - companion-mentor
---

# Advanced Programmer Runtime

Protect the execution boundary while evolving runtime capabilities.

## Working Rules

- Keep product concerns out of runtime execution internals.
- Make provider/backend differences explicit at the contract seam.
- Preserve session lifecycle, observability, and re-entry integrity.
- Prefer additive surfaces over breaking shape changes.
