"""Build the frozen pregame NE-CHI roster and public-research rating snapshot."""
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import shutil
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "teams", "matchup-2026-10-22.json")
TARGET = dt.date(2026, 10, 22)
TEAMS = {"NE": "New England Patriots", "CHI": "Chicago Bears"}
INACTIVES = {
    "NE": ["Ben Brown", "Channing Canada", "Carlton Davis III", "Karon Prunty", "Joshua Farmer", "Behren Morton"],
    "CHI": ["Kyle Monangai", "Nick McCloud", "T.J. Edwards", "Jack Sanborn", "Jordan McFadden", "Jayden Loving", "Case Keenum"],
}
INACTIVE_SOURCE = "https://www.patriots.com/news/week-7-inactives-patriots-at-bears-x7631"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def rows(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", newline="", encoding="utf-8-sig") as f:
        yield from csv.DictReader(f)


def as_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def age_on(birth, date):
    try:
        y, m, d = map(int, birth.split("-"))
        return date.year - y - ((date.month, date.day) < (m, d))
    except (AttributeError, ValueError):
        return None


def clean_name(s):
    return " ".join("".join(c for c in s.lower() if c.isalnum() or c.isspace()).split())


def position_code(r):
    """Use depth-chart position for generic roster labels such as OL and DB."""
    depth = (r.get("depth_chart_position") or "").upper()
    pos = (r.get("position") or "").upper()
    if depth and depth not in ("OL", "DL", "DB", "LB", "OFF", "DEF"):
        return depth
    return pos


def default_confidence(p, skill_conf):
    measured = set(p.get("combine", {})) - set(p.get("imputed_drills", []))
    physical_input = {
        "SPD": ("forty",), "ACC": ("forty", "broad_jump"), "AGI": ("cone", "shuttle"),
        "STR": ("bench",), "JMP": ("vertical",),
    }
    confidence = {}
    for key in p["ratings"]:
        if key in physical_input:
            n = len(physical_input[key])
            confidence[key] = round(sum(d in measured for d in physical_input[key]) / n, 2)
        elif key in skill_conf:
            confidence[key] = skill_conf[key]
        elif key in ("AWR", "PRC", "STA", "INJ"):
            confidence[key] = 0.35
        else:
            confidence[key] = 0.15
    return confidence


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    roster_path = os.path.join(RAW, "roster_weekly_2026.csv.gz")
    roster25_path = os.path.join(RAW, "roster_weekly_2025.csv.gz")
    stats25_gz = os.path.join(RAW, "stats_player_reg_2025.csv.gz")
    stats26_gz = os.path.join(RAW, "stats_player_week_2026.csv.gz")
    players_path = os.path.join(RAW, "players.csv")
    combine_path = os.path.join(RAW, "combine.csv")
    for path in (roster_path, roster25_path, stats25_gz, stats26_gz, players_path, combine_path):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"missing {path}; run python3 pipeline/fetch_prototype_data.py")

    # Reuse ratings.py's established 35-attribute and physical-body framework.
    # Its legacy loader accepts the same nflverse CSVs when uncompressed.
    for src, dst in ((stats25_gz, os.path.join(RAW, "stats_player_reg_2025.csv")),
                     (stats26_gz, os.path.join(RAW, "stats_player_week_2026.csv"))):
        with gzip.open(src, "rb") as fin, open(dst, "wb") as fout:
            shutil.copyfileobj(fin, fout)
    sys.path.insert(0, os.path.dirname(__file__))
    import ratings
    ratings.SEASON = 2026
    ratings.GAME_WEEK = 7  # use 2026 Weeks 1-6 only

    all_rosters = list(rows(roster_path))
    week7 = [r for r in all_rosters if r.get("season") == "2026" and r.get("week") == "7" and r.get("game_type") == "REG"]
    current = [r for r in week7 if r.get("team") in TEAMS]
    if not current:
        raise ValueError("week 7 regular-season roster snapshot contains no NE/CHI rows")
    # One player must have at most one team membership in the frozen week.
    ids = [(r.get("team"), r.get("gsis_id")) for r in week7 if r.get("gsis_id")]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate roster team/player key in week 7 source")
    latest_by_id = {r["gsis_id"]: r for r in week7 if r.get("gsis_id")}

    players = list(rows(players_path))
    player_by_gsis = {r["gsis_id"]: r for r in players if r.get("gsis_id")}
    combine_rows = list(rows(combine_path))
    combine_by_pfr = {r["pfr_id"]: r for r in combine_rows if r.get("pfr_id")}
    combine_by_name = defaultdict(list)
    for r in combine_rows:
        combine_by_name[r["player_name"].lower()].append(r)
    cm = ratings.CombineModel(combine_rows)
    stats, pos_of = ratings.load_stats()
    sm = ratings.SkillModel(stats, pos_of)

    def player_base(r):
        x = player_by_gsis.get(r.get("gsis_id"), {})
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
        experience = as_int(r.get("years_exp")) or 0
        age = age_on(r.get("birth_date"), TARGET)
        draft_pick = as_int(x.get("draft_pick")) or as_int(r.get("draft_number"))
        draft_round = as_int(x.get("draft_round"))
        group = ratings.group_of(pos, weight)
        p = {
            "pos": pos, "group": group, "name": name, "height_in": height, "weight_lb": weight,
            "age": age, "experience": experience, "gsis": r.get("gsis_id"),
            "draft_round": draft_round, "draft_pick": draft_pick, "combine": combine,
        }
        st = stats.get(p["gsis"])
        rush = None
        if st and st.get("games", 0) >= 4:
            rush = (st.get("def_sacks", 0) + 0.5 * st.get("def_qb_hits", 0)) / st["games"]
        p["group"] = ratings.group_of(p["pos"], weight, rush)
        return p

    # Current rostered players provide the active league comparison used by OVR.
    league_raw = []
    rated = {}
    for r in week7:
        if r.get("status") != "ACT":
            continue
        p = ratings.rate(player_base(r), cm, sm)
        rated[r["gsis_id"]] = p
        league_raw.append((p["group"], p["ovr_raw"]))
    calib = ratings.OvrCalibration(league_raw)
    for p in rated.values():
        p["ovr"] = calib(p["group"], p["ovr_raw"])

    inactive_ids = {}
    inactive_unmatched = {}
    for team, names in INACTIVES.items():
        by_name = {clean_name(r.get("full_name", "")): r for r in current if r.get("team") == team}
        matched, missed = [], []
        for name in names:
            row = by_name.get(clean_name(name))
            if row is None and name.endswith(" III"):
                row = by_name.get(clean_name(name[:-4]))
            if row is None:
                missed.append(name)
            else:
                matched.append(row["gsis_id"])
        inactive_ids[team] = set(matched)
        inactive_unmatched[team] = missed
        if missed:
            raise ValueError(f"official inactive names failed roster join for {team}: {missed}")

    final25 = [r for r in rows(roster25_path) if r.get("season") == "2025" and r.get("week") == "18"
               and r.get("game_type") == "REG" and r.get("gsis_id")]
    old_team_by_id = {r["gsis_id"]: r.get("team") for r in final25}
    team_payload = {}
    changes = {}
    for team, team_name in TEAMS.items():
        roster = []
        team_rows = [r for r in current if r.get("team") == team]
        for r in sorted(team_rows, key=lambda z: (z.get("position", ""), z.get("full_name", ""))):
            pid = r["gsis_id"]
            p = rated.get(pid)
            if p is None:
                # Non-ACT players retain identity and status; ratings are omitted
                # because the established calibration pipeline rates active players.
                base = player_base(r)
                ph, phy, meas, imputed, _, t10 = ratings.physical_profile(base, cm)
                skills, skill_conf = ratings.skill_ratings(base, sm, phy, {d: 0 for d in ratings.DRILLS})
                attrs = {**skills, **phy}
                p = {**base, "ratings": dict(sorted(attrs.items())), "physics": ph,
                     "measurables": meas, "imputed_drills": imputed, "t10": round(t10, 3),
                     "confidence": skill_conf, "ovr": None, "ovr_raw": None}
            was_inactive = pid in inactive_ids[team]
            roster.append({
                "id": pid, "gsis_id": pid, "espn_id": r.get("espn_id") or None,
                "team_id": team, "name": r.get("full_name"), "position": r.get("position"),
                "depth_chart_position": r.get("depth_chart_position") or None,
                "rating_position": p["pos"], "rating_group": p["group"],
                "eligible_roles": sorted(set([p["group"], (r.get("depth_chart_position") or "").upper(),
                                                (r.get("position") or "").upper()]) - {""}),
                "jersey": r.get("jersey_number") or None, "height_in": p["height_in"],
                "weight_lb": p["weight_lb"], "birth_date": r.get("birth_date") or None,
                "age_on_snapshot_date": p.get("age"), "experience_years": p["experience"],
                "college": r.get("college") or None, "headshot_url": r.get("headshot_url") or None,
                "status": r.get("status"), "availability": "inactive" if was_inactive else
                    ("available" if r.get("status") == "ACT" else "unavailable_roster_status"),
                "official_game_inactive": was_inactive,
                "source": {"roster_release": "nflverse weekly_rosters 2026, week 7 REG",
                           "rating_season": "2025 REG + 2026 REG weeks 1-6", "rating_method": "pipeline/ratings.py"},
                "ratings": p["ratings"],
                "rating_confidence_by_attribute": default_confidence(p, p.get("confidence", {})),
                "overall_estimate": p.get("ovr"), "physics": p["physics"],
                "measurables": p["measurables"], "imputed_combine_drills": p["imputed_drills"],
                "measurable_source": "nflverse combine if matched; otherwise position/body regression in ratings.py",
            })
        available = [p for p in roster if p["availability"] == "available"]
        if len(available) < 22:
            raise ValueError(f"{team} has only {len(available)} available roster records")
        current_ids = {r["gsis_id"] for r in team_rows}
        prior_ids = {r["gsis_id"] for r in final25 if r.get("team") == team}
        changes[team] = {
            "2025_week18_members": len(prior_ids), "2026_week7_roster_members": len(current_ids),
            "added_or_new_to_roster": sorted(current_ids - prior_ids),
            "departed_from_team_roster": sorted(prior_ids - current_ids),
            "moved_from_other_2025_team": sorted(pid for pid in current_ids if old_team_by_id.get(pid) not in (None, team)),
            "method_note": "Roster membership comparison only; it does not classify a move as trade, signing, injury, or release.",
        }
        team_payload[team] = {
            "team_id": team, "name": team_name, "roster_source_week": 7,
            "playbook_ref": f"data/playbooks/{team}-2025.json",
            "official_inactives": [p["id"] for p in roster if p["official_game_inactive"]],
            "active_available_count": len(available), "roster": roster,
        }

    output = {
        "schema_version": "gridiron.matchup.v1",
        "snapshot": {"as_of": "2026-10-22 pre-kickoff", "kickoff_eastern": "2026-10-22T20:15:00-04:00",
                     "kickoff_venue_local": "2026-10-22T19:15:00-05:00",
                     "snapshot_date": TARGET.isoformat(), "post_kickoff_information_included": False},
        "venue": {"name": "Soldier Field", "city": "Chicago", "home_team": "CHI",
                  "field": {"length_yards": 120, "width_yards": 53.333, "offense_direction_configurable": True}},
        "sources": {
            "roster_2026": {"url": "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_2026.csv.gz", "sha256": sha256(roster_path), "week": 7, "phase": "REG", "release_updated_at_utc": "2026-10-22T12:58:00Z"},
            "roster_2025": {"url": "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_2025.csv.gz", "sha256": sha256(roster25_path), "week": 18, "phase": "REG"},
            "stats_2025": {"url": "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv.gz", "sha256": sha256(stats25_gz)},
            "stats_2026": {"url": "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz", "sha256": sha256(stats26_gz), "included_weeks": [1, 6], "release_updated_at_utc": "2026-10-22T15:29:00Z"},
            "players": {"url": "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv", "sha256": sha256(players_path)},
            "combine": {"url": "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv", "sha256": sha256(combine_path)},
            "inactives": {"url": INACTIVE_SOURCE, "published_at": "2026-10-22T18:47:00-05:00", "team_source": "New England Patriots official site"},
            "official_team_rosters": {"NE": "https://www.patriots.com/team/players-roster/", "CHI": "https://www.chicagobears.com/team/players-roster/"},
        },
        "rating_method": {"framework": "pipeline/ratings.py", "attribute_count": 35,
            "rating_label": "estimated public-research rating; not EA/Madden official ratings or measured tracking",
            "skills": "shrunk position-normalized 2025 + 2026 weeks 1-6 production and draft/experience priors",
            "physical": "combine measurements where joined; otherwise position/body regression; simulator body derived by existing sprint model",
            "ovr_calibration": "active players in nflverse week 7 league roster", "uncertainty": "per-attribute evidence confidence and imputed combine input list"},
        "roster_changes_vs_2025_week18": changes,
        "teams": team_payload,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}; " + ", ".join(f"{code}={team_payload[code]['active_available_count']} available" for code in TEAMS) + f"; league calibration={len(league_raw)}")


if __name__ == "__main__":
    main()
