#!/usr/bin/env bash
# Setup cats-runtime to auto-start on Linux via systemd --user
# Usage: ./setup-autostart.sh --install|--remove|--verify [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/cats-runtime.service"
SERVICE_NAME="cats-runtime.service"
INSTALL=false
REMOVE=false
VERIFY=false
FORCE=false

usage() {
  cat <<'EOF'
Usage: ./setup-autostart.sh --install|--remove|--verify [--force]

Options:
  --install      Build and install a systemd --user service
  --remove       Remove the systemd --user service
  --verify       Check health and service status
  --force        Reinstall even if the service already exists
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

echo "--- Cats Runtime Auto-Start Setup (Linux) ---"

command -v systemctl >/dev/null 2>&1 || {
  echo "systemctl not found; this script requires systemd --user" >&2
  exit 1
}

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

  echo "2. systemd user unit..."
  if [[ -f "$UNIT_FILE" ]]; then
    echo "   Unit file exists: $UNIT_FILE"
  else
    echo "   Unit file missing: $UNIT_FILE"
    all_good=false
  fi

  if systemctl --user is-enabled "$SERVICE_NAME" >/dev/null 2>&1; then
    echo "   Enabled"
  else
    echo "   Not enabled"
    all_good=false
  fi

  if systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
    echo "   Active"
  else
    echo "   Not active"
    all_good=false
  fi

  echo "3. Recent logs..."
  journalctl --user -u "$SERVICE_NAME" -n 5 --no-pager || true

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
  systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE"
  systemctl --user daemon-reload
  echo "Removed $SERVICE_NAME"
  echo "Auto-start removed. Running service has been stopped if it was managed by systemd."
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

if [[ -f "$UNIT_FILE" && "$FORCE" != "true" ]]; then
  echo ""
  echo "Already installed. Use --force to reconfigure."
  echo "  Unit: $UNIT_FILE"
  exit 0
fi

echo "2. Building TypeScript..."
pushd "$REPO_ROOT" >/dev/null
npm run build
popd >/dev/null
echo "   Build OK"

echo "3. Creating systemd user unit..."
mkdir -p "$UNIT_DIR"

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Cats Runtime - embedded runtime service
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
ExecStart=/usr/bin/env node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo ""
echo "Setup complete!"
echo "  Dashboard: http://localhost:$PORT"
echo "  Unit:      $UNIT_FILE"
echo ""
echo "Useful commands:"
echo "  systemctl --user status $SERVICE_NAME"
echo "  journalctl --user -u $SERVICE_NAME -f"
