# Junie catalog refresh

Junie is a full-catalog provider. Current choices and evidence belong in the
[Junie picker capture](../../../../docs/research/2026-09-26-junie-picker-full-catalog.md). The
earlier [shortlist note](../../../../docs/research/2026-09-23-junie-shortlist.md) is superseded.
The scope is the default JetBrains AI channel only. BYOK channels selected with `--provider` stay
out of scope unless the operator asks for them.

## Bounded evidence

- **Picker:** `/model` opens `Select model`, with a footer counter `i/N`.
  - Up and Down move rows. Right cycles the highlighted row's effort. Escape closes the picker.
  - Never send Enter: it selects the row.
  - The Effort cell shows the row's saved `effortPerModel` value, not a default. Return each row
    to its starting value, and compare the `~/.junie/settings.json` hash before and after.
  - Only a row labelled `Default (<name>)` is a default. It executes as `<name>`.
- **CLI:** run the versioned `junie.exe --skip-update-check` for `--version` and `--help`, not the
  auto-updating `junie.bat` shim. Help is informational: it lists only low, medium and high for
  `--effort`, while the picker offers more.
- **Static corroboration in the installed JAR** (a possible superset, not entitlement or default
  evidence):
  - `ModelOption$Specific` should contain every literal picker name.
  - `EffortLevel.$values()` gives the linear order `None, Minimal, Low, Medium, High, XHigh, Max`.
    `getWireId()` lowercases the name. `EffortLevel$Companion.availableForModel` builds each
    model's list in that order.
  - The Right-key ring cannot show where `None` sits, so use this order.
  - Do not copy `defaultForModel` into the catalog while the picker shows no effort default.

## Windows launch pitfalls

- **Defender block.** At startup, Junie reads its credentials through
  `powershell -NoProfile -NonInteractive -EncodedCommand …` (DPAPI). When an agent launched Junie,
  Defender blocked that child process as `Trojan:Win32/Commando.A!ml`. Junie's log then shows
  `Cannot run program "powershell": CreateProcess error=5` and the CLI exits before its UI.
  An operator-launched Junie was not blocked. The cause of that difference is not established.
- **After the first unexpected exit, check Defender first.** Look at protection history, or
  `Get-MpThreatDetection` for events after the launch time. Every retry adds another detection,
  so do not relaunch to experiment.
- **Never allow, exclude or restore a Defender detection yourself.** Stop and give the operator a
  uniquely titled launch command, for example:
  `wt -w new new-tab --title "<unique title>" --suppressApplicationTitle -d <repo> <versioned junie.exe> --skip-update-check`.
  Then attach to that window.
- **Clean the environment when you launch Junie yourself.** Clear inherited agent variables first
  (`TERM`, `CI`, `NO_COLOR`, pager and git-prompt variables, `JUNIE_*`, `EJ_RUNNER_PWD`).
  `TERM=dumb` makes Junie exit with `JLine returned dumb`.

## Schema-2 execution data

- Keep literal model names, spaces and case in both `id` and `execution.model`.
- Give each model its own `junie.reasoning_effort` enum `controls`, with only the values observed
  for that model, as token/label pairs such as `xhigh`/`XHigh`. Add `default` only when the
  picker marks one.
- With no default, Desktop, Playground and runtime resolution start at the first value, and the
  runtime sends it as `--effort`.
- `--effort` is a free string option; no choice validation was found in the JAR. Record which
  tokens have actually been executed.
- Custom model strings get no inferred effort.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
