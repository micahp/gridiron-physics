"""Build source-backed 2025 NE/CHI playbook profiles from nflverse PBP.

The outputs describe recorded play attributes and selected labels, not literal
team play calls. Every aggregate bucket retains its source play IDs.
"""
import csv
import gzip
import hashlib
import json
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "playbooks")
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
            n = clean_int(v)
            return bool(n) if n is not None else None
        return v or None
    if field in ("air_yards", "defenders_in_box", "number_of_pass_rushers"):
        return clean_float((p or {}).get(field) if field in ("defenders_in_box", "number_of_pass_rushers") else r.get(field))
    if field in ("route", "defense_man_zone_type", "defense_coverage_type"):
        return (p or {}).get(field) or None
    if field == "target_available":
        return bool(r.get("receiver_player_id") or r.get("receiver_player_name")) if r.get("pass_attempt") == "1" else None
    if field in ("play_action", "motion"):
        # Preserve these only if a source release actually carries the field.
        raw = r.get(field)
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


def observed_candidates(rows):
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
                "candidate_id": f"observed-2025-{kind}-{slug}-{concept_hash}",
                "provenance": "observed_2025",
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
            "provenance": "observed_2025",
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


def main():
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
