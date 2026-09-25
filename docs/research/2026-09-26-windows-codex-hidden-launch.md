# Windows Codex hidden launch

## Problem and evidence

Observed with native Windows Codex CLI 0.157.0 on 2026-09-26. This is provenance,
not a version gate. Runtime already hid its immediate provider child and bypassed
npm's `.cmd` shim. Two later spawns could still create visible consoles:

- The [npm JavaScript launcher](https://github.com/openai/codex/blob/rust-v0.157.0/codex-cli/bin/codex.js)
  spawned the native executable without `windowsHide`.
- The [local Code Mode connection](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/code-mode/src/remote_session/connection.rs)
  spawned the host without `CREATE_NO_WINDOW`. See also
  [upstream issue #37599](https://github.com/openai/codex/issues/37599).

Cats uses `codex app-server` over stdio. The interactive CLI's `--no-daemon`
switch does not address either child spawn in that path. Disabling Code Mode host
is not an equivalent fix: Code Mode-only models can fail closed when the host is
unavailable, as covered by the
[upstream Code Mode tests](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core/tests/suite/code_mode.rs).

## Runtime behavior

For Windows native `auto` launches, Runtime recognizes the standard npm Codex
launcher and resolves its platform package directly. It preserves argv and the
managed npm package environment, clearing inherited flags from other package
managers. Missing binaries, unknown launcher layouts, custom wrappers and other
package managers retain the prior launch path. Direct native executables remain
supported. There is no installed-package edit or CLI version pin.

For task workers whose resolved executable has a sibling Code Mode host, Runtime
probes the app-server's external-host flag and the host's gRPC capability. It then
starts the host hidden on `grpc://127.0.0.1:0`, waits for its published loopback
address, and passes that address through `app-server --code-mode-host`.
The [upstream host transport](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/code-mode-host/src/grpc_transport.rs)
publishes the OS-assigned address after binding; no free-port discovery race is
needed. The external host retains Code Mode execution and tool delegation.

A hidden Node guard owns the host. Runtime closes the guard's input pipe to stop
it; the guard kills only its own host. The same EOF occurs if Runtime is forcibly
terminated, so cleanup does not rely on Windows delivering a JavaScript signal.
Startup cancellation, failed startup, app-server exit and host failure are
handled; a cancelled startup cannot alter a replacement worker's state.

The host capability check is cached by executable path, size and modification
time. An unsupported installation retains the prior launch path and may retain
the upstream window behavior. Failed probes can retry. A supported host that
fails to start reports an error instead of silently disabling tools.

Explicit `--code-mode-host` settings, WSL/Docker and shell/custom launchers retain
their existing behavior. Quota reads use the same native npm resolution but do
not start a managed Code Mode host: they send no model turn. macOS/Linux behavior
and public HTTP/config contracts are unchanged. No data migration or version bump
is required. Platform consumers obtain the change through their Runtime package;
the Platform launcher needs no separate patch. Existing installed releases need
a Runtime update before they receive this behavior.

## Validation

- Focused resolver/host/guard/worker tests cover hidden spawn options, capability
  fallback, argument preservation, isolated npm metadata, startup failure,
  cancellation/restart races and host death.
- Real subprocess tests verify EOF cleanup and host cleanup after forcibly killing
  a simulated Runtime parent.
- Existing Runtime command resolution, WorkerProcess/WorkerPool, Codex adapter and
  quota tests pass (152 tests across 12 files in total).
- Actual installed Codex 0.157.0 completed Code Mode `text("CATS_HOST_OK")` through
  a local mock Responses server, with two HTTP requests and no worker errors.
  The test used temporary `CODEX_HOME`, home/workspace and Runtime paths, no login
  credentials and no model-service request. The temporary Codex home emitted its
  expected helper-alias warning; tool execution still succeeded.
- In interactive Windows session 1, a read-only Win32 window observer sampled
  visible top-level windows 208 times during that smoke test and observed zero
  new visible windows (30 baseline windows). This is sampled evidence for this
  tested path, not a guarantee about every custom launcher or future CLI build.
- TypeScript runtime build passed. The native smoke left no managed loopback
  hosts; its two temporary Codex profiles were removed after verification.

The implementation is a Runtime-side workaround. The upstream Rust spawn still
needs its own fix for users invoking Codex outside Cats.
