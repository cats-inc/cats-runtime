# Cline CLI self-update — probe concurrency and the npm-global tree

Date: 2026-08-27
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

## Related

- `docs/research/2026-08-08-cline-cli-probe.md` — 3.0.51 install and execution contract
- `docs/research/2026-08-24-grok-cline-version-drift-probe.md` — 3.0.57 drift evidence
- ADR-035 — never block provider execution on exact CLI version
