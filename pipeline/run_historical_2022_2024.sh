#!/bin/bash
# Build 2022, 2023, and 2024 historical playbooks, one season per process, RSS capped.
# Usage: bash pipeline/run_historical_2022_2024.sh <absolute output dir outside this repository>
# A season whose process exceeds CAP_KB is stopped and the loop ends.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: run_historical_2022_2024.sh <absolute output dir>}"
CAP_KB=2457600
mkdir -p "$OUT"
for season in 2022 2023 2024; do
  python3 "$REPO/pipeline/run_historical_season.py" "$season" "$OUT" > "$OUT/build-$season.log" 2>&1 &
  pid=$!
  peak=0
  capped=0
  while kill -0 "$pid" 2>/dev/null; do
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$rss" ] && [ "$rss" -gt "$peak" ] && peak=$rss
    if [ -n "$rss" ] && [ "$rss" -gt "$CAP_KB" ]; then
      kill "$pid"
      capped=1
      break
    fi
    sleep 1
  done
  wait "$pid"
  code=$?
  echo "season=$season exit=$code capped=$capped peak_rss_kb=$peak"
  if [ "$code" -ne 0 ] || [ "$capped" -eq 1 ]; then exit 1; fi
done
