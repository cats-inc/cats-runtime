# Codex bootstrap permission readback

## Observed failure

On 2026-09-27 the owner authorized one brief ordinary-agent contribution test
using an isolated synthetic Platform profile and a temporary provider auth copy.
Platform `5201175d` plus the candidate-preparation changes and Runtime `679f32a4`
ran one gpt-6-astra turn through native Windows Codex 0.157.1. It took 22.4 seconds
and reported 21,570 tokens. The 24,000-token check was post-response, not a hard
spending cap. Native command execution was blocked, no draft was submitted, and
the model truthfully reported the failure. Adoption, consumer assembly and
revocation were not reached. The owned Runtime exited and the temporary auth
copy was removed; both were independently confirmed. No retry was performed.

Runtime persisted `shared` / `skip` with a read-write source workspace. The
provider's actual turn context instead recorded read-only and restricted
networking. Both source and compiled adapter requested `workspace-write` /
`never`; the mismatch was not a stale adapter mapping.

An auth-free direct native app-server probe then reproduced the mismatch in
2.6 seconds using a fresh owned home/workspace. It called only initialization,
`configRequirements/read` and two `thread/start` operations: no credentials,
`turn/start`, commands, tools or inference. Admin requirements were null. Both
requested `read-only` and requested `workspace-write` returned sandbox type
`readOnly`, `networkAccess: false`, and approval policy `never`. The owned process
exited. That first probe proved the effective mode differs before inference;
the next controlled comparison identified the missing Windows mode below.

Private raw traces and token-bearing capabilities are not committed. The
sanitized readback and cleanup receipts remain in the workspace's private
PLAN-109 completion checkpoint.

## Contract and correction

The locally generated 0.157.1 app-server schema requires `sandbox` and
`approvalPolicy` in thread bootstrap responses. The
[official app-server documentation](https://learn.chatgpt.com/docs/app-server)
describes legacy `sandbox` selection and optional per-turn `sandboxPolicy`
overrides. Omitting a turn override does not establish a bug. Experimental named
permission profiles are a separate interface; no policy override or permission
expansion is introduced here.

Runtime now correlates the start/resume/fork response ID and compares its sandbox
mode and approval policy to the request before releasing the pending model turn.
Absent, malformed or mismatched fields produce a bounded error and clear the
pending message. A `thread/started` notification or late response cannot revive
a failed bootstrap. The adapter does not retry the model or silently select a
different permission policy. Unknown CLI versions still attempt the best-known
protocol, consistent with [ADR-035](../decisions/035-never-block-provider-execution-on-exact-cli-version.md).

The check covers these two bootstrap fields, not complete writable-root,
network, OS enforcement or tool-execution proof. Successful ordinary contribution
acceptance remains open. No public route,
persisted format, version, package pin or installed profile changes.

## Windows cause identified without inference

A six-second follow-up compared fresh, unauthenticated native profiles with
`windows.sandbox` unset, `elevated`, and `unelevated`. The only RPC methods were
initialization, config/requirements reads and thread start. No sandbox setup,
commands, tools, auth copy or model inference ran, and all three processes exited.
Admin requirements and active permission profiles were absent in all cases.

With the Windows mode unset, requesting `workspace-write` returned `readOnly`.
Either explicitly selected Windows mode returned `workspaceWrite`; the read-only
control remained `readOnly` in all three cases. The original isolated test had
copied authentication without a Windows sandbox selection. The installed user's
profile already selected a mode, so this test failure does not establish that the
installed Desktop has the same problem. No user setting was changed or copied.

The [official Windows sandbox guide](https://learn.chatgpt.com/docs/windows/windows-sandbox)
describes mode selection and the separate setup requirements. Bootstrap mode
readback alone does not prove setup, command execution or network access works.
The adapter now gives setup guidance for a write-to-read downgrade without
silently selecting a mode or weakening the caller's policy. Future isolated
acceptance must prepare the declared mode before spending a model turn; the
previous failed acceptance is retained unchanged.

The follow-up readiness API reported `ready` for an isolated profile explicitly
using `unelevated`. A bounded native `command/exec` then wrote an owned fixture
file and fetched an owned loopback marker under the returned `workspaceWrite`
policy with `networkAccess: false`. Exit code was zero, the file was independently
read back, and the child exited. No auth, model call, machine setup or external
endpoint was used. An initial request failed on an unsupported Windows output-cap
parameter before execution; removing that parameter left the sandbox unchanged.
This proves that specific local transport/preparation, not successful model
contribution or elevated-sandbox readiness.
The follow-up build and **43 focused guard/telemetry tests** passed. Independent
review found no blocker. A prepared second model trial was rejected by automatic
approval review because the first one-call authorization was exhausted; no second
inference occurred. A new explicit bounded authorization is pending while
unaffected implementation continues.

## Validation

- Runtime TypeScript build passed.
- Five focused files passed **139 tests**. They cover matching read-only and
  write modes, start/resume/fork correlation, early/late notifications, missing
  or malformed replies, narrowed/widened permissions and no revival after failure.
- A real local Node child transport returned a downgraded sandbox; WorkerProcess
  reported the error without sending `turn/start`. The positive shared read-tool
  transport, existing permission/usage tests and quota capture replay also passed.
- These regression responses are synthetic. They are not another native model
  acceptance, a successful draft submission or a fresh provider quota charge.
- Full CI of `7feb259f` found one additional diagnostic regression: the ignored
  initialization reply was no longer counted by provider evolution telemetry.
  The adapter now preserves that correlated diagnostic event while keeping
  unrelated responses unable to release the pending turn.
  The follow-up TypeScript build and **41 focused guard/telemetry tests** passed;
  independent review found no blocker.
