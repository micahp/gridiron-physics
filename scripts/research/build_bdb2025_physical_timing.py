#!/usr/bin/env python3
"""Build the weeks 1-5 snap-anchored BDB physical-timing cohort.

Only the canonical LP cohort manifest determines play inclusion. Tracking
event markers determine the primary terminal family and elapsed duration.
The LP clock-audit table is an optional retrospective cross-check only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


WEEKS = (1, 2, 3, 4, 5)
TERMINAL_EVENTS = {
    "tackle",
    "out_of_bounds",
    "touchdown",
    "qb_sack",
    "qb_slide",
    "qb_kneel",
    "qb_spike",
    "pass_outcome_incomplete",
    "pass_outcome_interception",
    "pass_outcome_touchdown",
    "touchback",
    "fumble_defense_recovered",
    "qb_strip_sack",
}
EVENT_FAMILY = {
    "tackle": "tackle",
    "out_of_bounds": "out_of_bounds",
    "touchdown": "touchdown",
    "pass_outcome_touchdown": "touchdown",
    "qb_sack": "sack",
    "qb_strip_sack": "sack",
    "qb_slide": "quarterback_slide",
    "qb_kneel": "kneel",
    "qb_spike": "spike",
    "pass_outcome_incomplete": "incomplete_pass",
    "pass_outcome_interception": "interception",
    "touchback": "touchback",
    "fumble_defense_recovered": "fumble_recovery",
}
FRAME_SECONDS = 0.1
CARRIER_ACQUISITION_EVENTS = {
    "handoff", "pass_outcome_caught", "pass_outcome_interception",
    "qb_scramble", "qb_sneak", "qb_run",
}
CARRIER_FALLBACK_EVENTS = {
    "fumble", "out_of_bounds", "touchdown", "pass_outcome_touchdown",
    "qb_sack", "qb_strip_sack", "qb_slide", "qb_kneel", "qb_spike", "touchback", "tackle",
}
CARRIER_FRAME_EVENTS = CARRIER_ACQUISITION_EVENTS | CARRIER_FALLBACK_EVENTS
AUDIT_OUTCOME_GROUPS = (
    "run", "pass_complete", "pass_incomplete", "sack", "interception", "fumble", "touchdown", "other"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def key_from_ids(game: str, play: str) -> tuple[int, int]:
    return int(float(game)), int(float(play))


def read_cohort(path: Path) -> tuple[dict[tuple[int, int], dict[str, Any]], int]:
    included: dict[tuple[int, int], dict[str, Any]] = {}
    all_rows = 0
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            all_rows += 1
            if row["eligible_input"].strip().lower() != "true":
                continue
            week = int(row["week"])
            if week not in WEEKS:
                raise ValueError(f"cohort contains reserved/out-of-scope week {week}")
            key = key_from_ids(row["gameId"], row["playId"])
            if key in included:
                raise ValueError(f"duplicate eligible game/play key: {key}")
            included[key] = {
                "game_id": key[0],
                "play_id": key[1],
                "week": week,
                "snap_frame": int(row["origin_frame"]),
            }
    return included, all_rows


class HashingLines:
    """Yield decoded CSV lines while hashing their original bytes."""

    def __init__(self, source: Iterable[bytes], digest: Any):
        self.source = source
        self.digest = digest

    def __iter__(self):
        for raw in self.source:
            self.digest.update(raw)
            yield raw.decode("utf-8")


def scan_week(
    path: Path,
    week: int,
    cohort: dict[tuple[int, int], dict[str, Any]],
) -> tuple[dict[tuple[int, int], list[dict[str, Any]]], dict[tuple[int, int], dict[int, list[dict[str, Any]]]], dict[tuple[int, int], dict[tuple[int, str], dict[str, float | None]]], str, int]:
    events: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    event_frame_positions: dict[tuple[int, int], dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    carrier_frames: dict[tuple[int, int], dict[tuple[int, str], dict[str, float | None]]] = defaultdict(dict)
    digest = hashlib.sha256()
    row_count = 0
    week_keys = {key for key, value in cohort.items() if value["week"] == week}
    with path.open("rb") as f:
        reader = csv.reader(HashingLines(f, digest))
        header = next(reader)
        ix = {name: header.index(name) for name in (
            "gameId", "playId", "nflId", "frameId", "frameType", "time", "x", "y", "s", "a", "event"
        )}
        for row in reader:
            row_count += 1
            try:
                key = key_from_ids(row[ix["gameId"]], row[ix["playId"]])
            except (ValueError, IndexError):
                continue
            if key not in week_keys:
                continue
            try:
                frame = int(row[ix["frameId"]])
            except (ValueError, IndexError):
                continue
            event = row[ix["event"]].strip()
            nfl_id = row[ix["nflId"]].strip()
            event_time = row[ix["time"]].strip()
            if event == "ball_snap" or event in TERMINAL_EVENTS or event in CARRIER_FRAME_EVENTS:
                events[key].append({
                    "frame": frame,
                    "frame_type": row[ix["frameType"]].strip(),
                    "time": event_time,
                    "event": event,
                })
            if event in CARRIER_FRAME_EVENTS:
                def position_number(name: str) -> float | None:
                    raw = row[ix[name]].strip()
                    return None if raw in ("", "NA", "NaN", "nan") else float(raw)

                event_frame_positions[key][frame].append({
                    "nfl_id": None if nfl_id in ("", "NA", "nan", "NaN") else str(int(float(nfl_id))),
                    "football": nfl_id in ("", "NA", "nan", "NaN"),
                    "x": position_number("x"),
                    "y": position_number("y"),
                })
            snap_frame = cohort[key]["snap_frame"]
            if nfl_id not in ("", "NA", "nan", "NaN") and snap_frame - 2 <= frame <= snap_frame:
                def number(name: str) -> float | None:
                    raw = row[ix[name]].strip()
                    return None if raw in ("", "NA", "NaN", "nan") else float(raw)

                carrier_frames[key][(frame, str(int(float(nfl_id))))] = {
                    "x": number("x"),
                    "y": number("y"),
                    "s": number("s"),
                    "a": number("a"),
                }
    return events, event_frame_positions, carrier_frames, digest.hexdigest(), row_count


def nearest_player_to_ball(positions: list[dict[str, Any]]) -> tuple[str | None, float | None]:
    balls = [p for p in positions if p["football"] and p["x"] is not None and p["y"] is not None]
    players = [p for p in positions if not p["football"] and p["nfl_id"] and p["x"] is not None and p["y"] is not None]
    if not balls or not players:
        return None, None
    ball = balls[0]
    distance, player = min(
        ((math.hypot(p["x"] - ball["x"], p["y"] - ball["y"]), p) for p in players),
        key=lambda pair: (pair[0], pair[1]["nfl_id"]),
    )
    return player["nfl_id"], round(distance, 3)


def vec(values: dict[int, dict[str, float | None]], snap: int) -> dict[str, float | None]:
    p2, p1, p0 = values.get(snap - 2), values.get(snap - 1), values.get(snap)
    result: dict[str, float | None] = {
        "velocity_x_yards_per_second": None,
        "velocity_y_yards_per_second": None,
        "speed_yards_per_second": None,
        "acceleration_x_yards_per_second_squared": None,
        "acceleration_y_yards_per_second_squared": None,
        "acceleration_magnitude_yards_per_second_squared": None,
        "tracking_speed_at_snap_yards_per_second": None,
        "tracking_acceleration_at_snap_yards_per_second_squared": None,
    }
    if p0:
        result["tracking_speed_at_snap_yards_per_second"] = p0["s"]
        result["tracking_acceleration_at_snap_yards_per_second_squared"] = p0["a"]
    if p0 and p1 and p0["x"] is not None and p1["x"] is not None and p0["y"] is not None and p1["y"] is not None:
        vx = (p0["x"] - p1["x"]) / FRAME_SECONDS
        vy = (p0["y"] - p1["y"]) / FRAME_SECONDS
        result["velocity_x_yards_per_second"] = round(vx, 6)
        result["velocity_y_yards_per_second"] = round(vy, 6)
        result["speed_yards_per_second"] = round(math.hypot(vx, vy), 6)
    if (p0 and p1 and p2 and all(p[axis] is not None for p in (p0, p1, p2) for axis in ("x", "y"))):
        ax = (p0["x"] - 2 * p1["x"] + p2["x"]) / (FRAME_SECONDS ** 2)
        ay = (p0["y"] - 2 * p1["y"] + p2["y"]) / (FRAME_SECONDS ** 2)
        result["acceleration_x_yards_per_second_squared"] = round(ax, 6)
        result["acceleration_y_yards_per_second_squared"] = round(ay, 6)
        result["acceleration_magnitude_yards_per_second_squared"] = round(math.hypot(ax, ay), 6)
    return result


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[int(p * (len(ordered) - 1))], 3)


def summarize(groups: dict[str, list[float]]) -> dict[str, dict[str, Any]]:
    summary = {}
    for family, values in sorted(groups.items()):
        if not values:
            summary[family] = {
                "count": 0,
                "median_seconds": None,
                "p10_seconds": None,
                "p90_seconds": None,
            }
            continue
        summary[family] = {
            "count": len(values),
            "median_seconds": round(statistics.median(values), 3),
            "p10_seconds": percentile(values, 0.10),
            "p90_seconds": percentile(values, 0.90),
        }
    return summary


def read_clock_audit(path: Path | None) -> dict[tuple[int, int], dict[str, str]]:
    if path is None:
        return {}
    rows: dict[tuple[int, int], dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = key_from_ids(row["bdb_game"], row["bdb_play"])
            if key in rows:
                raise ValueError(f"duplicate BDB key in LP crosswalk: {key}")
            if not row.get("lp_game_id", "").strip() or not row.get("lp_play_id", "").strip():
                raise ValueError(f"missing LP nfl_pbp key for crosswalk row {key}")
            rows[key] = row
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracking-root", type=Path, required=True)
    parser.add_argument("--cohort-manifest", type=Path, required=True)
    parser.add_argument("--clock-audit-csv", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    cohort, manifest_rows = read_cohort(args.cohort_manifest)
    all_events: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    all_event_frame_positions: dict[tuple[int, int], dict[int, list[dict[str, Any]]]] = defaultdict(dict)
    all_carrier_frames: dict[tuple[int, int], dict[tuple[int, str], dict[str, float | None]]] = defaultdict(dict)
    tracking_inputs = []
    tracking_row_counts: dict[str, int] = {}
    for week in WEEKS:
        path = args.tracking_root / f"tracking_week_{week}.csv"
        events, frame_positions, frames, sha, rows = scan_week(path, week, cohort)
        for key, values in events.items():
            all_events[key].extend(values)
            all_event_frame_positions[key] = all_event_frame_positions.get(key, {}) | frame_positions.get(key, {})
        for key, values in frames.items():
            all_carrier_frames[key].update(values)
        tracking_inputs.append({"path": str(path), "sha256": sha})
        tracking_row_counts[str(week)] = rows
        print(f"week {week}: scanned {rows:,} tracking rows", flush=True)

    audit = read_clock_audit(args.clock_audit_csv)
    records = []
    families: dict[str, list[float]] = defaultdict(list)
    audit_groups: dict[str, list[float]] = {label: [] for label in AUDIT_OUTCOME_GROUPS}
    audit_metrics = Counter()
    for key, base in sorted(cohort.items(), key=lambda item: (item[1]["week"], item[0])):
        markers = all_events.get(key, [])
        snaps = [e for e in markers if e["event"] == "ball_snap" and e["frame_type"] == "SNAP"]
        snap_marker = next((e for e in snaps if e["frame"] == base["snap_frame"]), None)
        snap_time = parse_time(snap_marker["time"]) if snap_marker else None
        terminal_options = []
        if snap_time:
            for event in markers:
                if event["event"] not in TERMINAL_EVENTS:
                    continue
                event_time = parse_time(event["time"])
                if event_time >= snap_time:
                    terminal_options.append((event_time, event["frame"], event["event"]))
        terminal = min(terminal_options) if terminal_options else None
        terminal_time, terminal_frame, terminal_event = terminal if terminal else (None, None, None)
        elapsed = (terminal_time - snap_time).total_seconds() if terminal_time and snap_time else None
        family = EVENT_FAMILY.get(terminal_event) if terminal_event else None
        if elapsed is not None and family:
            families[family].append(elapsed)

        candidate_events: dict[tuple[int, str, str], dict[str, Any]] = {}
        for event in markers:
            if event["event"] in CARRIER_FRAME_EVENTS and event["frame"] >= base["snap_frame"]:
                candidate_events[(event["frame"], event["event"], event["time"])] = event
        carrier_options = [e for e in candidate_events.values() if e["event"] in CARRIER_ACQUISITION_EVENTS]
        if not carrier_options:
            carrier_options = [e for e in candidate_events.values() if e["event"] in CARRIER_FALLBACK_EVENTS]
        carrier_event = min(carrier_options, key=lambda x: (parse_time(x["time"]), x["frame"], x["event"])) if carrier_options else None
        carrier, carrier_distance = nearest_player_to_ball(
            all_event_frame_positions.get(key, {}).get(carrier_event["frame"], [])
        ) if carrier_event else (None, None)
        carrier_frames = {
            frame: data for (frame, nfl_id), data in all_carrier_frames.get(key, {}).items()
            if nfl_id == carrier
        } if carrier else {}
        kine = vec(carrier_frames, base["snap_frame"])
        audit_row = audit.get(key)
        lp_game_id = audit_row["lp_game_id"].strip() if audit_row and audit_row["lp_game_id"].strip() else None
        lp_play_id = int(float(audit_row["lp_play_id"])) if audit_row and audit_row["lp_play_id"].strip() else None
        carrier_candidates = []
        if carrier:
            carrier_candidates.append({
                "nfl_id": carrier,
                "event_marker": carrier_event["event"],
                "event_frame": carrier_event["frame"],
                "distance_to_football_yards": carrier_distance,
                "kinematics_at_snap": kine,
            })
        audit_crosscheck = None
        if audit_row is not None:
            audit_metrics["matched_records"] += 1
            audit_duration = float(audit_row["in_play_seconds"]) if audit_row["in_play_seconds"].strip() else None
            audit_terminal = audit_row["terminal_event"].strip() or None
            if audit_terminal == terminal_event:
                audit_metrics["terminal_event_match"] += 1
            if audit_duration is not None and elapsed is not None and abs(audit_duration - elapsed) <= 0.001:
                audit_metrics["elapsed_seconds_match"] += 1
            label = audit_row["outcome"].strip() or None
            if label and audit_duration is not None:
                audit_groups[label].append(audit_duration)
            audit_crosscheck = {
                "lp_clock_audit_outcome_label": label,
                "lp_clock_audit_terminal_event": audit_terminal,
                "lp_clock_audit_in_play_seconds": audit_duration,
            }

        records.append({
            **base,
            "lp_game_id": lp_game_id,
            "lp_play_id": lp_play_id,
            "lp_join_status": "matched" if lp_game_id is not None and lp_play_id is not None else "unmatched",
            "snap_frame_type": snap_marker["frame_type"] if snap_marker else None,
            "snap_event_frame": snap_marker["frame"] if snap_marker else None,
            "snap_event_time": snap_marker["time"] if snap_marker else None,
            "snap_event_matches_manifest": snap_marker is not None,
            "terminal_frame": terminal_frame,
            "terminal_event_time": terminal_time.isoformat(sep=" ") if terminal_time else None,
            "terminal_event": terminal_event,
            "outcome_family_tracking_only": family,
            "timing_status": "resolved" if elapsed is not None and family is not None else "unresolved_terminal",
            "elapsed_seconds": round(elapsed, 3) if elapsed is not None else None,
            "elapsed_frames": terminal_frame - base["snap_frame"] if terminal_frame is not None else None,
            "elapsed_seconds_from_frames": round((terminal_frame - base["snap_frame"]) * FRAME_SECONDS, 3) if terminal_frame is not None else None,
            "carrier_candidates": carrier_candidates,
            "clock_audit_crosscheck_only": audit_crosscheck,
        })

    audit_metrics["tracking_terminal_family_records"] = sum(bool(x["outcome_family_tracking_only"]) for x in records)
    audit_metrics["missing_snap_event_at_manifest_frame"] = sum(not x["snap_event_matches_manifest"] for x in records)
    audit_metrics["missing_terminal_event"] = sum(x["terminal_frame"] is None for x in records)
    audit_metrics["lp_join_key_available"] = sum(x["lp_join_status"] == "matched" for x in records)
    audit_metrics["resolved_and_lp_joinable"] = sum(x["timing_status"] == "resolved" and x["lp_join_status"] == "matched" for x in records)
    audit_metrics["resolved_without_lp_join_key"] = sum(x["timing_status"] == "resolved" and x["lp_join_status"] != "matched" for x in records)
    audit_metrics["carrier_candidate_available"] = sum(bool(x["carrier_candidates"]) for x in records)
    audit_metrics["carrier_candidate_and_lp_joinable"] = sum(bool(x["carrier_candidates"]) and x["lp_join_status"] == "matched" for x in records)
    audit_metrics["carrier_candidate_without_lp_join_key"] = sum(bool(x["carrier_candidates"]) and x["lp_join_status"] != "matched" for x in records)
    audit_metrics["carrier_candidates_without_terminal_timing"] = sum(bool(x["carrier_candidates"]) and x["timing_status"] != "resolved" for x in records)
    audit_metrics["carrier_velocity_available"] = sum(bool(x["carrier_candidates"]) and x["carrier_candidates"][0]["kinematics_at_snap"]["speed_yards_per_second"] is not None for x in records)
    audit_metrics["carrier_acceleration_available"] = sum(bool(x["carrier_candidates"]) and x["carrier_candidates"][0]["kinematics_at_snap"]["acceleration_magnitude_yards_per_second_squared"] is not None for x in records)
    lp_keys = [(x["lp_game_id"], x["lp_play_id"]) for x in records if x["lp_join_status"] == "matched"]
    if len(lp_keys) != len(set(lp_keys)):
        raise ValueError("LP nfl_pbp join keys are not unique in the eligible cohort")

    result = {
        "schema": "gridiron.bdb2025.snap_physical_timing.v2",
        "date": "2026-10-24",
        "cohort": {
            "key": ["game_id", "play_id"],
            "key_source": "BDB tracking gameId/playId; these are retained as source identifiers",
            "lp_nfl_pbp_join_key": ["lp_game_id", "lp_play_id"],
            "weeks": list(WEEKS),
            "manifest_rows": manifest_rows,
            "eligible_plays": len(cohort),
            "selection_source": "LP canonical bdb2025 snap-anchored cohort; eligible_input=true only",
        },
        "method": {
            "snap": "manifest origin_frame, cross-checked against tracking frameType=SNAP and event=ball_snap",
            "terminal": "earliest tracking event in LP clock-audit TERMINAL taxonomy at or after the matched snap timestamp",
            "duration": "tracking terminal timestamp minus ball_snap timestamp; the source is sampled at 10 Hz",
            "outcome_family": "normalized from the tracking terminal event only; null if no terminal event is resolved",
            "carrier_subject": "retrospective event frame; candidate is the nearest tracked player to football at the earliest acquisition marker (handoff/catch/interception/run), falling back to the earliest supported terminal marker; candidate ID is a retrospective label only, not cohort selection or model input; distance is retained because possession is not directly flagged",
            "carrier_velocity_acceleration": "finite differences of the candidate player's tracking x/y at snap and the two immediately preceding frames; future coordinates are used only to identify the retrospective subject, never for reported kinematics or model inputs",
            "coordinate_units": "yards; velocity in yards/second; acceleration in yards/second^2",
            "percentiles": "nearest lower empirical order statistic at floor(p*(n-1)); median uses the standard sample median",
            "lp_clock_audit": "supplies the exact BDB-to-LP game/play crosswalk when present; outcome labels, terminal event, and duration are separate retrospective checks and do not determine the primary tracking family or duration",
        },
        "limitations": [
            "Tracking is sampled at 10 Hz, so event timing is quantized and sub-frame motion is not observed.",
            "The terminal event marker is not a whistle timestamp.",
            "Tracking does not attribute clock stoppage or runoff to rules, officials, timeout use, or other stoppage causes.",
            "Ball-carrier identity is an unverified nearest-player-to-football inference at an event frame; candidate distances are retained, and only snap/pre-snap coordinates contribute to the reported kinematics.",
            "Carrier candidate identity uses a retrospective event frame and is not a prospective input; only the candidate's snap and pre-snap tracking contributes to the reported kinematics.",
        ],
        "input_manifest": {
            "tracking_source": {
                "mirror": "b00nk3r/NFL-Big-Data-Bowl-2025",
                "source_commit": "e28d3b25725799ef2213680016db5325f6f90014",
                "included_weeks_only": list(WEEKS),
                "files": tracking_inputs,
                "rows_scanned_by_week": tracking_row_counts,
            },
            "canonical_cohort_manifest": {"path": str(args.cohort_manifest), "sha256": sha256_file(args.cohort_manifest)},
            "lp_clock_audit_crosswalk_and_crosscheck": None if args.clock_audit_csv is None else {"path": str(args.clock_audit_csv), "sha256": sha256_file(args.clock_audit_csv)},
        },
        "coverage": dict(audit_metrics),
        "by_tracking_outcome_family": summarize(families),
        "by_lp_clock_audit_outcome_crosscheck": summarize(audit_groups),
        "plays": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"cohort_size": len(records), "coverage": result["coverage"],
                      "tracking_families": result["by_tracking_outcome_family"],
                      "audit_outcome_crosscheck": result["by_lp_clock_audit_outcome_crosscheck"],
                      "output": str(args.output), "output_sha256": sha256_file(args.output)}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
