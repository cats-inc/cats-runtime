# Runtime Setup Action Layout

Date: 2026-09-16

## Sources and findings

- [USWDS button group](https://designsystem.digital.gov/components/button-group/):
  group contextually related primary and alternative actions; keep the number
  of choices manageable and expose the relationship to assistive technology.
- [Fluent 2 button usage](https://fluent2.microsoft.design/components/web/react/core/button/usage):
  use one primary button in a layout to identify the most important action.

## Application to Runtime

The user reported that `Detect Again` at the top of the page broke the flow
after applying choices and reading provider results. Our design interpretation
is to keep editing and completion actions in one footer below the provider list.
Applied choices show secondary `Detect Again` beside primary `Go to Dashboard`;
pending edits show primary `Apply` with its optional detection checkbox.

During standalone detection, retain the two controls in place, show a spinner
in the detection button, and temporarily disable Dashboard navigation. Keep
progress and result feedback below the action row. This is a product-specific
layout choice informed by the sources, not a universal requirement of either
design system. The user completed local testing and accepted this layout on
2026-09-16. Automated interaction tests cover stable completion controls,
progress through save/detection, and unlocking after errors. See
[PLAN-039](../plans/PLAN-039-provider-selection-bootstrap-rollout.md) for the
validation and delivery record.
