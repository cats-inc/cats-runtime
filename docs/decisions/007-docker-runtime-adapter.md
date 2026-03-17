# ADR 007: Docker Runtime Adapter

## Status

Accepted

## Date

2026-03-17

## Context

ADR-003 explicitly foreshadowed Docker as a future environment kind, with the
blocker: "keep Docker out of the runtime until container persistence/login
behavior is validated."

On 2026-03-17, Docker CLI agent login validation confirmed that 9 out of 10
tested CLI agents authenticate successfully inside a `node:22-trixie` Docker
container (`docs/research/2026-03-17-docker-cli-agent-login-validation.md`).
The blocker is resolved.

The WSL adapter pattern already demonstrated how to run CLI agents in a
non-native execution environment using `wsl -d <distro> bash -lc <script>`.
Docker follows the same shape: `docker exec <container> bash -lc <script>`.

## Decision

Add `docker` as a third runtime mode alongside `native` and `wsl`.

- `DockerRuntimeAdapter` implements the `RuntimeAdapter` interface with simple
  slash normalization (containers run Linux) and `docker exec` shell invocation.
- `buildDockerSpawnConfig()` follows the WSL base64-payload pattern, using
  `CATS_RUNTIME_DOCKER_EXEC_B64` as the env var and prepending
  `/root/.local/bin` to PATH before `os.execvp`.
- `docker exec -i` (not `-it`) is used since spawned processes don't need TTY.
- `isDockerContainerRunning()` uses `docker inspect` to check container health,
  parallel to `isWslDistroRunning()`.
- File-backed discovery is **deferred** for Docker (per ADR-004 guidance).
  Discovery scans for Docker-backed providers check container status before
  attempting native session listing.

## Consequences

### Positive

- CLI agents can now run inside Docker containers with full login state
- Environment configuration uses the same `environments` block pattern as WSL
- Container health checks prevent discovery scans against stopped containers

### Negative

- Docker must be installed and the container must be running before spawning
- File-backed session discovery (FileWatcher) does not work for Docker
  containers because the session files live inside the container filesystem
- No automatic container lifecycle management (start/stop) from the runtime

### Neutral

- Config validation now enforces `container` for Docker environments, parallel
  to `distro` enforcement for WSL

## References

- ADR-003: Provider Instance Config (foreshadowed Docker)
- ADR-004: File-Backed Paths Are Host-Resolved (defers Docker discovery)
- `docs/research/2026-03-17-docker-cli-agent-login-validation.md`

---

*Decision made: 2026-03-17*
*Decision makers: Claude (Primary Coder)*
