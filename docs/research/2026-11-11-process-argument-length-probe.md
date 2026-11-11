# Process argument length probe — 2026-11-11

How long a single process argument can be when Node starts a child process on Windows. It
matters because several per-turn CLI adapters pass the whole composed prompt as one
argument. It is the evidence for [SPEC-042](../specs/SPEC-042-turn-scoped-context.md) R4.

## Method

One command, run in a shell on Windows 11 with Node v26.13.0. It starts Node itself with an
argument of `n` characters and prints either the length the child saw or the spawn error:

```js
const { spawnSync } = require('node:child_process');
for (const n of [20000, 32000, 33000, 48000]) {
  const r = spawnSync(process.execPath,
    ['-e', 'process.stdout.write(String(process.argv[1].length))', 'x'.repeat(n)],
    { encoding: 'utf8' });
  console.log(n, r.error ? ('ERROR ' + r.error.code) : ('ok ' + r.stdout));
}
```

## Result

- 20,000 characters: started; the child saw 20,000.
- 32,000 characters: started; the child saw 32,000.
- 33,000 characters: `ENAMETOOLONG`; no process started.
- 48,000 characters: `ENAMETOOLONG`; no process started.

The boundary is therefore between 32,000 and 33,000 characters for the argument, with a
short executable path and two other short arguments.

## Scope and limits

- **Platform**: native Windows only. macOS, Linux, WSL and docker launch paths were not
  measured.
- **Characters**: ASCII only. The limit applies to the whole command line, so other
  arguments, quoting and the executable path reduce what the prompt may use. Non-ASCII text
  was not measured.
- **Runtime**: this probe starts Node directly. It does not go through Runtime's launch
  code, a `.cmd` wrapper or a shell, which can impose lower limits.

## Where it applies

At Runtime `fb50e59a`, these adapters pass the composed prompt as an argument:

- grok (`-p <prompt>`), antigravity (`-p <prompt>`), cursor (positional), muse
  (`-- <prompt>`), goose (`--text <prompt>`) and cline (`-- <prompt>`).
- copilot and auggie switch to a temp file for long prompts and tell the model to read it.

The composed prompt holds skills, session instructions, turn instructions and the message.
A Cats Bot session's instructions already carry a handoff pack of up to 12,000 characters on
every turn.
