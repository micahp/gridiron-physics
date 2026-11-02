import csv
import gzip
import hashlib
import json
import os
import shutil
import sys
import urllib.request
from collections import defaultdict
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ratings
from build_matchup_snapshot import age_on, as_int, default_confidence, position_code, rows

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
NFLVERSE = os.path.join(RAW, "nflverse")
OUT = os.path.join(ROOT, "data", "teams", "league-ratings-2026-week7.rebuilt.json")
SNAPSHOT_DATE = dt.date(2026, 10, 24)
NFLVERSE_URL = "https://github.com/nflverse/nflverse-data/releases/download"

INPUTS = {
    "roster_2026": (f"{NFLVERSE_URL}/weekly_rosters/roster_weekly_2026.csv.gz", "roster_weekly_2026.csv.gz",
                    "fe0230633233bd1e09e2351ad853e63dc19e7710a332453b648d00ab4776b715"),
    "roster_2025": (f"{NFLVERSE_URL}/weekly_rosters/roster_weekly_2025.csv.gz", "roster_weekly_2025.csv.gz",
                    "f3fbe6bb1b56a0f51c4b6d5793f8bc3b46da2d54c070572144b8771912eeaaec"),
    "stats_2025": (f"{NFLVERSE_URL}/stats_player/stats_player_reg_2025.csv.gz", "stats_player_reg_2025.csv.gz",
                   "fdef6a98e9de7200aaf062d20d2a35831096d7424f43bbfad5d1881e00d3a9d8"),
    "stats_2026": (f"{NFLVERSE_URL}/stats_player/stats_player_week_2026.csv.gz", "stats_player_week_2026.csv.gz",
                   "a3c260c4d69fadb500d50d56cf69715b5936891d8c0a1dd6d5639f55b0c1d036"),
    "players": (f"{NFLVERSE_URL}/players/players.csv", "players.csv",
                "4b1e03631bbbd4341088efd2618a89916a9486623f4b022b8c0b077a1d451c02"),
    "combine": (f"{NFLVERSE_URL}/combine/combine.csv", "combine.csv",
                "5648886b1bb9de8a0c42b05ee7b1d9cbe58897676caaa2f6a4a3d3c9228235bb"),
}

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens", "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers", "CHI": "Chicago Bears", "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys", "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars", "KC": "Kansas City Chiefs",
    "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers", "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings", "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers", "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers", "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}
NO_WEEK7_ROWS = "no 2026 week-7 regular-season roster rows in the nflverse weekly roster file"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fetch_inputs():
    os.makedirs(NFLVERSE, exist_ok=True)
    paths, shas = {}, {}
    for key, (url, name, pinned) in INPUTS.items():
        path = os.path.join(NFLVERSE, name)
        if not os.path.isfile(path):
            urllib.request.urlretrieve(url, path)
        paths[key] = path
        shas[key] = sha256(path)
        if shas[key] != pinned:
            print(f"{key}: sha256 differs from the value recorded in the previous build")
    for key, name in (("stats_2025", "stats_player_reg_2025.csv"), ("stats_2026", "stats_player_week_2026.csv")):
        with gzip.open(paths[key], "rb") as fin, open(os.path.join(RAW, name), "wb") as fout:
            shutil.copyfileobj(fin, fout)
    return paths, shas


# build roster data
def build_roster_data(paths):
    week7 = [r for r in rows(paths["roster_2026"])
             if r.get("season") == "2026" and r.get("week") == "7" and r.get("game_type") == "REG"]
    final25 = [r for r in rows(paths["roster_2025"])
               if r.get("season") == "2025" and r.get("week") == "18" and r.get("game_type") == "REG" and r.get("gsis_id")]
    players = {r["gsis_id"]: r for r in rows(paths["players"]) if r.get("gsis_id")}
    return week7, final25, players


