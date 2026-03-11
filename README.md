# cats-runtime

> Thin facade over agent execution backends. Phase 1 wraps `agent-fleet` over HTTP.

## Overview

`cats-runtime` is the stable runtime boundary intended for future products such as
`cats-inc`. It hides backend-specific details behind a small HTTP surface so upper
layers do not depend on `agent-fleet` internals directly.

The first implementation is intentionally narrow:

- health inspection
- session creation
- session lookup
- message streaming
- session close
- Kiro model catalog passthrough

## Current Status

- [x] Bootstrap the subproject
- [x] Implement the first `agent-fleet` adapter
- [x] Add streaming passthrough tests
- [ ] Migrate `crew-chat-poc` to call `cats-runtime`
- [ ] Add a second backend (`api-runtime`)

## Design Rules

- `cats-runtime` MUST treat `agent-fleet` as an external backend boundary
- `cats-runtime` MUST NOT source-import `agent-fleet/src/...`
- Public callers should depend on `cats-runtime`, not on backend-specific routes

## Quick Start

```powershell
cd cats-runtime
npm install
copy .env.example .env
npm run build
node dist/index.js
```

Default URL: `http://127.0.0.1:3110`

Upstream dependency: `agent-fleet` at `http://localhost:3100`

## Key Files

- `src/index.ts` - process entrypoint
- `src/server.ts` - HTTP server and route handling
- `src/adapters/agentFleetBackend.ts` - upstream adapter
- `docs/api.md` - supported public API
- `docs/architecture.md` - boundary and layering notes
- [ ] Task 2 - description
- [x] Task 3 - completed

## Quick Start

```bash
# Clone the repository
git clone https://github.com/username/project-name.git
cd project-name

# Setup environment (example)
cp .env.example .env
# Edit .env with your values

# Install dependencies (choose based on your stack)
# Python:
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt

# Node.js:
npm install
```

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Setup Guide](./docs/setup-guide.md)
- [Architecture](./docs/architecture.md)
- [Contributing](./CONTRIBUTING.md)
- [Script Standards](./docs/SCRIPT-STANDARDS.md)
- [Research Log](./docs/research/)

## Project Structure

```
project-root/
├── src/           # Source code
├── tests/         # Test files
├── docs/          # Documentation
├── scripts/       # Build/deployment scripts
├── config/        # Configuration files
└── assets/        # Static assets
```

## Maintenance

### Updating Agent Rules & Templates

This project follows AAIF standards. You can update the core infrastructure files (Agent rules, documentation templates) using the built-in update scripts:

**Windows**
```powershell
.\scripts\windows\Update-Project.ps1
```

**Linux / macOS**
```bash
./scripts/linux/update-project.sh
```

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
