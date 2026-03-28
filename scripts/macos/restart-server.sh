#!/usr/bin/env bash
# Restart cats-runtime on macOS
# Usage: ./restart-server.sh [--stop] [--port PORT]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
source "$SCRIPT_DIR/launchd-config.sh"
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

cleanup_stale_temp_dirs() {
  if [[ ! -f "$REPO_ROOT/dist/index.js" ]]; then
    echo "  Skipping stale temp cleanup (dist/index.js not built yet)"
    return 0
  fi

  echo "Cleaning stale cats-runtime temp directories..."
  if (cd "$REPO_ROOT" && node dist/index.js --cleanup-temp-dirs >/dev/null); then
    echo "  Stale temp cleanup completed"
  else
    echo "  Stale temp cleanup skipped" >&2
  fi
}

has_launchd_agent() {
  [[ -f "$PLIST_FILE" ]]
}

stop_launchd_agent() {
  local scope="gui/$UID"

  if launchctl print "$scope/$LABEL" >/dev/null 2>&1; then
    echo "  Stopping $LABEL via launchd"
  else
    echo "  $LABEL not loaded in launchd"
  fi

  launchctl bootout "$scope" "$PLIST_FILE" >/dev/null 2>&1 || true

  if launchctl print "$scope/$LABEL" >/dev/null 2>&1; then
    echo "  Failed to unload $LABEL" >&2
    return 1
  fi

  echo "  Stopped"
}

start_launchd_agent() {
  local scope="gui/$UID"

  launchctl bootout "$scope" "$PLIST_FILE" >/dev/null 2>&1 || true
  launchctl bootstrap "$scope" "$PLIST_FILE"
  launchctl enable "$scope/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "$scope/$LABEL" >/dev/null 2>&1 \
    || launchctl kickstart "$scope/$LABEL" >/dev/null 2>&1 \
    || true
}

MANAGED_BY_LAUNCHD=false
if has_launchd_agent; then
  MANAGED_BY_LAUNCHD=true
fi

echo "Stopping cats-runtime..."
if [[ "$MANAGED_BY_LAUNCHD" == "true" ]]; then
  stop_launchd_agent
else
  stop_service_on_port "$PORT"
fi

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
NODE_BIN="$(resolve_node_binary)"

echo "Building TypeScript..."
pushd "$REPO_ROOT" >/dev/null
npm run build
popd >/dev/null
echo "  Build OK"

cleanup_stale_temp_dirs

mkdir -p "$LOG_DIR"

if [[ "$MANAGED_BY_LAUNCHD" == "true" ]]; then
  echo "Starting cats-runtime via launchd..."
  write_runner_script "$REPO_ROOT" "$NODE_BIN"
  if ! start_launchd_agent; then
    echo "  Failed to start $LABEL" >&2
    launchctl print "gui/$UID/$LABEL" || true
    exit 1
  fi
else
  echo "Starting cats-runtime..."
  pushd "$REPO_ROOT" >/dev/null
  nohup "$NODE_BIN" dist/index.js >"$STDOUT_LOG" 2>"$STDERR_LOG" < /dev/null &
  CATS_RUNTIME_PID=$!
  popd >/dev/null
  disown "$CATS_RUNTIME_PID" 2>/dev/null || true
fi

echo "Waiting for health check..."
sleep 3

if HEALTH_JSON="$(health_check "$PORT")"; then
  echo "  Healthy (port $PORT)"
  echo "  Dashboard: http://localhost:$PORT"
  if printf '%s' "$HEALTH_JSON" | grep -q '"bootstrapRequired"[[:space:]]*:[[:space:]]*true'; then
    echo "  Setup: bootstrap mode active, open http://localhost:$PORT/ to configure providers"
  fi
  if [[ "$MANAGED_BY_LAUNCHD" == "true" ]]; then
    echo "  Agent: $LABEL"
    echo "  Logs: $STDOUT_LOG / $STDERR_LOG"
  else
    echo "  PID: $CATS_RUNTIME_PID"
    echo "  Logs: $STDOUT_LOG / $STDERR_LOG"
  fi
else
  echo "  Not responding on port $PORT" >&2
  if [[ "$MANAGED_BY_LAUNCHD" == "true" ]]; then
    echo "  Check launchd state: launchctl print gui/$UID/$LABEL" >&2
    launchctl print "gui/$UID/$LABEL" || true
  fi
  echo "  Check logs:" >&2
  echo "    stdout: $STDOUT_LOG" >&2
  echo "    stderr: $STDERR_LOG" >&2
  exit 1
fi
