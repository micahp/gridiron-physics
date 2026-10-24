#!/usr/bin/env python3
"""Cross-fit a clock model with a pre-snap late-half/regulation regime split."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

WEEKS = (1, 2, 3, 4, 5)
BASELINE_SHA256 = "4f1af788f3ca3a0ee18a994439acf8c8491ddffff945882b285202787de8e302"
STATE_CSV_SHA256 = "f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9"
MIN_BUCKET = 25
STATE_FIELDS = (
    "lp_game_id", "lp_play_id", "week", "quarter", "quarter_seconds_remaining",
    "score_diff", "down", "distance", "timeouts_remaining",
)
MODEL_LEVELS = (
    ("quarter_clock_score_down_distance", ("quarter", "clock_band", "score_band", "down_band", "distance_band")),
    ("clock_score_down_distance", ("clock_band", "score_band", "down_band", "distance_band")),
    ("score_down_distance", ("score_band", "down_band", "distance_band")),
    ("down_distance", ("down_band", "distance_band")),
    ("score", ("score_band",)),
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
        raise ValueError("two-regime development model permits weeks 1-5 only; weeks 6-9 are reserved")
    return selected


def _number(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"missing or invalid pre-snap {name}") from exc
    if not math.isfinite(number):
        raise ValueError(f"missing or invalid pre-snap {name}")
    return number


def _band(value, edges, labels):
    for edge, label in zip(edges, labels):
        if value <= edge:
            return label
    return labels[-1]


def make_state_features(state):
    """Use only the protocol's pre-snap state whitelist; no play/outcome fields."""
    quarter = int(_number(state.get("quarter"), "quarter"))
    if quarter < 1 or quarter > 4:
        raise ValueError("the two-regime model is regulation-only (quarters 1-4)")
    clock = _number(state.get("quarter_seconds_remaining"), "quarter clock")
    score_diff = _number(state.get("score_diff"), "offense-relative score differential")
    down = int(_number(state.get("down"), "down"))
    distance = _number(state.get("distance"), "distance")

    # This deterministic split is made solely from the current quarter and clock.
    regime = "stoppage_drill" if quarter in (2, 4) and clock <= 120 else "regulation"
    return {
        "regime": regime,
        "quarter": quarter,
        "clock_band": _band(clock, (30, 60, 120, 300, 600), ("0-30", "31-60", "61-120", "121-300", "301-600", "601-900")),
        "score_band": _band(score_diff, (-14, -7, -3, 2, 6, 13), ("down_14+", "down_7_13", "down_3_6", "within_2", "up_3_6", "up_7_13", "up_14+")),
        "down_band": str(down) if 1 <= down <= 4 else "unknown",
        "distance_band": _band(distance, (3, 6, 10), ("1-3", "4-6", "7-10", "11+")),
        # This remains explicitly unavailable and is never substituted or modeled.
        "timeouts_remaining": None,
    }


def load_state_csv(path: Path):
    digest = sha256_file(path)
    if digest != STATE_CSV_SHA256:
        raise ValueError(f"weeks 1-5 state CSV SHA-256 mismatch: {digest}")
    states = {}
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        missing_fields = set(STATE_FIELDS) - set(reader.fieldnames or ())
        if missing_fields:
            raise ValueError(f"state CSV missing required state columns: {sorted(missing_fields)}")
        for row in reader:
            week = int(_number(row["week"], "week"))
            validate_weeks((week,))
            # The pinned source declares timeouts remaining unavailable on every row.
            if row["timeouts_remaining"].strip():
                raise ValueError("pinned state CSV unexpectedly supplies timeout counts")
            key = (str(row["lp_game_id"]), int(_number(row["lp_play_id"], "play identifier")))
            if key in states:
                raise ValueError(f"duplicate LP key in state CSV: {key}")
            # Copy only identifiers and pre-snap fields. Outcome and terminal columns
            # are present in the source file but are never read by this model.
            states[key] = {
                "week": week,
                "quarter": row["quarter"],
                "quarter_seconds_remaining": row["quarter_seconds_remaining"],
                "score_diff": row["score_diff"],
                "down": row["down"],
                "distance": row["distance"],
                "timeouts_remaining": None,
            }
    return states, digest


