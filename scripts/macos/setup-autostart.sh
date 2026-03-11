#!/usr/bin/env bash
# Setup cats-runtime to auto-start on macOS via launchd
# Usage: ./setup-autostart.sh --install|--remove|--verify [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
CATS_RUNTIME_SUPPORT_DIR="$HOME/Library/Application Support/cats-runtime"
RUNNER_SCRIPT="$CATS_RUNTIME_SUPPORT_DIR/start-cats-runtime.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/io.sammykenny2.cats-runtime.plist"
LOG_DIR="$HOME/Library/Logs/cats-runtime"
STDOUT_LOG="$LOG_DIR/stdout.log"
STDERR_LOG="$LOG_DIR/stderr.log"
LABEL="io.sammykenny2.cats-runtime"
INSTALL=false
REMOVE=false
VERIFY=false
FORCE=false

usage() {
  cat <<'EOF'
Usage: ./setup-autostart.sh --install|--remove|--verify [--force]

Options:
  --install      Build and install a launchd agent
  --remove       Remove the launchd agent
  --verify       Check health and launchd status
  --force        Reinstall even if the agent already exists
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
    --install)
      INSTALL=true
      shift
      ;;
    --remove)
      REMOVE=true
      shift
      ;;
    --verify)
      VERIFY=true
      shift
      ;;
    --force)
      FORCE=true
      shift
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

op_count=0
[[ "$INSTALL" == "true" ]] && ((op_count += 1))
[[ "$REMOVE" == "true" ]] && ((op_count += 1))
[[ "$VERIFY" == "true" ]] && ((op_count += 1))

if [[ $op_count -ne 1 ]]; then
  usage
  exit 1
fi

PORT="$(read_env_value CATS_RUNTIME_PORT)"
PORT="${PORT:-3110}"

echo "--- Cats Runtime Auto-Start Setup (macOS) ---"

health_check() {
  local api_key
  api_key="$(read_env_value CATS_RUNTIME_API_KEY)"
  if [[ -n "$api_key" ]]; then
    curl -fsS -H "Authorization: Bearer $api_key" "http://127.0.0.1:${PORT}/health" >/dev/null
  else
    curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
  fi
}

if [[ "$VERIFY" == "true" ]]; then
  echo ""
  all_good=true

  echo "1. HTTP service (localhost:${PORT})..."
  if health_check; then
    echo "   OK"
  else
    echo "   Not reachable"
    all_good=false
  fi

  echo "2. launchd config..."
  if [[ -f "$RUNNER_SCRIPT" ]]; then
    echo "   Runner script exists: $RUNNER_SCRIPT"
  else
    echo "   Runner script missing: $RUNNER_SCRIPT"
    all_good=false
  fi

  if [[ -f "$PLIST_FILE" ]]; then
    echo "   Plist exists: $PLIST_FILE"
  else
    echo "   Plist missing: $PLIST_FILE"
    all_good=false
  fi

  if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    echo "   launchd job loaded"
  else
    echo "   launchd job not loaded"
    all_good=false
  fi

  echo "3. Logs..."
  if [[ -f "$STDOUT_LOG" ]]; then
    tail -n 3 "$STDOUT_LOG" || true
  else
    echo "   No stdout log yet"
  fi
  if [[ -f "$STDERR_LOG" ]]; then
    tail -n 3 "$STDERR_LOG" || true
  else
    echo "   No stderr log yet"
  fi

  echo ""
  if [[ "$all_good" == "true" ]]; then
    echo "All good"
  else
    echo "Some issues found"
  fi
  exit 0
fi

if [[ "$REMOVE" == "true" ]]; then
  echo ""
  launchctl bootout "gui/$UID" "$PLIST_FILE" >/dev/null 2>&1 || true
  rm -f "$PLIST_FILE"
  rm -f "$RUNNER_SCRIPT"
  rm -f "$STDOUT_LOG" "$STDERR_LOG"
  echo "Removed launchd agent"
  echo "Auto-start removed. Running service has been stopped if launchd managed it."
  exit 0
fi

echo ""
echo "1. Checking prerequisites..."
command -v node >/dev/null 2>&1 || {
  echo "   Node.js not found" >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "   npm not found" >&2
  exit 1
}
echo "   Node.js $(node --version)"

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  echo "   node_modules missing, running npm install..."
  pushd "$REPO_ROOT" >/dev/null
  npm install
  popd >/dev/null
fi
echo "   Dependencies OK"

if [[ ! -f "$ENV_FILE" && -f "$ENV_EXAMPLE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "   Created .env from .env.example"
fi
echo "   Port: $PORT"

if [[ -f "$PLIST_FILE" && "$FORCE" != "true" ]]; then
  echo ""
  echo "Already installed. Use --force to reconfigure."
  echo "  Plist:  $PLIST_FILE"
  echo "  Runner: $RUNNER_SCRIPT"
  exit 0
fi

echo "2. Building TypeScript..."
pushd "$REPO_ROOT" >/dev/null
npm run build
popd >/dev/null
echo "   Build OK"

echo "3. Creating runner script and launchd plist..."
mkdir -p "$CATS_RUNTIME_SUPPORT_DIR" "$PLIST_DIR" "$LOG_DIR"

cat >"$RUNNER_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$REPO_ROOT"
exec node dist/index.js
EOF

cat >"$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>$RUNNER_SCRIPT</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$STDOUT_LOG</string>
    <key>StandardErrorPath</key>
    <string>$STDERR_LOG</string>
  </dict>
</plist>
EOF

chmod +x "$RUNNER_SCRIPT"

launchctl bootout "gui/$UID" "$PLIST_FILE" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST_FILE"
launchctl enable "gui/$UID/$LABEL"
launchctl kickstart -k "gui/$UID/$LABEL"

echo ""
echo "Setup complete!"
echo "  Dashboard: http://localhost:$PORT"
echo "  Runner:    $RUNNER_SCRIPT"
echo "  Plist:     $PLIST_FILE"
echo "  Logs:      $STDOUT_LOG / $STDERR_LOG"
echo ""
echo "Useful commands:"
echo "  launchctl print gui/$UID/$LABEL"
echo "  tail -f \"$STDOUT_LOG\""
