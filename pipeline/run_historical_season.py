"""Build one historical season (2022 to 2024) with the pinned team-season builder, then export its observations.

Usage: python3 pipeline/run_historical_season.py <season> <absolute output dir outside this repository>

build_research loops over bp.RESEARCH_SEASONS and frees each season's rows before the next, so one season per process
keeps the peak to one season's PBP rows. build_research rewrites BUILD-REPORT.md and build_manifest.json on every run,
so each season's copies are renamed as they finish.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_playbooks as bp  # noqa: E402
import build_historical_playbooks as hb  # noqa: E402

ALLOWED = (2022, 2023, 2024)


def main(argv):
    season = int(argv[1])
    if season not in ALLOWED:
        raise SystemExit(f"season {season} is outside the 2022-2024 historical range")
    if season not in bp.RESEARCH_SOURCE_PINS:
        raise SystemExit(f"no source pin for {season}")
    bp.RESEARCH_SEASONS = (season,)
    hb.HISTORICAL_SEASONS = (season,)
    dest = hb.validate_output_dir(argv[2])
    dest.mkdir(parents=True, exist_ok=True)

    bp.build_research(str(dest))
    exports = hb.export_observations(dest, (season,))

    # The manifest name avoids the "-<season>.json" suffix that playbook_prior.load globs for team files.
    for name, keep in (("BUILD-REPORT.md", f"BUILD-REPORT-{season}.md"),
                       ("build_manifest.json", f"build-manifest.{season}.json")):
        shutil.move(os.path.join(dest, name), os.path.join(dest, keep))

    print(json.dumps({"season": season, "output_dir": str(dest), "observations": exports}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)
