#!/bin/bash
# Restore check for an archived historical build. Extracts the archive into an empty scratch directory, checks the
# archive against its version ID, checks every file against SHA256SUMS.txt, runs the SLC consumer tests on the restored
# copy, then removes that copy.
# Usage: bash pipeline/restore_check_historical.sh <archive .tar.gz> <empty scratch dir> <SLC scripts/nfl_sequence dir>
set -u
ARCHIVE="${1:?usage: restore_check_historical.sh <archive> <empty scratch dir> <SLC scripts/nfl_sequence dir>}"
SCRATCH="${2:?usage: restore_check_historical.sh <archive> <empty scratch dir> <SLC scripts/nfl_sequence dir>}"
SLC="${3:?usage: restore_check_historical.sh <archive> <empty scratch dir> <SLC scripts/nfl_sequence dir>}"
STEM="${ARCHIVE%.tar.gz}"
VERSION="${STEM##*-}"
BUILD="$SCRATCH/historical-2022-2024-v2"
[ -z "$(ls -A "$SCRATCH")" ] || { echo "scratch dir is not empty: $SCRATCH"; exit 1; }
[ "$(sha256sum "$ARCHIVE" | cut -d' ' -f1)" = "$VERSION" ] || { echo "archive does not match its version ID $VERSION"; exit 1; }
trap 'rm -rf "$BUILD"' EXIT
tar -C "$SCRATCH" -xzf "$ARCHIVE" || { echo "extract failed"; exit 1; }
EXPECTED=$(( $(wc -l < "$BUILD/SHA256SUMS.txt") + 1 ))
FOUND=$(find "$BUILD" -type f | wc -l)
echo "files: found $FOUND, expected $EXPECTED (SHA256SUMS entries plus SHA256SUMS.txt)"
[ "$FOUND" -eq "$EXPECTED" ] || { echo "file count differs"; exit 1; }
(cd "$BUILD" && sha256sum -c --quiet SHA256SUMS.txt) || { echo "SHA256SUMS check failed"; exit 1; }
echo "SHA256SUMS: every entry verifies"
status=0
(cd "$SLC" && HISTORICAL_PLAYBOOK_DIR="$BUILD" HISTORICAL_CDE_PRIOR="$BUILD/cde-prior-2022-2024-v2.json" \
  python3 -m unittest -v test_playbook_prior_historical test_playbook_prior_compact) || status=1
exit $status
