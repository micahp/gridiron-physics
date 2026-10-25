#!/usr/bin/env python3
"""Build league-level 2025 special-teams tables from nflverse play-by-play.

Reads data/raw/pbp_2025.csv.gz (hash-checked), regular season only, and writes
data/special_teams/2025-league.json. The simulator samples kick distances,
outcomes and return yards from these counts. They are league rates for the
whole 2025 season, not team or kicker rates.
"""
import collections
import csv
import gzip
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "pbp_2025.csv.gz")
OUT = os.path.join(ROOT, "data", "special_teams", "2025-league.json")
EXPECTED_SHA256 = "2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978"

FG_BUCKETS = [("<30", 0, 30), ("30-39", 30, 40), ("40-49", 40, 50), ("50-59", 50, 60), ("60+", 60, 200)]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pooled_blocked_resolution():
    with open(os.path.join(ROOT, "data", "special_teams", "blocked-punts-2022-2025.json")) as f:
        counts = json.load(f)["outcome_counts"]
    return {k: counts[k] for k in ("receiving_recovery", "kicking_recovery", "out_of_bounds", "safety")}


def pooled_blocked_touchdowns():
    with open(os.path.join(ROOT, "data", "special_teams", "blocked-punts-2022-2025.json")) as f:
        return json.load(f)["receiving_touchdown_counts"]


def main():
    digest = sha256(RAW)
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"hash mismatch for {RAW}: {digest}")

    fg = {name: {"attempts": 0, "made": 0} for name, _, _ in FG_BUCKETS}
    xp = collections.Counter()
    punt_dist = collections.Counter()
    punt_cats = collections.Counter()
    punt_ret = collections.Counter()
    ko_cats = collections.Counter()
    ko_ret = collections.Counter()
    # Touchback sub-split. 2026 Rule 6-1-5: a kick that touches the landing
    # zone before it reaches the end zone is spotted at the receiving team's
    # 20; a kick that reaches the end zone in the air is spotted at its 35.
    ko_tb_zone = 0
    ko_tb_air = 0
    punts = kickoffs = 0
    blocked_res = collections.Counter()

    with gzip.open(RAW, "rt") as f:
        for r in csv.DictReader(f):
            if r["season_type"] != "REG":
                continue
            pt = r["play_type"]
            if pt == "field_goal" and r["field_goal_attempt"] == "1":
                d = num(r["kick_distance"])
                name = next(n for n, lo, hi in FG_BUCKETS if lo <= d < hi)
                fg[name]["attempts"] += 1
                if r["field_goal_result"] == "made":
                    fg[name]["made"] += 1
            elif pt == "extra_point" and r["extra_point_attempt"] == "1":
                xp[r["extra_point_result"] or "unknown"] += 1
            elif pt == "punt" and r["punt_attempt"] == "1" and r["kick_distance"]:
                punts += 1
                punt_dist[int(num(r["kick_distance"]))] += 1
                if r["punt_blocked"] == "1":
                    recovered = re.search(r"recovered by (\w+)-", r["desc"], re.I)
                    if recovered:
                        blocked_res["kicking_recovery" if recovered.group(1) == r["posteam"] else "receiving_recovery"] += 1
                    elif "SAFETY" in r["desc"]:
                        blocked_res["safety"] += 1
                    elif "out of bounds" in r["desc"].lower():
                        blocked_res["out_of_bounds"] += 1
                    else:
                        raise SystemExit(f"unclassified blocked punt {r['game_id']} {r['play_id']}: {r['desc'][:120]}")
                if r["touchback"] == "1":
                    cat = "touchback"
                elif r["punt_fair_catch"] == "1":
                    cat = "fair_catch"
                elif r["punt_downed"] == "1":
                    cat = "downed"
                elif r["punt_out_of_bounds"] == "1":
                    cat = "out_of_bounds"
                elif r["punt_blocked"] == "1":
                    cat = "blocked"
                else:
                    cat = "returned"
                    punt_ret[int(num(r["return_yards"]))] += 1
                punt_cats[cat] += 1
            elif pt == "kickoff" and r["kickoff_attempt"] == "1" and r["kick_distance"]:
                kickoffs += 1
                if r["touchback"] == "1":
                    cat = "touchback"
                    # "to landing zone to end zone" means the kick touched the
                    # landing zone before reaching the end zone (Rule 6-1-5).
                    if "to landing zone" in r["desc"]:
                        ko_tb_zone += 1
                    else:
                        ko_tb_air += 1
                elif r["kickoff_out_of_bounds"] == "1":
                    cat = "out_of_bounds"
                elif r["kickoff_fair_catch"] == "1":
                    cat = "fair_catch"
                elif r["kickoff_downed"] == "1":
                    cat = "downed"
                else:
                    cat = "returned"
                    ko_ret[int(num(r["return_yards"]))] += 1
                ko_cats[cat] += 1

    out = {
        "schema_version": "gridiron.special-teams-league.v1",
        "season": 2025,
        "season_type": "REG",
        "source": {
            "name": "nflverse play_by_play_2025.csv.gz",
            "path": os.path.basename(RAW),
            "sha256": digest,
        },
        "scope": "League-wide 2025 regular-season rates. Not team or kicker rates.",
        "field_goals": {
            "distance_is_yards_to_goal_plus": 18,
            "buckets": [
                {"name": name, "attempts": fg[name]["attempts"], "made": fg[name]["made"]}
                for name, _, _ in FG_BUCKETS
            ],
        },
        "extra_points": dict(xp),
        "punts": {
            "n": punts,
            "distance_yards": {str(k): v for k, v in sorted(punt_dist.items())},
            "outcomes": dict(punt_cats),
            "blocked_resolution": {k: blocked_res[k] for k in ("receiving_recovery", "kicking_recovery", "out_of_bounds", "safety")},
            "blocked_resolution_pooled": pooled_blocked_resolution(),
            "blocked_receiving_touchdown_pooled": pooled_blocked_touchdowns(),
            "return_yards": {str(k): v for k, v in sorted(punt_ret.items())},
        },
        "kickoffs": {
            "n": kickoffs,
            "outcomes": dict(ko_cats),
            "return_yards": {str(k): v for k, v in sorted(ko_ret.items())},
            # Touchback sub-split used to place the spot under 2026 Rule 6-1-5.
            # landing_zone -> receiving team's 20; in_air -> receiving team's 35.
            "touchback_spot": {
                "landing_zone": ko_tb_zone,
                "in_air": ko_tb_air,
            },
        },
    }
    if blocked_res["unclassified"]:
        sys.exit(f"{blocked_res['unclassified']} blocked punts have no recognized resolution; refusing to write {OUT}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT}: punts {punts}, kickoffs {kickoffs}, field goals {sum(b['attempts'] for b in out['field_goals']['buckets'])}")


if __name__ == "__main__":
    main()
