# Junie's JVM writes piped stdio in the Windows ANSI code page

Date: 2026-09-28. Scope: the `junie` / `cli` adapter on native Windows. The operator reported
that a Desktop Cats Chat reply from Junie quoted their message `junie午安` as `junie�Ȧw`.

## Symptom

- Chat channel `junie午安`, runtime session `26609b89-5704-477a-b8ce-6f391e861dab`, model
  `gemini-3.7-flash`. The stored result read `Acknowledged the user message ("junie�Ȧw")`.
- The machine's ANSI and console code page is 950 (Big5). `午安` in CP950 is `A4 C8 A6 77`;
  those bytes decoded as UTF-8 are exactly `�Ȧw`.

## Evidence

- **Junie received the message intact.** Its own session file
  (`~/.junie/sessions/session-260928-135734-kx4o/events.jsonl`) holds the same result with
  `junie午安` as UTF-8 (`e5 8d 88 e5 ae 89`). The damage happened after Junie produced it.
- **The stdout JSON is the damaged copy.** The adapter reads both `events.jsonl` and the
  `--output-format json` blob on stdout; only stdout was decoded wrongly. Junie 26.9.22
  (build 3419.7) is a jpackage image on JBR 21.0.11, and its `app/junie.cfg` sets no encoding.
  On JDK 19+, redirected `System.out` / `System.err` use `stdout.encoding` / `stderr.encoding`,
  which default to the native encoding (`MS950` here), not UTF-8.
- **Reproduced without a model turn.** A one-line program on Junie's bundled `java.exe`, piped to
  Node, printed `junie�Ȧw ?�^ ?` for `junie午安 简体 🐱`: CP950 mojibake, plus `?` for characters
  CP950 lacks. `junie.exe --model 午安模型 …` printed `Invalid model: �Ȧw�ҫ�` on stderr. With
  `JAVA_TOOL_OPTIONS=-Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8`, both came out intact, and
  the JVM added a `Picked up JAVA_TOOL_OPTIONS: …` line to stderr.
- Decoding with the code page on the Cats side was rejected: characters outside CP950 are
  already `?` in the bytes Junie writes.

## Change

- `src/backends/cli/providers/junie.ts` appends the two properties to any inherited
  `JAVA_TOOL_OPTIONS` for native launches, and drops the JVM's `Picked up` line from the stderr
  kept for failure messages. WSL and Docker launches take their environment from the exec payload,
  not the host process, and their Linux locale normally makes the JVM write UTF-8 already.
- A real turn through the patched `JunieProvider.streamTurn` returned `午安` intact.

## Separate defect: the task argument loses non-CP950 characters

- The same turn asked for `午安 简体 🐱` and got back `午安 ?体 ??`. Junie's session state shows it
  received `午安 ?体 ??`: the jpackage launcher hands the command line to the JVM through the ANSI
  code page, so `简` and 🐱 were replaced before Junie started. No JVM property can recover them.
  Traditional Chinese that Big5 covers, such as the reported `午安`, is unaffected.
- Junie also reads the task from stdin. `junie.exe --output-format json --input-format text …`
  with no positional task and the UTF-8 prompt written to stdin received `午安 简体 🐱` intact and
  returned it intact. That run used a one-line prompt; whether stdin keeps a multi-line prompt,
  which every Cats turn is, has not been tested.
- Not changed here. The Junie ACP profile on the agent backend reads the same JVM's stdout and does
  not get this change.
