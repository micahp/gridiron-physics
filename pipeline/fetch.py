"""Download every public input the pipeline needs.

ESPN (unofficial public JSON endpoints):
  * site API summary  -> drives, play text, clock, box score
  * core API plays    -> per-play participants (passer, rusher, tackler, ...)
  * rosters           -> height, weight, age, experience, position
  * depth charts      -> starters per formation slot
nflverse (CC-BY public data, github.com/nflverse/nflverse-data):
  * play_by_play      -> air yards, YAC, run gap, pass location, kick distance
  * players           -> ESPN id <-> GSIS id <-> PFR id crosswalk, draft slot
  * combine           -> 40 / bench / vertical / broad / 3-cone / shuttle
  * stats_player      -> 2025 season + 2026 weekly production for skill ratings

Usage: python3 pipeline/fetch.py [--event 401872995] [--season 2026]
"""
import argparse
import json
import os
import re
import urllib.request

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"


def get(url, dest):
    path = os.path.join(RAW, dest)
    print(f"  {dest:<34} <- {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "gridiron-physics/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", default="401872995")  # SEA @ DEN, 2026-10-15
    ap.add_argument("--season", default="2026")
    a = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)

    summary = json.load(open(get(f"{SITE}/summary?event={a.event}", "summary.json")))
    get(f"{CORE}/events/{a.event}/competitions/{a.event}/plays?limit=500", "core_plays.json")
    for comp in summary["header"]["competitions"][0]["competitors"]:
        abbr, tid = comp["team"]["abbreviation"], comp["team"]["id"]
        get(f"{SITE}/teams/{abbr}/roster", f"roster_{abbr}.json")
        get(f"{SITE}/teams/{abbr}", f"team_{abbr}.json")
        get(f"{CORE}/seasons/{a.season}/teams/{tid}/depthcharts", f"depth_{tid}.json")

    prev = int(a.season) - 1
    get(f"{NFLVERSE}/pbp/play_by_play_{a.season}.csv.gz", f"pbp_{a.season}.csv.gz")
    get(f"{NFLVERSE}/players/players.csv", "players.csv")
    get(f"{NFLVERSE}/combine/combine.csv", "combine.csv")
    get(f"{NFLVERSE}/stats_player/stats_player_reg_{prev}.csv", f"stats_player_reg_{prev}.csv")
    get(f"{NFLVERSE}/stats_player/stats_player_week_{a.season}.csv", f"stats_player_week_{a.season}.csv")


if __name__ == "__main__":
    main()
