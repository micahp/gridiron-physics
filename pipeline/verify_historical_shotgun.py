"""Recheck the 2022 to 2024 shotgun hierarchy and the revised R1 gate on the built population.

For one season, recomputes every eligible offense play's hierarchy value and source from the pinned PBP, FTN and
participation inputs and compares it with shotgun-provenance-<season>.jsonl. Any mismatch or missing row fails. Then
computes FTN-vs-participation agreement per team-season over that population (revised R1) and sets it beside the
committed Gate 3 team table. Reads inputs and the build directory, writes one JSON file.

With a rev3 profile directory, also compares value and source on every play shared with the committed rev3 profiles,
and counts the plays on either side that the other does not have.

Usage: python3 pipeline/verify_historical_shotgun.py <season> <build dir> <output json> [rev3 profile dir]
"""
import csv
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_playbooks as bp  # noqa: E402

ALLOWED = (2022, 2023, 2024)
GATE = os.path.join(os.path.dirname(HERE), "data", "playbooks", "research-2026-10-28-gate3-shotgun-reconciliation",
                    "team_season_sources.csv")
R1_THRESHOLD = 0.99


def rev3_shotgun(season, rev3_dir):
    suffix = f"-{season}.json"
    rev = {}
    for name in sorted(os.listdir(rev3_dir)):
        if not name.endswith(suffix):
            continue
        team = name[: -len(suffix)]
        with open(os.path.join(rev3_dir, name), encoding="utf-8") as stream:
            profile = json.load(stream)["offense"]["profile"]
        values = {}
        for cat, value in profile["shotgun"]["categories"].items():
            for sid in value.get("source_ids", []):
                values[(team, sid["game_id"], bp.play_id(sid["play_id"]))] = cat == "True"
        for cat, value in profile["shotgun_source"]["categories"].items():
            for sid in value.get("source_ids", []):
                key = (team, sid["game_id"], bp.play_id(sid["play_id"]))
                rev[key] = (values[key], cat)
    return rev