def _bucket_key(features, fields):
    return tuple(features[name] for name in fields)


def train_regimes(rows):
    buckets = defaultdict(list)
    regime_targets = defaultdict(list)
    for row in rows:
        features = row["state_features"]
        regime = features["regime"]
        target = row["target_s"]
        regime_targets[regime].append(target)
        for level, fields in MODEL_LEVELS:
            buckets[(regime, level, _bucket_key(features, fields))].append(target)
    stats = {
        key: {"median_s": statistics.median(values), "n": len(values)}
        for key, values in buckets.items()
    }
    for regime, values in regime_targets.items():
        stats[(regime, "regime_global", ())] = {"median_s": statistics.median(values), "n": len(values)}
    return stats


def predict_regime(stats, features):
    regime = features["regime"]
    for level, fields in MODEL_LEVELS:
        value = stats.get((regime, level, _bucket_key(features, fields)))
        if value and value["n"] >= MIN_BUCKET:
            return {**value, "level": level}
    value = stats.get((regime, "regime_global", ()))
    if not value:
        raise ValueError(f"training fold has no rows for regime {regime}")
    return {**value, "level": "regime_global"}


def quantile(values, probability):
    """Type-7 linear-interpolated quantile, position p*(n-1)."""
    if not values:
        return None
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize(errors, rows):
    return {
        "plays": len(errors),
        "drives": len({(row["game_id"], int(row["drive"])) for row in rows if row.get("drive") is not None}),
        "mae_s": round(statistics.mean(errors), 4) if errors else None,
        "p90_absolute_error_s": round(quantile(errors, 0.90), 4) if errors else None,
        "p99_absolute_error_s": round(quantile(errors, 0.99), 4) if errors else None,
    }


