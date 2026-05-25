#!/usr/bin/env bash
# Bundle every source file in the project into a single txt file for AI context.
# Usage: ./complete_script.sh [output_file]
#   default output: project_bundle.txt

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${1:-${ROOT_DIR}/project_bundle.txt}"

# Directories to skip entirely (matched by name anywhere in the tree).
EXCLUDE_DIRS=(
  .env
  .env.example
  node_modules
  .next
  .git
  .turbo
  .cache
  dist
  build
  out
  coverage
  .vscode
  .idea
  __pycache__
  .pytest_cache
  .mypy_cache
  .DS_Store
)

# Filenames to skip (full basename match).
EXCLUDE_FILES=(
  .env
  package-lock.json
  yarn.lock
  pnpm-lock.yaml
  bun.lockb
  tsconfig.tsbuildinfo
  next-env.d.ts
  claude-marjoram-tmux-transcript.txt
)

# Extensions to skip (binary / generated / heavy).
EXCLUDE_EXTS=(
  png jpg jpeg gif webp ico svg bmp tiff
  pdf zip tar gz tgz bz2 7z rar
  woff woff2 ttf eot otf
  mp3 mp4 mov avi mkv wav
  exe dll so dylib bin dat
  lockb
)

# Build the find expression dynamically.
build_find_args() {
  local args=("$ROOT_DIR")

  # Prune excluded directories.
  args+=("(")
  local first=1
  for d in "${EXCLUDE_DIRS[@]}"; do
    if [[ $first -eq 1 ]]; then
      args+=("-type" "d" "-name" "$d")
      first=0
    else
      args+=("-o" "-type" "d" "-name" "$d")
    fi
  done
  args+=(")" "-prune" "-o")

  # Match regular files only.
  args+=("-type" "f")

  # Exclude by filename.
  for f in "${EXCLUDE_FILES[@]}"; do
    args+=("!" "-name" "$f")
  done

  # Exclude by extension.
  for e in "${EXCLUDE_EXTS[@]}"; do
    args+=("!" "-iname" "*.$e")
  done

  # Don't include the output file or this script's own output.
  args+=("!" "-name" "$(basename "$OUTPUT_FILE")")

  args+=("-print")

  FIND_ARGS=("${args[@]}")
}

# Detect binary files. `grep -I` reports binary files; combined with a match-all
# pattern, grep exits non-zero on binary or empty input.
is_binary() {
  local file="$1"
  # Empty files are fine — treat as text.
  if [[ ! -s "$file" ]]; then
    return 1
  fi
  if LC_ALL=C grep -Iq . "$file" 2>/dev/null; then
    return 1
  fi
  return 0
}

main() {
  build_find_args

  # Truncate / create output.
  : > "$OUTPUT_FILE"

  local total_files=0
  local skipped_binary=0
  local file_count=0

  # Header.
  {
    echo "================================================================================"
    echo "PROJECT BUNDLE: $(basename "$ROOT_DIR")"
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Root: $ROOT_DIR"
    echo "================================================================================"
    echo
  } >> "$OUTPUT_FILE"

  # Collect files (sorted for deterministic output).
  while IFS= read -r file; do
    total_files=$((total_files + 1))

    if is_binary "$file"; then
      skipped_binary=$((skipped_binary + 1))
      continue
    fi

    local rel="${file#"$ROOT_DIR"/}"
    {
      echo
      echo "================================================================================"
      echo "FILE: $rel"
      echo "================================================================================"
      cat "$file"
      echo
    } >> "$OUTPUT_FILE"

    file_count=$((file_count + 1))
  done < <(find "${FIND_ARGS[@]}" | sort)

  # Footer.
  {
    echo
    echo "================================================================================"
    echo "END OF BUNDLE"
    echo "Files included: $file_count"
    echo "Binary files skipped: $skipped_binary"
    echo "Total files scanned: $total_files"
    echo "================================================================================"
  } >> "$OUTPUT_FILE"

  echo "Wrote $file_count files to: $OUTPUT_FILE"
  echo "Skipped $skipped_binary binary files."
  printf "Output size: %s\n" "$(du -h "$OUTPUT_FILE" | cut -f1)"
}

main "$@"
