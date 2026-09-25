---
name: cats-practice-and-distill
description: Derive a sanitized Cats knowledge candidate from admitted preview practice or development evidence, then submit it for independent evaluation and review. Use for lesson production, never for self-promotion or background training.
family: work
slug: cats-practice-and-distill
role: cats_knowledge_author
packageKind: role
version: 1.0.0
capabilityTags:
  - practice
  - knowledge-distillation
  - counterexamples
productTags:
  - cats
  - preview
deliveryHints:
  - filesystem
  - instructions
recommendedCompanions:
  - cats-platform-operation
---

# Practice and Distill

Produce a candidate lesson, not an asserted improvement to the underlying LLM.
Release Catlas and Orchestrator receive reviewed knowledge through their normal
provider/model context; they do not need this preview authoring supplement.

Draft candidates from already authorized development evidence without launching
another exercise. New practice/evaluation requires an explicitly admitted
on-demand exercise with a private fixture/output root, allowed operations, fixed
evaluator, baseline, target metric and finite attempt/time/provider-usage budget.
Preserve existing authorization. Do not
schedule background practice, reuse a consumed model approval, capture private
conversations, or access evaluator-owned held-out inputs from the author context.

Freeze evaluation before optimization. The first promotion gate requires at
least ten scenarios, four held out, three clean resets per scenario, all critical
checks passing, no correctness/policy regression and improvement in the chosen
metric. Budget exhaustion, interruption and negative results remain evidence.
If a provider supplies no usable usage measurement, record unknown and stop
dependent continuation; do not treat it as zero. An attempt may finish above a
continuation threshold, so do not describe that threshold as a hard cost cap.

Distill only the reusable rule: scope/version/capabilities, recognizable trigger,
next supported action, authoritative success check, known failure/counterexample
and recovery. Write concise English and Traditional Chinese content. Separate
Catlas advice from Orchestrator actions and their required operations. Include
sanitized evidence IDs and exact source/input digests. The optional
[candidate checklist](references/candidate-checklist.md) helps prepare review.

Remove credentials, account/user identifiers, machine paths, raw transcripts,
private source and developer-only instructions. Automated checks cannot prove
sanitization or correctness; an independent reviewer must inspect the exact
candidate and evaluator-produced evidence. Do not edit the evaluator, assign
yourself a different reviewer identity or fabricate result receipts.

Submit the candidate through the Platform practice workflow available in the
admitted checkout. Find its current commands in the governing plan; do not
invent missing endpoints. Bind review to exact candidate and evaluation digests.
Only accepted, compatible knowledge may be exported to a reviewable branch
artifact and validated by the production loader. Export does not install or
publish. Revocation must remove future selection/export; published bundle
changes still require the ordinary release process.
