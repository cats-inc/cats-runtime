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

CATS_RUNTIME_LAUNCHD_LABEL="$(read_autostart_override CATS_RUNTIME_LAUNCHD_LABEL)"
CATS_RUNTIME_LAUNCHD_LABEL="${CATS_RUNTIME_LAUNCHD_LABEL:-io.sammykenny2.cats-runtime}"
CATS_RUNTIME_LAUNCHD_PLIST_DIR="$(read_autostart_override CATS_RUNTIME_LAUNCHD_PLIST_DIR)"
CATS_RUNTIME_LAUNCHD_PLIST_DIR="${CATS_RUNTIME_LAUNCHD_PLIST_DIR:-$HOME/Library/LaunchAgents}"
CATS_RUNTIME_LOG_DIR="$(read_autostart_override CATS_RUNTIME_LOG_DIR)"
CATS_RUNTIME_LOG_DIR="${CATS_RUNTIME_LOG_DIR:-$HOME/Library/Logs/cats-runtime}"
CATS_RUNTIME_SUPPORT_DIR="$(read_autostart_override CATS_RUNTIME_SUPPORT_DIR)"
CATS_RUNTIME_SUPPORT_DIR="${CATS_RUNTIME_SUPPORT_DIR:-$HOME/Library/Application Support/cats-runtime}"

LABEL="$CATS_RUNTIME_LAUNCHD_LABEL"
PLIST_DIR="$CATS_RUNTIME_LAUNCHD_PLIST_DIR"
PLIST_FILE="$PLIST_DIR/$LABEL.plist"
LOG_DIR="$CATS_RUNTIME_LOG_DIR"
STDOUT_LOG="$LOG_DIR/stdout.log"
STDERR_LOG="$LOG_DIR/stderr.log"
RUNNER_SCRIPT="$CATS_RUNTIME_SUPPORT_DIR/start-cats-runtime.sh"

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

render_runner_script() {
  local repo_root="$1"
  local node_bin="$2"
  local node_dir
  node_dir="$(dirname "$node_bin")"

  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf 'export PATH=%q:"$HOME/.npm-global/bin":"$HOME/.local/bin":"$HOME/.pyenv/shims":"$HOME/.pyenv/bin":/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}\n' "$node_dir"
  printf 'cd %q\n' "$repo_root"
  printf 'exec %q dist/index.js\n' "$node_bin"
}

runner_script_matches() {
  local repo_root="$1"
  local node_bin="$2"
  local expected_runner
  local current_runner

  [[ -f "$RUNNER_SCRIPT" ]] || return 1

  expected_runner="$(render_runner_script "$repo_root" "$node_bin")"
  current_runner="$(<"$RUNNER_SCRIPT")"

  [[ "$current_runner" == "$expected_runner" ]]
}

write_runner_script() {
  local repo_root="$1"
  local node_bin="$2"

  mkdir -p "$CATS_RUNTIME_SUPPORT_DIR"
  render_runner_script "$repo_root" "$node_bin" >"$RUNNER_SCRIPT"
  chmod +x "$RUNNER_SCRIPT"
}
