# Service Registry

> This file documents all services in this project that listen on network ports.
> Keeping this up to date helps avoid port conflicts and makes onboarding easier.

## Services

| Service | Port | Env Var | Purpose | Notes |
|---------|------|---------|---------|-------|
| `cats-runtime` | 3110 | `CATS_RUNTIME_PORT` | Unified runtime service for upper-layer apps | Default host `127.0.0.1` |
| `opencode` embedded server | 4097 | `OPENCODE_SERVER_PORT` | Local OpenCode HTTP bridge used by the OpenCode backend | Started on demand by `cats-runtime` |

## Environment Variables

Port numbers should be configurable via environment variables so developers can override defaults when needed.

| Variable | Default | Service | Notes |
|----------|---------|---------|-------|
| `CATS_RUNTIME_PORT` | `3110` | `cats-runtime` | Main inbound HTTP listener |
| `CATS_RUNTIME_DIR` | `~/.cats/runtime` | `cats-runtime` | Runtime root for `config/`, `data/`, and `sessions/` |
| `OPENCODE_SERVER_PORT` | `4097` | `opencode` embedded server | Only used when the OpenCode backend is active |

## Cross-Project Port Coordination

This project was created from **project-bootstrap**, which maintains a central port registry at:

```
<bootstrap-project>/docs/port-registry.md
```

**For AI agents**: When adding or changing a service port in this project:

1. **MUST** update the **Services** table above
2. **SHOULD** check the bootstrap project's `docs/port-registry.md` for conflicts with other projects
3. **SHOULD** register the new port in the bootstrap project's `docs/port-registry.md`
4. **MUST** warn the user if a port conflict is detected

---

*Last updated: 2026-03-11*
