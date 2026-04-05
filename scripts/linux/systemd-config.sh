#!/usr/bin/env bash

read_autostart_override() {
  local key="$1"
  local value="${!key-}"

  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return 0
  fi

  if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
    grep -E "^${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1 | sed -E 's/^[^=]+=[[:space:]]*//' || true
  fi
}

CATS_RUNTIME_SYSTEMD_SERVICE_NAME="$(read_autostart_override CATS_RUNTIME_SYSTEMD_SERVICE_NAME)"
CATS_RUNTIME_SYSTEMD_SERVICE_NAME="${CATS_RUNTIME_SYSTEMD_SERVICE_NAME:-cats-runtime.service}"
CATS_RUNTIME_SYSTEMD_UNIT_DIR="$(read_autostart_override CATS_RUNTIME_SYSTEMD_UNIT_DIR)"
CATS_RUNTIME_SYSTEMD_UNIT_DIR="${CATS_RUNTIME_SYSTEMD_UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"

SERVICE_NAME="$CATS_RUNTIME_SYSTEMD_SERVICE_NAME"
UNIT_DIR="$CATS_RUNTIME_SYSTEMD_UNIT_DIR"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME"

resolve_node_binary() {
  local node_bin
  node_bin="$(read_autostart_override CATS_RUNTIME_NODE_BIN)"

  if [[ -z "$node_bin" ]]; then
    node_bin="$(command -v node || true)"
  fi

  if [[ -z "$node_bin" ]]; then
    echo "Node.js not found in PATH" >&2
    return 1
  fi

  printf '%s\n' "$node_bin"
}

render_systemd_unit() {
  local repo_root="$1"
  local node_bin="$2"

  cat <<EOF
[Unit]
Description=Cats Runtime - embedded runtime service
After=network.target

[Service]
Type=simple
WorkingDirectory=$repo_root
ExecStart=$node_bin build/runtime/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF
}

unit_file_matches() {
  local repo_root="$1"
  local node_bin="$2"
  local expected_unit
  local current_unit

  [[ -f "$UNIT_FILE" ]] || return 1

  expected_unit="$(render_systemd_unit "$repo_root" "$node_bin")"
  current_unit="$(<"$UNIT_FILE")"

  [[ "$current_unit" == "$expected_unit" ]]
}

write_unit_file() {
  local repo_root="$1"
  local node_bin="$2"

  mkdir -p "$UNIT_DIR"
  render_systemd_unit "$repo_root" "$node_bin" >"$UNIT_FILE"
}