def main(argv):
    season = int(argv[1])
    if season not in ALLOWED:
        raise SystemExit(f"season {season} is outside 2022-2024")
    build_dir, out_path = argv[2], argv[3]
    rev3_dir = argv[4] if len(argv) > 4 else None
    pbp_path = os.path.join(bp.RAW, bp.RESEARCH_PBP_FILES[season])
    ftn_path = os.path.join(bp.RAW, bp.RESEARCH_FTN_FILES[season])
    part_path = os.path.join(bp.RAW, bp.RESEARCH_PART_FILES[season])
    pins = bp.RESEARCH_SOURCE_PINS[season]
    hashes = {}
    for key, path in (("pbp", pbp_path), ("participation", part_path), ("ftn_charting", ftn_path)):
        hashes[key] = bp.sha256(path)
        if hashes[key] != (pins.get(key) or {}).get("sha256"):
            raise SystemExit(f"{season} {key} input differs from its source pin")

    population = {}
    with open(os.path.join(build_dir, f"shotgun-provenance-{season}.jsonl"), encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            population[(row["team"], row["game_id"], bp.play_id(row["play_id"]))] = row

    ftn_idx = bp.ftn_index(bp.open_rows(ftn_path), season, max_week=18)
    part_idx = bp.participation_index(bp.open_rows(part_path))
    ftn_games = {key[0] for key in ftn_idx}
    stats = {"population_rows": len(population), "matched": 0, "hierarchy_mismatch": 0,
             "outside_population_scrimmage": 0, "r1_plays_with_both_values": 0}
    rev3 = rev3_shotgun(season, rev3_dir) if rev3_dir else {}
    rev3_only_pbp = Counter()
    seen = set()
    agreement = defaultdict(lambda: [0, 0])
    for r in bp.open_rows(pbp_path):
        if bp.clean_int(r.get("season")) != season or r.get("season_type") != "REG":
            continue
        week = bp.clean_int(r.get("week"))
        if week is None or week > 18 or not bp.is_scrimmage(r):
            continue
        team = r.get("posteam")
        game = r.get("game_id") or ""
        play = bp.play_id(r.get("play_id"))
        key = (team, game, play)
        part = part_idx.get((r.get("old_game_id") or game, play))
        ftn = ftn_idx.get((game, play))
        r["_ftn"] = ftn
        r["_ftn_game_charted"] = game in ftn_games
        hierarchy, source = bp.shotgun_with_source(r, part)
        if key not in population:
            stats["outside_population_scrimmage"] += 1
            if key in rev3:
                rev3_only_pbp[f"{r.get('play_type')}, two_point={r.get('two_point_attempt')}, fumble={r.get('fumble')}"] += 1
            continue
        seen.add(key)
        expected = population[key]
        if hierarchy == expected["shotgun_hierarchy"] and source == expected["shotgun_source"]:
            stats["matched"] += 1
        else:
            stats["hierarchy_mismatch"] += 1
        q = (ftn or {}).get("qb_location")
        ftn_value = True if q in ("S", "P") else False if q == "U" else None
        part_value = bp.participation_shotgun_equivalent((part or {}).get("offense_formation"), season) if part else None
        if ftn_value is not None and part_value is not None:
            stats["r1_plays_with_both_values"] += 1
            agreement[team][0] += 1
            agreement[team][1] += ftn_value == part_value
    stats["population_rows_not_found"] = len(set(population) - seen)
    if stats["hierarchy_mismatch"] or stats["population_rows_not_found"]:
        raise SystemExit(f"{season}: per-play check failed: {stats}")
    if rev3_dir:
        shared = [key for key in population if key in rev3]
        rev3_not_population = set(rev3) - set(population)
        stats["rev3"] = {
            "shared": len(shared),
            "value_mismatch": sum(rev3[key][0] != population[key]["shotgun_hierarchy"] for key in shared),
            "source_mismatch": sum(rev3[key][1] != population[key]["shotgun_source"] for key in shared),
            "population_not_in_rev3": len(set(population) - set(rev3)),
            "rev3_not_in_population": len(rev3_not_population),
            "rev3_not_in_population_unclassified": len(rev3_not_population) - sum(rev3_only_pbp.values()),
            "rev3_not_in_population_by_pbp_class": dict(sorted(rev3_only_pbp.items())),
        }
        if stats["rev3"]["value_mismatch"] or stats["rev3"]["source_mismatch"]:
            raise SystemExit(f"{season}: rev3 shared plays disagree: {stats['rev3']}")

    gate = {}
    with open(GATE, newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            if int(row["season"]) == season:
                gate[row["team"]] = row
    if set(gate) != set(agreement):
        raise SystemExit(f"{season}: team sets differ between the population and the Gate 3 table")

    teams = {}
    for team in sorted(gate):
        both, agree = agreement[team]
        teams[team] = {
            "new_both": both, "new_agree": agree,
            "new_rate": round(agree / both, 6) if both else None,
            "gate_both": int(gate[team]["ftn_part_both"]), "gate_agree": int(gate[team]["ftn_part_agree"]),
            "gate_rate": float(gate[team]["ftn_part_agreement"]),
        }
    below = sorted(team for team, row in teams.items() if row["new_rate"] is None or row["new_rate"] < R1_THRESHOLD)
    gate_below = sorted(team for team, row in teams.items() if row["gate_rate"] < R1_THRESHOLD)
    result = {
        "season": season, "inputs_sha256": hashes, "stats": stats,
        "r1_threshold": R1_THRESHOLD, "r1_below_new_population": below, "r1_below_gate3": gate_below,
        "r1_denominators_no_larger_than_gate3": all(row["new_both"] <= row["gate_both"] for row in teams.values()),
        "teams": teams,
    }
    with open(out_path, "w", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps({k: result[k] for k in ("season", "stats", "r1_below_new_population", "r1_below_gate3",
                                             "r1_denominators_no_larger_than_gate3")}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)
