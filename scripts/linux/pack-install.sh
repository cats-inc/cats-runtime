#!/usr/bin/env bash
# Pack cats-runtime as .tgz and optionally install it globally.
#
# Usage:
#   ./scripts/linux/pack-install.sh                   # Interactive (install defaults to yes; delete defaults to yes after install)
#   ./scripts/linux/pack-install.sh --pack-only       # Build + pack, skip install
#   ./scripts/linux/pack-install.sh --install         # Build + pack + install + delete tgz (no prompt)
#   ./scripts/linux/pack-install.sh --install --clean # Build + pack + install + delete tgz
#   ./scripts/linux/pack-install.sh --skip-build      # Pack only (assumes already built)

set -euo pipefail

PACK_ONLY=false
INSTALL=false
CLEAN=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --pack-only)  PACK_ONLY=true ;;
    --install)    INSTALL=true ;;
    --clean)      CLEAN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--pack-only] [--install] [--clean] [--skip-build]" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ "$SKIP_BUILD" = false ]; then
  printf '\n\033[36m=== Building... ===\033[0m\n'
  npm run build
else
  printf '\n\033[33m=== Skipping build (--skip-build) ===\033[0m\n'
fi

printf '\n\033[36m=== Packing... ===\033[0m\n'
TGZ_NAME="$(npm_config_ignore_scripts=true npm pack --silent)"
TGZ="$ROOT/$TGZ_NAME"
printf -v TGZ_QUOTED '%q' "$TGZ"

if [ ! -f "$TGZ" ]; then
  echo "Expected $TGZ but file not found" >&2
  exit 1
fi

printf '\n\033[32mPackage created: %s\033[0m\n' "$TGZ"

if [ "$PACK_ONLY" = true ]; then
  printf '\033[90mPack only mode. Package at: %s\033[0m\n' "$TGZ"
  printf '\033[90mYou can install later with: npm install -g %s\033[0m\n' "$TGZ_QUOTED"
  printf '\033[90mAfter installing, try: cats-runtime --help\033[0m\n'
  exit 0
fi

SHOULD_INSTALL=false
if [ "$INSTALL" = true ]; then
  SHOULD_INSTALL=true
else
  printf '\nInstall globally? (Y/n) '
  read -r ANSWER
  case "$ANSWER" in
    [nN]*) ;;
    *)     SHOULD_INSTALL=true ;;
  esac
fi

if [ "$SHOULD_INSTALL" = false ]; then
  printf '\033[90mSkipped install. Package at: %s\033[0m\n' "$TGZ"
  printf '\033[90mYou can install later with: npm install -g %s\033[0m\n' "$TGZ_QUOTED"
  printf '\033[90mAfter installing, try: cats-runtime --help\033[0m\n'
  exit 0
fi

printf '\n\033[36m=== Installing globally... ===\033[0m\n'
npm install -g "$TGZ"
printf '\033[32mInstalled successfully!\033[0m\n'
printf '\033[90mTry: cats-runtime --help\033[0m\n'

SHOULD_DELETE=false
if [ "$CLEAN" = true ]; then
  SHOULD_DELETE=true
elif [ "$INSTALL" = true ]; then
  SHOULD_DELETE=true
else
  printf '\nDelete %s? (Y/n) ' "$TGZ_NAME"
  read -r ANSWER
  case "$ANSWER" in
    [nN]*) ;;
    *)     SHOULD_DELETE=true ;;
  esac
fi

if [ "$SHOULD_DELETE" = true ]; then
  rm -f "$TGZ"
  printf '\033[33mDeleted.\033[0m\n'
else
  printf '\033[90mKept at: %s\033[0m\n' "$TGZ"
  printf '\033[90mYou can reinstall later with: npm install -g %s\033[0m\n' "$TGZ_QUOTED"
fi
