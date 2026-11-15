# Kimi Code

Kimi Code CLI's catalog is the managed `kimi-code` provider that `kimi login` writes into
`<KIMI_CODE_HOME>/config.toml` (default `~/.kimi-code`). Aliases a user adds with
`kimi provider add` or by hand are out of scope; they stay reachable as custom model strings.
Current rows and evidence belong in `docs/research/2026-11-16-kimi-code-cli-provider.md` and its
fixtures in cats-runtime, not in this skill.

## Evidence

`kimi provider list --json` prints the configured providers and model aliases without starting a
session or calling the model. It is the machine-readable enumeration; the probe source reads it
with `KIMI_CODE_NO_AUTO_UPDATE=1` so the launch cannot apply a staged self-update:

```text
npm run catalog:probe -- --providers kimi
```

- The `providers` block holds `apiKey` and `oauth.key`. The parser,
  `parseKimiProviderList` in [`sources.mjs`](../../scripts/catalog-probe/sources.mjs), copies
  model fields only. Redact both keys in any saved evidence.
- Keep rows whose `provider` is `managed:kimi-code`, in the enumeration's order. The id and
  `execution.model` are the alias key (`kimi-code/k3`), which is what `--model` accepts. The
  label is `displayName` exactly as written (`K3.1 Pro Highspeed 2x Usage Cost` included);
  `maxContextSize` is the context limit.
- An account without a Kimi Code plan still lists the aliases while every prompt fails with
  `provider.auth_error`. The list therefore proves what the CLI offers to the signed-in
  account's region, not what its plan can run.
- Mainland China and global accounts sign in to different regions (`kimi login --region
  mainland-cn`); record the region with the observation, because the managed list can differ.

## Options and defaults

- Each alias lists `supportEfforts` and `defaultEffort`, but print mode has no per-invocation
  effort flag: Kimi resolves a turn's effort from config.toml `[thinking]` or the model's
  `defaultEffort`. `KIMI_MODEL_THINKING_EFFORT` applies only together with `KIMI_MODEL_NAME` and
  `KIMI_MODEL_API_KEY`, which replace the managed provider. Record efforts in notes; add a control
  only after an execution path that applies it per turn is verified.
- `default_model` in config.toml is the user's current choice (`/model` changes it), not an
  account default, so no row is marked default.

## Sign-in check

`npm run catalog:logins -- --providers kimi` never launches kimi, whose 160 MB single executable
takes seconds per start. A refresh token in `<KIMI_CODE_HOME>/credentials/*.json`, an `api_key` in
config.toml, a set `api_key_env` variable or `KIMI_MODEL_API_KEY` counts as signed in; a
credential file proves a sign-in, not a plan.
