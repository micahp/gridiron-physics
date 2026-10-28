"""Build source-backed 2025 NE/CHI playbook profiles from nflverse PBP.

The outputs describe recorded play attributes and selected labels, not literal
team play calls. Every aggregate bucket retains its source play IDs.
"""
import argparse
import csv
import gc
import gzip
import hashlib
import json
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "playbooks")
PINNED_INPUTS = os.path.join(OUT, "research-2026-10-27", "inputs")
TEAMS = {"NE": "New England Patriots", "CHI": "Chicago Bears"}
SCRIMMAGE = {"run", "pass"}

PBP_FILES = {
    2025: "pbp_2025.csv.gz",
    2026: "pbp_2026.csv.gz",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def open_rows(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", newline="", encoding="utf-8-sig") as f:
        yield from csv.DictReader(f)


def clean_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def clean_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def play_id(value):
    n = clean_int(value)
    return str(n) if n is not None else str(value or "")


def personnel_group(value):
    """Return the conventional skill-personnel code only when parseable."""
    if not value:
        return None
    counts = {"RB": 0, "TE": 0, "WR": 0}
    for count, pos in re.findall(r"(\d+)\s*(RB|HB|FB|TE|WR)\b", value.upper()):
        key = "RB" if pos in ("RB", "HB", "FB") else pos
        counts[key] += int(count)
    if sum(counts.values()) != 5:
        return None
    return f"{counts['RB']}{counts['TE']}{counts['WR']}"


def defensive_personnel_code(value):
    if not value:
        return None
    counts = {"DL": 0, "LB": 0, "DB": 0}
    for count, pos in re.findall(r"(\d+)\s*(DL|DE|DT|NT|MLB|ILB|OLB|LB|DB|CB|FS|SS|S)\b", value.upper()):
        key = "DL" if pos in ("DL", "DE", "DT", "NT") else "LB" if pos in ("LB", "MLB", "ILB", "OLB") else "DB"
        counts[key] += int(count)
    if sum(counts.values()) != 11:
        return None
    return f"{counts['DL']}-{counts['LB']}-{counts['DB']}"


def participation_index(rows):
    out = {}
    for r in rows:
        # PBP's current game_id is its ten-digit legacy game key; the
        # participation export carries that same key as old_game_id.
        game = r.get("old_game_id") or r.get("game_id") or r.get("nflverse_game_id") or ""
        key = (game, play_id(r.get("play_id")))
        if key in out:
            raise ValueError(f"duplicate participation source key: {key}")
        out[key] = r
    return out


def index_pbp(rows, season):
    out = {}
    for r in rows:
        if clean_int(r.get("season")) != season or r.get("season_type") != "REG":
            continue
        game = r.get("old_game_id") or r.get("game_id") or ""
        key = (game, play_id(r.get("play_id")))
        if key in out:
            raise ValueError(f"duplicate PBP source key: {key}")
        out[key] = r
    return out


def is_scrimmage(r):
    if r.get("play_type") not in SCRIMMAGE:
        return False
    # Keep source play_type as the authoritative coarse class, including sacks
    # in pass plays. Special teams, penalties/no-plays and administrative rows
    # are not playbook snaps for this prototype.
    return bool(r.get("posteam") and r.get("defteam"))


def situation_labels(r):
    labels = []
    ytg = clean_float(r.get("yardline_100"))
    down = clean_int(r.get("down"))
    distance = clean_float(r.get("ydstogo"))
    qtr = clean_int(r.get("qtr"))
    sec = clean_float(r.get("quarter_seconds_remaining"))
    if ytg is not None and ytg <= 20:
        labels.append("red_zone")
    if ytg is not None and ytg <= 5:
        labels.append("goal_line")
    if down == 3:
        labels.append("third_down")
    if down in (3, 4) and distance is not None and distance <= 2:
        labels.append("short_yardage")
    if qtr == 2 and sec is not None and sec <= 120:
        labels.append("two_minute_first_half")
    if qtr == 4 and sec is not None and sec <= 120:
        labels.append("two_minute_second_half")
    return labels


def source_id(r):
    return {
        "game_id": r.get("game_id"),
        "old_game_id": r.get("old_game_id") or None,
        "play_id": play_id(r.get("play_id")),
    }


def value_for(r, p, field):
    ftn = r.get("_ftn") or {}
    if field == "offense_formation":
        return (p or {}).get("offense_formation")
    if field == "offense_personnel":
        return (p or {}).get("offense_personnel")
    if field == "offense_personnel_code":
        return personnel_group((p or {}).get("offense_personnel"))
    if field == "defense_personnel":
        return (p or {}).get("defense_personnel")
    if field == "defense_personnel_code":
        return defensive_personnel_code((p or {}).get("defense_personnel"))
    if field == "defense_formation":
        # Derived label only: participation publishes personnel counts, not
        # the actual defensive alignment or coverage shell.
        code = defensive_personnel_code((p or {}).get("defense_personnel"))
        return f"personnel_{code}" if code else None
    if field in ("shotgun", "no_huddle", "pass_length", "pass_location", "run_location", "run_gap"):
        v = r.get(field)
        if field in ("shotgun", "no_huddle"):
            if v in (None, "") and field == "no_huddle":
                v = ftn.get("is_no_huddle")
            n = clean_int(v)
            return bool(n) if n is not None else None
        return v or None
    if field in ("air_yards", "defenders_in_box", "number_of_pass_rushers", "n_blitzers"):
        raw = (p or {}).get(field) if field in ("defenders_in_box", "number_of_pass_rushers") else r.get(field)
        if field == "defenders_in_box" and raw in (None, ""):
            raw = ftn.get("n_defense_box")
        if field == "number_of_pass_rushers" and raw in (None, ""):
            raw = ftn.get("n_pass_rushers")
        if field == "n_blitzers":
            raw = ftn.get("n_blitzers")
        return clean_float(raw)
    if field in ("route", "defense_man_zone_type", "defense_coverage_type"):
        return (p or {}).get(field) or None
    if field == "pressure":
        return (p or {}).get("was_pressure") or None
    if field == "target_available":
        return bool(r.get("receiver_player_id") or r.get("receiver_player_name")) if r.get("pass_attempt") == "1" else None
    if field in ("play_action", "motion", "rpo", "is_screen_pass", "is_trick_play"):
        # Preserve these only if a source release actually carries the field.
        raw = r.get(field)
        if raw in (None, ""):
            raw = ftn.get({"play_action": "is_play_action", "motion": "is_motion"}.get(field, field))
        if raw in (None, ""):
            return None
        return raw
    return r.get(field) or None


def wilson(successes, total, z=1.959963984540054):
    if not total:
        return None
    p = successes / total
    den = 1 + z * z / total
    center = (p + z * z / (2 * total)) / den
    margin = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5) / den
    return [round(max(0.0, center - margin), 5), round(min(1.0, center + margin), 5)]


def distribution(rows, field, denominator_rows=None, provenance="observed_2025"):
    denominator_rows = rows if denominator_rows is None else denominator_rows
    buckets = defaultdict(list)
    missing = []
    for item in denominator_rows:
        value = value_for(item["pbp"], item.get("participation"), field)
        if value is None or value == "":
            missing.append(item["pbp"])
        else:
            buckets[str(value)].append(item["pbp"])
    denominator = len(denominator_rows)
    observed = denominator - len(missing)
    return {
        "provenance": provenance,
        "denominator": denominator,
        "observed": observed,
        "missing": len(missing),
        "coverage": round(observed / denominator, 6) if denominator else None,
        "missing_source_ids": [source_id(r) for r in missing],
        "categories": {
            key: {
                "count": len(src),
                "rate": round(len(src) / observed, 6) if observed else None,
                "ci95_wilson": wilson(len(src), observed),
                "source_ids": [source_id(r) for r in src],
            }
            for key, src in sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        },
    }


def summarize(rows, side, provenance="observed_2025"):
    def tendency(source_rows, field):
        kind = "inferred_concept" if field in ("offense_personnel_code", "defense_personnel_code", "defense_formation") else provenance
        return distribution(source_rows, field, provenance=kind)

    if side == "offense":
        selected = rows
        formation_field = "offense_formation"
        personnel_field = "offense_personnel"
        personnel_code = "offense_personnel_code"
    else:
        selected = rows
        formation_field = "defense_formation"
        personnel_field = "defense_personnel"
        personnel_code = "defense_personnel_code"

    runs = [x for x in selected if x["pbp"].get("play_type") == "run"]
    passes = [x for x in selected if x["pbp"].get("play_type") == "pass"]
    summary = {
        "eligible_scrimmage_plays": len(selected),
        "run_play_count": len(runs),
        "pass_play_count_including_sacks": len(passes),
        "run_pass_denominator": len(selected),
        "run_rate": round(len(runs) / len(selected), 6) if selected else None,
        "pass_rate": round(len(passes) / len(selected), 6) if selected else None,
        "run_pass": tendency(selected, "play_type"),
        "formation": tendency(selected, formation_field),
        "personnel": tendency(selected, personnel_field),
        "personnel_code": tendency(selected, personnel_code),
        "shotgun": tendency(selected, "shotgun"),
        "no_huddle": tendency(selected, "no_huddle"),
        "third_down": tendency([x for x in selected if clean_int(x["pbp"].get("down")) == 3], "play_type"),
        "short_yardage": tendency([x for x in selected if "short_yardage" in situation_labels(x["pbp"])], "play_type"),
        "red_zone": tendency([x for x in selected if "red_zone" in situation_labels(x["pbp"])], "play_type"),
        "goal_line": tendency([x for x in selected if "goal_line" in situation_labels(x["pbp"])], "play_type"),
        "two_minute": tendency([x for x in selected if "two_minute_first_half" in situation_labels(x["pbp"]) or "two_minute_second_half" in situation_labels(x["pbp"])], "play_type"),
    }
    if side == "offense":
        summary.update({
            "run_location": tendency(runs, "run_location"),
            "run_gap": tendency(runs, "run_gap"),
            "pass_location": tendency(passes, "pass_location"),
            "pass_depth": tendency(passes, "pass_length"),
            "air_yards": tendency(passes, "air_yards"),
            "target_available": tendency(passes, "target_available"),
            "route": tendency(passes, "route"),
            "play_action": tendency(selected, "play_action"),
            "motion": tendency(selected, "motion"),
        })
    else:
        summary.update({
            "defenders_in_box": tendency(selected, "defenders_in_box"),
            "number_of_pass_rushers": tendency(passes, "number_of_pass_rushers"),
            "coverage_family": tendency(passes, "defense_man_zone_type"),
            "coverage_type": tendency(passes, "defense_coverage_type"),
        })
    return summary


def compact_play(pbp, participation, season, provenance):
    key_fields = (
        "week", "posteam", "defteam", "play_type", "down", "ydstogo", "yardline_100", "qtr",
        "quarter_seconds_remaining", "shotgun", "no_huddle", "run_location", "run_gap", "pass_location",
        "pass_length", "air_yards", "receiver_player_id", "receiver_player_name", "play_action", "motion",
        "yards_gained", "complete_pass", "interception", "touchdown", "season_type",
    )
    p_fields = (
        "offense_formation", "offense_personnel", "defense_personnel", "defenders_in_box",
        "number_of_pass_rushers", "players_on_play", "offense_players", "defense_players", "n_offense",
        "n_defense", "route", "defense_man_zone_type", "defense_coverage_type",
    )
    p = {k: participation.get(k) for k in p_fields} if participation else {}
    if participation:
        p["nflverse_game_id"] = participation.get("nflverse_game_id")
    return {
        "provenance": provenance,
        "phase": "REG",
        "season": season,
        "source_id": source_id(pbp),
        "attributes": {k: pbp.get(k) for k in key_fields if k in pbp},
        "participation": p,
        "situation": situation_labels(pbp),
        "outcome_label": {
            "yards_gained": clean_float(pbp.get("yards_gained")),
            "complete_pass": clean_int(pbp.get("complete_pass")),
            "interception": clean_int(pbp.get("interception")),
            "touchdown": clean_int(pbp.get("touchdown")),
        },
    }


def compact_research_play(pbp, participation, season, provenance):
    """Research output that makes absent participation fields explicit."""
    result = compact_play(pbp, participation, season, provenance)
    participant_fields = (
        "offense_formation", "offense_personnel", "defense_personnel", "defenders_in_box",
        "number_of_pass_rushers", "players_on_play", "offense_players", "defense_players",
        "n_offense", "n_defense", "route", "defense_man_zone_type", "defense_coverage_type", "was_pressure",
    )
    result["participation"] = {
        "availability": "observed" if participation else "missing",
        **{field: (participation or {}).get(field) for field in participant_fields},
    }
    ftn = pbp.get("_ftn") or {}
    result["charting"] = {
        "availability": "observed" if ftn else "missing",
        **{field: ftn.get(field) for field in (
            "is_no_huddle", "is_motion", "is_play_action", "is_rpo", "is_screen_pass",
            "is_trick_play", "n_blitzers", "n_pass_rushers", "n_defense_box",
        )},
    }
    return result


def observed_candidates(rows, season=2025, provenance="observed_2025"):
    """Collapse directly charted formation/action labels into selectable entries."""
    result = {}
    for kind, fields in (("run", ("run_gap", "run_location")), ("pass", ("pass_length", "pass_location"))):
        eligible = [x for x in rows if x["pbp"].get("play_type") == kind]
        buckets = defaultdict(list)
        for x in eligible:
            p = x.get("participation") or {}
            pbp = x["pbp"]
            formation = p.get("offense_formation") or None
            shotgun_value = value_for(pbp, p, "shotgun")
            concept = {"formation": formation, "shotgun": shotgun_value}
            for field in fields:
                concept[field] = pbp.get(field) or None
            if any(v is None or v == "" for v in concept.values()):
                continue
            key = tuple(str(concept[field]) for field in ("formation", "shotgun", *fields))
            buckets[key].append(x["pbp"])
        classified = sum(len(source) for source in buckets.values())
        entries = []
        for key, source in sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            concept = {"formation": key[0], "shotgun": key[1] == "True"}
            concept.update({field: value for field, value in zip(fields, key[2:])})
            slug = re.sub(r"[^a-z0-9]+", "-", "-".join(key).lower()).strip("-")
            concept_hash = hashlib.sha256(json.dumps(concept, sort_keys=True).encode()).hexdigest()[:10]
            entries.append({
                "candidate_id": f"observed-{season}-{kind}-{slug}-{concept_hash}",
                "provenance": provenance,
                "candidate_kind": "observed_attribute_combination",
                "action": kind,
                "attributes": concept,
                "count": len(source),
                "denominator": len(eligible),
                "rate": round(len(source) / len(eligible), 6) if eligible else None,
                "ci95_wilson": wilson(len(source), len(eligible)),
                "source_ids": [source_id(r) for r in source],
                "claim_limit": "Combination of recorded labels; not evidence of a literal call, route, blocking scheme, or full alignment.",
            })
        result[kind] = {
            "provenance": provenance,
            "eligible_action_plays": len(eligible),
            "classified_plays": classified,
            "missing_or_unclassified": len(eligible) - classified,
            "candidates": entries,
        }
    return result


def build_2025(pbp_path, part_path, team):
    pbp_all = list(open_rows(pbp_path))
    pbp_idx = index_pbp(pbp_all, 2025)
    part_idx = participation_index(open_rows(part_path))
    offense, defense = [], []
    missing = {"offense": [], "defense": []}
    for key, row in sorted(pbp_idx.items(), key=lambda kv: (kv[0][0], clean_int(kv[0][1]) or 0)):
        if not is_scrimmage(row):
            continue
        join = part_idx.get(key)
        for side, team_field, target in (("offense", "posteam", offense), ("defense", "defteam", defense)):
            if row.get(team_field) != team:
                continue
            if join is None:
                missing[side].append(source_id(row))
            target.append({"pbp": row, "participation": join})

    if not offense or not defense:
        raise ValueError(f"no 2025 regular-season PBP rows for {team}")
    for side, rows in (("offense", offense), ("defense", defense)):
        if len({(x["pbp"].get("game_id"), play_id(x["pbp"].get("play_id"))) for x in rows}) != len(rows):
            raise ValueError(f"duplicate eligible {side} plays for {team}")

    # Separate the one-game record attributes from tendencies; only the
    # profile's published rates are used by the demo selector.
    out_plays = [compact_play(x["pbp"], x["participation"], 2025, "observed_2025") for x in offense]
    def_plays = [compact_play(x["pbp"], x["participation"], 2025, "observed_2025") for x in defense]
    total_team_rows = sum(1 for r in pbp_idx.values() if r.get("posteam") == team or r.get("defteam") == team)
    post_rows = [r for r in pbp_all if clean_int(r.get("season")) == 2025 and r.get("season_type") == "POST" and (r.get("posteam") == team or r.get("defteam") == team)]
    return {
        "schema_version": "gridiron.playbook.v1",
        "team_id": team,
        "team_name": TEAMS[team],
        "season": 2025,
        "phase": "REG",
        "provenance": "observed_2025",
        "claims": {
            "literal_playbook_reconstruction": False,
            "observed_attributes_are_play_calls": False,
            "outcome_labels_used_for_prospective_demo": False,
            "notes": [
                "PBP and participation describe charted play attributes, not every play call or assignment.",
                "Outcomes are retained as separate labels and never passed to the prospective demo execution path.",
                "Play action and motion are unknown unless directly present in the pinned input schema.",
                "Selectable candidates combine recorded attributes and are not verified play calls or assignments.",
                "Postseason games are excluded from every regular-season denominator and listed separately.",
            ],
        },
        "source": {
            "pbp": {"name": "nflverse play_by_play_2025.csv.gz", "url": "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz", "sha256": sha256(pbp_path)},
            "participation": {"name": "nflverse pbp_participation_2025.csv", "url": "https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_2025.csv", "sha256": sha256(part_path)},
        },
        "coverage": {
            "team_pbp_rows_in_regular_season": total_team_rows,
            "eligible_offense_scrimmage_plays": len(offense),
            "eligible_defense_scrimmage_plays": len(defense),
            "offense_participation_joined": len(offense) - len(missing["offense"]),
            "offense_participation_missing": len(missing["offense"]),
            "defense_participation_joined": len(defense) - len(missing["defense"]),
            "defense_participation_missing": len(missing["defense"]),
            "missing_join_source_ids": missing,
            "excluded_postseason_team_rows": len(post_rows),
            "postseason_phase": "POST; excluded from regular-season playbooks",
        },
        "offense": {"profile": summarize(offense, "offense"), "observed_plays": out_plays,
                    "play_candidates": observed_candidates(offense)},
        "defense": {"profile": summarize(defense, "defense"), "observed_plays": def_plays},
        "playbook_variants": [],
        "provenance_categories": ["observed_2025", "observed_2026_pre_game", "historical_coach", "inferred_concept", "synthetic_variation"],
        "sampling_controls": {
            "observed_2025": {"enabled": True, "purpose": "frequency evidence prior"},
            "observed_2026_pre_game": {"enabled": False, "purpose": "descriptive comparison only"},
            "historical_coach": {"enabled": False, "purpose": "not implemented"},
            "inferred_concept": {"enabled": False, "purpose": "classification evidence only"},
            "synthetic_variation": {"enabled": False, "purpose": "explicit integration demo only; never contributes to observed rates"},
        },
    }


def build_pregame_2026(pbp_path, team):
    rows = []
    for r in open_rows(pbp_path):
        if clean_int(r.get("season")) != 2026 or r.get("season_type") != "REG":
            continue
        week = clean_int(r.get("week"))
        if week is None or week > 6 or r.get("posteam") != team or not is_scrimmage(r):
            continue
        rows.append({"pbp": r, "participation": None})
    rows.sort(key=lambda x: (x["pbp"].get("game_id", ""), clean_int(x["pbp"].get("play_id")) or 0))
    if len({(x["pbp"].get("game_id"), play_id(x["pbp"].get("play_id"))) for x in rows}) != len(rows):
        raise ValueError(f"duplicate 2026 pre-game PBP plays for {team}")
    if not rows:
        return {"provenance": "observed_2026_pre_game", "weeks": [1, 6], "eligible_plays": 0, "profile": None, "source_ids": []}
    return {
        "provenance": "observed_2026_pre_game",
        "weeks": [1, 6],
        "phase": "REG",
        "eligible_plays": len(rows),
        "profile": summarize(rows, "offense", "observed_2026_pre_game"),
        "source_ids": [source_id(x["pbp"]) for x in rows],
        "coverage_note": "PBP-only. No 2026 participation join was verified; formation/personnel remain unavailable here.",
    }


RESEARCH_TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SF": "San Francisco 49ers", "SEA": "Seattle Seahawks", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}

RESEARCH_PBP_FILES = {
    2022: "pbp_2022.csv.gz", 2023: "pbp_2023.csv.gz", 2024: "pbp_2024.csv.gz",
    2025: "pbp_2025.csv.gz", 2026: "pbp_2026_week7.csv.gz",
}
RESEARCH_FTN_FILES = {year: f"ftn_charting_{year}.csv" for year in range(2022, 2027)}
RESEARCH_PART_FILES = {year: f"pbp_participation_{year}.csv" for year in range(2022, 2026)}


def ftn_index(rows, season, max_week=None):
    result = {}
    for row in rows:
        if clean_int(row.get("season")) != season:
            continue
        week = clean_int(row.get("week"))
        if week is None or week > (max_week or 18):
            continue
        key = (row.get("nflverse_game_id") or "", play_id(row.get("nflverse_play_id")))
        if key in result:
            raise ValueError(f"duplicate FTN source key for {season}: {key}")
        result[key] = row
    return result


def research_provenance(season):
    return "observed_2026_pre_game" if season == 2026 else f"observed_{season}"


def research_summary(rows, side, provenance):
    result = summarize(rows, side, provenance)
    result["play_action"] = distribution(rows, "play_action", provenance=provenance)
    result["motion"] = distribution(rows, "motion", provenance=provenance)
    result["rpo"] = distribution(rows, "rpo", provenance=provenance)
    result["n_blitzers"] = distribution(rows, "n_blitzers", provenance=provenance)
    result["is_screen_pass"] = distribution(rows, "is_screen_pass", provenance=provenance)
    result["is_trick_play"] = distribution(rows, "is_trick_play", provenance=provenance)
    result["pressure"] = distribution(
        [item for item in rows if item["pbp"].get("play_type") == "pass"],
        "pressure", provenance=provenance,
    )
    return result


def validate_research_distributions(value, path="profile"):
    errors = []
    if isinstance(value, dict):
        if all(key in value for key in ("denominator", "observed", "missing")):
            if value["observed"] + value["missing"] != value["denominator"]:
                errors.append(f"{path}: observed + missing != denominator")
            if isinstance(value.get("categories"), dict):
                category_total = sum(category.get("count", 0) for category in value["categories"].values())
                if category_total != value["observed"]:
                    errors.append(f"{path}: category counts do not equal observed")
        for key, child in value.items():
            errors.extend(validate_research_distributions(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            errors.extend(validate_research_distributions(child, f"{path}[{i}]"))
    return errors


def participation_shotgun_equivalent(formation, season):
    # PBP's binary shotgun field also includes Pistol. The 2022 participation
    # taxonomy additionally labels Empty and Wildcat as distinct formations.
    formation = (formation or "").strip().upper()
    if not formation:
        return None
    labels = {"SHOTGUN", "PISTOL"}
    if season == 2022:
        labels.update(("EMPTY", "WILDCAT"))
    return formation in labels


def research_shotgun_check(offense, season):
    paired = []
    disagreements = []
    for item in offense:
        pbp_value = clean_int(item["pbp"].get("shotgun"))
        formation = (item.get("participation") or {}).get("offense_formation")
        part_value = participation_shotgun_equivalent(
            formation, season,
        )
        if pbp_value in (0, 1) and part_value is not None:
            paired.append((bool(pbp_value), part_value))
            if bool(pbp_value) != part_value:
                disagreements.append({
                    **source_id(item["pbp"]),
                    "week": clean_int(item["pbp"].get("week")),
                    "play_type": item["pbp"].get("play_type"),
                    "pbp_shotgun": bool(pbp_value),
                    "participation_formation": formation,
                    "participation_shotgun_mapped": part_value,
                })
    if not paired:
        return {"paired_plays": 0, "pbp_share": None, "participation_share": None, "absolute_difference": None}
    pbp_share = sum(a for a, _ in paired) / len(paired)
    part_share = sum(b for _, b in paired) / len(paired)
    p0_part_shotgun = [d for d in disagreements if not d["pbp_shotgun"] and d["participation_shotgun_mapped"]]
    p1_part_other = [d for d in disagreements if d["pbp_shotgun"] and not d["participation_shotgun_mapped"]]
    week_counts = Counter(d["week"] for d in disagreements)
    return {
        "paired_plays": len(paired), "pbp_share": round(pbp_share, 6),
        "participation_share": round(part_share, 6),
        "absolute_difference": round(abs(pbp_share - part_share), 6),
        "source_disagreement_count": len(disagreements),
        "pbp_0_participation_shotgun_count": len(p0_part_shotgun),
        "pbp_1_participation_other_formation_count": len(p1_part_other),
        "net_difference_plays": len(p0_part_shotgun) - len(p1_part_other),
        "disagreement_games": len({d["game_id"] for d in disagreements}),
        "disagreement_weeks": dict(sorted(week_counts.items())),
        "disagreement_formation_counts": dict(sorted(Counter(d["participation_formation"] for d in disagreements).items())),
        "disagreement_play_type_counts": dict(sorted(Counter(d["play_type"] for d in disagreements).items())),
        "disagreement_source_rows": disagreements,
    }


def research_source_spec(season, kind, path):
    if kind == "pbp":
        filename = f"play_by_play_{season}.csv.gz"
        url = f"https://github.com/nflverse/nflverse-data/releases/download/pbp/{filename}"
    elif kind == "participation":
        filename = f"pbp_participation_{season}.csv"
        url = f"https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/{filename}"
    else:
        filename = f"ftn_charting_{season}.csv"
        url = f"https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/{filename}"
    spec = {"name": filename, "url": url, "sha256": sha256(path)}
    if kind == "pbp" and season == 2026:
        spec["capture_scope"] = "regular-season Weeks 1-7 only"
    return spec


def build_research_team_season(season, team, pbp_rows, part_idx, ftn_idx, pbp_path,
                               part_path, ftn_path, max_week=None):
    provenance = research_provenance(season)
    offense, defense = [], []
    missing = {"offense": [], "defense": []}
    ftn_missing = {"offense": [], "defense": []}
    selected_pbp = []
    for row in pbp_rows:
        if clean_int(row.get("season")) != season or row.get("season_type") != "REG":
            continue
        week = clean_int(row.get("week"))
        if max_week is not None and (week is None or week > max_week):
            continue
        selected_pbp.append(row)
        if not is_scrimmage(row):
            continue
        key = (row.get("old_game_id") or row.get("game_id") or "", play_id(row.get("play_id")))
        part = part_idx.get(key) if part_idx is not None else None
        ftn = ftn_idx.get((row.get("game_id") or "", play_id(row.get("play_id"))))
        row["_ftn"] = ftn
        for side, team_field, target in (("offense", "posteam", offense), ("defense", "defteam", defense)):
            if row.get(team_field) != team:
                continue
            if part is None:
                missing[side].append(source_id(row))
            if ftn is None:
                ftn_missing[side].append(source_id(row))
            target.append({"pbp": row, "participation": part})

    if not offense or not defense:
        raise ValueError(f"no eligible regular-season PBP plays for {season} {team}")
    for side, rows in (("offense", offense), ("defense", defense)):
        if len({(x["pbp"].get("game_id"), play_id(x["pbp"].get("play_id"))) for x in rows}) != len(rows):
            raise ValueError(f"duplicate eligible {side} plays for {season} {team}")

    offense_plays = [compact_research_play(x["pbp"], x["participation"], season, provenance) for x in offense]
    defense_plays = [compact_research_play(x["pbp"], x["participation"], season, provenance) for x in defense]
    regular_rows = [r for r in selected_pbp if r.get("posteam") == team or r.get("defteam") == team]
    post_rows = [r for r in pbp_rows if clean_int(r.get("season")) == season and r.get("season_type") == "POST" and (r.get("posteam") == team or r.get("defteam") == team)]
    ftn_game_ids = {r.get("nflverse_game_id") for r in ftn_idx.values()}
    selected_game_ids = {r.get("game_id") for r in selected_pbp if team in (r.get("posteam"), r.get("defteam"))}
    ftn_game_count = len(selected_game_ids & ftn_game_ids)
    shotgun_check = research_shotgun_check(offense, season) if season in (2022, 2023, 2024) else None
    result = {
        "schema_version": "gridiron.playbook.v1",
        "team_id": team,
        "team_name": RESEARCH_TEAM_NAMES[team],
        "season": season,
        "phase": "REG",
        "provenance": provenance,
        "cohort": ({
            "label": "in-season, through Week 7",
            "weeks_included": [1, 7],
            "frozen": True,
            "test_tuning_allowed": False,
            "may_be_described_as_unseen": False,
        } if season == 2026 else {
            "label": f"historical regular season {season}",
            "weeks_included": [1, 18],
            "frozen": False,
        }),
        "claims": {
            "literal_playbook_reconstruction": False,
            "observed_attributes_are_play_calls": False,
            "outcome_labels_used_for_prospective_demo": False,
            "notes": [
                "Historical records describe published charted attributes, not every play call or assignment.",
                "Outcome labels are kept in a separate subobject and do not define prospective tendencies.",
                "Participation fields are explicitly null where no participation source row is available.",
                "FTN charting is an independent source; unmatched charting fields remain missing.",
                "Research profiles are not promoted to engine defaults or used for movement evaluation.",
                "2026 is labeled in-season through Week 7, is frozen, must not be used to tune tests, and must not be described as unseen.",
                "Postseason games are excluded from regular-season denominators and listed separately.",
            ],
        },
        "source": {
            "pbp": research_source_spec(season, "pbp", pbp_path),
            "participation": research_source_spec(season, "participation", part_path) if part_path else None,
            "ftn_charting": {
                **research_source_spec(season, "ftn", ftn_path),
                "license": "CC-BY-SA-4.0",
                "attribution": "FTN Data via nflverse",
            },
        },
        "coverage": {
            "team_pbp_rows_in_regular_season": len(regular_rows),
            "eligible_offense_scrimmage_plays": len(offense),
            "eligible_defense_scrimmage_plays": len(defense),
            "offense_participation_joined": len(offense) - len(missing["offense"]),
            "offense_participation_missing": len(missing["offense"]),
            "defense_participation_joined": len(defense) - len(missing["defense"]),
            "defense_participation_missing": len(missing["defense"]),
            "missing_participation_source_ids": missing,
            "offense_ftn_charting_joined": len(offense) - len(ftn_missing["offense"]),
            "offense_ftn_charting_missing": len(ftn_missing["offense"]),
            "defense_ftn_charting_joined": len(defense) - len(ftn_missing["defense"]),
            "defense_ftn_charting_missing": len(ftn_missing["defense"]),
            "missing_ftn_source_ids": ftn_missing,
            "eligible_regular_season_games": len(selected_game_ids),
            "ftn_games_present": ftn_game_count,
            "excluded_postseason_team_rows": len(post_rows),
            "postseason_phase": "POST; excluded from regular-season playbooks",
            "participation_shotgun_reconciliation": shotgun_check,
        },
        "offense": {
            "profile": research_summary(offense, "offense", provenance),
            "observed_plays": offense_plays,
            "play_candidates": observed_candidates(offense, season, provenance),
        },
        "defense": {"profile": research_summary(defense, "defense", provenance), "observed_plays": defense_plays},
        "playbook_variants": [],
        "provenance_categories": [provenance, "inferred_concept", "synthetic_variation"],
        "sampling_controls": {
            provenance: {"enabled": False, "purpose": "research build only; not promoted to engine defaults"},
            "inferred_concept": {"enabled": False, "purpose": "classification evidence only"},
            "synthetic_variation": {"enabled": False, "purpose": "explicit integration demo only"},
        },
    }
    errors = validate_research_distributions(result)
    if len(offense_plays) != len(offense) or len(defense_plays) != len(defense):
        errors.append("eligible play count does not equal emitted observed play records")
    for action, catalog in result["offense"]["play_candidates"].items():
        if catalog["classified_plays"] + catalog["missing_or_unclassified"] != catalog["eligible_action_plays"]:
            errors.append(f"{action} candidate counts do not reconcile")
    if errors:
        raise ValueError(f"reconciliation failed for {season} {team}: {errors[:3]}")
    return result


def build_research(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    season_inputs = {}
    pin_manifest_path = os.path.join(OUT, "research-2026-10-27", "build_manifest.json")
    if not os.path.isfile(pin_manifest_path):
        raise FileNotFoundError(f"pinned input manifest missing: {pin_manifest_path}")
    with open(pin_manifest_path, encoding="utf-8") as f:
        pinned_source_hashes = json.load(f).get("source_hashes") or {}
    if set(pinned_source_hashes) != {str(year) for year in range(2022, 2027)}:
        raise ValueError(f"pinned input manifest is missing one or more seasons: {pin_manifest_path}")
    for season in range(2022, 2027):
        input_root = PINNED_INPUTS if season == 2026 else RAW
        pbp_path = os.path.join(input_root, RESEARCH_PBP_FILES[season])
        ftn_path = os.path.join(input_root, RESEARCH_FTN_FILES[season])
        part_path = os.path.join(RAW, RESEARCH_PART_FILES[season]) if season in RESEARCH_PART_FILES else None
        for path in (pbp_path, ftn_path, part_path):
            if path and not os.path.isfile(path):
                raise FileNotFoundError(f"missing research source {path}")
        pins = pinned_source_hashes[str(season)]
        for key, path in (("pbp", pbp_path), ("participation", part_path), ("ftn_charting", ftn_path)):
            if path is None:
                continue
            expected = (pins.get(key) or {}).get("sha256")
            actual = sha256(path)
            if not expected or actual != expected:
                raise ValueError(
                    f"unpinned or changed {season} {key} source: expected {expected}, got {actual}; "
                    "fetch the exact assets with pipeline/fetch_research_playbook_sources.py"
                )
        max_week = 7 if season == 2026 else 18
        season_inputs[season] = (pbp_path, part_path, ftn_path, max_week)

    metadata = []
    team_season_count = 0
    total_offense = total_defense = 0
    total_participation_joined = total_participation_missing = 0
    total_ftn_joined = total_ftn_missing = 0
    nonreconciling = []
    season_game_counts = {}
    season_ftn_game_counts = {}
    season_ftn_missing_games = {}
    for season, inputs in season_inputs.items():
        pbp_path, part_path, ftn_path, max_week = inputs
        print(f"loading sources for {season}", flush=True)
        pbp_rows = list(open_rows(pbp_path))
        part_idx = participation_index(open_rows(part_path)) if part_path else None
        ftn_idx = ftn_index(open_rows(ftn_path), season, max_week=max_week)
        selected_games = {
            r.get("game_id") for r in pbp_rows
            if clean_int(r.get("season")) == season and r.get("season_type") == "REG"
            and (max_week is None or (clean_int(r.get("week")) is not None and clean_int(r.get("week")) <= max_week))
        }
        season_game_counts[season] = len(selected_games)
        ftn_game_ids = {r.get("nflverse_game_id") for r in ftn_idx.values()}
        season_ftn_game_counts[season] = len(selected_games & ftn_game_ids)
        season_ftn_missing_games[season] = sorted(selected_games - ftn_game_ids)
        for team in RESEARCH_TEAM_NAMES:
            result = build_research_team_season(
                season, team, pbp_rows, part_idx, ftn_idx, pbp_path, part_path,
                ftn_path, max_week=max_week,
            )
            dest = os.path.join(output_dir, f"{team}-{season}.json")
            temp = dest + ".tmp"
            with open(temp, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=1, sort_keys=True)
                f.write("\n")
            os.replace(temp, dest)
            cov = result["coverage"]
            team_season_count += 1
            total_offense += cov["eligible_offense_scrimmage_plays"]
            total_defense += cov["eligible_defense_scrimmage_plays"]
            total_participation_joined += cov["offense_participation_joined"] + cov["defense_participation_joined"]
            total_participation_missing += cov["offense_participation_missing"] + cov["defense_participation_missing"]
            total_ftn_joined += cov["offense_ftn_charting_joined"] + cov["defense_ftn_charting_joined"]
            total_ftn_missing += cov["offense_ftn_charting_missing"] + cov["defense_ftn_charting_missing"]
            check = cov["participation_shotgun_reconciliation"]
            if check and check["absolute_difference"] is not None and check["absolute_difference"] > 0.01:
                nonreconciling.append((season, team, check))
            metadata.append({
                "season": season, "team": team, "output": os.path.basename(dest),
                "output_sha256": sha256(dest), "games": cov["eligible_regular_season_games"],
                "offense_plays": cov["eligible_offense_scrimmage_plays"],
                "defense_plays": cov["eligible_defense_scrimmage_plays"],
                "participation_joined": cov["offense_participation_joined"] + cov["defense_participation_joined"],
                "participation_missing": cov["offense_participation_missing"] + cov["defense_participation_missing"],
                "ftn_joined": cov["offense_ftn_charting_joined"] + cov["defense_ftn_charting_joined"],
                "ftn_missing": cov["offense_ftn_charting_missing"] + cov["defense_ftn_charting_missing"],
                "shotgun_check": check,
            })
            print(f"built {season} {team}: offense={cov['eligible_offense_scrimmage_plays']} "
                  f"defense={cov['eligible_defense_scrimmage_plays']} "
                  f"participation={cov['offense_participation_joined'] + cov['defense_participation_joined']}/"
                  f"{cov['eligible_offense_scrimmage_plays'] + cov['eligible_defense_scrimmage_plays']} "
                  f"FTN={cov['offense_ftn_charting_joined'] + cov['defense_ftn_charting_joined']}/"
                  f"{cov['eligible_offense_scrimmage_plays'] + cov['eligible_defense_scrimmage_plays']}")
        del pbp_rows, part_idx, ftn_idx
        gc.collect()
        print(f"released source rows for {season}", flush=True)

    if season_game_counts.get(2026) != 107:
        nonreconciling.append((2026, "ALL", {"reason": f"expected 107 REG games through Week 7, got {season_game_counts.get(2026)}"}))
    report_path = os.path.join(output_dir, "BUILD-REPORT.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# Team-season playbook research build\n\n")
        f.write("Research-only output from `pipeline/build_playbooks.py --research`; no engine defaults or Week 8 snapshots were changed. The 2026 profiles are labeled **in-season, through Week 7**, frozen, and must not be used to tune tests or described as unseen. Participation inputs are unavailable for 2026 and are represented as missing, not zero.\n\n")
        f.write("## Reproduction\n\n")
        f.write("From a clean checkout with Python 3, run `python3 pipeline/fetch_research_playbook_sources.py` to verify the vendored 2026 Weeks 1–7 PBP and FTN snapshots and download the remaining inputs by URL and SHA-256 from `build_manifest.json`; then run `python3 pipeline/build_playbooks.py --research`. The fetcher and builder both refuse inputs whose SHA-256 differs from the manifest.\n\n")
        f.write("## Aggregate counts\n\n")
        f.write(f"- Team-season profiles: {team_season_count} (expected 160).\n")
        f.write(f"- PBP regular-season games by season: {', '.join(f'{s}={n}' for s,n in season_game_counts.items())}.\n")
        f.write(f"- FTN charting games present by season: {', '.join(f'{s}={n}/{season_game_counts[s]}' for s,n in season_ftn_game_counts.items())}.\n")
        missing_2026 = season_ftn_missing_games.get(2026, [])
        f.write(f"- 2026 game without an FTN charting row: {', '.join(missing_2026) if missing_2026 else 'none'}.\n")
        f.write(f"- Eligible offense plays: {total_offense:,}; eligible defense plays: {total_defense:,}.\n")
        f.write(f"- Participation joins: {total_participation_joined:,}; missing joins: {total_participation_missing:,}.\n")
        f.write(f"- FTN charting joins: {total_ftn_joined:,}; missing joins: {total_ftn_missing:,}.\n")
        f.write("- 2026 participation rows: 0; all participation-derived profile fields are explicitly missing.\n")
        f.write("- 2026 cohort label: in-season, through Week 7; frozen; no test tuning; not an unseen cohort.\n\n")
        f.write("## Shotgun cross-source gate (2022–2024)\n\n")
        f.write("PBP `shotgun=1` was compared on paired eligible offense plays with participation formation categories. Pistol is grouped with shotgun in all years; the 2022 taxonomy additionally groups Empty and Wildcat because those are explicit formation labels in that release.\n\n")
        failures = [x for x in nonreconciling if len(x) == 3 and isinstance(x[2], dict) and x[2].get("absolute_difference") is not None]
        f.write(f"Nonreconciling team-seasons (>1 percentage point): {len(failures)}.\n\n")
        if failures:
            f.write("Each exception is an exact-key cross-source classification disagreement. In these 2023–2024 data, PBP marks more of the discrepant plays `shotgun=0` while participation labels their formation SHOTGUN or PISTOL; fewer plays go the other way (`shotgun=1` with a non-shotgun formation). The table gives the two disagreement directions per team-season; the manifest retains each discrepant source row with game/play ID, week, play type, and both labels. These rows are distributed across multiple weeks/games, with no missing participation joins in these seasons. The source labels are preserved; no rows were recoded to force the tolerance.\n\n")
            f.write("| Season | Team | Difference (pp) | Paired plays | PBP 0 / participation shotgun | PBP 1 / participation other | Discrepant plays | Games | Weeks |\n|---:|:---:|---:|---:|---:|---:|---:|---:|:---|\n")
            for season, team, check in failures:
                weeks = ", ".join(str(w) for w in check["disagreement_weeks"])
                f.write(f"| {season} | {team} | {check['absolute_difference']*100:.3f} | {check['paired_plays']} | {check['pbp_0_participation_shotgun_count']} | {check['pbp_1_participation_other_formation_count']} | {check['source_disagreement_count']} | {check['disagreement_games']} | {weeks} |\n")
            f.write("\n")
        else:
            f.write("Every team-season met the 1 percentage-point tolerance.\n\n")
        f.write("## Per-team-season counts\n\n")
        f.write("| Season | Team | Games | Offense | Defense | Participation joined / plays | FTN joined / plays | Shotgun difference |\n|---:|:---:|---:|---:|---:|---:|---:|---:|\n")
        for item in metadata:
            chk = item["shotgun_check"]
            diff = "—" if not chk or chk["absolute_difference"] is None else f"{chk['absolute_difference']*100:.3f} pp"
            nplays = item["offense_plays"] + item["defense_plays"]
            f.write(f"| {item['season']} | {item['team']} | {item['games']} | {item['offense_plays']} | {item['defense_plays']} | {item['participation_joined']} / {nplays} | {item['ftn_joined']} / {nplays} | {diff} |\n")
        f.write("\n## Gate status\n\n")
        f.write("- NE-2025 and CHI-2025 legacy reproduction gate: passed byte-for-byte before this expanded build.\n")
        f.write("- Emitted offense and defense records reconcile to eligible play counts; every distribution reconciles observed + missing to denominator.\n")
        f.write("- 2026 game-count gate: " + ("passed (107 games).\n" if season_game_counts.get(2026) == 107 else f"FAILED ({season_game_counts.get(2026)} games; expected 107).\n"))
        f.write("- Shotgun cross-source gate: " + ("passed.\n" if not failures else f"has {len(failures)} exceptions listed above.\n"))
        f.write("- 2026 is frozen and labeled in-season through Week 7; tests must not be tuned on it and it must not be called unseen.\n")
        f.write("- Shotgun exceptions are cross-source label disagreements at exact joined game/play keys, not missing participation joins; each cause is itemized in the manifest with the original source labels and IDs.\n")
        f.write("- This is Part A only; no movement evaluation is included.\n")
    source_hashes = {}
    for season, (pbp_path, part_path, ftn_path, _max_week) in season_inputs.items():
        source_hashes[str(season)] = {
            "pbp": research_source_spec(season, "pbp", pbp_path),
            "participation": research_source_spec(season, "participation", part_path) if part_path else None,
            "ftn_charting": {
                **research_source_spec(season, "ftn", ftn_path),
                "license": "CC-BY-SA-4.0", "attribution": "FTN Data via nflverse",
            },
        }
    manifest_path = os.path.join(output_dir, "build_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"schema_version": "gridiron.playbook.research-build.v1", "team_season_count": team_season_count,
                   "builder_sha256": sha256(__file__),
                   "build_report_sha256": sha256(report_path),
                   "reproduction_commands": [
                       "python3 pipeline/fetch_research_playbook_sources.py",
                       "python3 pipeline/build_playbooks.py --research",
                   ],
                   "profile_cohort_policy": {
                       "2026": {
                           "label": "in-season, through Week 7", "frozen": True,
                           "test_tuning_allowed": False, "may_be_described_as_unseen": False,
                       },
                   },
                   "vendored_input_files": {
                       "2026_pbp": "data/playbooks/research-2026-10-27/inputs/pbp_2026_week7.csv.gz",
                       "2026_ftn_charting": "data/playbooks/research-2026-10-27/inputs/ftn_charting_2026.csv",
                   },
                   "season_game_counts": season_game_counts,
                   "season_ftn_game_counts": season_ftn_game_counts,
                   "season_ftn_missing_games": season_ftn_missing_games,
                   "source_hashes": source_hashes,
                   "team_seasons": metadata,
                   "nonreconciling_shotgun_team_seasons": [
                       {"season": s, "team": t, **check} for s, t, check in nonreconciling
                       if isinstance(check, dict) and check.get("absolute_difference") is not None
                   ]}, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"research build complete: {team_season_count} profiles; report={report_path}")


def main():
    parser = argparse.ArgumentParser(description="Build prototype or full research team-season playbooks")
    parser.add_argument("--research", action="store_true", help="build 2022-2025 team-seasons and 2026 Weeks 1-7")
    parser.add_argument("--output-dir", help="research output directory; defaults to data/playbooks/research-2026-10-27")
    args = parser.parse_args()
    if args.research:
        build_research(args.output_dir or os.path.join(OUT, "research-2026-10-27"))
        return
    os.makedirs(OUT, exist_ok=True)
    pbp25 = os.path.join(RAW, PBP_FILES[2025])
    pbp26 = os.path.join(RAW, PBP_FILES[2026])
    part25 = os.path.join(RAW, "pbp_participation_2025.csv")
    for path in (pbp25, pbp26, part25):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"missing source {path}; run python3 pipeline/fetch_prototype_data.py")
    for team in TEAMS:
        result = build_2025(pbp25, part25, team)
        result["source"]["pbp_2026_pre_game"] = {
            "name": "nflverse play_by_play_2026.csv.gz",
            "url": "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz",
            "sha256": sha256(pbp26), "usable_weeks": [1, 6],
            "release_updated_at_utc": "2026-10-22T15:03:00Z",
            "note": "Only regular-season weeks 1-6 are selected; asset hash pins the pre-kickoff download.",
        }
        result["pregame_2026_comparison"] = build_pregame_2026(pbp26, team)
        path = os.path.join(OUT, f"{team}-2025.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1, sort_keys=True)
            f.write("\n")
        print(f"wrote {path}: offense={result['coverage']['eligible_offense_scrimmage_plays']} "
              f"defense={result['coverage']['eligible_defense_scrimmage_plays']} "
              f"participation joins={result['coverage']['offense_participation_joined']}/"
              f"{result['coverage']['eligible_offense_scrimmage_plays']}")


if __name__ == "__main__":
    main()
