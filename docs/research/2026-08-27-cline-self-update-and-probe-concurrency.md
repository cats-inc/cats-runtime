# Cline CLI self-update — probe concurrency and the npm-global tree

Date: 2026-08-27
Last updated: 2026-09-15
Scope: A setup scan uninstalled an installed provider CLI. Root cause, blast radius, and
what the runtime fix does and does not cover.
Host: Windows 11 26100, packaged Cats desktop (`cats-runtime@0.1.5`), `npm@12.0.2`,
`node@v24.19.0`, npm global prefix `~/.npm-global`.

All findings below come from npm's own debug logs, the installed package on this host, and
the runtime source. Where something is reasoned rather than observed it says so.

## What happened

The Cats desktop first-run screen (CLI detect/install) was left untouched. Two Windows
Terminal windows appeared, both titled `npm update cline`, and were still running six
minutes later. Afterwards `cline` was gone: no `cline` entry in `npm ls -g`, no
`node_modules/cline`, and none of the three shims (`cline`, `cline.cmd`, `cline.ps1`).

**A detection scan uninstalled a CLI it was only supposed to detect.**

## Evidence — who ran npm

`%LOCALAPPDATA%\npm-cache\_logs\2026-08-27T09_08_02_761Z-debug-0.log` and
`...09_08_02_788Z-debug-0.log`, 27ms apart:

```
verbose title  npm update cline
verbose argv   "update" "--global" "cline" "--tag" "latest" "--min-release-age" "0"
verbose cwd    C:\Users\sammy\.cats\runtime\data
```

- The cwd is `ProviderCompatibilityService`'s `probeCwd` (`config.dataDir`), so both npm
  processes are descendants of the setup scan's compatibility probe.
- Neither `npm update` nor `--min-release-age` appears anywhere in this repo, in
  `cats-platform`, or in the packaged `resources/{cats-runtime,desktop,app-sidecar}`. The
  runtime did not compose this command.
- Therefore the command came from the `cline` binary itself. The npm package's
  `bin/cline` is only a Node resolver with no update logic, so the updater lives in the
  compiled platform binary (`@cline/cli-windows-x64`), which was not disassembled.

`--min-release-age 0` is an npm 12 flag that overrides the new supply-chain publish delay.
Its presence is consistent with a self-updater that wants the newest version immediately.

## Why two

`buildAssessment` issued the `--version` and `--help` probes through `Promise.all`. Cline
has no `versionArgs`/`helpArgs` override in `compatibility/knowledge.ts`, so it inherited
the generic npm defaults `['--version']` and `['--help']` — two launches of the same
binary, 27ms apart, each spawning its own updater.

## The damage

Both npm runs reified the same global root concurrently:

- `placeDep ROOT cline@3.0.60 REPLACE` — an older cline was installed, so the updater had
  real work to do.
- Both runs retired the same paths: `node_modules/cline`, `cline`, `cline.cmd`,
  `cline.ps1` → `.cline-<random>`.
- `...761Z` failed: `error code EEXIST`, `path C:\Users\sammy\.npm-global\cline`, `exit 1`,
  with `unfinished npm timer reify:build`.
- `...788Z` succeeded: `exit 0`, `info ok`.

Net result was an uninstalled package, so the failing run's rollback removed what the
successful run had written.

`...788Z` also shows npm 12 blocking cline's `postinstall` (`warn install-scripts`). On
Windows that script is a no-op anyway — `main()` returns early on `win32` — so nothing was
lost here, but see the hub note below.

## The updater outlives the probe

- `DEFAULT_PROBE_TIMEOUT_MS` is 10s.
- The npm runs started at 09:08:02 and were still visibly working at 09:14.

So the npm work outlives the probe by minutes whether the probe returned normally or was
killed at the timeout. **Serializing probes therefore does not serialize the updates**: the
second probe can start, finish, and spawn its own updater while the first update is still
writing. Only reducing the number of launches helps.

The updater also allocates its own console window, which is why it is visible despite the
runtime spawning every probe with `windowsHide: true` — `windowsHide` applies to the
process Node creates, not to a detached grandchild that asks for a new console.

## Trigger condition

After the CLI was reinstalled manually at 14:32 and used, no further `npm update cline`
appears in the npm logs. Cline does not update on every launch; it updates when a newer
version exists. The incident needed an already-stale install.

## What the runtime fix covers

This section records the August mitigation. The September recurrence and
replacement are documented below.