def build(baseline, states, state_sha):
    if len(baseline.get("per_play", [])) != baseline.get("scope", {}).get("common_scored_rows"):
        raise ValueError("baseline row count does not match its declared scored cohort")
    if baseline.get("scope", {}).get("weeks") != list(WEEKS):
        raise ValueError("baseline must contain weeks 1-5 only")
    rows = []
    for source in baseline["per_play"]:
        if source["week"] not in WEEKS:
            raise ValueError(f"baseline contains reserved week {source['week']}")
        key = (str(source["game_id"]), int(source["play_id"]))
        state = states.get(key)
        if state is None:
            raise ValueError(f"no pre-snap state join for baseline row {key}")
        if state["week"] != source["week"]:
            raise ValueError(f"week mismatch at joined play {key}")
        rows.append({
            "game_id": key[0], "play_id": key[1], "week": source["week"],
            "drive": source.get("drive"), "target_s": float(source["target_s"]),
            "baseline_prediction_s": float(source["pbp_presnap_prediction_s"]),
            "state_features": make_state_features(state),
        })
    if len(rows) != 8977:
        raise ValueError(f"unexpected common-row count: {len(rows)}")

    per_play = {}
    for held_week in WEEKS:
        training = [row for row in rows if row["week"] != held_week]
        if any(row["week"] == held_week for row in training):
            raise RuntimeError("held development week leaked into training")
        stats = train_regimes(training)
        for row in rows:
            if row["week"] != held_week:
                continue
            pred = predict_regime(stats, row["state_features"])
            baseline_error = abs(row["target_s"] - row["baseline_prediction_s"])
            candidate_error = abs(row["target_s"] - pred["median_s"])
            per_play[(row["game_id"], row["play_id"])] = {
                "game_id": row["game_id"], "play_id": row["play_id"], "week": held_week,
                "drive": row["drive"], "target_s": row["target_s"],
                "regime": row["state_features"]["regime"],
                "baseline_prediction_s": row["baseline_prediction_s"],
                "two_regime_prediction_s": pred["median_s"], "backoff_level": pred["level"],
                "baseline_absolute_error_s": round(baseline_error, 4),
                "two_regime_absolute_error_s": round(candidate_error, 4),
            }
    scored = [per_play[key] for key in sorted(per_play)]
    metrics = {}
    for regime in ("regulation", "stoppage_drill"):
        subset = [row for row in scored if row["regime"] == regime]
        metrics[regime] = {
            "baseline": summarize([r["baseline_absolute_error_s"] for r in subset], subset),
            "two_regime": summarize([r["two_regime_absolute_error_s"] for r in subset], subset),
        }
    metrics["overall"] = {
        "baseline": summarize([r["baseline_absolute_error_s"] for r in scored], scored),
        "two_regime": summarize([r["two_regime_absolute_error_s"] for r in scored], scored),
    }
    return {
        "schema": "gridiron.e3.two_regime_presnap_clock.v1",
        "source": {"frozen_baseline_sha256": BASELINE_SHA256, "pre_snap_state_csv_sha256": state_sha},
        "scope": {
            "season": 2022, "weeks": list(WEEKS), "rows": len(scored),
            "holdout_status": "weeks 6-9 were not accessed for this evaluation; prior E3 work examined them, so results are not holdout-validated",
            "folds": "leave-one-development-week-out; fit on other four weeks, score the held week",
            "target": "PBP game_seconds_remaining at this snap minus the next non-null-play_type row's game_seconds_remaining in the same quarter",
        },
        "regime_rule": "stoppage_drill iff quarter is 2 or 4 and pre-snap quarter_seconds_remaining <= 120; regulation otherwise",
        "feature_policy": {
            "regime_selector": ["quarter", "quarter_seconds_remaining"],
            "model_predictors": ["quarter", "quarter_seconds_remaining band", "offense-relative score_diff band", "down band", "distance band"],
            "timeouts_remaining": "unresolvable in the pinned source; null, excluded, no default or imputation",
            "excluded": ["play_type", "outcome family", "terminal event", "target duration", "post-snap or future tracking", "timeout_called"],
        },
        "model_form": {
            "estimator": "separate conditional-median categorical backoff model within each regime",
            "backoff_order": [name for name, _fields in MODEL_LEVELS] + ["regime_global"],
            "minimum_bucket_rows": MIN_BUCKET,
            "crossfit": "five leave-one-week-out folds over weeks 1-5",
            "error_quantiles": "Type-7 linear interpolation at p*(n-1)",
        },
        "coverage": {
            "paired_baseline_rows": len(scored),
            "paired_baseline_drives": len({(r["game_id"], int(r["drive"])) for r in scored if r.get("drive") is not None}),
            "timeouts_left_observed": 0,
            "timeouts_left_unresolvable": len(scored),
        },
        "metrics": metrics,
        "by_week": {
            str(week): {
                regime: {
                    "plays": sum(1 for r in scored if r["week"] == week and r["regime"] == regime),
                    "baseline_mae_s": summarize([r["baseline_absolute_error_s"] for r in scored if r["week"] == week and r["regime"] == regime], [r for r in scored if r["week"] == week and r["regime"] == regime])["mae_s"],
                    "two_regime_mae_s": summarize([r["two_regime_absolute_error_s"] for r in scored if r["week"] == week and r["regime"] == regime], [r for r in scored if r["week"] == week and r["regime"] == regime])["mae_s"],
                } for regime in ("regulation", "stoppage_drill")
            } for week in WEEKS
        },
        "per_play": scored,
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-json", type=Path, required=True)
    parser.add_argument("--state-csv", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    validate_weeks(WEEKS)
    try:
        if sha256_file(args.baseline_json) != BASELINE_SHA256:
            raise ValueError("frozen baseline JSON SHA-256 mismatch")
        baseline = json.loads(args.baseline_json.read_text(encoding="utf-8"))
        states, state_sha = load_state_csv(args.state_csv)
        result = build(baseline, states, state_sha)
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        parser.error(str(exc))
    result["source"]["model_script_sha256"] = sha256_file(Path(__file__))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for label in ("regulation", "stoppage_drill", "overall"):
        item = result["metrics"][label]
        print(f"{label}: baseline MAE={item['baseline']['mae_s']} s; two-regime MAE={item['two_regime']['mae_s']} s; "
              f"two-regime P90={item['two_regime']['p90_absolute_error_s']} s; "
              f"P99={item['two_regime']['p99_absolute_error_s']} s; plays={item['two_regime']['plays']}")
    print("Timeouts-left feature: UNRESOLVABLE; excluded with no imputation")
    print("Holdout weeks 6-9: not accessed in this evaluation; previously examined, not holdout-validated")
    print(f"Output SHA-256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
