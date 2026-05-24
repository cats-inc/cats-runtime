#!/usr/bin/env bash
set -euo pipefail

clean=false
agent=""

print_usage() {
  cat <<'EOF'
Usage: sync-agent-skills.sh [--clean] [--agent claude|codex]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      clean=true
      shift
      ;;
    --agent)
      shift
      if [[ $# -eq 0 ]]; then
        echo "--agent requires a value" >&2
        exit 1
      fi
      case "$1" in
        claude|codex)
          agent="$1"
          ;;
        *)
          echo "Unsupported agent: $1" >&2
          exit 1
          ;;
      esac
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/../.." && pwd)"
while [[ "$project_root" != "/" && ! -f "$project_root/AGENTS.md" ]]; do
  project_root="$(dirname "$project_root")"
done

if [[ ! -f "$project_root/AGENTS.md" ]]; then
  echo "Could not find project root (no AGENTS.md found)." >&2
  exit 1
fi

skills_dir="$project_root/skills"
if [[ ! -d "$skills_dir" ]]; then
  echo "No skills/ directory found at $skills_dir" >&2
  exit 0
fi

resolve_target_dir() {
  case "$1" in
    claude) echo "$project_root/.claude/skills" ;;
    codex) echo "$project_root/.agents/skills" ;;
    *) return 1 ;;
  esac
}

agents=(claude codex)
if [[ -n "$agent" ]]; then
  agents=("$agent")
fi

skill_dirs=()
for entry in "$skills_dir"/*; do
  [[ -d "$entry" ]] || continue
  [[ -f "$entry/SKILL.md" ]] || continue
  skill_dirs+=("$entry")
done

if [[ ${#skill_dirs[@]} -eq 0 ]]; then
  echo "No skills found in $skills_dir (no directories with SKILL.md)" >&2
  exit 0
fi

for agent_name in "${agents[@]}"; do
  target_dir="$(resolve_target_dir "$agent_name")"
  if [[ "$clean" == true && -d "$target_dir" ]]; then
    rm -rf "$target_dir"
  fi
  mkdir -p "$target_dir"
  for skill_dir in "${skill_dirs[@]}"; do
    skill_name="$(basename "$skill_dir")"
    rm -rf "$target_dir/$skill_name"
    cp -R "$skill_dir" "$target_dir/"
  done
  printf 'Synced %s skill(s) to %s: %s\n' "${#skill_dirs[@]}" "$agent_name" "$target_dir"
done
