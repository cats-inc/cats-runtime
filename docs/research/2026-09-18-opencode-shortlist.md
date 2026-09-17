# OpenCode 1.18.31 shortlist

## Scope and evidence

Refresh, OpenCode only, confirm-uncertainty. The operator supplied the complete desired
six-row Cats shortlist, not a complete upstream model catalog. No effort, context, or default
metadata was supplied; none is inferred. Other providers are unchanged.

- [Operator transcription](./fixtures/opencode-1.18.31/models.redacted.txt), version 1.18.31.
- [ID/name evidence](./fixtures/opencode-1.18.31/model-id-mappings.redacted.json): installed
  Windows CLI reports 1.18.31. A read-only `opencode models --verbose --pure` enumeration
  returned 36 models. The fixture retains only relevant public ID/name/provider fields.
  `OPENCODE_DISABLE_AUTOUPDATE=true` was set; no inference, login or paid probe was run.
- The only material question was Union Alpha Free's provider: the same label occurred as
  both `opencode/union-alpha` and `opencode-go/union-alpha`. The operator explicitly chose
  **OpenCode Go**, consistent with the other five entries.

| Display name (exact) | Execution ID |
| --- | --- |
| Union Alpha Free | `opencode-go/union-alpha` |
| DeepSeek V4.1 Flash | `opencode-go/deepseek-v4.1-flash` |
| Hy4 preview | `opencode-go/hy4-preview` |
| GLM-5.3-Flash | `opencode-go/glm-5.3-flash` |
| Qwen3.8 Flash | `opencode-go/qwen3.8-flash` |
| MiniMax-M3 | `opencode-go/minimax-m3` |

Completeness is limited to the approved shortlist. Account entitlements elsewhere and model
options remain unverified. The observation/decision artifacts passed the intake helper with
no gaps or unresolved gates. Projection preserves every supplied row and exact label; IDs
come from enumeration, with the ambiguous namespace resolved by the operator.

## Implementation

- Add OpenCode to the existing curated verbatim-ID and static catalog routing. Use the existing
  `selection_mode: shortlist` contract; refresh cannot append live/cached models or configured defaults.
- Replace the old three-row Runtime/Desktop fallback and two-row Playground fallback with these
  six entries. UI starts at the first row without a `(default)` claim. Custom strings stay available.
- Advanced selection uses the existing entry-only path; no adapter or advanced control changes.
- The historical dynamic-discovery test now explicitly supplies an empty curated document in an
  isolated test home, so it tests non-shortlist behavior without depending on personal settings.
- `providers.yaml.example` has no OpenCode model list/default to update.

## Validation and local settings

- YAML loads without warnings; exact six IDs/labels/order, absent defaults/controls, resolution,
  configured-default exclusion and refresh stability pass in the bundled-catalog regression.
- Focused catalog loader/normalization/advanced/service and Playground suites: 82 tests pass
  across six files, reusing unchanged passing suites after the focused correction.
- OpenCode-only HTTP and diagnostics tests: 2 pass. Historical dynamic cases explicitly use
  an empty curated document; their old IDs remain independent fixtures, not current recommendations.
- Playground regression exposed that the fixed-shortlist custom action was routed only for
  Cursor/Copilot. OpenCode now follows the same menu, serializer and legacy-selection path;
  first-item initialization, six plus custom, and saved custom strings pass.
- Runtime typecheck/UI generation and Desktop server TypeScript build pass. Desktop selection
  and execution-label suites: 26 pass. Final Runtime typecheck covers the changed route fixtures.
- Exact old-ID/example-consumer searches completed in both repositories. Independent historical
  dynamic/inline fixtures and package-path assertions are retained. No normalization warnings.
- Initial sandboxed test/build attempts failed with spawn EPERM before tests ran; authorized
  runs (or Node's no-isolation test mode) succeeded. No full-suite or installed Desktop visual claim.
- Live read of 127.0.0.1:3110 returned ECONNREFUSED, including outside the sandbox; no Runtime
  process was started or session created for this check.

The operator explicitly approved synchronizing the personal OpenCode block. It was added after
backing up the file; exact readback and parsed equality of every other provider were verified.
Backup suffix: .opencode-1.18.31-2026-09-17T20-08-02.479Z.bak.
The existing personal file overrides the whole bundled document; before this sync it had no
OpenCode entry and would therefore have retained dynamic discovery.

Version bumps and releases are outside this update.

## Maintenance feedback

The follow-up updated the canonical maintenance skill in `cats-runtime/skills/`:

- Add an OpenCode reference for verbose ID/name enumeration and duplicate provider namespaces.
- Move discovery-test isolation into shared rollout guidance and include HTTP/diagnostics fixture
  setup. The first HTTP retry still loaded the bundled shortlist because its temporary home had
  no explicit curated document; the empty-document fixture corrected that assumption.
- Check custom-input provider conditions before final validation. The first Playground run exposed
  the Cursor/Copilot-only path, which a six-row data comparison could not detect.
- Document whole-file personal override precedence and reuse a demonstrated sandbox spawn
  restriction instead of rediscovering it across multiple runners.
- Describe a refused optional live check without implying an unknown process exists. On the
  operator's subsequent cleanup request, port and process inspection found no listener on 3110
  and no identifiable Cats Runtime process, so no process was terminated.

This follow-up changes skill/documentation only. Product checks above remain applicable;
validation is frontmatter, reference links, diff and both agent discovery mirrors.
