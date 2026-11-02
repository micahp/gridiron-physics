"""Compact C/D/E prior counts for one historical build (2022 to 2024), for versioned distribution.

For each team-season profile this applies the playbook prior's labelling rule and cell rule, and writes counts only:
team_id, season, cell, family and label, with n. No play IDs, source IDs or observed-play attributes are written. The
consumer must reproduce the full loader's table from these counts; the slc-v1 test test_playbook_prior_compact.py checks
that digest for each cutoff.

Usage: python3 pipeline/build_cde_prior.py <build dir> <output json>
"""
import glob
import hashlib
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SEASONS = (2022, 2023, 2024)
PASS_LABELS = {"D": ("short", "deep"), "E": ("left", "middle", "right")}
RUN_LABELS = {"C": ("guard", "tackle", "end")}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def cell_of(down, togo, yl):
    dist = "short" if togo <= 3 else ("medium" if togo <= 7 else "long")
    zone = "red" if yl <= 20 else "other"
    return f"{int(down)}|{dist}|{zone}"


def labels_of(a):
    labels = {}
    if a.get("play_type") == "pass":
        if a.get("pass_length") in PASS_LABELS["D"]:
            labels["D"] = a["pass_length"]
        if a.get("pass_location") in PASS_LABELS["E"]:
            labels["E"] = a["pass_location"]
    elif a.get("play_type") == "run" and a.get("run_gap") in RUN_LABELS["C"]:
        labels["C"] = a["run_gap"]
    return labels


def main(argv):
    build_dir, out_path = argv[1], argv[2]
    counts = {}
    totals = {}
    sources = []
    for season in SEASONS:
        suffix = f"-{season}.json"
        paths = sorted(p for p in glob.glob(os.path.join(build_dir, f"*{suffix}"))
                       if not os.path.basename(p).startswith("build"))
        if len(paths) != 32:
            raise SystemExit(f"season {season}: expected 32 team-season profiles, found {len(paths)}")
        season_totals = Counter()
        season_counts = defaultdict(lambda: defaultdict(Counter))
        for path in paths:
            with open(path, encoding="utf-8") as stream:
                playbook = json.load(stream)
            team_id = playbook["team_id"]
            sources.append({"file": os.path.basename(path), "sha256": sha256(path)})
            for play in playbook["offense"]["observed_plays"]:
                a = play["attributes"]
                if not (a.get("down") and a.get("ydstogo") and a.get("yardline_100")):
                    continue
                labels = labels_of(a)
                if not labels:
                    continue
                cell = cell_of(int(a["down"]), int(a["ydstogo"]), int(float(a["yardline_100"])))
                for family, value in labels.items():
                    season_counts[(team_id, cell)][family][value] += 1
                    season_totals[family] += 1
        counts[str(season)] = {
            team: {cell: {fam: dict(sorted(c.items())) for fam, c in fams.items()}
                   for (t, cell), fams in season_counts.items() if t == team}
            for team in sorted({t for t, _ in season_counts})
        }
        totals[str(season)] = dict(sorted(season_totals.items()))

    provenance = {
        "builder_file": "pipeline/build_cde_prior.py",
        "builder_file_sha256": sha256(os.path.join(HERE, "build_cde_prior.py")),
        "builder_commit": subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True,
                                         text=True, check=True).stdout.strip(),
        "source_profiles": sources,
    }
    artifact = {
        "artifact": "historical-cde-prior",
        "schema_version": 1,
        "seasons": list(SEASONS),
        "team_key": "profile team_id, raw; the consumer maps it with its own team-code rule",
        "cell_rule": "down | distance band (short <= 3, medium <= 7, long) | red zone (yardline_100 <= 20, else other)",
        "families": {"C": "run gap (guard, tackle, end)", "D": "pass depth (short, deep)",
                     "E": "pass location (left, middle, right)"},
        "totals": totals,
        "counts": counts,
        "provenance": provenance,
    }
    with open(out_path, "w", encoding="utf-8") as stream:
        json.dump(artifact, stream, indent=1, sort_keys=True)
        stream.write("\n")
    print(json.dumps({"out": out_path, "bytes": os.path.getsize(out_path), "sha256": sha256(out_path),
                      "totals": totals}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)