# build ratings data
def build_ratings_data(paths, week7, players):
    ratings.SEASON = 2026
    ratings.GAME_WEEK = 7
    combine_rows = list(rows(paths["combine"]))
    combine_by_pfr = {r["pfr_id"]: r for r in combine_rows if r.get("pfr_id")}
    combine_by_name = defaultdict(list)
    for r in combine_rows:
        combine_by_name[r["player_name"].lower()].append(r)
    cm = ratings.CombineModel(combine_rows)
    stats, pos_of = ratings.load_stats()
    sm = ratings.SkillModel(stats, pos_of)

    def player_base(r):
        x = players.get(r.get("gsis_id"), {})
        weight = ratings.num(r.get("weight")) or ratings.num(x.get("weight")) or 220
        height = ratings.height_in(r.get("height")) or ratings.height_in(x.get("height")) or 74
        pos = x.get("position") or position_code(r) or "LB"
        name = r.get("full_name") or x.get("display_name") or "Unknown"
        pfr = r.get("pfr_id") or x.get("pfr_id")
        comb = combine_by_pfr.get(pfr)
        if not comb:
            cands = [c for c in combine_by_name.get(name.lower(), [])
                     if not r.get("entry_year") or c.get("draft_year") in ("", r.get("entry_year"))]
            comb = cands[0] if len(cands) == 1 else None
        combine = {d: ratings.num(comb[d]) for d in ratings.DRILLS if comb and ratings.num(comb.get(d)) is not None}
        gsis = r.get("gsis_id")
        st = stats.get(gsis)
        rush = None
        if st and st.get("games", 0) >= 4:
            rush = (st.get("def_sacks", 0) + 0.5 * st.get("def_qb_hits", 0)) / st["games"]
        return {
            "pos": pos, "group": ratings.group_of(pos, weight, rush), "name": name, "height_in": height,
            "weight_lb": weight, "age": age_on(r.get("birth_date"), SNAPSHOT_DATE),
            "experience": as_int(r.get("years_exp")) or 0, "gsis": gsis, "combine": combine,
            "draft_round": as_int(x.get("draft_round")),
            "draft_pick": as_int(x.get("draft_pick")) or as_int(r.get("draft_number")),
        }

    rated, league_raw = {}, []
    for r in week7:
        if r.get("status") != "ACT":
            continue
        p = ratings.rate(player_base(r), cm, sm)
        rated[r["gsis_id"]] = p
        league_raw.append((p["group"], p["ovr_raw"]))
    calib = ratings.OvrCalibration(league_raw)
    for p in rated.values():
        p["ovr"] = calib(p["group"], p["ovr_raw"])

    def profile(r):
        if r["gsis_id"] in rated:
            return rated[r["gsis_id"]]
        base = player_base(r)
        ph, phy, meas, imputed, _, t10 = ratings.physical_profile(base, cm)
        skills, skill_conf = ratings.skill_ratings(base, sm, phy, {d: 0 for d in ratings.DRILLS})
        attrs = {**skills, **phy}
        return {**base, "ratings": dict(sorted(attrs.items())), "physics": ph, "measurables": meas,
                "imputed_drills": imputed, "t10": round(t10, 3), "confidence": skill_conf,
                "ovr": None, "ovr_raw": None}

    return profile


def team_roster(team, week7, profile):
    roster = []
    for r in sorted((z for z in week7 if z.get("team") == team), key=lambda z: (z.get("position", ""), z.get("full_name", ""))):
        p = profile(r)
        active = r.get("status") == "ACT"
        roster.append({
            "id": r["gsis_id"], "gsis_id": r["gsis_id"], "espn_id": r.get("espn_id") or None,
            "team_id": team, "name": r.get("full_name"), "position": r.get("position"),
            "depth_chart_position": r.get("depth_chart_position") or None,
            "rating_position": p["pos"], "rating_group": p["group"],
            "eligible_roles": sorted(set([p["group"], (r.get("depth_chart_position") or "").upper(),
                                          (r.get("position") or "").upper()]) - {""}),
            "jersey": r.get("jersey_number") or None, "height_in": p["height_in"],
            "weight_lb": p["weight_lb"], "birth_date": r.get("birth_date") or None,
            "age_on_snapshot_date": p.get("age"), "experience_years": p["experience"],
            "college": r.get("college") or None, "headshot_url": r.get("headshot_url") or None,
            "status": r.get("status"), "availability": "available" if active else "unavailable_roster_status",
            "official_game_inactive": False,
            "source": {"roster_release": "nflverse weekly_rosters 2026, week 7 REG",
                       "rating_season": "2025 REG + 2026 REG weeks 1-6", "rating_method": "pipeline/ratings.py"},
            "ratings": p["ratings"],
            "rating_confidence_by_attribute": default_confidence(p, p.get("confidence", {})),
            "overall_estimate": p.get("ovr"), "physics": p["physics"],
            "measurables": p["measurables"], "imputed_combine_drills": p["imputed_drills"],
            "measurable_source": "nflverse combine if matched; otherwise position/body regression in ratings.py",
        })
    return roster


