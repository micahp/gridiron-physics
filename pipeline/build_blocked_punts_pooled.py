#!/usr/bin/env python3
"""Pool 2022-2025 regular-season blocked punts and validate every record.

Reads nflverse play_by_play_{2022..2025}.parquet (SHA-256 checked against the
directory's SHA256SUMS). Writes data/special_teams/blocked-punts-2022-2025.json
with one validated record per blocked punt. Exits non-zero if any record is
unclassified, contradicts its flags, or has an unparsed recovery/out-of-bounds
spot, so no record is silently dropped.

Outcome weights are empirical sampling weights only; they are not predictive
probabilities and are not modelled by team, field position or player.
"""
import hashlib
import json
import os
import re
import sys

import pandas as pd

RAW_DIR = sys.argv[1] if len(sys.argv) > 1 else "/root/nflverse-raw"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "special_teams", "blocked-punts-2022-2025.json")
SEASONS = [2022, 2023, 2024, 2025]
OUTCOMES = ["receiving_recovery", "kicking_recovery", "out_of_bounds", "safety"]
MODEL_VERSION = "blocked-punt-resolution-pooled.v1"
SPOT_RE = re.compile(r"\bat ([A-Z]{2,3}) (-?\d+)\b")
RECOVERED_RE = re.compile(r"recovered by ([A-Z]{2,3})-", re.I)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_sums(directory):
    sums = {}
    with open(os.path.join(directory, "SHA256SUMS")) as f:
        for line in f:
            digest, name = line.split()
            sums[name] = digest
    return sums


def classify(row, errors):
    desc = str(row["desc"])
    rec = RECOVERED_RE.search(desc)
    if "SAFETY" in desc:
        if rec:
            errors.append("safety record also names a recovery")
        return "safety", None
    if rec:
        team = rec.group(1).upper()
        if team == row["posteam"]:
            outcome = "kicking_recovery"
        elif team == row["defteam"]:
            outcome = "receiving_recovery"
        else:
            errors.append(f"recovering team {team} is neither posteam nor defteam")
            return None, None
        spot = SPOT_RE.search(desc)
        if not spot:
            errors.append("recovery spot not parsed")
        return outcome, spot
    if "out of bounds" in desc.lower():
        spot = SPOT_RE.search(desc)
        if not spot:
            errors.append("out-of-bounds spot not parsed")
        return "out_of_bounds", spot
    errors.append("no recognised blocked-punt resolution")
    return None, None


def main():
    sums = load_sums(RAW_DIR)
    sources = {}
    records = []
    failures = []
    for year in SEASONS:
        name = f"play_by_play_{year}.parquet"
        digest = sha256(os.path.join(RAW_DIR, name))
        if digest != sums[name]:
            raise SystemExit(f"hash mismatch for {name}")
        sources[name] = digest
        df = pd.read_parquet(os.path.join(RAW_DIR, name))
        blocked = df[(df.season_type == "REG") & (df.punt_blocked == 1)]
        for _, row in blocked.iterrows():
            errors = []
            if "BLOCKED" not in str(row["desc"]).upper():
                errors.append("punt_blocked flag without BLOCKED in description")
            outcome, spot = classify(row, errors)
            rec = {
                "season": year,
                "game_id": row["game_id"],
                "play_id": int(row["play_id"]),
                "punting_team": row["posteam"],
                "receiving_team": row["defteam"],
                "outcome": outcome,
                "ball_spot_text": spot.group(0) if spot else None,
                "ball_spot_team": spot.group(1) if spot else None,
                "ball_spot_yard_line": int(spot.group(2)) if spot else None,
                "desc": str(row["desc"]),
            }
            if errors or outcome is None:
                failures.append({"game_id": rec["game_id"], "play_id": rec["play_id"], "errors": errors})
            records.append(rec)
    if failures:
        print(json.dumps(failures, indent=1))
        raise SystemExit(f"{len(failures)} blocked punt(s) failed validation; nothing written")

    counts = {k: sum(1 for r in records if r["outcome"] == k) for k in OUTCOMES}
    per_season = {str(y): sum(1 for r in records if r["season"] == y) for y in SEASONS}
    out = {
        "schema_version": "gridiron.blocked-punts-pooled.v1",
        "model_version": MODEL_VERSION,
        "provenance": "nflverse play_by_play_{2022..2025}.parquet, SHA-256 verified against SHA256SUMS; regular season punt_blocked==1; each record classified from its description and checked against posteam/defteam and flags",
        "seasons": SEASONS,
        "season_type": "REG",
        "sources": sources,
        "per_season_counts": per_season,
        "outcome_counts": counts,
        "scope": "Pooled 2022-2025 regular-season blocked punts. Empirical sampling weights for the outcome given a blocked punt; not predictive probabilities.",
        "records": records,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(json.dumps({"per_season": per_season, "outcomes": counts, "total": len(records)}))


if __name__ == "__main__":
    main()
