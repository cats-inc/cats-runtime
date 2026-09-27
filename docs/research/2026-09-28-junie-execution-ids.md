# Junie executes setting IDs, not picker names

Date: 2026-09-28. Mode: refresh, limited to execution bindings. Scope: the `junie` / `cli`
catalog scope. Interaction policy: apply authorized. The operator reported that Junie turns failed
in the Desktop 0.5.9 preview and asked for the failures to be fixed.

## Symptom

- Every Junie turn failed right after launch, whichever model was selected:
  `Junie exited with code 1 before producing a usable result. stderr: - gpt-6-sol | - gpt-codex | … | - sonnet`.
- The runtime kept only the last 12 stderr lines, so the log lost the line that named the cause.
  It now keeps the first lines as well; see `src/backends/cli/stderrLines.ts`.

## Evidence

- **The rejected argument.** A probe with a model that cannot exist shows the whole message without
  running an agent: `junie.exe --output-format json --skip-update-check --model "Zzz Qqq Probe" …`
  printed `Junie failed with the message: Invalid model: Zzz Qqq Probe`, then `Available models:`
  and 41 entries. Every entry is an alias or a lowercase setting ID, such as `gemini-3.7-flash`,
  `grok-4.6` and `claude-opus-5-5`. No picker name is accepted. The spaced name arrived as one
  argument, so the launch path was not splitting it.
- **How `--model` resolves** (`ModelsState.resolveModelOption` in `junie-release-3419.7.jar`, read with
  `javap -c`): an alias, then a `ModelOption$Specific` whose setting ID matches ignoring case, then one
  whose LLM name matches, then a `MetaModels` option by setting ID. No step compares display names.
- **The mapping.** [model-setting-ids.json](./fixtures/junie-26.9.22/model-setting-ids.json) lists all
  34 `ModelOption$Specific` rows with their setting IDs and exact display names, and the 7 aliases.
  It is the output of the kept helper below, run against the installed 26.9.22 (build 3419.7). All
  15 catalog rows map to a setting ID, and each of those IDs is in the CLI's `Available models` list.

## Catalog delta

- The 15 `execution.model` values change from picker names to setting IDs, for example
  `Gemini 3.7 Flash` → `gemini-3.7-flash` and `GPT-5.6-SOL` → `gpt-5.6-sol`.
- Entry IDs, labels, order, the default row and effort controls do not change, so saved selections
  keep resolving. A runtime session created earlier keeps its resolved binding; those sessions never
  ran successfully, and a new conversation uses the corrected ID.
- The scope note that said to pass picker names to `--model` is replaced. `last_updated` is kept,
  because the list itself did not change.

## Corrections to earlier notes

- [2026-09-26 full catalog](./2026-09-26-junie-picker-full-catalog.md): the picker names do occur in
  `ModelOption$Specific`, but as display names, which `--model` does not accept. Its statement that
  low and medium had run through Cats cannot hold for 26.9.22, which rejects those names. Whether
  26.9.21 accepted them is unknown.
- [2026-09-23 shortlist](./2026-09-23-junie-shortlist.md): its "Literal model argument" column was
  never a valid `--model` value.

## Validation

- `tests/catalog-runtime.test.ts` now resolves every Junie row through the catalog and requires a
  setting ID. With the previous data it fails and lists the 15 picker names.
- `npm run catalog:check`, `tests/catalog-data.test.ts`, `src/core/models/providerModelCatalog.test.ts`
  and `src/backends/cli/providers/junie.test.ts` pass.
- Not verified: a Junie turn with a setting ID. That runs an agent, which this change did not do.

## Scripts

- **Kept:** [`junie-model-ids.mjs`](../../skills/maintain-provider-model-catalogs/scripts/junie-model-ids.mjs)
  prints the setting ID, display name and enum name of every `ModelOption$Specific` row, plus the
  aliases. It runs an embedded Java source file on the JVM bundled with Junie and starts no Junie CLI.
  A later version can rerun it unchanged while those class and method names stay the same. Its parser
  has an offline suite in `tests/junie-model-ids.node-test.mjs`.
- **Not kept:** a first Java probe that printed every string getter (the helper replaces it) and a
  JAR string search used to find the resolution class (one-off; `javap` from any JDK reads the class).
