#!/usr/bin/env python3
"""Inventory complete-play and retrospective carrier-only tracking coverage.

The input week list is deliberately fixed to development weeks 1-5. Cohort
membership comes only from the canonical snap manifest. Terminal markers and
carrier candidates are inventory labels, never model inputs or play selectors.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path

ALLOWED_WEEKS = (1, 2, 3, 4, 5)
DEFAULT_TRACKING_ROOT = Path("/root/nfl-tracking-data/bdb2025")
DEFAULT_COHORT = Path("/root/lp-nfl-snap-benchmark/docs/research/bdb2025-snap-anchored-cohort-v1.csv")
DEFAULT_TIMING = Path("docs/research/gridiron-e3-physical-timing-2026-10-24.json")
DEFAULT_OUTPUT = Path("data/research/team-movement/trajectory-inventory-v1.json")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def as_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def has_xy(row):
    try:
        return row.get("x", "") != "" and row.get("y", "") != "" and \
            float(row["x"]) == float(row["x"]) and float(row["y"]) == float(row["y"])
    except (TypeError, ValueError):
        return False


def player_id(value):
    value = (value or "").strip()
    if value.upper() in {"", "NA", "NAN", "NONE"}:
        return None
    return str(as_int(value)) if as_int(value) is not None else value


def load_inputs(cohort_path: Path, timing_path: Path):
    eligible = {week: set() for week in ALLOWED_WEEKS}
    with cohort_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            week = as_int(row.get("week"))
            if week not in eligible or row.get("eligible_input", "").lower() != "true":
                continue
            eligible[week].add((row["gameId"], row["playId"]))

    timing = json.loads(timing_path.read_text(encoding="utf-8"))
    timing_by_key = {}
    for row in timing["plays"]:
        key = (int(row["week"]), str(row["game_id"]), str(row["play_id"]))
        if key in timing_by_key:
            raise ValueError(f"duplicate physical-timing key: {key}")
        timing_by_key[key] = row
    if sum(map(len, eligible.values())) != timing["cohort"]["eligible_plays"]:
        raise ValueError("canonical eligible cohort count differs from the pinned timing artifact")
    return eligible, timing_by_key


def inventory_play(week: int, key: tuple[str, str], rows, timing: dict, expected_snap: int):
    snap = int(timing["snap_frame"])
    if snap != expected_snap:
        raise ValueError(f"manifest/timing snap mismatch for {(week, *key)}: {expected_snap} vs {snap}")
    terminal = as_int(timing.get("terminal_frame"))
    if terminal is not None and terminal < snap:
        raise ValueError(f"terminal precedes snap for {(week, *key)}")
    cutoff = terminal if terminal is not None else snap + 10

    player_frames: dict[str, set[int]] = defaultdict(set)
    duplicate_player_frames = set()
    player_seen_at_snap = set()
    ball_frames = set()
    duplicate_ball_frames = set()

    for row in rows:
        frame = as_int(row.get("frameId"))
        if frame is None or frame < snap - 10 or frame > cutoff or not has_xy(row):
            continue
        pid = player_id(row.get("nflId"))
        if pid is None:
            if frame in ball_frames:
                duplicate_ball_frames.add(frame)
            ball_frames.add(frame)
            continue
        if frame == snap:
            player_seen_at_snap.add(pid)
        if frame in player_frames[pid]:
            duplicate_player_frames.add((pid, frame))
        player_frames[pid].add(frame)

    history_frames = {snap - 10, snap - 5, snap}
    horizon_frames = {0.5: snap + 5, 1.0: snap + 10}
    players_at_snap = len(player_seen_at_snap)
    players_with_history = sum(history_frames.issubset(player_frames[pid]) for pid in player_seen_at_snap)
    players_at_half_second = sum(horizon_frames[0.5] in player_frames[pid] for pid in player_seen_at_snap)
    players_at_one_second = sum(horizon_frames[1.0] in player_frames[pid] for pid in player_seen_at_snap)

    carrier_rows = timing.get("carrier_candidates") or []
    carrier_id = player_id(carrier_rows[0].get("nfl_id")) if carrier_rows else None
    carrier_snap_history = bool(carrier_id and history_frames.issubset(player_frames[carrier_id]))

    if terminal is None:
        complete_player_count = None
        all22_complete = None
        ball_complete = None
        carrier_complete = None
        expected_frame_count = None
        trajectory_class = "terminal_unresolved"
    else:
        expected = set(range(snap, terminal + 1))
        complete_player_count = sum(expected.issubset(player_frames[pid]) for pid in player_seen_at_snap)
        duplicate_interval_players = any(pid in player_seen_at_snap and frame in expected
                                         for pid, frame in duplicate_player_frames)
        duplicate_interval_ball = bool(expected.intersection(duplicate_ball_frames))
        all22_complete = players_at_snap == 22 and complete_player_count == 22 and not duplicate_interval_players
        ball_complete = expected.issubset(ball_frames) and not duplicate_interval_ball
        carrier_complete = bool(carrier_id and carrier_id in player_seen_at_snap and
                                expected.issubset(player_frames[carrier_id]))
        expected_frame_count = len(expected)
        if all22_complete:
            trajectory_class = "complete_22_players"
        elif carrier_complete:
            trajectory_class = "carrier_only_complete"
        else:
            trajectory_class = "partial_or_missing"

    return {
        "week": week,
        "game_id": int(key[0]),
        "play_id": int(key[1]),
        "lp_game_id": timing.get("lp_game_id"),
        "lp_play_id": timing.get("lp_play_id"),
        "snap_frame": snap,
        "terminal_frame": terminal,
        "terminal_event_tracking_only": timing.get("terminal_event"),
        "outcome_family_tracking_only": timing.get("outcome_family_tracking_only"),
        "timing_status": timing.get("timing_status"),
        "expected_snap_to_terminal_frames": expected_frame_count,
        "players_at_snap_with_xy": players_at_snap,
        "players_with_minus_1_minus_0_5_snap_history": players_with_history,
        "players_with_xy_at_plus_0_5s": players_at_half_second,
        "players_with_xy_at_plus_1_0s": players_at_one_second,
        "players_complete_through_terminal": complete_player_count,
        "complete_22_players_through_terminal": all22_complete,
        "ball_frames_observed_snap_to_terminal_or_plus_1s": sum(frame >= snap and frame <= cutoff for frame in ball_frames),
        "ball_complete_through_terminal": ball_complete,
        "carrier_candidate_id_retrospective_label": carrier_id,
        "carrier_candidate_snap_history_complete": carrier_snap_history,
        "carrier_candidate_complete_through_terminal": carrier_complete,
        "trajectory_class": trajectory_class,
        "duplicate_player_frame_rows": len(duplicate_player_frames),
        "duplicate_ball_frame_rows": len(duplicate_ball_frames),
        "selection_and_input_note": "Cohort selected by canonical snap manifest only. Terminal family and carrier candidate are retrospective inventory labels; never prospective model inputs.",
    }


def scan_week(week: int, tracking_root: Path, eligible, timing_by_key, manifest_by_key):
    if week not in ALLOWED_WEEKS:
        raise ValueError(f"week {week} is reserved and cannot be opened by this inventory")
    path = tracking_root / "code-data" / f"tracking_week_{week}.csv"
    if not path.is_file():
        raise FileNotFoundError(path)
    expected_keys = eligible[week]
    seen = set()
    output = []
    rows_scanned = 0
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for key, grouped_rows in groupby(reader, key=lambda row: (row["gameId"], row["playId"])):
            # Consume the group once, including groups outside the snap cohort.
            if key not in expected_keys:
                for _ in grouped_rows:
                    rows_scanned += 1
                continue
            if key in seen:
                raise ValueError(f"non-contiguous tracking group for week {week}: {key}")
            seen.add(key)
            play_rows = list(grouped_rows)
            rows_scanned += len(play_rows)
            time_key = (week, key[0], key[1])
            if time_key not in timing_by_key:
                raise ValueError(f"eligible play missing from physical-timing artifact: {time_key}")
            manifest_row = manifest_by_key[(week, *key)]
            expected_snap = as_int(manifest_row["origin_frame"])
            output.append(inventory_play(week, key, play_rows, timing_by_key[time_key], expected_snap))

    missing = expected_keys - seen
    if missing:
        raise ValueError(f"week {week} eligible plays absent from raw tracking: {len(missing)}")
    return output, rows_scanned, path


def summarize(records):
    by_class = Counter(row["trajectory_class"] for row in records)
    by_family = defaultdict(Counter)
    for row in records:
        family = row["outcome_family_tracking_only"] or "unresolved_terminal"
        by_family[family][row["trajectory_class"]] += 1
    return {
        "eligible_plays": len(records),
        "terminal_resolved": sum(row["terminal_frame"] is not None for row in records),
        "terminal_unresolved": by_class["terminal_unresolved"],
        "snap_22_with_complete_minus1_minus0_5_history": sum(
            row["players_at_snap_with_xy"] == 22 and row["players_with_minus_1_minus_0_5_snap_history"] == 22
            for row in records),
        "all_22_at_plus_0_5_seconds": sum(row["players_with_xy_at_plus_0_5s"] == 22 for row in records),
        "all_22_at_plus_1_0_seconds": sum(row["players_with_xy_at_plus_1_0s"] == 22 for row in records),
        "complete_22_player_trajectories_snap_through_terminal": by_class["complete_22_players"],
        "complete_carrier_only_trajectories_snap_through_terminal": by_class["carrier_only_complete"],
        "partial_or_missing_trajectories": by_class["partial_or_missing"],
        "retrospective_carrier_candidates": sum(bool(row["carrier_candidate_id_retrospective_label"]) for row in records),
        "carrier_candidates_with_complete_snap_to_terminal_path": sum(
            row["carrier_candidate_complete_through_terminal"] is True for row in records),
        "ball_complete_snap_through_terminal": sum(row["ball_complete_through_terminal"] is True for row in records),
        "by_tracking_terminal_family": {family: dict(sorted(counts.items()))
                                        for family, counts in sorted(by_family.items())},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracking-root", type=Path, default=DEFAULT_TRACKING_ROOT)
    parser.add_argument("--cohort", type=Path, default=DEFAULT_COHORT)
    parser.add_argument("--timing", type=Path, default=DEFAULT_TIMING)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    eligible, timing_by_key = load_inputs(args.cohort, args.timing)
    manifest_by_key = {}
    with args.cohort.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            week = as_int(row.get("week"))
            if week in ALLOWED_WEEKS and row.get("eligible_input", "").lower() == "true":
                manifest_by_key[(week, row["gameId"], row["playId"])] = row

    records, tracking_sources = [], []
    for week in ALLOWED_WEEKS:
        week_records, rows_scanned, path = scan_week(week, args.tracking_root, eligible,
                                                     timing_by_key, manifest_by_key)
        source_hash = sha256_file(path)
        records.extend(week_records)
        tracking_sources.append({"week": week, "path": str(path), "sha256": source_hash,
                                 "rows_scanned": rows_scanned})
        print(f"week {week}: eligible={len(week_records)} rows_scanned={rows_scanned} sha256={source_hash}",
              flush=True)

    if len(records) != sum(len(keys) for keys in eligible.values()):
        raise ValueError("inventory row count differs from canonical eligible cohort")
    records.sort(key=lambda row: (row["week"], row["game_id"], row["play_id"]))
    result = {
        "schema_version": "gridiron.team-movement-trajectory-inventory.v1",
        "date": "2026-10-24",
        "scope": {
            "weeks_read": list(ALLOWED_WEEKS),
            "weeks_6_9_read": False,
            "selection": "LP canonical snap-anchored manifest, eligible_input=true only",
            "complete_play_definition": "all 22 distinct snap participants have one valid x/y observation at every integer 10 Hz frame from the manifest snap frame through the tracking terminal frame, inclusive",
            "carrier_only_definition": "the retrospective carrier candidate has a complete snap-to-terminal path while the complete-22 criterion is false",
            "terminal_and_carrier_use": "terminal event and carrier candidate are descriptive target-side inventory labels, not cohort criteria, model inputs, or assignment labels",
            "unresolved_terminal": "full-play completeness is unknown and remains a separate stratum; no end frame is inferred",
        },
        "input_manifest": {
            "canonical_cohort": {"path": str(args.cohort), "sha256": sha256_file(args.cohort)},
            "physical_timing_inventory": {"path": str(args.timing), "sha256": sha256_file(args.timing)},
            "tracking_weeks": tracking_sources,
        },
        "summary": summarize(records),
        "plays": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], indent=1, sort_keys=True))
    print(f"output={args.output} sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
