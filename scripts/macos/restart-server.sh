#!/usr/bin/env bash
# macOS wrapper for the shared POSIX restart script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../linux/restart-server.sh" "$@"
