#!/usr/bin/env bash
# Serve the repo root on a free port and run the Playwright UI test against it.
# Port 8080 is skipped because an externally-managed TileServer already binds it.
set -euo pipefail

PORT="${PORT:-8137}"
BASE_URL="http://127.0.0.1:${PORT}"

# Pick a free port if the requested one is taken.
while ss -tln 2>/dev/null | grep -q ":${PORT} "; do
  PORT=$((PORT + 1))
  BASE_URL="http://127.0.0.1:${PORT}"
done

cd "$(dirname "$0")/.."
python3 -m http.server "${PORT}" --directory . >/tmp/gridiron-http.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT

# Give the server a moment to bind, then run the browser test.
sleep 1
BASE_URL="${BASE_URL}" node --test --test-concurrency=1 test/week7.browser.mjs test/week7-audio.browser.mjs test/rigged-clip-playback.browser.mjs test/rigged-stance-hands.browser.mjs
BASE_URL="${BASE_URL}" node --test test/autonomous.browser.mjs
