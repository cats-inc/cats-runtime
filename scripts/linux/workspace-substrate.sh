#!/usr/bin/env bash
# Invoke the repo-owned cats-runtime workspace substrate helper.
#
# Usage:
#   ./scripts/linux/workspace-substrate.sh --operation audit --workspace-path .
#   ./scripts/linux/workspace-substrate.sh --operation update --workspace-path . --profile a2a-enabled --agent codex --apply --actor-role boss_cat

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_PATH="$ROOT/dist/bin/workspaceSubstrate.js"

if [ ! -f "$BIN_PATH" ]; then
  echo "Missing $BIN_PATH. Run 'npm run build' in cats-runtime first." >&2
  exit 1
fi

exec node "$BIN_PATH" "$@"
