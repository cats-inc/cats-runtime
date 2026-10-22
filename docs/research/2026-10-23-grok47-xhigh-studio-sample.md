# Grok 4.7 / Extra High Studio sample

Last updated: 2026-10-23 (UTC+8). Owner-authorized single image and Studio execution
profile change; no version bump, publication or installed-profile update.

## Authorization and route

After the two text-only capability inquiries, the owner chose Grok 4.7 / Extra High
(non-Fast) for Studio and requested an image to replace its Fast/Low sample. The
operator used CDP to send a new prompt in the existing Cats Desktop 4.7 research
conversation. The composer showed Grok 4.7 / xhigh, and its room-generated working
directory was present on disk. No separate provider process or child agent was
launched by the operator, and no privacy/account setting was changed.

The prompt authorized exactly one image_gen, one square image, no retry, edit or
video. It reused the earlier sample description verbatim:

```json
{"prompt":"A simple flat illustration of one orange cat sitting, solid light blue background, minimal shapes, no text, no letters, no watermark","aspect_ratio":"1:1"}
```

## Observed execution and artifact

The operator inspected only media events in the exact CLI session's updates.jsonl
identified by the returned artifact. It contains one image_gen tool_call with the
above prompt and ratio, and one matching completed ImageGen tool_call_update.
No other image/video generation tool call appeared in that session's inspected
media events. The conversation completed and the agent reported success.

The actual file was independently read and decoded with jpeg-js under the normal
4-megapixel bound. Visual inspection confirmed one seated orange cat, blue
background and no visible text. No regeneration was requested.

| Field | Observed result |
| --- | --- |
| Format | JPEG, complete signature and successful decode |
| Dimensions | 1024 x 1024 |
| Bytes | 85,413 |
| SHA-256 | 6a4fe15907ac11becbc892029dd78cbf40c00590c82826ae638df5b93965867e |
| Tool output | ImageGen, filename 1.jpg, session_folder images, original local path |
| Agent selection | grok-4.7 / xhigh, not grok-4.7-build-fast |
| Media-model ID | Not returned; unknown |
| Cost / account allowance delta | Not independently measured |

The original JPEG includes C2PA/Grok Imagine metadata strings. Apps received a
byte-identical copy without re-encoding. The new square size is an observed
artifact fact, not an exact-pixel request guarantee or evidence that Extra High
improves media quality. Private transcript/screenshots and user-specific paths
remain outside Git.

## Runtime change and validation boundary

The owner-selected grokSingleImage catalog profile now pins agentModel grok-4.7
and reasoningEffort xhigh. Existing imageInvocation reads both fields and keeps
one model round, image_gen-only tool policy, original timeout, JPEG validation
and no retry. The existing invocation regression now checks the requested model
and effort along with those bounds.

This live image ran through an ordinary Desktop Chat session, not Studio's
single-round HTTP/SDK job collector. It does not establish a fresh paid
App-to-Runtime-to-CLI generation, cancellation, recovery, editing or video
acceptance. Those distinctions remain separate from fixture validation and the
[earlier adapter spike](2026-09-28-grok-single-image-spike.md).

Apps owns the replacement sample and its
[asset provenance](../../../cats-apps/apps/studio/assets/README.md). A local
candidate App package must use a separate output directory, preserving published
version bytes. Publishing or changing the installed Desktop/App remains outside
this task's delivery scope.

The follow-on [five-provider research summary](../../../cats-apps/docs/research/2026-10-23-studio-cli-media-probe-summary.md)
and [probe SOP](../../../cats-apps/docs/research/2026-10-23-cli-media-probe-playbook.md)
belong to Apps. Both exact Grok sessions' persisted media definitions were later
independently compared and matched; they expose no media output-directory field.
Native cwd/session grouping and Runtime artifact collection are separate contracts.
The remaining providers' declared tools do not extend this Runtime execution API.

## Local checks

- Focused image-generation suite: 9 tests passed, including the explicit non-Fast
  model/xhigh argument assertions and existing collection/cancellation bounds.
- TypeScript runtime build and catalog generation/boundary checks passed.
- Apps' package test passed and a separate temporary candidate archive embedded
  the exact JPEG. Platform's isolated host/SDK browser fixture passed with zero
  CLI calls. These are fixture checks, not another live generation.

The default Vitest config bundler could not read a parent directory inside the
Windows sandbox; the documented --configLoader runner option completed the same
focused suite. No source change or broader test run was needed for that issue.
