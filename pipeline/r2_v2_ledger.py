"""R2 v2 exclusion ledger for one historical season (2022 to 2024).

Compares three sets of run and pass snaps: the Gate 3 eligible offense plays (every event class), the ordinary-offense
population in the build's shotgun provenance, and the plays in the committed rev3 profiles. Every play in a difference
is written with its builder event class as the reason. An ordinary play missing from the population, a population play
the builder does not class as "scrimmage", or a population play outside the eligible set is an unexplained difference
and fails the run.

Usage: python3 pipeline/r2_v2_ledger.py <season> <build dir> <rev3 profile dir> <output csv>
"""
import csv
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_playbooks as bp  # noqa: E402
from verify_historical_shotgun import rev3_shotgun  # noqa: E402

ALLOWED = (2022, 2023, 2024)
FIELDS = ("season", "team", "game_id", "play_id", "direction", "snap_type", "reason")


def main(argv):
    season = int(argv[1])
    if season not in ALLOWED:
        raise SystemExit(f"season {season} is outside 2022-2024")
    build_dir, rev3_dir, out_path = argv[2], argv[3], argv[4]
    population = set()
    with open(os.path.join(build_dir, f"shotgun-provenance-{season}.jsonl"), encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            population.add((row["team"], row["game_id"], bp.play_id(row["play_id"])))
    rev3 = set(rev3_shotgun(season, rev3_dir))
    part_idx = bp.participation_index(bp.open_rows(os.path.join(bp.RAW, bp.RESEARCH_PART_FILES[season])))
    eligible = {}
    for r in bp.open_rows(os.path.join(bp.RAW, bp.RESEARCH_PBP_FILES[season])):
        if bp.clean_int(r.get("season")) != season or r.get("season_type") != "REG":
            continue
        week = bp.clean_int(r.get("week"))
        if week is None or week > 18 or not bp.is_scrimmage(r):
            continue
        game = r.get("game_id") or ""
        play = bp.play_id(r.get("play_id"))
        part = part_idx.get((r.get("old_game_id") or game, play))
        snap, origin, execution = bp.event_class(r)
        if snap != bp.snap_kind({"pbp": r, "participation": part}):
            raise SystemExit(f"{season} {game} {play}: event_class and snap_kind disagree")
        reason = ":".join(x for x in (snap, origin, execution) if x)
        eligible[(r.get("posteam"), game, play)] = (snap, reason)

    rows, unexplained = [], []
    for key in sorted(set(eligible) | population | rev3, key=repr):
        team, game, play = key
        snap, reason = eligible.get(key, ("not_eligible", "not_eligible"))
        in_pop, in_rev3 = key in population, key in rev3
        if in_pop and snap != "scrimmage":
            unexplained.append(("population_not_scrimmage", key, snap))
        if in_pop and key not in eligible:
            unexplained.append(("population_not_eligible", key, snap))
        if snap == "scrimmage" and not in_pop:
            unexplained.append(("ordinary_missing_from_population", key, snap))
        if in_rev3 and snap == "not_eligible":
            unexplained.append(("rev3_not_eligible", key, snap))
        if in_pop and not in_rev3:
            unexplained.append(("population_not_in_rev3", key, snap))
        if in_pop or (not in_rev3 and not in_pop and snap == "not_eligible"):
            continue
        direction = "excluded_from_ordinary_and_rev3" if in_rev3 else "excluded_from_ordinary_gate3_only"
        rows.append({"season": season, "team": team, "game_id": game, "play_id": play,
                     "direction": direction, "snap_type": snap, "reason": reason})
    if unexplained:
        raise SystemExit(f"{season}: unexplained differences: {unexplained[:10]} (total {len(unexplained)})")

    with open(out_path, "w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda r: (r["team"], r["game_id"], r["play_id"])))
    summary = {
        "season": season, "ordinary_population": len(population), "gate3_eligible": len(eligible),
        "rev3_profile_plays": len(rev3), "ledger_rows": len(rows), "unexplained": 0,
        "by_direction": dict(sorted(Counter(r["direction"] for r in rows).items())),
        "by_reason": dict(sorted(Counter(r["reason"] for r in rows).items())),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)