`ProviderCompatibilityService`:

- The version and help probes now run one after the other.
- For a provider with `check.npmPackage`, the version comes from
  `npm list -g <pkg> --depth=0 --json` and the version probe is skipped entirely. This is
  the part that actually fixed cline: **two launches per scan became one.**
- `commandAvailable` stays tied to a probe that executed, so an npm-recorded version on a
  broken shim does not report `ready`.

**Still uncovered.** `DEFAULT_MAX_CONCURRENT_ASSESSMENTS` is 4, so up to four *different*
provider CLIs are launched at once during a scan. Two stale npm-global CLIs updating in the
same scan would still write to the same global tree concurrently. This was not reproduced
across packages, but nothing in the observed failure mode (bin-shim `EEXIST` plus a
competing rollback) depends on the two runs being the same package. A mutex around the
probes would not help, for the reason in the previous section — the only real fix is not
launching npm-global CLIs during a scan at all, which is what the
`maybeInferCompatibilityFromInstallMetadata` stub is reserved for and which trades away
live drift detection (ADR-035).

## Symptoms to look for

If a cline session dies mid-turn, or a provider that was detected earlier goes missing:

- `%LOCALAPPDATA%\npm-cache\_logs` — look for `verbose title npm update cline`. The `cwd`
  line names the parent: `~/.cats/runtime/data` means the scan triggered it. Note npm keeps
  only the last 10 logs, so check early.
- `npm ls -g cline` and `ls ~/.npm-global | grep cline` — a missing package or missing
  shims after a scan is this bug.
- Cline restarts its own hub daemon after a background update. Its `postinstall.mjs`
  records that versions ≤ 3.0.54 did this while serving live sessions, killing them
  mid-turn, and sets the hub discovery record aside to protect attached clients. That
  guard never runs on Windows (`main()` returns early on `win32`) and npm 12 blocks
  `postinstall` regardless, so on this platform a background update during an active
  session has no protection.

## Not probed

- Whether any other npm-global provider CLI (`codex`, `copilot`, `opencode`, `kilo`,
  `auggie`, `pi`) self-updates on launch. No evidence either way was collected.
- Whether the cross-package race actually reproduces.
- Whether `CI=1` or a similar environment variable suppresses cline's updater. Cline's
  README documents no opt-out.
- The updater's own logic, which lives in the compiled `@cline/cli-windows-x64` binary.

## 2026-09-15 recurrence at Windows login

The packaged Cats process started with `--launch-at-login` at 18:16:44 Taiwan time.
Its runtime sidecar reported version `0.1.21` and readiness at 18:17:10. Four npm
debug logs then recorded `npm update --global cline --tag latest --min-release-age 0`:

| npm log UTC timestamp | Exit | Evidence |
| --- | --- | --- |
| `2026-09-15T10_18_31_901Z` | 1 | `EEXIST` at the global `cline` shim |
| `2026-09-15T10_18_52_574Z` | 0 | Update completed |
| `2026-09-15T10_19_35_148Z` | 0 | Update completed |
| `2026-09-15T10_19_56_393Z` | 0 | Update completed |

All four recorded `~/.cats/runtime/data` as cwd and used Node `24.21.0` / npm
`12.0.2`. Afterwards, the three global Cline shims and
`~/.npm-global/node_modules/cline/package.json` were missing, with an empty package
directory left behind. This is consistent with the competing reify/rollback
failure seen in August; no Cline command was executed during the investigation.

Two holes remained in the August mitigation:

1. Health-purpose compatibility assessments skipped npm metadata altogether and
   still ran both version and help commands. Diagnostics availability refreshes
   use that purpose even after Desktop opens without a setup scan.
2. Native install checks called `spawn('npm', ..., { shell: false })`. Windows
   npm is a command shim, so that lookup can fail before supplying a version,
   causing standard scans to fall back to executing Cline again.

The four npm logs prove the updates originated in the probe cwd; they do not
identify the exact pair of HTTP callers. The reported PowerShell processes had
already exited before process-tree inspection, so their individual origins are
not established. Do not label every reported console as separately proven.

### Replacement behavior

- All 16 CLI families use passive light detection. Setup, execution preparation,
  diagnostics light mode, and health resolve configured commands and inspect
  installation metadata without executing the provider. Missing, invalid, or
  timed-out metadata never falls back to `--version` or `--help`.
- Health, setup, and execution preparation stay passive even when passed live
  mode. Executable compatibility checks require diagnostics purpose plus live
  mode. Actual user turns still execute the provider.
