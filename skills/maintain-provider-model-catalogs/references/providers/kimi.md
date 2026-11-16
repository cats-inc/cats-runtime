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

- The `providers` block holds `apiKey` and `oauth.key`. Per the 2.5.3 code, the managed sign-in
  writes an empty `apiKey` and a storage reference name in `oauth.key`, but a provider a user added
  with an API key prints that key. The owner kept this output as the source on 2026-11-16, since
  no other machine-readable list exists and config.toml would expose the same keys. The parser,
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
takes seconds per start, and Kimi 2.5.3 has no status command. A non-empty
`<KIMI_CODE_HOME>/credentials/*.json` or a set `KIMI_MODEL_API_KEY` counts as signed in. Only
presence is checked: the credential files, and config.toml, which can hold the API keys of
providers a user added, are never opened (ADR-038; owner decision 2026-11-16). A credential file
proves a sign-in, not a plan.

## Region detection

Kimi Code 2.5.3 records the sign-in region in `<KIMI_CODE_HOME>/region`, a one-line non-secret
marker holding the `kimi login --region` token (`global` or `mainland-cn`). On the owner's
machine on 2026-11-16 it held `global`, matching the `kimi login` used for the current capture
(ADR-056). It is SPEC-045 FR-6's first detection source:

- Runtime reads only that file, for a local native Kimi instance, and marks the basis whose
  `basis.region.id` equals the token as `detected`. A WSL, Docker or remote instance reads
  nothing. The credentials and config.toml stay unopened.
- `npm run catalog:logins -- --providers kimi` appends `detected basis: region <token>` to a
  signed-in result. It reads the marker only after the presence check passes.
- The catalog probe reads the same file with the same reader (`catalog-probe/basis.mjs`),
  records the token on the snapshot's Kimi source and compares the basis it matches. The
  evidence command copies it into the fixture as `signIn`.
- A refresh records this token with the capture; a new region basis needs it as evidence
  (SPEC-045 FR-8).

## Recorded region

Since 2026-11-16 (SPEC-045 FR-9) the Kimi scope records
`basis: { region: { id: global, label: global (kimi.ai) } }`, the region of the current capture.
The label is the `kimi login --region` help's own spelling. As the only and first basis it has no
`id`, so saved selections keep resolving to it, Playground and Desktop show the region in the
information icon, and no basis select appears.

- A refresh signed in to `global` updates this scope. A `mainland-cn` sign-in makes the probe
  report `basis-not-captured`; it is never compared against the `global` list.
- A `mainland-cn (kimi.com)` basis is a separate owner-authorized capture (SPEC-045 owner
  decision 6). It needs `basis.id: mainland-cn`, its own `cli_version` and `last_updated`, and
  the region marker as evidence.
