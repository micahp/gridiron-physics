#!/usr/bin/env python3
"""Build descriptive, PBP-only conditional play and drive distributions."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_DEFAULT = Path("/root/legendarypicks/backend/data/picks.dev.db")
SCOPE_SQL = "((p.season=2022 AND p.week BETWEEN 1 AND 5) OR p.season BETWEEN 2023 AND 2025)"
QUERY_FIELDS = (
    "p.season", "p.week", "p.game_id", "p.play_id", "p.posteam", "p.qtr", "p.down", "p.ydstogo",
    "p.yardline_100", "p.game_seconds_remaining", "p.play_type", "p.yards_gained", "p.series", "p.series_result",
    "p.drive", "p.complete_pass", "p.touchdown", "p.sack", "p.interception", "p.fumble_lost", "p.qb_dropback",
)
DISTANCE_BANDS = ((0, 3, "0-3"), (4, 6, "4-6"), (7, 10, "7-10"), (11, 10_000, "11+"))
FIELD_ZONES = ("red_zone_0-20", "opponent_half_21-50", "own_half_51-80", "backed_up_81-99", "unknown")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(rows) -> str:
    raw = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return sha256_bytes(raw)


def load_rows(db_path: Path):
    connection = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        available = {row[1] for row in connection.execute("PRAGMA table_info(nfl_pbp)")}
        missing = sorted(set(field.split(".")[1] for field in QUERY_FIELDS) - available)
        if missing:
            raise ValueError(f"nfl_pbp missing required fields: {missing}")
        fields = ", ".join(QUERY_FIELDS)
        rows = [dict(row) for row in connection.execute(
            f"SELECT {fields} FROM nfl_pbp AS p "
            "JOIN nfl_schedule AS s ON s.season=p.season AND s.game_id=p.game_id "
            f"WHERE s.game_type='REG' AND {SCOPE_SQL} "
            "ORDER BY p.season,p.week,p.game_id,p.play_id"
        )]
        games = [dict(row) for row in connection.execute(
            "SELECT season, week, game_id, home_score, away_score FROM nfl_schedule "
            "WHERE game_type='REG' AND ((season=2022 AND week BETWEEN 1 AND 5) OR season BETWEEN 2023 AND 2025) "
            "ORDER BY season,week,game_id"
        )]
    finally:
        connection.close()
    if any(int(row["season"]) == 2022 and 6 <= int(row["week"]) <= 9 for row in rows):
        raise ValueError("reserved 2022 weeks 6-9 entered the PBP cohort")
    return rows, games


def distance_band(value):
    try:
        distance = int(value)
    except (TypeError, ValueError):
        return "unknown"
    if distance < 0:
        return "unknown"
    for low, high, label in DISTANCE_BANDS:
        if low <= distance <= high:
            return label
    return "unknown"


def field_zone(value):
    if value is None:
        return "unknown"
    try:
        yardline = float(value)
    except (TypeError, ValueError):
        return "unknown"
    if not 0 <= yardline <= 99:
        return "unknown"
    if yardline <= 20:
        return "red_zone_0-20"
    if yardline <= 50:
        return "opponent_half_21-50"
    if yardline <= 80:
        return "own_half_51-80"
    return "backed_up_81-99"


def clock_band(row):
    q = row["qtr"]
    sec = row["game_seconds_remaining"]
    if q not in (1, 2, 3, 4) or sec is None:
        return "unknown"
    quarter_sec = float(sec) - (4 - int(q)) * 900
    if not 0 <= quarter_sec <= 900:
        return "unknown"
    if quarter_sec <= 120:
        return "0-120"
    if quarter_sec <= 600:
        return "121-600"
    return "601-900"


def eligible_play(row):
    return (
        row["play_type"] in ("pass", "run")
        and row["down"] in (1, 2, 3, 4)
        and row["ydstogo"] is not None and float(row["ydstogo"]) >= 0
        and row["yardline_100"] is not None and 0 <= float(row["yardline_100"]) <= 99
    )


def terminal_maps(rows):
    series_groups = defaultdict(list)
    drive_groups = defaultdict(list)
    for row in rows:
        game_key = (int(row["season"]), str(row["game_id"]))
        if row["series"] is not None:
            series_groups[(*game_key, str(row["series"]))].append(row)
        if row["drive"] is not None:
            drive_groups[(*game_key, str(row["drive"]))].append(row)
    series_terminal = set()
    for group in series_groups.values():
        final = max(group, key=lambda row: int(row["play_id"]))
        if final["series_result"] is not None:
            series_terminal.add((int(final["season"]), str(final["game_id"]), int(final["play_id"])))
    return series_terminal, drive_groups


def _quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = probability * (len(ordered) - 1)
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _rate(numerator, denominator):
    return None if denominator == 0 else numerator / denominator


def _mix_table(plays, key_fn):
    groups = defaultdict(Counter)
    totals = Counter()
    for row in plays:
        key = key_fn(row)
        groups[key][row["play_type"]] += 1
        totals[key] += 1
    result = []
    for key in sorted(groups, key=lambda item: tuple(str(x) for x in (item if isinstance(item, tuple) else (item,)))):
        counts = groups[key]
        denominator = totals[key]
        result.append({
            "condition": list(key) if isinstance(key, tuple) else [key],
            "eligible_pass_run_plays": denominator,
            "pass_count": counts["pass"],
            "run_count": counts["run"],
            "pass_share": counts["pass"] / denominator,
            "run_share": counts["run"] / denominator,
        })
    return result


def _conditional_yards(plays, series_terminal):
    groups = defaultdict(list)
    for row in plays:
        groups[(int(row["down"]), distance_band(row["ydstogo"]), row["play_type"])].append(row)
    result = []
    for (down, band, kind), items in sorted(groups.items()):
        yards = [float(row["yards_gained"]) for row in items if row["yards_gained"] is not None]
        terminal = [row for row in items if (int(row["season"]), str(row["game_id"]), int(row["play_id"])) in series_terminal]
        first_downs = sum(row["series_result"] == "First down" for row in terminal)
        touchdowns = sum(row["touchdown"] == 1 for row in items)
        result.append({
            "down": down,
            "distance_band": band,
            "play_type": kind,
            "eligible_plays": len(items),
            "yards_gained_observed_count": len(yards),
            "yards_gained_p10": _quantile(yards, 0.10),
            "yards_gained_p50": statistics.median(yards) if yards else None,
            "yards_gained_p90": _quantile(yards, 0.90),
            "series_terminal_plays_with_result": len(terminal),
            "first_down_series_terminals": first_downs,
            "first_down_rate_among_series_terminals": _rate(first_downs, len(terminal)),
            "touchdowns": touchdowns,
        })
    return result


def _dropback_events(plays):
    groups = defaultdict(list)
    for row in plays:
        if row["qb_dropback"] == 1:
            groups[(int(row["down"]), distance_band(row["ydstogo"]))].append(row)
    result = []
    for (down, band), items in sorted(groups.items()):
        denominator = len(items)
        known_sack = [row for row in items if row["sack"] is not None]
        known_interception = [row for row in items if row["interception"] is not None]
        known_fumble = [row for row in items if row["fumble_lost"] is not None]
        sacks = sum(row["sack"] == 1 for row in known_sack)
        interceptions = sum(row["interception"] == 1 for row in known_interception)
        fumbles = sum(row["fumble_lost"] == 1 for row in known_fumble)
        result.append({
            "down": down,
            "distance_band": band,
            "qb_dropbacks": denominator,
            "sack_count": sacks,
            "sack_rate_known_flags": _rate(sacks, len(known_sack)),
            "sack_flag_known_count": len(known_sack),
            "interception_count": interceptions,
            "interception_rate_known_flags": _rate(interceptions, len(known_interception)),
            "interception_flag_known_count": len(known_interception),
            "fumble_lost_count": fumbles,
            "fumble_lost_rate_known_flags": _rate(fumbles, len(known_fumble)),
            "fumble_lost_flag_known_count": len(known_fumble),
        })
    return result


def _series_conversions(rows, series_terminal):
    groups = defaultdict(Counter)
    for row in rows:
        key = (int(row["season"]), str(row["game_id"]), int(row["play_id"]))
        if row["down"] not in (3, 4) or key not in series_terminal:
            continue
        result = row["series_result"]
        groups[(int(row["down"]), row["play_type"] or "unknown")][result] += 1
    table = []
    for (down, kind), counts in sorted(groups.items()):
        denominator = sum(counts.values())
        converted = counts["First down"] + counts["Touchdown"]
        table.append({
            "down": down,
            "play_type": kind,
            "resolved_series_terminals": denominator,
            "first_down_or_touchdown": converted,
            "first_down_or_touchdown_share": converted / denominator,
            "terminal_results": dict(sorted(counts.items())),
        })
    return table


def _drive_tables(drive_groups):
    by_zone_terminal = defaultdict(list)
    terminal_counts = defaultdict(Counter)
    missing_terminal = 0
    for rows in drive_groups.values():
        rows = sorted(rows, key=lambda row: int(row["play_id"]))
        first = next((row for row in rows if row["yardline_100"] is not None and row["play_type"] not in ("kickoff", "extra_point")), None)
        zone = field_zone(first["yardline_100"] if first else None)
        last = rows[-1]
        terminal = last["series_result"]
        if terminal is None:
            missing_terminal += 1
            continue
        terminal_counts[zone][str(terminal)] += 1
        by_zone_terminal[(zone, str(terminal))].append(len(rows))
    mix = []
    for zone in FIELD_ZONES:
        counts = terminal_counts.get(zone, Counter())
        denominator = sum(counts.values())
        if not denominator:
            continue
        mix.append({
            "starting_field_zone": zone,
            "resolved_drive_count": denominator,
            "terminal_result_counts": dict(sorted(counts.items())),
            "terminal_result_shares": {name: count / denominator for name, count in sorted(counts.items())},
        })
    length = []
    for (zone, terminal), values in sorted(by_zone_terminal.items()):
        length.append({
            "starting_field_zone": zone,
            "terminal_result": terminal,
            "drive_count": len(values),
            "plays_per_drive_p10": _quantile(values, 0.10),
            "plays_per_drive_p50": statistics.median(values),
            "plays_per_drive_p90": _quantile(values, 0.90),
        })
    return mix, length, missing_terminal


def build(db_path: Path):
    rows, games = load_rows(db_path)
    series_terminal, drive_groups = terminal_maps(rows)
    plays = [row for row in rows if eligible_play(row)]
    if not games or not plays:
        raise ValueError("the scope returned no scheduled games or eligible pass/run plays")
    for row in plays:
        row["_distance_band"] = distance_band(row["ydstogo"])
        row["_field_zone"] = field_zone(row["yardline_100"])
        row["_clock_band"] = clock_band(row)
    pass_run_down_distance = _mix_table(plays, lambda row: (int(row["down"]), row["_distance_band"]))
    pass_run_field_zone = _mix_table(plays, lambda row: row["_field_zone"])
    pass_run_quarter_clock = _mix_table(
        [row for row in plays if row["_clock_band"] != "unknown"],
        lambda row: (int(row["qtr"]), row["_clock_band"]),
    )
    drive_mix, drive_lengths, missing_drive_terminals = _drive_tables(drive_groups)
    pbp_hash_rows = [[row[field.split(".")[1]] for field in QUERY_FIELDS] for row in rows]
    schedule_rows = [[g["season"], g["week"], g["game_id"], g["home_score"], g["away_score"]] for g in games]
    return {
        "schema": "gridiron.e3.conditional_pbp_distributions.v1",
        "study": "Retrospective conditional play and drive distributions from PBP only; no tracking features or prediction claim.",
        "sources": {
            "database": str(db_path),
            "open_mode": "SQLite mode=ro; PRAGMA query_only=ON",
            "scope": "regular season; 2022 weeks 1-5 and 2023-2025; 2022 weeks 6-9 excluded in SQL",
            "weeks_6_9_queried": False,
            "scheduled_games": len(games),
            "pbp_rows": len(rows),
            "eligible_pass_run_plays": len(plays),
            "nonnull_drive_groups": len(drive_groups),
            "pbp_selected_rows_sha256": canonical_sha(pbp_hash_rows),
            "schedule_score_rows_sha256": canonical_sha(schedule_rows),
        },
        "definitions": {
            "conditioning_state": ["down", "distance_band", "yardline_100 field zone", "quarter", "derived quarter_seconds_remaining band"],
            "conditioning_state_excludes": ["score differential: no play-state score-differential field exists in this nfl_pbp schema"],
            "eligible_pass_run_play": "play_type in {pass, run}; down 1-4; ydstogo >= 0; yardline_100 in [0,99]",
            "distance_bands": ["0-3", "4-6", "7-10", "11+"],
            "field_zones": list(FIELD_ZONES[:-1]),
            "clock_bands_seconds_remaining": ["0-120", "121-600", "601-900"],
            "quarter_clock_derivation": "game_seconds_remaining - (4 - qtr) * 900 for regulation quarters 1-4; values outside 0-900 are excluded as unknown",
            "series_terminal": "last play_id within (season, game_id, series) when series_result is non-null",
            "drive_terminal": "last play_id within (season, game_id, drive); result is source series_result",
            "first_down_or_touchdown_share": "share of resolved third/fourth-down series-terminal rows with result First down or Touchdown; includes punts, field goals and no_play rows by play_type and is not an attempt-only conversion probability",
            "quantiles": "linear empirical quantiles at p10/p90; median is ordinary sample median",
        },
        "conditionals": {
            "pass_run_by_down_distance": pass_run_down_distance,
            "pass_run_by_field_zone": pass_run_field_zone,
            "pass_run_by_quarter_clock": pass_run_quarter_clock,
            "yards_and_first_downs_by_down_distance_play_type": _conditional_yards(plays, series_terminal),
            "dropback_events_by_down_distance": _dropback_events(plays),
            "third_fourth_down_series_outcomes": _series_conversions(rows, series_terminal),
            "drive_terminal_by_starting_field_zone": drive_mix,
            "plays_per_drive_by_starting_zone_and_terminal": drive_lengths,
        },
        "coverage": {
            "series_terminal_plays_with_resolved_source_result": len(series_terminal),
            "drive_groups_with_missing_terminal_result": missing_drive_terminals,
            "note": "Each table reports its own denominator and source-flag coverage. Rates are descriptive frequencies, not calibrated probabilities or a model evaluation.",
        },
        "limitations": [
            "nfl_pbp has no pre-play score differential field in the selected schema; score-conditional rates are omitted rather than reconstructed from future scores.",
            "First-down and drive-terminal outcomes are retrospective source labels; these tables do not establish pregame predictive skill.",
            "The cohort intentionally excludes 2022 weeks 6-9; it is not a blind evaluation set for any model already developed on these seasons.",
            "No tracking files, physical timing cohort, LP game payload, or engine code is consumed.",
        ],
    }


def render_markdown(data):
    cond = data["conditionals"]
    lines = [
        "# Conditional PBP distributions for E3 — 2026-10-24", "",
        "## Scope", "",
        f"Read-only observed cohort: {data['sources']['scheduled_games']} regular-season games, {data['sources']['pbp_rows']:,} PBP rows, and {data['sources']['eligible_pass_run_plays']:,} eligible pass/run plays. It uses 2022 weeks 1–5 plus 2023–2025; 2022 weeks 6–9 were excluded in SQL and not queried. No tracking, clock-audit join, LP game payload, or physical features are used.", "",
        "These are descriptive conditional frequencies and outcome summaries, not a forecast model or proof of calibration. Conditions are available pre-play state fields only. Quarter-clock bands are derived from game_seconds_remaining and quarter as `game_seconds_remaining - (4 - quarter) * 900`. The source schema has no score-differential field, so score-conditioned tables are omitted.", "",
        "## Pass/run mix by down and distance", "",
        "| Down | Distance | Eligible plays | Pass | Pass share | Run | Run share |", "| ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in cond["pass_run_by_down_distance"]:
        lines.append(f"| {row['condition'][0]} | {row['condition'][1]} | {row['eligible_pass_run_plays']} | {row['pass_count']} | {row['pass_share']:.4f} | {row['run_count']} | {row['run_share']:.4f} |")
    lines += ["", "## Pass/run mix by field zone", "", "| Field zone | Eligible plays | Pass share | Run share |", "| --- | ---: | ---: | ---: |"]
    for row in cond["pass_run_by_field_zone"]:
        lines.append(f"| {row['condition'][0]} | {row['eligible_pass_run_plays']} | {row['pass_share']:.4f} | {row['run_share']:.4f} |")
    lines += ["", "## Conditional yards, series conversions and drive endings", "",
              "Yards summaries use rows with observed `yards_gained`. First-down rates use only eligible plays that are the resolved terminal row of a series and have a source `series_result`.", "",
              "| Down | Distance | Type | Plays | Yard rows | Yards p10 / p50 / p90 | Resolved series terminals | First downs | First-down rate | TD rows |",
              "| ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |"]
    for row in cond["yards_and_first_downs_by_down_distance_play_type"]:
        quantiles = " / ".join("—" if row[key] is None else f"{row[key]:.1f}" for key in ("yards_gained_p10", "yards_gained_p50", "yards_gained_p90"))
        rate = "—" if row["first_down_rate_among_series_terminals"] is None else f"{row['first_down_rate_among_series_terminals']:.3f}"
        lines.append(f"| {row['down']} | {row['distance_band']} | {row['play_type']} | {row['eligible_plays']} | {row['yards_gained_observed_count']} | {quantiles} | {row['series_terminal_plays_with_result']} | {row['first_down_series_terminals']} | {rate} | {row['touchdowns']} |")
    lines += ["", "### Dropback events by down and distance", "",
              "Rates use known source flags as denominators. The machine-readable table includes total dropbacks and known-flag counts.", "",
              "| Down | Distance | Dropbacks | Sacks / known | INT / known | Lost fumbles / known |",
              "| ---: | --- | ---: | --- | --- | --- |"]
    for row in cond["dropback_events_by_down_distance"]:
        lines.append(f"| {row['down']} | {row['distance_band']} | {row['qb_dropbacks']} | {row['sack_count']} / {row['sack_flag_known_count']} | {row['interception_count']} / {row['interception_flag_known_count']} | {row['fumble_lost_count']} / {row['fumble_lost_flag_known_count']} |")
    lines += ["", "### Third and fourth down series outcomes", "",
              "First down or TD share counts those source results among all resolved terminal series rows, grouped by terminal play type. Since the denominator includes punts, field goals and no-play rows, this is not an attempt-only conversion probability.", "",
              "| Down | Type | Resolved terminal series | First down or TD | Share | Terminal results |",
              "| ---: | --- | ---: | ---: | ---: | --- |"]
    for row in cond["third_fourth_down_series_outcomes"]:
        lines.append(f"| {row['down']} | {row['play_type']} | {row['resolved_series_terminals']} | {row['first_down_or_touchdown']} | {row['first_down_or_touchdown_share']:.3f} | {json.dumps(row['terminal_results'], sort_keys=True)} |")
    lines += ["", "### Drive endings by starting field zone", "",
              "| Starting field zone | Resolved drives | Terminal result counts |",
              "| --- | ---: | --- |"]
    for row in cond["drive_terminal_by_starting_field_zone"]:
        lines.append(f"| {row['starting_field_zone']} | {row['resolved_drive_count']} | {json.dumps(row['terminal_result_counts'], sort_keys=True)} |")
    lines += ["", "| Starting field zone | Terminal result | Drives | Plays/drive p10 / p50 / p90 |",
              "| --- | --- | ---: | --- |"]
    for row in cond["plays_per_drive_by_starting_zone_and_terminal"]:
        lines.append(f"| {row['starting_field_zone']} | {row['terminal_result']} | {row['drive_count']} | {row['plays_per_drive_p10']:.1f} / {row['plays_per_drive_p50']:.1f} / {row['plays_per_drive_p90']:.1f} |")
    lines += ["",
              f"Resolved drive terminal coverage: {sum(row['resolved_drive_count'] for row in cond['drive_terminal_by_starting_field_zone']):,} drives. Drive groups with no terminal series_result: {data['coverage']['drive_groups_with_missing_terminal_result']}.", "",
              "## Provenance and limits", "",
              f"- PBP rows SHA-256: `{data['sources']['pbp_selected_rows_sha256']}`; official schedule score rows SHA-256: `{data['sources']['schedule_score_rows_sha256']}`.",
              "- Conditions use down, distance, yardline_100 field zone, quarter and derived quarter-clock bands. All outcome fields remain retrospective source labels.",
              "- `score differential` is not in this nfl_pbp schema. It is not imputed from score outcomes or schedule finals.",
              "- Weeks 6–9 of 2022 were not queried. The observed set is development/reference evidence, not an untouched holdout.",
              "- No 2022 tracking data, physical timing cohort, LP game payload, or simulator engine was read.", "",
              "## Reproduction", "", "```bash",
              "python scripts/research/e3_conditional_pbp_distributions.py \\",
              "  --db /root/legendarypicks/backend/data/picks.dev.db \\",
              "  --json-output docs/evidence/e3/conditional-pbp-distributions-2022-2025-no-2022-wk6-9-2026-10-24.json \\",
              "  --markdown-output docs/evidence/e3/CONDITIONAL-PBP-DISTRIBUTIONS-2022-2025-NO-2022-WK6-9-2026-10-24.md",
              "```", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DB_DEFAULT)
    parser.add_argument("--json-output", type=Path, default=ROOT / "docs/evidence/e3/conditional-pbp-distributions-2022-2025-no-2022-wk6-9-2026-10-24.json")
    parser.add_argument("--markdown-output", type=Path, default=ROOT / "docs/evidence/e3/CONDITIONAL-PBP-DISTRIBUTIONS-2022-2025-NO-2022-WK6-9-2026-10-24.md")
    args = parser.parse_args()
    data = build(args.db)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.markdown_output.write_text(render_markdown(data), encoding="utf-8")
    print(f"PASS: read-only observed cohort {data['sources']['scheduled_games']} games / {data['sources']['pbp_rows']} PBP rows")
    print(f"PASS: conditional tables emitted; weeks 6-9 queried=false; tracking inputs=0")
    print(f"JSON SHA-256: {sha256_bytes(args.json_output.read_bytes())}")


if __name__ == "__main__":
    main()
