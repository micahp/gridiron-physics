"""Generate all six 2026 Week 7 matchup assets using the existing, pinned
Gridiron 35-attribute rating pipeline and team-playbook builder.

This does NOT assert official gameday actives. The nflverse week-7 roster is a
pregame membership/projection only; absent inactive reports are unresolved.
Run from repository root after fetch_prototype_data.py has populated data/raw.
"""
from __future__ import annotations
import datetime as dt
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import build_matchup_snapshot as roster_builder
import build_playbooks as playbook_builder

TEAMS = {
    "SF": "San Francisco 49ers", "ATL": "Atlanta Falcons",
    "CIN": "Cincinnati Bengals", "BAL": "Baltimore Ravens",
    "TB": "Tampa Bay Buccaneers", "CAR": "Carolina Panthers",
    "MIA": "Miami Dolphins", "NYJ": "New York Jets",
    "GB": "Green Bay Packers", "DET": "Detroit Lions",
    "DAL": "Dallas Cowboys", "PHI": "Philadelphia Eagles",
}
MATCHUPS = [
    {"game_id": "2026_07_SF_ATL", "away": "SF", "home": "ATL", "date": "2026-10-25", "tracking_reference": "2022_06_SF_ATL"},
    {"game_id": "2026_07_CIN_BAL", "away": "CIN", "home": "BAL", "date": "2026-10-25", "tracking_reference": "2022_05_CIN_BAL"},
    {"game_id": "2026_07_TB_CAR", "away": "TB", "home": "CAR", "date": "2026-10-25", "tracking_reference": "2022_07_TB_CAR"},
    {"game_id": "2026_07_MIA_NYJ", "away": "MIA", "home": "NYJ", "date": "2026-10-25", "tracking_reference": "2022_05_MIA_NYJ"},
    {"game_id": "2026_07_GB_DET", "away": "GB", "home": "DET", "date": "2026-10-25", "tracking_reference": "2022_09_GB_DET"},
    {"game_id": "2026_07_DAL_PHI", "away": "DAL", "home": "PHI", "date": "2026-10-26", "tracking_reference": "2022_06_DAL_PHI"},
]
OUT = ROOT / "data" / "teams" / "week7-six-2026-10-24.json"

def main():
    # Reuse the existing audited calculators instead of inventing ratings.
    # All mutable module constants are used only by this one CLI invocation.
    roster_builder.TEAMS = dict(TEAMS)
    roster_builder.TARGET = dt.date(2026, 10, 24)
    roster_builder.INACTIVES = {team: [] for team in TEAMS}  # No invented gameday inactive names.
    roster_builder.OUT = str(OUT)
    roster_builder.main()

    obj = json.loads(OUT.read_text(encoding="utf-8"))
    obj["snapshot"] = {
        "snapshot_date": "2026-10-24",
        "source_cutoff": "2026 regular-season week 7 roster / stats through week 6",
        "as_of_verified": False,
        "gameday_inactives_verified": False,
        "availability_note": "ACT in the week-7 roster is a projection, not confirmation of gameday eligibility. No unverified inactive name has been guessed.",
    }
    obj.pop("venue", None)  # Venue is matchup-specific, not NE/CHI.
    obj["matchups"] = MATCHUPS
    obj["sources"]["inactives"] = {
        "status": "unverified_for_six_matchups",
        "note": "No six-game official inactive reports were joined. Do not imply a confirmed active 53.",
    }
    obj["sources"].pop("official_team_rosters", None)  # NE/CHI-specific links
    for team in obj["teams"].values():
        team["official_inactives_verified"] = False
        team["roster_status_note"] = "Projected available from nflverse roster, not confirmed gameday active."
        for p in team["roster"]:
            p["official_game_inactive"] = None
            p["availability_certainty"] = "unverified_gameday_inactives"
    OUT.write_text(json.dumps(obj, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    playbook_builder.TEAMS = dict(TEAMS)
    playbook_builder.main()
    for code in TEAMS:
        file = ROOT / "data" / "playbooks" / f"{code}-2025.json"
        result = json.loads(file.read_text(encoding="utf-8"))
        if not result["offense"]["play_candidates"]["run"]["candidates"] or not result["offense"]["play_candidates"]["pass"]["candidates"]:
            raise ValueError(f"{code} has no selectable run/pass catalog")
        if not obj["teams"][code]["roster"]:
            raise ValueError(f"{code} has no roster snapshot")
        print(f"READY {code}: {len(obj['teams'][code]['roster'])} players, 2025 run/pass candidates")
    print(f"Wrote {OUT} and 12 playbook profiles. These remain experimental pregame inputs.")

if __name__ == "__main__":
    main()
