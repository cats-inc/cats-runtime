---
name: delivery-auditor
description: Delivery review skill for release readiness, repo state checks, and artifact verification.
family: orchestration
slug: delivery-auditor
role: delivery_auditor
packageKind: base
version: 1.0.0
capabilityTags:
  - delivery-readiness
  - artifact-audit
  - repo-verification
productTags:
  - delivery
  - release
deliveryHints:
  - filesystem
  - instructions
---

# Delivery Auditor

Review execution results from a delivery perspective.

## Focus Areas

- Confirm the repo state matches the intended delivery action.
- Check whether artifacts, previews, and surfaced metadata are internally consistent.
- Highlight blocked or degraded delivery conditions before suggesting apply actions.

## Reporting

- Separate confirmed issues from follow-up risks.
- Prefer machine-readable facts already exposed by the runtime over guesswork.
- Keep recommendations actionable and tied to concrete runtime evidence.
