"""Per-play shotgun provenance sidecars for the historical team-season playbooks (2022 to 2024).

For each eligible offense play in a team-season profile, writes one JSONL row with the value and source that the
builder's hierarchy assigned (FTN, participation, or the PBP flag in FTN-charted games), the PBP flag, and whether
the two disagree. Profiles and observation streams are read, never written. Consumers that use a shotgun feature
should join on (game_id, play_id) and exclude or label rows with shotgun_source "pbp_flag" or
shotgun_pbp_flag_disagrees.

Usage: python3 pipeline/build_shotgun_provenance.py --profile-dir <historical build dir> [--seasons 2022 2023 2024]
"""
import argparse
import glob
import json
import os

SEASONS = (2022, 2023, 2024)


def keyed(categories):
    out = {}
    for cat, value in categories.items():
        for sid in value.get("source_ids", []):
            out[(sid["game_id"], str(sid["play_id"]))] = (cat, sid)
    return out


def team_rows(path, season, team):
    profile = json.load(open(path, encoding="utf-8"))["offense"]["profile"]
    hierarchy = keyed(profile["shotgun"]["categories"])
    source = keyed(profile["shotgun_source"]["categories"])
    pbp = keyed(profile["shotgun_pbp_flag"]["categories"])
    eligible = profile["eligible_scrimmage_plays"]
    if not len(hierarchy) == len(source) == eligible:
        raise ValueError(f"{path}: hierarchy {len(hierarchy)}, source {len(source)}, eligible {eligible} disagree")
    rows = []
    for key, (src_cat, sid) in sorted(source.items()):
        if key not in hierarchy or key not in pbp:
            raise ValueError(f"{path}: play {key} is missing from a shotgun category")
        value = hierarchy[key][0] == "True"
        flag = pbp[key][0] == "True"
        rows.append({
            "season": season,
            "team": team,
            "game_id": key[0],
            "old_game_id": sid["old_game_id"],
            "play_id": key[1],
            "shotgun_hierarchy": value,
            "shotgun_source": src_cat,
            "shotgun_pbp_flag": flag,
            "shotgun_pbp_flag_disagrees": value != flag,
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--profile-dir", required=True)
    parser.add_argument("--seasons", type=int, nargs="+", default=list(SEASONS))
    args = parser.parse_args()
    for season in args.seasons:
        if season not in SEASONS:
            raise SystemExit(f"season {season} is outside 2022-2024")
    summary = {}
    for season in args.seasons:
        out_path = os.path.join(args.profile_dir, f"shotgun-provenance-{season}.jsonl")
        counts = {"plays": 0, "by_source": {}, "pbp_flag_disagrees": 0, "disagrees_by_source": {}}
        suffix = f"-{season}.json"
        paths = sorted(p for p in glob.glob(os.path.join(args.profile_dir, f"*{suffix}"))
                       if not os.path.basename(p).startswith("build"))
        if len(paths) != 32:
            raise SystemExit(f"season {season}: expected 32 team-season profiles, found {len(paths)}")
        temp = out_path + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="") as stream:
            for path in paths:
                team = os.path.basename(path)[: -len(suffix)]
                for row in team_rows(path, season, team):
                    stream.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    counts["plays"] += 1
                    src = row["shotgun_source"]
                    counts["by_source"][src] = counts["by_source"].get(src, 0) + 1
                    if row["shotgun_pbp_flag_disagrees"]:
                        counts["pbp_flag_disagrees"] += 1
                        counts["disagrees_by_source"][src] = counts["disagrees_by_source"].get(src, 0) + 1
        os.replace(temp, out_path)
        summary[str(season)] = counts
    summary_path = os.path.join(args.profile_dir, "shotgun-provenance-summary.json")
    with open(summary_path, "w", encoding="utf-8") as stream:
        json.dump(summary, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