def main():
    paths, shas = fetch_inputs()
    week7, final25, players = build_roster_data(paths)
    profile = build_ratings_data(paths, week7, players)
    present = sorted({r["team"] for r in week7 if r.get("team") in TEAM_NAMES})
    excluded = {t: NO_WEEK7_ROWS for t in sorted(TEAM_NAMES) if t not in present}
    old_team_by_id = {r["gsis_id"]: r.get("team") for r in final25}
    teams, changes = {}, {}
    for team in present:
        roster = team_roster(team, week7, profile)
        current_ids = {p["id"] for p in roster}
        prior_ids = {r["gsis_id"] for r in final25 if r.get("team") == team}
        changes[team] = {
            "2025_week18_members": len(prior_ids), "2026_week7_roster_members": len(current_ids),
            "added_or_new_to_roster": sorted(current_ids - prior_ids),
            "departed_from_team_roster": sorted(prior_ids - current_ids),
            "moved_from_other_2025_team": sorted(pid for pid in current_ids if old_team_by_id.get(pid) not in (None, team)),
            "method_note": "Roster membership comparison only; it does not classify a move as trade, signing, injury, or release.",
        }
        teams[team] = {
            "team_id": team, "name": TEAM_NAMES[team], "roster_source_week": 7,
            "playbook_ref": f"data/playbooks/{team}-2025.json",
            "official_inactives": [], "official_inactives_verified": False,
            "active_available_count": sum(1 for p in roster if p["availability"] == "available"),
            "roster_status_note": "Complete week-7 roster membership; ACT status is projected availability, not verified game-day inactive clearance. No depth chart join.",
            "roster": roster,
        }
    output = {
        "schema_version": "gridiron.matchup.v1",
        "snapshot": {
            "as_of_verified": False,
            "availability_note": "ACT in the week-7 roster is a projection, not confirmation of gameday eligibility. No unverified inactive name has been guessed.",
            "gameday_inactives_verified": False,
            "excluded_teams": excluded,
            "snapshot_date": SNAPSHOT_DATE.isoformat(),
            "source_cutoff": "2026 regular-season week 7 roster / stats through week 6",
        },
        "sources": {
            "roster_2026": {"url": INPUTS["roster_2026"][0], "sha256": shas["roster_2026"], "week": 7, "phase": "REG"},
            "roster_2025": {"url": INPUTS["roster_2025"][0], "sha256": shas["roster_2025"], "week": 18, "phase": "REG"},
            "stats_2025": {"url": INPUTS["stats_2025"][0], "sha256": shas["stats_2025"]},
            "stats_2026": {"url": INPUTS["stats_2026"][0], "sha256": shas["stats_2026"], "included_weeks": [1, 6]},
            "players": {"url": INPUTS["players"][0], "sha256": shas["players"]},
            "combine": {"url": INPUTS["combine"][0], "sha256": shas["combine"]},
        },
        "rating_method": {
            "framework": "pipeline/ratings.py", "attribute_count": 35,
            "rating_label": "estimated public-research rating; not EA/Madden official ratings or measured tracking",
            "skills": "shrunk position-normalized 2025 + 2026 weeks 1-6 production and draft/experience priors",
            "physical": "combine measurements where joined; otherwise position/body regression; simulator body derived by existing sprint model",
            "ovr_calibration": "active players in nflverse week 7 league roster",
            "uncertainty": "per-attribute evidence confidence and imputed combine input list",
        },
        "roster_changes_vs_2025_week18": changes,
        "teams": teams,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}: {len(teams)} teams, {sum(len(t['roster']) for t in teams.values())} players")


if __name__ == "__main__":
    main()
