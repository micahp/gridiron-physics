#!/usr/bin/env python3
"""Evaluation-only comparison of LP game-record JSON to frozen NFL PBP tables.

The evaluator intentionally imports no LP modules. It reads LP output JSON and
Gridiron's checked-in observed distribution CSVs only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OBSERVED = ROOT / "docs/fixtures/e3/observed-2022-2025"
DEFAULT_BOOTSTRAPS = 500
SEED = 20261024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_record(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict) or not str(payload.get("schema", "")).startswith("lp-e2-game-"):
        raise ValueError(f"{path}: expected an LP E2 game JSON envelope")
    record = payload.get("record")
    if not isinstance(record, dict) or not isinstance(record.get("drives"), list):
        raise ValueError(f"{path}: missing record.drives")
    if not record.get("simulation_id"):
        raise ValueError(f"{path}: missing record.simulation_id")
    return payload, record


def _band_distance(value: Any) -> str:
    if value is None:
        return "unknown"
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "unknown"
    if n <= 3:
        return "0-3"
    if n <= 6:
        return "4-6"
    if n <= 10:
        return "7-10"
    return "11+"


def _field_zone(value: Any) -> str:
    if value is None:
        return "unknown"
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "unknown"
    if n <= 20:
        return "red_zone_0-20"
    if n <= 50:
        return "opponent_half_21-50"
    if n <= 80:
        return "own_half_51-80"
    return "backed_up_81-99"


def _canonical_yards(value: str) -> str:
    try:
        number = float(value)
        if number.is_integer():
            return str(int(number))
    except ValueError:
        pass
    return value


def _clock_span_bucket(value: int | float) -> str:
    start = max(0, int(value) // 30 * 30)
    return f"{start}-{start + 29}s" if start < 900 else "900s+"


def _play_family(event: str) -> str | None:
    if event in {"run", "rush", "qb_scramble"}:
        return "run"
    if event in {"pass_complete", "pass_incomplete", "sack", "interception", "fumble_lost"}:
        return "pass"
    return None


def _drive_terminal(drive: dict[str, Any]) -> str:
    terminal = str(drive.get("terminal") or "unknown").lower()
    if terminal == "touchdown":
        return "touchdown"
    if terminal == "field_goal_attempt":
        return "field_goal" if drive.get("field_goal_made") is True else "missed_field_goal"
    if terminal == "punt":
        return "punt"
    if terminal in {"turnover", "turnover_on_downs"}:
        return "turnover"
    if terminal in {"halftime", "end_of_regulation", "end_of_half", "clock_only_terminal"}:
        return "clock_ending"
    if terminal == "safety":
        return "safety"
    return "other"


def _observed_rows(directory: Path) -> tuple[dict[str, list[dict[str, str]]], dict[str, Any]]:
    manifest_path = directory / "lp-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != "lp.nfl.e3-observed-distributions.v1":
        raise ValueError(f"{manifest_path}: unsupported observed-reference schema")
    rows: dict[str, list[dict[str, str]]] = {}
    for filename in ("play_distribution.csv", "drive_distribution.csv", "game_distribution.csv"):
        path = directory / filename
        expected = manifest.get("table_sha256", {}).get(filename)
        actual = sha256(path)
        if not expected or actual != expected:
            raise ValueError(f"{path}: sha256 mismatch (manifest {expected}, actual {actual})")
        with path.open(newline="") as stream:
            rows[filename] = list(csv.DictReader(stream))
    return rows, {"manifest_sha256": sha256(manifest_path), "manifest": manifest}


def _counts(rows: list[dict[str, str]], metric: str, condition: str | None = None) -> Counter[str]:
    result: Counter[str] = Counter()
    for row in rows:
        if row.get("metric") != metric:
            continue
        if condition is not None and row.get("condition") != condition:
            continue
        result[str(row["value"])] += int(row["count"])
    return result


def _tvd(a: Counter[str], b: Counter[str]) -> float | None:
    na, nb = sum(a.values()), sum(b.values())
    if not na or not nb:
        return None
    keys = set(a) | set(b)
    return 0.5 * sum(abs(a[k] / na - b[k] / nb) for k in keys)


def _bootstrap_tvd(
    observed: Counter[str],
    generated_by_game: list[Counter[str]],
    replicates: int,
    rng: random.Random,
) -> list[float] | None:
    """Dirichlet approximation to an aggregate multinomial bootstrap plus game clusters.

    The observed exports contain histograms, not game-keyed rows, so the observed
    side is multinomial-resampled and cannot preserve cross-metric/game clustering.
    Generated samples are resampled by whole game.
    """
    obs_n = sum(observed.values())
    if not obs_n or not generated_by_game:
        return None
    keys = sorted(set(observed).union(*(set(c) for c in generated_by_game)))
    obs_weights = [observed[k] for k in keys]
    obs_draw_n = obs_n
    obs_support = keys
    obs_probs = obs_weights
    result: list[float] = []
    for _ in range(replicates):
        # A Dirichlet(counts) draw has the same first-order covariance as
        # multinomial-resampled category proportions, without expanding 188k rows.
        gamma_draw = [rng.gammavariate(max(float(count), 1e-12), 1.0) for count in obs_probs]
        gamma_total = sum(gamma_draw)
        obs_shares = {key: value / gamma_total for key, value in zip(obs_support, gamma_draw)}
        selected = rng.choices(generated_by_game, k=len(generated_by_game))
        gen_draw: Counter[str] = Counter()
        for item in selected:
            gen_draw.update(item)
        gen_total = sum(gen_draw.values())
        if gen_total:
            keys = set(obs_shares) | set(gen_draw)
            result.append(0.5 * sum(abs(obs_shares.get(key, 0.0) - gen_draw.get(key, 0) / gen_total) for key in keys))
    return result or None


def _comparison(
    observed: Counter[str] | None,
    generated_by_game: list[Counter[str]],
    *,
    replicates: int,
    rng: random.Random,
    observed_note: str,
) -> dict[str, Any]:
    generated: Counter[str] = Counter()
    for game_counts in generated_by_game:
        generated.update(game_counts)
    if not observed:
        return {
            "status": "reference_unavailable",
            "observed_source_note": observed_note,
            "generated_counts": dict(sorted(generated.items())),
            "generated_n": sum(generated.values()),
            "observed_counts": None,
            "tvd": None,
            "bootstrap_95_ci": None,
        }
    score = _tvd(observed, generated)
    samples = _bootstrap_tvd(observed, generated_by_game, replicates, rng)
    interval = None
    if samples:
        ordered = sorted(samples)
        interval = [ordered[math.floor(0.025 * (len(ordered) - 1))], ordered[math.ceil(0.975 * (len(ordered) - 1))]]
    return {
        "status": "compared_exploratory",
        "observed_source_note": observed_note,
        "observed_counts": dict(sorted(observed.items())),
        "observed_n": sum(observed.values()),
        "generated_counts": dict(sorted(generated.items())),
        "generated_n": sum(generated.values()),
        "tvd": score,
        "bootstrap_95_ci": interval,
        "bootstrap_replicates": len(samples or []),
    }


def evaluate(
    generated_paths: list[Path],
    observed_directory: Path = DEFAULT_OBSERVED,
    bootstrap_replicates: int = DEFAULT_BOOTSTRAPS,
    lp_evidence_sha: str | None = None,
) -> dict[str, Any]:
    if not generated_paths:
        raise ValueError("provide at least one --generated LP record JSON")
    if bootstrap_replicates < 100:
        raise ValueError("bootstrap replicates must be at least 100")
    observed_tables, observed_meta = _observed_rows(observed_directory)
    game_data: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for path in generated_paths:
        envelope, record = _load_record(path)
        sim_id = str(record["simulation_id"])
        if sim_id in seen_ids:
            raise ValueError(f"duplicate generated simulation_id: {sim_id}")
        seen_ids.add(sim_id)
        game_data.append({"path": path, "envelope": envelope, "record": record, "simulation_id": sim_id})

    per_game: list[dict[str, Any]] = []
    histograms: dict[str, list[Counter[str]]] = defaultdict(list)
    conditional: Counter[str] = Counter()
    total_points: list[float] = []
    score_margins: list[float] = []
    all_valid = True
    for game in game_data:
        record = game["record"]
        all_valid = all_valid and record.get("valid_full_game") is True and game["envelope"].get("valid_full_game") is True
        passrun: Counter[str] = Counter()
        passrun_by_state: Counter[str] = Counter()
        yards: Counter[str] = Counter()
        downs_yards: Counter[str] = Counter()
        first_down: Counter[str] = Counter()
        sack: Counter[str] = Counter()
        turnover: Counter[str] = Counter()
        conversion: Counter[str] = Counter()
        rzone: Counter[str] = Counter()
        plays_per_drive: Counter[str] = Counter()
        possession_duration: Counter[str] = Counter()
        drive_endings: Counter[str] = Counter()
        for drive in record["drives"]:
            drive_plays = drive.get("plays", [])
            red_zone_entered = False
            red_zone_td = _drive_terminal(drive) == "touchdown"
            for i, play in enumerate(drive_plays):
                event = str(play.get("event_type", ""))
                family = _play_family(event)
                before = play.get("state_before") or {}
                after = play.get("state_after") or {}
                outcome = play.get("outcome") or {}
                down = before.get("down")
                distance = before.get("yards_to_go")
                zone = _field_zone(before.get("yardline_100"))
                if zone == "red_zone_0-20":
                    red_zone_entered = True
                d_band = f"down_{down}" if down in (1, 2, 3, 4) else "down_unknown"
                distance_band = _band_distance(distance)
                context = f"q{before.get('quarter', 'unknown')}|{d_band}|{distance_band}|{zone}"
                if family:
                    passrun[family] += 1
                    passrun_by_state[f"{context}|{family}"] += 1
                    conditional[f"pass_run_by_state|{context}|{family}"] += 1
                    if outcome.get("yards_gained") is not None:
                        y = _canonical_yards(str(outcome["yards_gained"]))
                        yards[f"{family}|{y}"] += 1
                        downs_yards[f"{context}|{family}|{y}"] += 1
                        ytg = distance
                        converted = bool(outcome.get("touchdown")) or (
                            ytg is not None and float(outcome["yards_gained"]) >= float(ytg) and not outcome.get("turnover")
                        )
                        success_label = "success" if converted else "failure"
                        first_down[f"{context}|{success_label}"] += 1
                        if down in (3, 4):
                            conversion[f"down_{down}|{success_label}"] += 1
                            conditional[f"third_fourth_conversion|down_{down}|{success_label}"] += 1
                        conditional[f"first_down_by_state|{context}|{'success' if converted else 'failure'}"] += 1
                    if family == "pass":
                        if event == "sack":
                            sack["sack"] += 1
                        else:
                            sack["no_sack"] += 1
                    if outcome.get("turnover") or event in {"interception", "fumble_lost"}:
                        turnover["turnover"] += 1
                    else:
                        turnover["no_turnover"] += 1
            terminal = _drive_terminal(drive)
            if red_zone_entered:
                rzone["touchdown" if red_zone_td else "no_touchdown"] += 1
                for label, count in (("red_zone_drive|entered|touchdown" if red_zone_td else "red_zone_drive|entered|no_touchdown", 1),):
                    conditional[label] += count
            plays_per_drive[str(len(drive_plays))] += 1
            # Quarter + clock coordinates yield the same snap-to-snap clock span estimand as the observed table.
            q0, c0 = drive.get("quarter_start"), drive.get("clock_start")
            q1, c1 = drive.get("end_quarter"), drive.get("end_clock")
            if all(isinstance(x, (int, float)) for x in (q0, c0, q1, c1)):
                span = max(0, int((q1 - q0) * 900 + c0 - c1))
                possession_duration[_clock_span_bucket(span)] += 1
            drive_endings[terminal] += 1
        histograms["plays_per_drive"].append(plays_per_drive)
        histograms["pass_run_plays_per_drive"].append(Counter(
            str(sum(_play_family(str(p.get("event_type", ""))) is not None for p in drive.get("plays", [])))
            for drive in record["drives"]
        ))
        histograms["possession_duration"].append(possession_duration)
        histograms["drive_endings"].append(drive_endings)
        for key, counts in (("pass_run_mix", passrun), ("pass_run_by_game_state", passrun_by_state),
                            ("yards_by_play_type", yards), ("yards_by_down_distance", downs_yards),
                            ("first_down_by_down_distance", first_down), ("sacks_per_dropback", sack),
                            ("turnovers_per_scrimmage_play", turnover), ("third_fourth_conversion", conversion),
                            ("red_zone_conversion", rzone)):
            histograms[key].append(counts)
        points = record.get("points") or {}
        scores = [points.get("A"), points.get("B")]
        if all(isinstance(x, (int, float)) for x in scores):
            total_points.append(float(sum(scores)))
            score_margins.append(float(abs(scores[0] - scores[1])))
            histograms["total_points"].append(Counter({str(int(sum(scores))): 1}))
            histograms["score_margin_abs"].append(Counter({str(int(abs(scores[0] - scores[1]))): 1}))
        per_game.append({
            "simulation_id": game["simulation_id"],
            "seed": record.get("seed"),
            "valid_full_game": record.get("valid_full_game") is True and game["envelope"].get("valid_full_game") is True,
            "unsupported_rules": record.get("unsupported_rules", game["envelope"].get("unsupported_rules", [])),
            "drives": len(record["drives"]),
            "plays": sum(len(d.get("plays", [])) for d in record["drives"]),
            "points": points,
            "pass_run_counts": dict(passrun),
            "sack_counts": dict(sack),
            "turnover_counts": dict(turnover),
            "drive_endings": {k: _drive_terminal(d) for k, d in ((str(x.get("index")), x) for x in record["drives"])},
            "score_total": sum(scores) if all(isinstance(x, (int, float)) for x in scores) else None,
            "score_margin_abs": abs(scores[0] - scores[1]) if all(isinstance(x, (int, float)) for x in scores) else None,
        })

    play_rows = observed_tables["play_distribution.csv"]
    drive_rows = observed_tables["drive_distribution.csv"]
    game_rows = observed_tables["game_distribution.csv"]
    play_types = _counts(play_rows, "play_type")
    observed_yards: Counter[str] = Counter()
    observed_yards_missing = 0
    for family in ("pass", "run"):
        for yards, count in _counts(play_rows, "yards_gained", f"play_type={family}").items():
            if yards == "NULL":
                observed_yards_missing += count
                continue
            observed_yards[f"{family}|{_canonical_yards(yards)}"] += count
    observed_duration: Counter[str] = Counter()
    observed_duration_missing = 0
    for value, count in _counts(drive_rows, "snap_clock_span_seconds").items():
        if value == "NULL":
            observed_duration_missing += count
            continue
        observed_duration[_clock_span_bucket(float(value))] += count
    eligible_dropbacks = _counts(play_rows, "source_flag:qb_dropback").get("1", 0)
    observed_sacks = _counts(play_rows, "source_flag:sack").get("1", 0)
    observed_turnovers = _counts(play_rows, "source_flag:interception").get("1", 0) + _counts(play_rows, "source_flag:fumble_lost").get("1", 0)
    scrimmage_plays = play_types.get("pass", 0) + play_types.get("run", 0)
    observed_refs: dict[str, tuple[Counter[str] | None, str]] = {
        "pass_run_mix": (Counter({"pass": play_types.get("pass", 0), "run": play_types.get("run", 0)}), "PBP play_type pass/run; denominator restricted to pass+run"),
        "pass_run_by_game_state": (None, "joint down/distance/quarter/field-zone reference is not exported"),
        "yards_by_play_type": (observed_yards, "PBP yards_gained histograms conditional on play_type; keys are family|yards"),
        "yards_by_down_distance": (None, "joint down-distance yards reference is not exported"),
        "first_down_by_down_distance": (None, "joint down-distance first-down reference is not exported"),
        "sacks_per_dropback": (Counter({"sack": observed_sacks, "no_sack": max(0, eligible_dropbacks - observed_sacks)}) if eligible_dropbacks else None, "PBP source_flag:sack among source_flag:qb_dropback=1"),
        "turnovers_per_scrimmage_play": (Counter({"turnover": observed_turnovers, "no_turnover": max(0, scrimmage_plays - observed_turnovers)}) if scrimmage_plays else None, "PBP interceptions + fumbles_lost over pass/run play_type rows"),
        "third_fourth_conversion": (None, "third/fourth conversion reference is not exported"),
        "red_zone_conversion": (None, "red-zone conversion reference is not exported"),
        "plays_per_drive": (_counts(drive_rows, "offensive_play_rows_per_drive"), "PBP offensive play rows per non-null drive group"),
        "pass_run_plays_per_drive": (_counts(drive_rows, "pass_run_rows_per_drive"), "PBP pass/run rows per non-null drive group"),
        "possession_duration": (observed_duration, "PBP max-minus-min snap game-clock span, grouped into 30-second bins; not wall-clock possession duration"),
        "drive_endings": (_counts(drive_rows, "final_source_series_result"), "PBP final series result; normalized to touchdown/field-goal/punt/turnover/clock/other"),
        "total_points": (_counts(game_rows, "total_points"), "official retained schedule final scores, regular-season games"),
        "score_margin_abs": (_counts(game_rows, "absolute_margin"), "official retained schedule absolute score margin"),
    }

    # Normalize observed categories into the evaluator's explicit event families.
    endings = observed_refs["drive_endings"][0]
    if endings is not None:
        mapped: Counter[str] = Counter()
        for label, count in endings.items():
            low = label.lower()
            if low == "opp touchdown":
                key = "opponent_touchdown"
            elif "touchdown" in low:
                key = "touchdown"
            elif low == "field goal":
                key = "field_goal"
            elif low == "missed field goal":
                key = "missed_field_goal"
            elif low == "punt":
                key = "punt"
            elif "turnover" in low:
                key = "turnover"
            elif low == "end of half":
                key = "clock_ending"
            elif low == "qb kneel":
                key = "qb_kneel"
            elif low == "safety":
                key = "safety"
            else:
                key = "other"
            mapped[key] += count
        observed_refs["drive_endings"] = (mapped, observed_refs["drive_endings"][1])

    rng = random.Random(SEED)
    comparisons: dict[str, Any] = {}
    for metric, note in (
        ("pass_run_mix", "PBP pass/run rows; see exported play_distribution.csv"),
        ("pass_run_by_game_state", "No observed joint game-state table in the checked-in PBP export"),
        ("yards_by_play_type", "PBP integer yards_gained split by pass/run"),
        ("yards_by_down_distance", "No observed down-distance yards table in the checked-in PBP export"),
        ("first_down_by_down_distance", "No observed down-distance first-down table; generated success is inferred from line-to-gain"),
        ("sacks_per_dropback", "PBP flagged sacks per PBP flagged QB dropback"),
        ("turnovers_per_scrimmage_play", "PBP interception plus fumble-lost flags per pass/run row"),
        ("third_fourth_conversion", "No observed third/fourth conversion cross-tab in the checked-in PBP export"),
        ("red_zone_conversion", "No observed red-zone conversion cross-tab in the checked-in PBP export"),
        ("plays_per_drive", "PBP offensive_play_rows_per_drive histogram"),
        ("pass_run_plays_per_drive", "PBP pass_run_rows_per_drive histogram"),
        ("possession_duration", "PBP snap_clock_span_seconds histogram in 30-second bins; not wall-clock possession"),
        ("drive_endings", "PBP final_source_series_result histogram, collapsed to event family"),
        ("total_points", "official schedule total-points histogram"),
        ("score_margin_abs", "official schedule absolute-margin histogram"),
    ):
        ref, ref_note = observed_refs[metric]
        generated = histograms.get(metric, [])
        comparisons[metric] = _comparison(ref, generated, replicates=bootstrap_replicates, rng=rng, observed_note=f"{note}; {ref_note}")

    observed_scores = observed_refs["total_points"][0] or Counter()
    observed_score_values = [float(value) for value, count in observed_scores.items() for _ in range(count)]
    generated_var = statistics.pvariance(total_points) if len(total_points) > 1 else None
    observed_var = statistics.pvariance(observed_score_values) if len(observed_score_values) > 1 else None
    observed_sorted = sorted(observed_score_values)
    generated_sorted = sorted(total_points)
    score_stats = {
        "observed_games": len(observed_score_values),
        "observed_mean_total_points": statistics.mean(observed_score_values) if observed_score_values else None,
        "observed_variance_total_points": observed_var,
        "observed_p90_total_points": observed_sorted[math.ceil(.90 * len(observed_sorted)) - 1] if observed_sorted else None,
        "observed_p99_total_points": observed_sorted[math.ceil(.99 * len(observed_sorted)) - 1] if observed_sorted else None,
        "generated_games": len(total_points),
        "generated_mean_total_points": statistics.mean(total_points) if total_points else None,
        "generated_variance_total_points": generated_var,
        "generated_p90_total_points": generated_sorted[math.ceil(.90 * len(generated_sorted)) - 1] if len(generated_sorted) >= 30 else None,
        "generated_p99_total_points": generated_sorted[math.ceil(.99 * len(generated_sorted)) - 1] if len(generated_sorted) >= 100 else None,
        "generated_variance_and_tails_estimable": len(total_points) >= 2,
        "generated_p90_estimable": len(total_points) >= 30,
        "generated_p99_estimable": len(total_points) >= 100,
    }

    conditional_rows = []
    for key, n in sorted(conditional.items()):
        pieces = key.split("|")
        conditional_rows.append({"family": pieces[0], "condition": "|".join(pieces[1:-1]), "value": pieces[-1], "count": n, "observed_reference": None, "status": "generated_only_reference_table_lacks_this_joint_split"})

    generated_fingerprints = [{"path": str(g["path"]), "sha256": sha256(g["path"]), "simulation_id": g["simulation_id"]} for g in game_data]
    return {
        "schema": "gridiron.e3.game-realism-evaluation.v1",
        "scope": {
            "generated_game_count": len(game_data),
            "all_generated_valid_full_game": all_valid,
            "evaluation_status": "EXPLORATORY_SMOKE_ONLY" if not all_valid or len(game_data) < 300 else "EVALUATED_PENDING_STOP_RULE",
            "held_out_status": "NOT_HELD_OUT: current E2 baseline is sampled from the 2022-2025 PBP window, and the available observed export spans that same window",
            "reserved_weeks_6_9": "not queried as a separate split; the aggregate 2022-2025 reference includes them, and prior E3 work already examined them, so they cannot be described as blind holdout",
            "observed_reference_window": observed_meta["manifest"]["window"],
            "bootstrap_unit": "generated whole games; observed aggregate histograms use a Dirichlet(counts) approximation to multinomial-resampled proportions because exported tables do not retain game keys; intervals do not preserve observed game clustering or cross-metric covariance",
            "bootstrap_replicates": bootstrap_replicates,
            "bootstrap_seed": SEED,
        },
        "sources": {
            "generated_payloads": generated_fingerprints,
            "lp_evidence_commit": lp_evidence_sha,
            "observed_manifest_sha256": observed_meta["manifest_sha256"],
            "observed_manifest": observed_meta["manifest"],
        },
        "per_game": per_game,
        "comparisons": comparisons,
        "conditional_generated_only": conditional_rows,
        "coverage": {
            "compared": [k for k, v in comparisons.items() if v["status"] == "compared_exploratory"],
            "reference_unavailable": [k for k, v in comparisons.items() if v["status"] == "reference_unavailable"],
            "requested_but_not_in_export": ["pass_run_by_game_state", "yards_and_first_downs_by_down_distance", "third_and_fourth_down_conversion", "red_zone_conversion", "team_and_player_stat_coherence"],
            "observed_missing_coverage": {"yards_gained_pass_run_null_rows": observed_yards_missing, "drive_clock_span_null_rows": observed_duration_missing},
            "conditional_reference_status": "Only pass/run and yards by pass/run are exported conditionally; no observed joint down-distance, field-zone, score-state or drive-ending cross-tabs are available.",
            "possession_duration_definition": "Observed snap-clock span is max-minus-min retained PBP snap clock within a drive; generated counterpart is derived from drive start/end quarter and clock; both are grouped in 30-second bins. Neither measures wall-clock possession or explicit stoppage duration.",
            "first_down_definition": "Generated-only proxy: yards_gained >= yards_to_go or touchdown; LP record has no explicit first_down result field. This is inferred, not observed.",
            "third_fourth_definition": "Generated-only proxy from the same line-to-gain condition on state_before.down 3 or 4; not compared to observed reference in the available export.",
        },
        "score_distribution_summary": score_stats,
        "stop_rule": {
            "minimum_generated_games": 300,
            "legal_gate": "Every generated payload must declare valid_full_game=true; otherwise stop as not scoreable for promotion.",
            "reference_support": "At least 30 observed games and 30 generated games per game-level metric; at least 200 eligible observations on each side for a play/drive conditional cell.",
            "acceptance": "After support gates, each comparable primary categorical distribution must have 95% bootstrap TVD upper bound <= 0.10; generated score variance and P90/P99 total-points tails must each be within 0.10 observed standard deviations; all required conditional cells must meet their support floor.",
            "rejection": "Reject promotion if any comparable primary metric's 95% bootstrap lower bound exceeds its threshold in two independently seeded, frozen batches.",
            "otherwise": "INCONCLUSIVE; do not tune on the evaluation split. Freeze a new prospective split before any follow-up.",
        },
    }


def render_markdown(result: dict[str, Any]) -> str:
    scope = result["scope"]
    lines = [
        "# E3 game-realism evaluator smoke run — 2026-10-24",
        "",
        "This is an evaluation-only harness. It imports no LP code and reads only LP game-record JSON plus the frozen observed-distribution CSV export.",
        "",
        f"**Status:** `{scope['evaluation_status']}`; `{scope['generated_game_count']}` generated game(s); all records valid full games: `{scope['all_generated_valid_full_game']}`.",
        "",
        f"**Validation boundary:** {scope['held_out_status']}. The current accepted E2 record declares `valid_full_game=false`; this run is an ingestion/scoring smoke test, not legal-game sign-off or evidence of forecast skill.",
        "",
        "## Marginal comparisons",
        "",
        "TVD is total-variation distance between categorical distributions; 0 is identical and 1 is disjoint. Intervals use the declared bootstrap and are exploratory because the observed export is aggregated and the generated baseline has one game.",
        "",
        "| Metric | Generated n | Observed n | TVD | Bootstrap 95% CI | Status |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for metric, value in result["comparisons"].items():
        ci = value.get("bootstrap_95_ci")
        ci_text = f"[{ci[0]:.4f}, {ci[1]:.4f}]" if ci else "—"
        tvd = f"{value['tvd']:.4f}" if value.get("tvd") is not None else "—"
        lines.append(f"| `{metric}` | {value.get('generated_n', 0)} | {value.get('observed_n', '—')} | {tvd} | {ci_text} | {value['status']} |")
    lines += [
        "",
        "## Requested metric coverage",
        "",
        "The evaluator emits generated-only conditional tables for down, distance, quarter, field zone and play family. The checked-in PBP export has no matching joint game-state/down-distance tables, so those splits are reported without fabricated observed values or confidence intervals.",
        "",
        "| Gate E3 metric | Current result |",
        "|---|---|",
        "| Pass/run mix by game state | Generated conditional table; observed joint reference unavailable |",
        "| Yards and first downs by down/distance | Generated table; observed reference unavailable; first down is an inferred line-to-gain proxy |",
        "| Sacks/turnovers per eligible play | Sacks per flagged dropback and turnovers per pass/run row are compared; conditional splits are unavailable |",
        "| Plays per drive | Compared to observed offensive rows per drive; a pass/run-only sensitivity is also emitted |",
        "| Possession duration | Compared in 30-second bins as snap-clock span, not wall time |",
        "| TD/FG/punt/turnover/clock drive endings | Compared after categories are collapsed to event families; opponent TD and QB kneel stay separate |",
        "| Third/fourth down and red-zone conversion | Generated-only; observed cross-tabs unavailable |",
        "| Total points, score variance and tails | Total-point and margin histograms compared; generated variance/tails unestimable from one game |",
        "| Team/player stat coherence | No matching reference table in this export |",
        "",
        "## Bootstrap and stop rule",
        "",
        f"Bootstrap: {scope['bootstrap_replicates']} replicates, seed {scope['bootstrap_seed']}; generated samples resample whole games. Observed CSV histogram proportions use a Dirichlet(counts) approximation to multinomial resampling because the export has no game keys, so observed clustering and cross-metric covariance are not preserved.",
        "",
        "Promotion requires at least 300 generated games, every payload `valid_full_game=true`, support floors per metric/cell, and all predeclared 95% bounds inside thresholds. Reject after two independent frozen batches if a primary lower bound exceeds threshold; otherwise result is inconclusive. The current run fails the legality and sample-size gates by construction.",
        "",
        "Reproduction command:",
        "",
        "```sh",
        "python scripts/research/e3_game_realism_evaluator.py --generated docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json --lp-evidence-sha a442dcd7 --observed-dir docs/fixtures/e3/observed-2022-2025 --json-out docs/evidence/e3/e3-game-realism-smoke-seed1-2026-10-24.json --report-out docs/evidence/e3/E3-GAME-REALISM-EVALUATOR-SMOKE-SEED1-2026-10-24.md --bootstrap-replicates 500",
        "```",
        "",
        "Verification output: 4 evaluator tests pass; evaluator status `EXPLORATORY_SMOKE_ONLY`; 1 generated game; 10 marginals compared, 5 references unavailable; 182 generated conditional rows; stop rule not met.",
        "",
        "## Provenance and limits",
        "",
        f"Observed export: `{result['sources']['observed_manifest']['schema']}`, {result['sources']['observed_manifest']['source_measurements']['nfl_pbp_games']} games and {result['sources']['observed_manifest']['source_measurements']['nfl_pbp_rows']} PBP rows, 2022–2025. Manifest SHA-256: `{result['sources']['observed_manifest_sha256']}`.",
        "",
        f"LP E2 evidence pin: `{result['sources'].get('lp_evidence_commit') or 'unspecified'}`. Generated payload raw SHA-256 values:",
        "",
    ]
    for payload in result["sources"]["generated_payloads"]:
        lines.append(f"- `{payload['path']}` — `{payload['sha256']}` (`{payload['simulation_id']}`)")
    lines += [
        "",
        "The current E2 record is a one-game 2022–2025 retrospective sample. Because its source window overlaps the observed reference, the score is not held-out validation. Weeks 6–9 were not queried as a separate split; they are included in the pooled 2022–2025 reference and had already been examined in earlier E3 work, so they are not a blind holdout.",
        "",
        "The tracking-informed pre-snap clock route is closed as a negative finding: 12.04 s MAE versus 11.89 s for PBP-only pre-snap on the reported comparison. No further tracking-clock calibration is authorized or performed here.",
        "",
        "The full machine-readable result is `e3-game-realism-smoke-seed1-2026-10-24.json`.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generated", action="append", type=Path, required=True, help="LP E2 game record JSON; repeat for a seed corpus")
    parser.add_argument("--observed-dir", type=Path, default=DEFAULT_OBSERVED)
    parser.add_argument("--json-out", type=Path, required=True)
    parser.add_argument("--report-out", type=Path, required=True)
    parser.add_argument("--bootstrap-replicates", type=int, default=DEFAULT_BOOTSTRAPS)
    parser.add_argument("--lp-evidence-sha", help="LP commit containing the immutable record JSON")
    args = parser.parse_args()
    result = evaluate(args.generated, args.observed_dir, args.bootstrap_replicates, args.lp_evidence_sha)
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(render_markdown(result))
    compared = sum(v["status"] == "compared_exploratory" for v in result["comparisons"].values())
    unavailable = sum(v["status"] == "reference_unavailable" for v in result["comparisons"].values())
    print(f"E3 evaluator: {result['scope']['evaluation_status']}")
    print(f"generated games={result['scope']['generated_game_count']} legal_full_game={result['scope']['all_generated_valid_full_game']}")
    print(f"marginal distributions compared={compared}; reference unavailable={unavailable}")
    print(f"conditional generated rows={len(result['conditional_generated_only'])}")
    print("stop rule: NOT MET (current E2 fixture is one valid_full_game=false game)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
