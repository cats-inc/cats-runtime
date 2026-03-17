# Docker CLI Agent Login Validation

> Validated: 2026-03-17 | Updated: 2026-03-18

## Purpose

Validate that all CLI agents supported by cats-runtime can successfully
authenticate when running inside a Docker container, confirming feasibility
of a future `DockerRuntimeAdapter` (see ADR-003).

## Test Environment

- Image: `node:22-trixie` (Debian 13)
- Container: `cats-cli-test`
- Volume: `cats-cli-test-home` mounted at `/root` (persistence)
- Host: Windows 11 Pro + Docker Desktop

## Setup

```bash
# Create and start container
docker volume create cats-cli-test-home
docker run -d --name cats-cli-test \
  -v cats-cli-test-home:/root \
  node:22-trixie sleep infinity

# Enter interactive shell
docker exec -it cats-cli-test bash -l
export PATH="/root/.local/bin:$PATH"
```

## Installation

- claude, cursor-agent, kiro-cli, goose: dedicated installer scripts
- codex, gemini, copilot, auggie, opencode, junie, pi: `npm i -g`

Source: `environment-bootstrap/platform/linux/install-node-packages.sh`
and individual `install-*.sh` scripts.

Goose install: `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash`

## Login Results

10 of 11 agents authenticated successfully from inside the container.
No arguments are needed for most of the login commands.

| Agent | Login Command | Auth Flow | Result |
|-------|--------------|-----------|--------|
| claude | `claude auth login` | OAuth (copy code) | Pass |
| codex | `codex auth` | Device code | Pass |
| gemini | `gemini auth login` | Device code | Pass |
| copilot | `copilot auth login` | Device code (github.com) | Pass |
| cursor-agent | `cursor-agent` | OAuth (browser) | Pass |
| kiro-cli | `kiro-cli auth login` | OAuth (AWS Builder ID) | Pass |
| auggie | `auggie auth login` | OAuth | Pass |
| opencode | `opencode auth` | API key | Pass |
| junie | `junie auth` | API token (manual) | Pass (token only) |
| pi | `pi auth login` | OAuth | Pass |
| goose | `goose auth` | OAuth | Fail (Docker only) |

**Note on Goose**: OAuth login now works in WSL (fixed since 2026-03-17),
but still fails inside Docker containers. The issue appears to be
Docker-specific (OAuth redirect cannot reach the container).

**Note on Junie**: OAuth redirect fails inside Docker because the callback
cannot reach the container. Authentication works by manually creating an
API token on the Junie website and pasting it in, similar to the `opencode`
API key flow. Both junie and opencode use subscription-based pricing
(monthly flat rate), not pay-as-you-go, so the token/API key approach
does not incur additional per-request costs.

## Key Findings

- Most login commands work **without any extra arguments**
- Agents that rely on localhost OAuth redirect (goose, junie) fail in
  Docker; workaround is manual API token entry where supported
- Interactive shell is required: `docker exec -it <container> bash -l`
- `PATH` must include `/root/.local/bin` for cursor-agent and kiro-cli
- No port forwarding from container to host is needed
- OAuth flows that use device code or copy-code patterns work natively
  because the callback target is the provider's server, not localhost

## Implications for DockerRuntimeAdapter

- Container login is validated; the blocker noted in ADR-003
  ("container persistence/login behavior") is now partially resolved
- Remaining work: verify session/token persistence across container
  restarts (tokens are stored in the `/root` volume)
- `DockerRuntimeAdapter` can follow the same `docker exec` pattern
  used in this validation for spawning CLI processes