- Metadata-derived versions use fingerprint source `package`. Finding a command
  selects a fallback adapter with unverified compatibility, without fabricated
  help tokens or live validation. Missing commands remain unavailable even if
  npm still records a version.
- Background requests normalize to light mode before cache lookup/write, so a
  setup request carrying live mode cannot satisfy later real live diagnostics.
  Ordinary installed/unverified results do not create empty evidence artifacts;
  installation failures and live failures retain their evidence.
- Native install checks use the runtime's command resolver. Both npm-created
  shims and Node's bundled `npm.cmd` run their Node entrypoint directly. The
  bundled launcher first runs `npm-prefix.js` through hidden Node and honors an
  installed npm override at that prefix. Unknown Windows wrappers produce an
  inspection error instead of opening a shell. The whole inspection shares one
  timeout budget.
- Passive command lookup shares the launcher's npm-directory and install-path
  fallbacks, so a GUI process with stale PATH can still find a stock install
  without executing it or substituting for a missing custom wrapper.
- ACP light/default probes resolve their command without running help or opening
  a session. Health/availability diagnostics also prevent dynamic model/tool
  discovery from bypassing the passive policy.
- Goose's CLI-backed session list/export is no longer scheduled at startup or on
  the background discovery timer. Explicit manual discovery remains available;
  existing retained sessions are preserved. Other passive session readers and
  OpenCode/Kilo reads from already-running servers retain their behavior.
- Desktop accepts installed but unverified (`degraded`) providers as usable and
  retains their warning/remediation details. Its first-run Windows Ollama audit
  reads executable version metadata rather than launching `ollama --version`.

### Process-scoped updater controls

Cats also uses confirmed updater controls for provider execution. Environment
controls apply to native children, WSL/Docker exec payloads, and ACP families.
The Junie flag is injected only when the executable itself is Junie; arbitrary
Node/npx/ACP bridges keep their arguments. Controls do not persist global
environment or provider-config changes. Model discovery preserves inherited
environment variables when merging these controls, and ACP passive command
lookup uses the same child PATH/cwd as real launches.

| Provider | Control | Evidence |
| --- | --- | --- |
| Claude | `DISABLE_AUTOUPDATER=1` | [Official setup guide](https://code.claude.com/docs/en/setup) |
| OpenCode | `OPENCODE_DISABLE_AUTOUPDATE=true` | [Official CLI environment variables](https://opencode.ai/docs/cli/#environment-variables) |
| Muse | `MUSE_NO_AUTO_UPDATE=1` | Installed launcher and [September 5 probe](./2026-09-05-meta-muse-cli-probe.md) |
| Junie | `--skip-update-check` once | [Official CLI parameters](https://junie.jetbrains.com/docs/parameters.html) |

No suppression flags are guessed for other providers. Cline's observed updater
remains possible during actual turns or explicit live diagnostics; passive
detection prevents background launch without needing an upstream opt-out.

Regression coverage includes every CLI in native/WSL/Docker, all four purposes,
repeated scans, absent/malformed/timed-out metadata, missing commands, explicit
live diagnostics, background requests carrying live mode, and both Windows npm
launcher forms with the shell unavailable. It also covers prefix overrides,
stale PATH, ACP passive probes and updater controls, child-only environment
changes, Goose background discovery, Desktop usability, and passive Ollama
version detection. Tests use isolated fixtures, not real provider turns.

Validation on Windows, 2026-09-15: the final 16-file Runtime regression set passed
290 tests, with one POSIX-only test skipped. Three additional runtime-server
tests passed for health summaries and startup/periodic discovery. Desktop
readiness, setup readiness, and isolated Ollama helper tests passed 43 tests.
Runtime and Desktop TypeScript builds, Runtime bundling, and diff whitespace
checks passed. Cross-review findings covering npm launchers, stale/custom PATH,
cache modes, Junie wrappers, child environment inheritance, and evidence retention
were fixed and verified; no code findings remain.

The installed Desktop and damaged global Cline installation remain unchanged.
The source fix must be packaged and installed before it affects login on this
machine; this record does not claim a reboot test of a newly installed package.

## Related

- `docs/research/2026-08-08-cline-cli-probe.md` — 3.0.51 install and execution contract
- `docs/research/2026-08-24-grok-cline-version-drift-probe.md` — 3.0.57 drift evidence
- ADR-035 — never block provider execution on exact CLI version
