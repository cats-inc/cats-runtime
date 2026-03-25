#!/usr/bin/env bash
# Restart cats-runtime on Linux/macOS
# Usage: ./restart-server.sh [--stop] [--port PORT]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/cats-runtime"
STOP_ONLY=false
PORT=""

usage() {
  cat <<'EOF'
Usage: ./restart-server.sh [--stop] [--port PORT]

Options:
  --stop         Stop cats-runtime without restarting it
  --port PORT    Override port (default: CATS_RUNTIME_PORT from .env or 3110)
  --help         Show this help
EOF
}

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1 | sed -E 's/^[^=]+=[[:space:]]*//' || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop)
      STOP_ONLY=true
      shift
      ;;
    --port)
      PORT="${2:-}"
      if [[ -z "$PORT" ]]; then
        echo "Missing value for --port" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PORT" ]]; then
  PORT="$(read_env_value CATS_RUNTIME_PORT)"
fi
PORT="${PORT:-3110}"

stop_service_on_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$port" 2>/dev/null || true)"
  fi

  if [[ -z "${pids// }" ]]; then
    echo "  Not running on port $port"
    return 0
  fi

  echo "  Stopping PID(s) on port $port: $pids"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  sleep 1

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$port" 2>/dev/null || true)"
  fi

  if [[ -n "${pids// }" ]]; then
    echo "  Force killing remaining PID(s): $pids"
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi

  echo "  Stopped"
}

health_check() {
  local port="$1"
  local api_key
  api_key="$(read_env_value CATS_RUNTIME_API_KEY)"

  if [[ -n "$api_key" ]]; then
    curl -fsS -H "Authorization: Bearer $api_key" "http://127.0.0.1:${port}/health"
  else
    curl -fsS "http://127.0.0.1:${port}/health"
  fi
}

echo "Stopping cats-runtime..."
stop_service_on_port "$PORT"

if [[ "$STOP_ONLY" == "true" ]]; then
  echo "Done."
  exit 0
fi

command -v node >/dev/null 2>&1 || {
  echo "Node.js not found in PATH" >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "npm not found in PATH" >&2
  exit 1
}

echo "Building TypeScript..."
pushd "$REPO_ROOT" >/dev/null
npm run build
popd >/dev/null
echo "  Build OK"

mkdir -p "$LOG_DIR"
STDOUT_LOG="$LOG_DIR/cats-runtime.out.log"
STDERR_LOG="$LOG_DIR/cats-runtime.err.log"

echo "Starting cats-runtime..."
pushd "$REPO_ROOT" >/dev/null
nohup node dist/index.js >"$STDOUT_LOG" 2>"$STDERR_LOG" < /dev/null &
CATS_RUNTIME_PID=$!
popd >/dev/null
disown "$CATS_RUNTIME_PID" 2>/dev/null || true

echo "Waiting for health check..."
sleep 3

if HEALTH_JSON="$(health_check "$PORT")"; then
  echo "  Healthy (port $PORT)"
  echo "  Dashboard: http://localhost:$PORT"
  if printf '%s' "$HEALTH_JSON" | grep -q '"bootstrapRequired"[[:space:]]*:[[:space:]]*true'; then
    echo "  Setup: bootstrap mode active, open http://localhost:$PORT/ to configure providers"
  fi
  echo "  PID: $CATS_RUNTIME_PID"
  echo "  Logs: $STDOUT_LOG / $STDERR_LOG"
else
  echo "  Not responding on port $PORT" >&2
  echo "  Check logs:" >&2
  echo "    stdout: $STDOUT_LOG" >&2
  echo "    stderr: $STDERR_LOG" >&2
  exit 1
fi
