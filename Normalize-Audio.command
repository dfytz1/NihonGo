#!/bin/bash
# Double-click in Finder: normalizes all MP3s referenced in the DB (same as: npm run normalize-audio).
# One-time: copy scripts/env.normalize.example → scripts/.env.normalize and fill in values.

set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
ENV_FILE="$REPO/scripts/.env.normalize"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  echo "Create: $ENV_FILE"
  echo "Copy from: $REPO/scripts/env.normalize.example"
  read -r -p "Press Enter to close…"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js first."
  read -r -p "Press Enter to close…"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install with: brew install ffmpeg"
  read -r -p "Press Enter to close…"
  exit 1
fi

[[ -d "$REPO/node_modules" ]] || npm install --silent

npm run normalize-audio
echo ""
read -r -p "Done. Press Enter to close…"
