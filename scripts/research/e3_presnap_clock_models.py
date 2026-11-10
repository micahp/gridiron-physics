#!/usr/bin/env python3
"""Cross-fit PBP-only and tracking-informed clock models with pre-snap inputs only."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import statistics
from collections import Counter, defaultdict
from pathlib import Path

WEEKS = (1, 2, 3, 4, 5)
FEATURE_ARTIFACT_SHA256 = "5ca5cabd3ed5c262fbf60a96af62f7921d0402fab11b7dfc0274dfbfc816e506"
FEATURE_SCHEMA = "gridiron.bdb2025.presnap_tracking_features.v1"
PBP_FIELDS = (
    "game_id", "play_id", "season", "week", "posteam", "defteam", "qtr", "down", "ydstogo",
    "yardline_100", "game_seconds_remaining", "play_type", "drive",
)
MIN_BUCKET = 25
DEFAULT_DB = Path("/root/legendarypicks/backend/data/picks.dev.db")

BASE_LEVELS = (
    ("pbp_team_clock_state", lambda f: (f["qtr"], f["clock_bin"], f["down"], f["distance"], f["field"], f["posteam"], f["defteam"])),
    ("pbp_clock_state", lambda f: (f["qtr"], f["clock_bin"], f["down"], f["distance"], f["field"])),
    ("pbp_period_state", lambda f: (f["qtr"], f["down"], f["distance"], f["field"])),
    ("pbp_state", lambda f: (f["down"], f["distance"], f["field"])),
    ("pbp_down_field", lambda f: (f["down"], f["field"])),
    ("pbp_field", lambda f: (f["field"],)),
)
TRACK_LEVELS = (
    ("snap_kinematics_full", lambda f: (f["qtr"], f["clock_bin"], f["down"], f["distance"], f["field"], f["off_speed"], f["def_speed"], f["off_accel"], f["def_accel"])),
    ("snap_kinematics_state", lambda f: (f["qtr"], f["down"], f["distance"], f["field"], f["off_speed"], f["def_speed"], f["off_accel"], f["def_accel"])),
    ("snap_speed_spacing", lambda f: (f["qtr"], f["down"], f["distance"], f["field"], f["off_speed"], f["def_speed"], f["off_spacing"], f["def_spacing"])),
    ("snap_speed_state", lambda f: (f["qtr"], f["clock_bin"], f["down"], f["distance"], f["field"], f["off_speed"], f["def_speed"])),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_weeks(weeks):
    selected = tuple(sorted(set(int(week) for week in weeks)))
    if not selected or any(week not in WEEKS for week in selected):
        raise ValueError("pre-snap clock model permits weeks 1-5 only; weeks 6-9 are reserved")
    return selected


def load_tracking_features(path: Path):
    digest = sha256_file(path)
    if digest != FEATURE_ARTIFACT_SHA256:
        raise ValueError(f"pre-snap feature artifact SHA-256 mismatch: {digest}")
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != FEATURE_SCHEMA:
        raise ValueError("unexpected pre-snap feature schema")
    if document.get("scope", {}).get("weeks") != list(WEEKS):
        raise ValueError("pre-snap feature weeks do not equal 1-5")
    output = {}
    for record in document["plays"]:
        if record.get("week") not in WEEKS:
            raise ValueError(f"pre-snap tracking feature uses reserved week {record.get('week')}")
        if record.get("last_input_frame") != record.get("snap_frame") - 1:
            raise ValueError(f"tracking feature reaches snap or later: {(record.get('game_id'), record.get('play_id'))}")
        if record.get("input_frame_range") != [record["snap_frame"] - 3, record["snap_frame"] - 1]:
            raise ValueError("unexpected pre-snap kinematic history window")
        if set(record.get("players_at_each_input_frame", {}).values()) != {22}:
            raise ValueError("tracking feature is missing an all-22 pre-snap frame")
        key = (record.get("lp_game_id"), record.get("lp_play_id"))
        if key[0] is None or key[1] is None:
            continue
        if key in output:
            raise ValueError(f"duplicate LP key in pre-snap tracking artifact: {key}")
        output[key] = record
    return output, digest


def load_pbp(db_path: Path):
    uri = db_path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        placeholders = ",".join("?" for _ in WEEKS)
        query = (
            f"SELECT {', '.join(PBP_FIELDS)} FROM nfl_pbp "
            f"WHERE season=2022 AND week IN ({placeholders}) ORDER BY game_id, play_id"
        )
        rows = [dict(row) for row in connection.execute(query, WEEKS)]
    finally:
        connection.close()
    encoded = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return rows, hashlib.sha256(encoded).hexdigest()


def key(row):
    return str(row["game_id"]), int(float(row["play_id"]))


def pbp_target(row, following):
    if following is None:
        return None
    if row.get("qtr") is None or following.get("qtr") is None or row["qtr"] != following["qtr"]:
        return None
    try:
        current, next_clock = float(row["game_seconds_remaining"]), float(following["game_seconds_remaining"])
    except (TypeError, ValueError):
        return None
    value = current - next_clock
    if not math.isfinite(value) or value < 0:
        return None
    return round(value, 3)


def _bucket(value, edges, labels):
    if value is None:
        return "unknown"
    for edge, label in zip(edges, labels):
        if value <= edge:
            return label
    return labels[-1]


def make_pbp_features(row):
    """Whitelist only pre-snap state fields; never reads play_type or outcome columns."""
    qtr = int(float(row["qtr"])) if row.get("qtr") is not None else 0
    try:
        remaining = float(row["game_seconds_remaining"])
        period_clock = min(900.0, max(0.0, remaining - (4 - qtr) * 900.0)) if 1 <= qtr <= 4 else None
    except (TypeError, ValueError):
        period_clock = None
    try:
        down_value = int(float(row["down"]))
        down = "1-2" if down_value <= 2 else "3-4" if down_value <= 4 else "unknown"
    except (TypeError, ValueError):
        down = "unknown"
    try:
        dist_value = float(row["ydstogo"])
        distance = _bucket(dist_value, (3, 6, 10), ("1-3", "4-6", "7-10", "11+"))
    except (TypeError, ValueError):
        distance = "unknown"
    try:
        field_value = float(row["yardline_100"])
        field = _bucket(field_value, (9, 19, 49, 79), ("1-9", "10-19", "20-49", "50-79", "80-100"))
    except (TypeError, ValueError):
        field = "unknown"
    clock_bin = _bucket(period_clock, (120, 300, 600), ("0-120", "121-300", "301-600", "601-900"))
    return {
        "qtr": qtr, "clock_bin": clock_bin, "down": down, "distance": distance,
        "field": field, "posteam": str(row.get("posteam") or "unknown"),
        "defteam": str(row.get("defteam") or "unknown"),
    }


def _motion_bin(value, edges, labels):
    return _bucket(float(value) if value is not None else None, edges, labels)


def make_tracking_features(record):
    raw = record["tracking_features"]
    off_speed = raw["offense_mean_speed_yards_per_second"]
    def_speed = raw["defense_mean_speed_yards_per_second"]
    off_accel = raw["offense_mean_acceleration_magnitude_yards_per_second_squared"]
    def_accel = raw["defense_mean_acceleration_magnitude_yards_per_second_squared"]
    off_spacing = raw["offense_mean_nearest_teammate_distance_yards"]
    def_spacing = raw["defense_mean_nearest_teammate_distance_yards"]
    return {
        "off_speed": _motion_bin(off_speed, (0.5, 1.0, 2.0), ("le0.5", "0.5-1", "1-2", "gt2")),
        "def_speed": _motion_bin(def_speed, (0.5, 1.0, 2.0), ("le0.5", "0.5-1", "1-2", "gt2")),
        "off_accel": _motion_bin(off_accel, (2.0, 6.0, 12.0), ("le2", "2-6", "6-12", "gt12")),
        "def_accel": _motion_bin(def_accel, (2.0, 6.0, 12.0), ("le2", "2-6", "6-12", "gt12")),
        "off_spacing": _motion_bin(off_spacing, (2.0, 4.0, 7.0), ("le2", "2-4", "4-7", "gt7")),
        "def_spacing": _motion_bin(def_spacing, (2.0, 4.0, 7.0), ("le2", "2-4", "4-7", "gt7")),
    }


def median(values):
    return statistics.median(values)


def _levels(model, features):
    if model == "pbp_presnap":
        yield from BASE_LEVELS
    else:
        yield from TRACK_LEVELS
        yield from BASE_LEVELS


def train_model(rows, model):
    buckets = defaultdict(list)
    values = []
    for item in rows:
        target = item["target_s"]
        values.append(target)
        for level, key_fn in _levels(model, item["features"]):
            buckets[(level, key_fn(item["features"]))].append(target)
    stats = {key: {"p50_s": median(group), "n": len(group)} for key, group in buckets.items()}
    stats[("global", ())] = {"p50_s": median(values), "n": len(values)}
    return stats


def predict(stats, features, model):
    for level, key_fn in _levels(model, features):
        row = stats.get((level, key_fn(features)))
        if row and row["n"] >= MIN_BUCKET:
            return {**row, "level": level}
    return {**stats[("global", ())], "level": "global"}


def summarize_errors(values):
    return {"n": len(values), "mae_s": round(statistics.mean(values), 4) if values else None}


def build(rows, pbp_sha, tracking, tracking_sha):
    by_game = defaultdict(list)
    for row in rows:
        if row.get("play_type") is not None:
            by_game[str(row["game_id"])].append(row)
    following = {}
    for game_rows in by_game.values():
        game_rows.sort(key=lambda item: int(float(item["play_id"])))
        for i, row in enumerate(game_rows):
            following[key(row)] = game_rows[i + 1] if i + 1 < len(game_rows) else None

    records = []
    target_unresolved = Counter()
    target_source_rows = 0
    target_resolved_rows = 0
    resolved_without_tracking = 0
    for row in rows:
        if row.get("play_type") is None:
            continue
        target_source_rows += 1
        k = key(row)
        target = pbp_target(row, following.get(k))
        if target is None:
            target_unresolved["no_same_quarter_nonnull_next_play_or_valid_clock"] += 1
            continue
        target_resolved_rows += 1
        track = tracking.get(k)
        if track is None:
            resolved_without_tracking += 1
            continue
        context = make_pbp_features(row)
        track_features = make_tracking_features(track)
        # Explicit feature-key guard: this whitelist must remain pre-snap only.
        if set(context) != {"qtr", "clock_bin", "down", "distance", "field", "posteam", "defteam"}:
            raise RuntimeError("unexpected PBP feature field")
        features = {**context, **track_features}
        records.append({
            "game_id": str(row["game_id"]), "play_id": int(float(row["play_id"])),
            "week": int(row["week"]), "drive": row.get("drive"), "target_s": target,
            "features": features, "snap_record": track,
        })
    by_week = {week: [] for week in WEEKS}
    for row in records:
        by_week[row["week"]].append(row)

    predictions = {}
    fold_rows = {}
    for held_week in WEEKS:
        train = [row for row in records if row["week"] != held_week]
        if any(row["week"] == held_week for row in train):
            raise RuntimeError("held week leaked into training")
        pbp_stats = train_model(train, "pbp_presnap")
        track_stats = train_model(train, "tracking_presnap")
        fold_rows[str(held_week)] = len(train)
        for row in by_week[held_week]:
            k = (row["game_id"], row["play_id"])
            bp = predict(pbp_stats, row["features"], "pbp_presnap")
            cp = predict(track_stats, row["features"], "tracking_presnap")
            predictions[k] = {
                "game_id": row["game_id"], "play_id": row["play_id"], "week": held_week,
                "drive": row["drive"], "target_s": row["target_s"],
                "pbp_presnap_prediction_s": bp["p50_s"], "pbp_presnap_level": bp["level"],
                "tracking_presnap_prediction_s": cp["p50_s"], "tracking_presnap_level": cp["level"],
                "paired_abs_error_s": {
                    "pbp_presnap": round(abs(row["target_s"] - bp["p50_s"]), 4),
                    "tracking_presnap": round(abs(row["target_s"] - cp["p50_s"]), 4),
                },
                "pre_snap_feature_values": row["features"],
                "tracking_input_cutoff": row["snap_record"]["last_input_frame"],
                "snap_frame": row["snap_record"]["snap_frame"],
            }

    scored = list(predictions.values())
    paired_drives = {
        (row["game_id"], int(row["drive"]))
        for row in scored if row["drive"] is not None
    }
    pbp_errors = [row["paired_abs_error_s"]["pbp_presnap"] for row in scored]
    track_errors = [row["paired_abs_error_s"]["tracking_presnap"] for row in scored]
    differences = [row["paired_abs_error_s"]["pbp_presnap"] - row["paired_abs_error_s"]["tracking_presnap"] for row in scored]
    tracking_specific = [row for row in scored if row["tracking_presnap_level"].startswith("snap_")]
    pbp_fallback = [row for row in scored if not row["tracking_presnap_level"].startswith("snap_")]
    def paired_level_summary(level_rows):
        pbp_level_errors = [row["paired_abs_error_s"]["pbp_presnap"] for row in level_rows]
        tracking_level_errors = [row["paired_abs_error_s"]["tracking_presnap"] for row in level_rows]
        return {
            "rows": len(level_rows),
            "PBP_presnap_mae_s": summarize_errors(pbp_level_errors)["mae_s"],
            "tracking_presnap_mae_s": summarize_errors(tracking_level_errors)["mae_s"],
            "mean_PBP_minus_tracking_absolute_error_s": round(statistics.mean(
                [a - b for a, b in zip(pbp_level_errors, tracking_level_errors)]
            ), 4) if level_rows else None,
        }
    weekly = {}
    for week in WEEKS:
        sample = [row for row in scored if row["week"] == week]
        drives = {(row["game_id"], int(row["drive"])) for row in sample if row["drive"] is not None}
        weekly[str(week)] = {
            "rows": len(sample), "drives": len(drives),
            "pbp_presnap_mae_s": summarize_errors([r["paired_abs_error_s"]["pbp_presnap"] for r in sample])["mae_s"],
            "tracking_presnap_mae_s": summarize_errors([r["paired_abs_error_s"]["tracking_presnap"] for r in sample])["mae_s"],
        }
    return {
        "schema": "gridiron.e3.presnap_clock_models.v1",
        "source": {"PBP_slice_sha256": pbp_sha, "presnap_tracking_feature_sha256": tracking_sha},
        "scope": {
            "season": 2022, "weeks": list(WEEKS),
            "query_filter": "season=2022 AND week IN (1,2,3,4,5)",
            "holdout_status": "NOT HOLDOUT-VALIDATED: weeks 6-9 were previously examined; weeks 1-5 are development only",
            "target": "PBP game_seconds_remaining minus the next non-null-play_type row in the same quarter",
            "common_scored_rows": len(scored), "common_scored_drives": len(paired_drives),
            "fold_training_rows": fold_rows,
        },
        "coverage": {
            "PBP_rows_with_play_type": target_source_rows,
            "PBP_same_quarter_clock_delta_resolved": target_resolved_rows,
            "resolved_PBP_rows_without_all22_pre_snap_features": resolved_without_tracking,
            "paired_model_scored_rows": len(scored),
        },
        "models": {
            "B_pbp_presnap": "Conditional median using only qtr, current clock remaining, down, distance, yardline bucket and offense/defense identity. Current play_type, terminal outcome, next-play outcome and future tracking are excluded from model features.",
            "C_tracking_presnap": "Same pre-snap PBP context and the 22-player team-level kinematic/alignment aggregates computed from raw tracking frames snap-3 through snap-1. No snap frame, post-snap location, terminal event or carrier-candidate list is used.",
        },
        "fixed_model_spec": {
            "bucket_minimum_rows": MIN_BUCKET,
            "PBP_backoff_levels": [name for name, _fn in BASE_LEVELS] + ["global"],
            "tracking_backoff_levels": [name for name, _fn in TRACK_LEVELS] + [name for name, _fn in BASE_LEVELS] + ["global"],
            "tracking_bins": "speed <=0.5/1/2/over2 yd/s; acceleration <=2/6/12/over12 yd/s^2; nearest teammate spacing <=2/4/7/over7 yd",
            "feature_selection": "fixed before scoring; no weeks 6-9 evaluation or tuning",
        },
        "common_rows_metrics": {
            "B_pbp_presnap_mae": summarize_errors(pbp_errors),
            "C_tracking_presnap_mae": summarize_errors(track_errors),
            "paired_difference_B_minus_C_s": {
                "mean": round(statistics.mean(differences), 4) if differences else None,
                "B_lower_error_rows": sum(value < 0 for value in differences),
                "C_lower_error_rows": sum(value > 0 for value in differences),
                "ties": sum(value == 0 for value in differences),
            },
            "by_tracking_backoff_family": {
                "tracking_specific_bins": paired_level_summary(tracking_specific),
                "PBP_only_fallback": paired_level_summary(pbp_fallback),
            },
        },
        "by_week": weekly,
        "unresolvable_target_rows": dict(target_unresolved),
        "limitations": [
            "This is a same-quarter PBP snap-to-next-play clock delta, not whistle time or wall-clock possession duration.",
            "The trained models are cross-fitted within weeks 1-5. Weeks 6-9 were already examined and are not holdout evidence.",
            "PBP target construction uses later clock stamps only as labels; target play outcomes are not model inputs.",
            "Tracking summary is derived only from the same 22 players' x/y positions at snap-3, snap-2 and snap-1; team roles are not individually assigned.",
            "The matching cohort requires complete 22-player histories at all three strictly pre-snap frames, so its scored denominator is narrower than the retrospective comparison.",
        ],
        "per_play": [predictions[k] for k in sorted(predictions)],
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--tracking-features", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    validate_weeks(WEEKS)
    try:
        tracking, tracking_sha = load_tracking_features(args.tracking_features)
        pbp, pbp_sha = load_pbp(args.db)
        result = build(pbp, pbp_sha, tracking, tracking_sha)
    except (OSError, sqlite3.Error, ValueError, RuntimeError, KeyError) as exc:
        parser.error(str(exc))
    result["source"]["model_script_sha256"] = sha256_file(Path(__file__))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Common prospective rows={result['scope']['common_scored_rows']}; drives={result['scope']['common_scored_drives']}")
    print(f"PBP-only pre-snap MAE={result['common_rows_metrics']['B_pbp_presnap_mae']['mae_s']} s")
    print(f"Tracking pre-snap MAE={result['common_rows_metrics']['C_tracking_presnap_mae']['mae_s']} s")
    print("Holdout status: NOT HOLDOUT-VALIDATED; weeks 6-9 reserved/examined")
    print(f"Output SHA-256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
