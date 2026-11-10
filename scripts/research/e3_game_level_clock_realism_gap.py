#!/usr/bin/env python3
"""Replay the frozen one-seed E2 event stream with clock policies only."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import math
import sqlite3
import statistics
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "docs/fixtures/e2/game-seed1.json"
E2_MANIFEST = ROOT / "docs/fixtures/e2/MANIFEST.json"
BASELINE = ROOT / "docs/evidence/e3/presnap-clock-model-comparison-weeks1-5-2026-10-24.json"
STATE_CSV = Path("/root/lp-nfl-bdb-join/docs/research/bdb2022-clock-audit-weeks1-5-2026-10-24.csv")
OBSERVED_MANIFEST = ROOT / "docs/fixtures/e3/observed-2022-2025/lp-manifest.json"
OBSERVED_DIR = OBSERVED_MANIFEST.parent
DB_DEFAULT = Path("/root/legendarypicks/backend/data/picks.dev.db")
EXPECTED_FIXTURE_SHA = "b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1"
EXPECTED_BASELINE_SHA = "4f1af788f3ca3a0ee18a994439acf8c8491ddffff945882b285202787de8e302"
EXPECTED_STATE_SHA = "f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9"
PASS_RUN_TYPES = {"run", "pass_complete", "pass_incomplete", "sack", "interception", "fumble_lost"}
SCORE_TYPES = ("total_points", "absolute_margin")
METRIC_NAMES = (
    "pass_run_plays_per_game", "time_of_possession_proxy_seconds", "drive_count_per_game",
    "home_score", "away_score", *SCORE_TYPES,
)
REFERENCE_FILTER = "regular season; 2022 weeks 1-5 and 2023-2025 all weeks; 2022 weeks 6-9 excluded"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def canonical_sha(rows) -> str:
    payload = json.dumps(rows, separators=(",", ":"), ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()


def load_clock_model():
    spec = importlib.util.spec_from_file_location(
        "e3_two_regime_presnap_clock", ROOT / "scripts/research/e3_two_regime_presnap_clock.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if sha256_file(BASELINE) != EXPECTED_BASELINE_SHA:
        raise ValueError("pinned PBP pre-snap baseline hash changed")
    if sha256_file(STATE_CSV) != EXPECTED_STATE_SHA:
        raise ValueError("pinned weeks 1-5 state crosswalk hash changed")
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    states, state_sha = module.load_state_csv(STATE_CSV)
    train_rows = []
    for item in baseline["per_play"]:
        key = (str(item["game_id"]), int(item["play_id"]))
        state = states.get(key)
        if state is None:
            raise ValueError(f"missing development state for {key}")
        train_rows.append({
            "target_s": float(item["target_s"]),
            "state_features": module.make_state_features(state),
        })
    if len(train_rows) != 8977:
        raise ValueError(f"unexpected frozen model training rows: {len(train_rows)}")
    return module, module.train_regimes(train_rows), state_sha


def _as_int(value, name):
    try:
        number = int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"missing {name}") from exc
    return number


def _fixture_record():
    manifest = json.loads(E2_MANIFEST.read_text(encoding="utf-8"))
    entry = next((item for item in manifest["fixtures"] if item["file"] == "game-seed1.json"), None)
    if entry is None or entry["sha256"] != EXPECTED_FIXTURE_SHA or sha256_file(FIXTURE) != EXPECTED_FIXTURE_SHA:
        raise ValueError("frozen E2 seed-1 fixture pin mismatch")
    envelope = json.loads(FIXTURE.read_text(encoding="utf-8"))
    record = envelope["record"]
    if record.get("seed") != 1 or record.get("valid_full_game") is not False:
        raise ValueError("expected the frozen scoped seed-1 E2 reference with valid_full_game=false")
    upstream_path = ROOT / "docs/fixtures/e2" / entry["upstream_source_file"]
    if sha256_file(upstream_path) != entry["upstream_source_sha256"]:
        raise ValueError("frozen E2 upstream payload hash mismatch")
    upstream = json.loads(upstream_path.read_text(encoding="utf-8"))
    return manifest, envelope, record, upstream


def _team_score_orientation(record):
    last = record["drives"][-1]["plays"][-1]["state_after"]
    points = record["points"]
    if points.get("A") == last.get("home_score") and points.get("B") == last.get("away_score"):
        return {"A": "home", "B": "away"}
    if points.get("A") == last.get("away_score") and points.get("B") == last.get("home_score"):
        return {"A": "away", "B": "home"}
    raise ValueError("cannot map fixture A/B score state to home/away without inventing a mapping")


def _observed_games(db_path: Path):
    uri = db_path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        game_rows = [dict(row) for row in connection.execute(
            "SELECT season, week, game_id, home_score, away_score "
            "FROM nfl_schedule WHERE game_type='REG' AND "
            "((season=2022 AND week BETWEEN 1 AND 5) OR season BETWEEN 2023 AND 2025) "
            "ORDER BY season, week, game_id"
        )]
        pbp_rows = [dict(row) for row in connection.execute(
            "SELECT p.season, p.week, p.game_id, p.drive, p.play_type, p.game_seconds_remaining "
            "FROM nfl_pbp AS p JOIN nfl_schedule AS s ON s.season=p.season AND s.game_id=p.game_id "
            "WHERE s.game_type='REG' AND "
            "((p.season=2022 AND p.week BETWEEN 1 AND 5) OR p.season BETWEEN 2023 AND 2025) "
            "ORDER BY p.season, p.week, p.game_id, p.play_id"
        )]
    finally:
        connection.close()
    games = {(int(x["season"]), str(x["game_id"])): x for x in game_rows}
    if not games or len(games) != len(game_rows):
        raise ValueError("observed regular-season schedule keys are empty or duplicated")
    per_game = {key: {"pass_run": 0, "drives": set(), "drive_clock": defaultdict(list)} for key in games}
    for row in pbp_rows:
        key = (int(row["season"]), str(row["game_id"]))
        if key not in per_game:
            raise ValueError(f"PBP row has no scheduled regular-season key: {key}")
        target = per_game[key]
        if row["play_type"] in ("pass", "run"):
            target["pass_run"] += 1
        if row["drive"] is not None:
            target["drives"].add(str(row["drive"]))
            if row["game_seconds_remaining"] is not None:
                target["drive_clock"][str(row["drive"])].append(float(row["game_seconds_remaining"]))
    if set(per_game) != {(int(x["season"]), str(x["game_id"])) for x in game_rows}:
        raise ValueError("schedule/PBP game-key mismatch")
    series = {name: [] for name in METRIC_NAMES}
    for key, game in per_game.items():
        schedule = games[key]
        if schedule["home_score"] is None or schedule["away_score"] is None:
            raise ValueError(f"scheduled final score unavailable for {key}")
        spans = [max(clocks) - min(clocks) for clocks in game["drive_clock"].values() if clocks]
        series["pass_run_plays_per_game"].append(game["pass_run"])
        series["drive_count_per_game"].append(len(game["drives"]))
        series["time_of_possession_proxy_seconds"].append(sum(spans))
        series["home_score"].append(int(schedule["home_score"]))
        series["away_score"].append(int(schedule["away_score"]))
        series["total_points"].append(int(schedule["home_score"]) + int(schedule["away_score"]))
        series["absolute_margin"].append(abs(int(schedule["home_score"]) - int(schedule["away_score"])))
    pbp_sha_rows = [[x["season"], x["week"], x["game_id"], x["drive"], x["play_type"], x["game_seconds_remaining"]] for x in pbp_rows]
    schedule_sha_rows = [[x["season"], x["week"], x["game_id"], x["home_score"], x["away_score"]] for x in game_rows]
    return series, {
        "games": len(games), "PBP_rows": len(pbp_rows), "nonnull_drive_groups": sum(len(x["drives"]) for x in per_game.values()),
        "schedule_rows_sha256": canonical_sha(schedule_sha_rows), "PBP_clock_subset_sha256": canonical_sha(pbp_sha_rows),
    }


def _bootstrap_ci(values, confidence=0.95):
    # Normal 95% CI for the observed mean; its limits are used to form a
    # reference-sampling CI for a fixed E2 seed, not a generated-policy CI.
    n = len(values)
    mean = statistics.mean(values)
    if n < 2:
        return [mean, mean]
    se = statistics.stdev(values) / math.sqrt(n)
    z = 1.959963984540054 if confidence == 0.95 else 1.959963984540054
    return [mean - z * se, mean + z * se]


def summarize_observed(values):
    ci = _bootstrap_ci(values)
    return {
        "games": len(values), "mean": round(statistics.mean(values), 4),
        "mean_95_ci_normal": [round(x, 4) for x in ci],
        "median": round(statistics.median(values), 4),
        "p10": round(_quantile(values, 0.10), 4), "p90": round(_quantile(values, 0.90), 4),
        "min": min(values), "max": max(values),
    }


def _quantile(values, p):
    ordered = sorted(values)
    pos = p * (len(ordered) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return ordered[lo] if lo == hi else ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def _fixture_clock_replay(record, clock_model, model_stats):
    orientation = _team_score_orientation(record)
    home_team = next(team for team, side in orientation.items() if side == "home")
    plays = [(drive, play) for drive in record["drives"] for play in drive["plays"]]
    if sum(len(drive["plays"]) for drive in record["drives"]) != 143:
        raise ValueError("frozen seed-1 play count changed")
    offset = 0.0
    replay = []
    changed_levels = Counter()
    sampled_total = sum(float(play["outcome"]["clock_runoff_seconds"]) for _drive, play in plays)
    model_prefix_total = 0.0
    candidate_stopped = None
    for index, (drive, play) in enumerate(plays):
        before = play["state_before"]
        after = play["state_after"]
        q = _as_int(before["quarter"], "quarter")
        base_clock = float(before["clock_seconds"])
        baseline_gsr = (4 - q) * 900 + base_clock
        counterfactual_gsr = baseline_gsr + offset
        counterfactual_clock = counterfactual_gsr - (4 - q) * 900
        if counterfactual_clock < 0 or counterfactual_clock > 900:
            candidate_stopped = {
                "before_play_sequence": int(play["sequence"]),
                "drive_index": int(drive["index"]), "quarter": q,
                "candidate_pre_snap_clock_seconds": round(counterfactual_clock, 4),
                "reason": "fixed fixture requests a snap outside the candidate period clock",
            }
            break
        offense = str(before["offense_team"])
        home_score = float(before["home_score"])
        away_score = float(before["away_score"])
        offense_score = home_score if orientation[offense] == "home" else away_score
        defense_score = away_score if orientation[offense] == "home" else home_score
        state = {
            "quarter": q, "quarter_seconds_remaining": counterfactual_clock,
            "score_diff": offense_score - defense_score,
            "down": before["down"], "distance": before["yards_to_go"],
            "timeouts_remaining": None,
        }
        features = clock_model.make_state_features(state)
        current = float(play["outcome"]["clock_runoff_seconds"])
        boundary = bool(play["outcome"].get("quarter_change")) or _as_int(after["quarter"], "after quarter") != q
        if boundary:
            chosen = current
            level = "preserved_period_boundary_runoff"
            raw_prediction = None
        else:
            prediction = clock_model.predict_regime(model_stats, features)
            raw_prediction = float(prediction["median_s"])
            chosen = raw_prediction
            level = prediction["level"]
        if not boundary and chosen >= counterfactual_clock:
            chosen = max(0.0, counterfactual_clock)
            expire_after_play = True
        else:
            expire_after_play = False
        changed_levels[level] += 1
        model_prefix_total += chosen
        replay.append({
            "drive_index": int(drive["index"]), "sequence": int(play["sequence"]), "event_type": play["event_type"],
            "quarter": q, "baseline_pre_snap_clock_s": base_clock,
            "candidate_pre_snap_clock_s": round(counterfactual_clock, 4),
            "score_diff_offense_relative": round(offense_score - defense_score, 4),
            "sampled_runoff_s": current, "raw_two_regime_prediction_s": raw_prediction,
            "applied_two_regime_runoff_s": round(chosen, 4), "prediction_level": level,
            "period_expired_after_this_play": expire_after_play,
        })
        offset += current - chosen
        if expire_after_play:
            next_item = plays[index + 1] if index + 1 < len(plays) else None
            candidate_stopped = {
                "period_ended_after_play_sequence": int(play["sequence"]),
                "drive_index": int(drive["index"]), "quarter": q,
                "clock_before_play_seconds": round(counterfactual_clock, 4),
                "model_prediction_seconds": round(raw_prediction, 4),
                "applied_runoff_seconds": round(chosen, 4),
                "candidate_clock_after_play_seconds": 0.0,
                "next_fixed_fixture_play_sequence": int(next_item[1]["sequence"]) if next_item else None,
                "next_fixed_fixture_quarter": _as_int(next_item[1]["state_before"]["quarter"], "next quarter") if next_item else None,
                "reason": "candidate clock reaches period end before the next fixed-fixture snap",
            }
            break

    drive_spans = []
    for drive in record["drives"]:
        base_times = []
        for play in drive["plays"]:
            q = _as_int(play["state_before"]["quarter"], "quarter")
            base = (4 - q) * 900 + float(play["state_before"]["clock_seconds"])
            base_times.append(base)
        drive_spans.append(max(base_times) - min(base_times))
    last = record["drives"][-1]["plays"][-1]
    final_q = _as_int(last["state_after"]["quarter"], "final quarter")
    sampled_final_clock = float(last["state_after"]["clock_seconds"])
    final_counterfactual_clock = sampled_final_clock + offset
    event_counts = Counter(play["event_type"] for _drive, play in plays)
    pass_run = sum(event_counts[name] for name in PASS_RUN_TYPES)
    result = {
        "seed": int(record["seed"]), "seeds_in_frozen_fixture": [int(record["seed"])],
        "event_stream_plays": len(plays), "pass_run_plays": pass_run,
        "drive_count": len(record["drives"]), "points": dict(record["points"]),
        "score_orientation": orientation, "home_team_label": home_team,
        "scoreline_home_away": [int(last["state_after"]["home_score"]), int(last["state_after"]["away_score"])],
        "total_points": int(record["points"]["A"]) + int(record["points"]["B"]),
        "absolute_margin": abs(int(record["points"]["A"]) - int(record["points"]["B"])),
        "sampled_runoff_total_s": round(sampled_total, 4), "two_regime_runoff_applied_prefix_s": round(model_prefix_total, 4),
        "runoff_model_predictions": sum(v for k, v in changed_levels.items() if k != "preserved_period_boundary_runoff"),
        "preserved_period_boundary_runoffs": changed_levels.get("preserved_period_boundary_runoff", 0),
        "prediction_levels": dict(changed_levels), "candidate_stopped": candidate_stopped,
        "candidate_replayed_plays": len(replay), "candidate_unreplayed_fixture_plays": len(plays) - len(replay),
        "sampled_final_clock_seconds": sampled_final_clock,
        "two_regime_full_game_clock_span_sum_s": None,
        "sampled_within_drive_snap_clock_span_sum_s": round(sum(drive_spans), 4),
        "per_drive_sampled_snap_clock_spans_s": [round(v, 4) for v in drive_spans],
        "per_play_clock_replay": replay,
    }
    return result


def build(db_path: Path):
    e2_manifest, envelope, record, upstream = _fixture_record()
    clock_model, model_stats, state_sha = load_clock_model()
    observed, observed_coverage = _observed_games(db_path)
    fixture_replay = _fixture_clock_replay(record, clock_model, model_stats)
    scenarios = {
        "current_sampled_runoff": {
            "pass_run_plays_per_game": fixture_replay["pass_run_plays"],
            "time_of_possession_proxy_seconds": fixture_replay["sampled_within_drive_snap_clock_span_sum_s"],
            "drive_count_per_game": fixture_replay["drive_count"],
            "home_score": fixture_replay["scoreline_home_away"][0],
            "away_score": fixture_replay["scoreline_home_away"][1],
            "total_points": fixture_replay["total_points"],
            "absolute_margin": fixture_replay["absolute_margin"],
        },
        "two_regime_presnap_clock": {
            "pass_run_plays_per_game": None,
            "time_of_possession_proxy_seconds": None,
            "drive_count_per_game": None,
            "home_score": None,
            "away_score": None,
            "total_points": None,
            "absolute_margin": None,
        },
    }
    metrics = {}
    for name in METRIC_NAMES:
        ref = summarize_observed(observed[name])
        metric = {"observed_reference": ref, "scenarios": {}}
        for scenario, values in scenarios.items():
            value = values[name]
            lo, hi = ref["mean_95_ci_normal"]
            metric["scenarios"][scenario] = {
                "seed1_value": value,
                "difference_from_observed_mean": round(value - ref["mean"], 4) if value is not None else None,
                "difference_95_ci_reference_only": [round(value - hi, 4), round(value - lo, 4)] if value is not None else None,
                "generated_seed_uncertainty": "not estimable from one frozen seed" if value is not None else "not estimable: clock replay ends before full fixed fixture can continue",
            }
        metrics[name] = metric
    original_manifest = json.loads(OBSERVED_MANIFEST.read_text(encoding="utf-8"))
    observed_table_hashes = {
        name: original_manifest["table_sha256"][name]
        for name in ("game_distribution.csv", "drive_distribution.csv", "play_distribution.csv")
    }
    return {
        "schema": "gridiron.e3.game_level_clock_realism_gap.v1",
        "study": "Frozen one-seed E2 sequence replayed under two clock policies; no event, score, drive, or LP producer behavior changed.",
        "sources": {
            "E2_fixture": "docs/fixtures/e2/game-seed1.json",
            "E2_fixture_sha256": sha256_file(FIXTURE),
            "E2_upstream_payload_sha256": e2_manifest["lp_source"]["payload_sha256"],
            "E2_LP_commit": e2_manifest["lp_source"]["base_commit"],
            "E2_valid_full_game": record["valid_full_game"],
            "E2_seed": int(record["seed"]),
            "E2_seed_selection": upstream.get("seed_selection"),
            "E2_upstream_fixture_sha256": sha256_file(ROOT / "docs/fixtures/e2" / e2_manifest["fixtures"][0]["upstream_source_file"]),
            "two_regime_training_baseline_sha256": sha256_file(BASELINE),
            "two_regime_training_state_crosswalk_sha256": state_sha,
            "two_regime_builder_sha256": sha256_file(ROOT / "scripts/research/e3_two_regime_presnap_clock.py"),
            "observed_fixture_manifest_sha256": sha256_file(OBSERVED_MANIFEST),
            "observed_fixture_manifest_schema": original_manifest["schema"],
            "observed_fixture_source_nfl_pbp_sha256": original_manifest["source_measurements"]["nfl_pbp_sha256"],
            "observed_fixture_table_sha256": observed_table_hashes,
            "observed_scope_filter": REFERENCE_FILTER,
            "observed_PBP_clock_subset_sha256": observed_coverage["PBP_clock_subset_sha256"],
            "observed_schedule_subset_sha256": observed_coverage["schedule_rows_sha256"],
        },
        "protocol": {
            "frozen_E2_package_is_reference_only": True,
            "same_seed_set": [int(record["seed"])],
            "seed_count": 1,
            "clock_model_fit": "conditional medians fit on the frozen 8,977-row weeks 1-5 development cohort; no weeks 6-9 were queried",
            "timeout_feature": "not used by the two-regime model; the model source marks timeouts-left unresolvable",
            "clock_replay": "replace each non-period-boundary sampled play runoff with the pre-snap two-regime prediction; keep period-boundary runoffs, kickoff runoffs, play order, outcomes, drive endings, score, and the E2 record fixed; carry cumulative clock-offset through later pre-snap states",
            "observed_top_proxy": "for each game, sum max(game_seconds_remaining)-min(game_seconds_remaining) within each non-null (game_id,drive); this is a snap-clock-span proxy, not official time of possession",
            "E2_top_proxy": "for each drive, sum the max-minus-min game-seconds-remaining span of its play pre-snap states; same proxy, excludes unobserved dead-ball and exact live-play time",
            "confidence_bounds": "normal 95% confidence interval for the observed mean; difference interval reverses those limits around the fixed seed-1 value. It captures reference-sample uncertainty only, not E2 seed or policy uncertainty.",
        },
        "observed_coverage": observed_coverage,
        "scenario_metrics": metrics,
        "fixed_outcome_reference": {
            "plays_in_event_stream": fixture_replay["event_stream_plays"],
            "pass_run_plays": fixture_replay["pass_run_plays"],
            "drive_count": fixture_replay["drive_count"],
            "scoreline_home_away": fixture_replay["scoreline_home_away"],
            "note": "These are current sampled-runoff fixture results. The two-regime clock path expires the period before the next fixed-fixture snap, so its complete-game metrics are not estimable without deciding future events.",
        },
        "clock_replay_diagnostics": {k: v for k, v in fixture_replay.items() if k != "per_play_clock_replay"},
        "per_play_clock_replay": fixture_replay["per_play_clock_replay"],
        "limitations": [
            "The frozen package contains seed 1 only; no multi-seed distribution or generated-policy confidence interval is available without running the LP E2 engine.",
            "The frozen E2 sequence was retrospectively sampled from a 2022-2025 outcome pool and is not insulated from 2022 weeks 6-9 donor rows; this replay is not blind-holdout evidence.",
            "valid_full_game is false. The record is a scoped E2 research fixture, not legal-game evidence.",
            "The replay holds play events, drive endings, and scoring fixed. Plays, drives, and score comparisons are reference-gap diagnostics, not causal effects of clock policy.",
            "The two-regime replay does not invent timeouts, two-minute warnings, penalties, stoppages, or period transitions; the source fixture declares these areas unsupported.",
            "Observed reference excludes 2022 weeks 6-9 to honor the frozen protocol; 2022 weeks 1-5 and all regular-season games in 2023-2025 are used.",
            "Possession time is a within-drive snap-clock span proxy; it is not official time of possession or live-ball duration.",
        ],
    }


def _write_markdown(result, path: Path):
    metrics = result["scenario_metrics"]
    keys = ("pass_run_plays_per_game", "time_of_possession_proxy_seconds", "drive_count_per_game", "total_points")
    labels = {
        "pass_run_plays_per_game": "Pass/run plays per game",
        "time_of_possession_proxy_seconds": "Possession clock-span proxy (s)",
        "drive_count_per_game": "Drive groups per game",
        "total_points": "Total points (score distribution)",
    }
    lines = [
        "# Game-level clock realism gap — frozen E2 seed 1",
        "",
        "## Scope",
        "",
        "The immutable E2 fixture at LP payload SHA `" + result["sources"]["E2_upstream_payload_sha256"] + "` was replayed once with its current sampled per-play runoffs and once with the weeks 1–5 two-regime pre-snap clock model. The fixture has one seed (1), 143 event-stream plays, 24 drives, score A 14–B 10, and `valid_full_game=false`. Its producer selected the first seed in 1–300 that completed regulation untied and unblocked; this is a selected singleton, not a random-seed sample. No LP engine or E2 producer file was run or changed.",
        "",
        "The observed reference uses " + str(result["observed_coverage"]["games"]) + " regular-season games: 2022 weeks 1–5 and 2023–2025. 2022 weeks 6–9 were not queried. Confidence intervals below describe uncertainty in the observed mean only; a single frozen E2 seed supplies no generated-policy interval.",
        "",
        "## Metrics",
        "",
        "Differences and their intervals are E2 seed-1 value minus observed mean. The intervals transform the observed-mean 95% normal CI; they do not include simulation variance.",
        "",
        "| Metric | Observed mean (95% CI) | Current sampled runoff | Difference (95% CI) | Two-regime clock | Difference (95% CI) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key in keys:
        row = metrics[key]
        ref = row["observed_reference"]
        a = row["scenarios"]["current_sampled_runoff"]
        b = row["scenarios"]["two_regime_presnap_clock"]
        def cell(item):
            value = item["seed1_value"]
            if value is None:
                return "Not estimable"
            ci = item["difference_95_ci_reference_only"]
            return f"{value:.2f} | {item['difference_from_observed_mean']:+.2f} ({ci[0]:+.2f}, {ci[1]:+.2f})"
        lines.append(
            f"| {labels[key]} | {ref['mean']:.2f} ({ref['mean_95_ci_normal'][0]:.2f}, {ref['mean_95_ci_normal'][1]:.2f}) | "
            f"{cell(a)} | {cell(b)} |"
        )
    score_components = []
    for name, label in (("home_score", "home"), ("away_score", "away"), ("absolute_margin", "absolute margin")):
        metric = metrics[name]
        ref = metric["observed_reference"]
        scenario = metric["scenarios"]["current_sampled_runoff"]
        ci = scenario["difference_95_ci_reference_only"]
        score_components.append(
            f"{label} {scenario['seed1_value']:.0f} vs observed mean {ref['mean']:.2f} "
            f"(E2-minus-mean {scenario['difference_from_observed_mean']:+.2f}, 95% CI {ci[0]:+.2f} to {ci[1]:+.2f})"
        )
    lines += [
        "",
        f"The current fixture scoreline is `{result['fixed_outcome_reference']['scoreline_home_away'][0]}–{result['fixed_outcome_reference']['scoreline_home_away'][1]}`; total points are 24. Score components: {'; '.join(score_components)}. These are marginal comparisons; one scoreline does not establish a score-distribution fit.",
        "",
        "## Interpretation",
        "",
        "The current sampled-runoff fixture has 128 pass/run plays, 24 drive groups, and a 14–10 score. Under the two-regime clock replay, play sequence 27 in drive 4 predicts 33 seconds with only 13.5 seconds left in quarter 1. Clamping that runoff to period end makes the fixture's next snap (sequence 28, still labeled quarter 1) impossible. Therefore the candidate has no complete-game plays/game, time-of-possession, drive-count, or score metric; these are marked not estimable instead of treating the unchanged fixture outcome as a valid counterfactual. Continuing after that boundary would require the game executor to decide what happens next. The LP E2 successor engine remains untouched and full legal-game status is unsigned.",
        "",
        f"The clock replay evaluated {result['clock_replay_diagnostics']['candidate_replayed_plays']} fixture plays and could not replay the remaining {result['clock_replay_diagnostics']['candidate_unreplayed_fixture_plays']}. It applied {result['clock_replay_diagnostics']['runoff_model_predictions']} model predictions before period expiry and preserved {result['clock_replay_diagnostics']['preserved_period_boundary_runoffs']} period-boundary runoffs. The raw sum of stored sampled per-play runoff fields is {result['clock_replay_diagnostics']['sampled_runoff_total_s']:.1f}s; the applied two-regime prefix is {result['clock_replay_diagnostics']['two_regime_runoff_applied_prefix_s']:.1f}s. These sums include terminal/clamp and period-boundary behavior and are not whole-game elapsed-time estimates. The current fixture's within-drive snap-clock-span proxy is {result['clock_replay_diagnostics']['sampled_within_drive_snap_clock_span_sum_s']:.1f}s; the counterfactual full-game proxy is not estimable.",
        "",
        "The reference possession metric is a snap-clock-span proxy, not official time of possession. The E2 fixture itself is `valid_full_game=false`, uses one seed, and declares timeouts, two-minute warnings, penalties, and overtime unsupported. The reported intervals therefore describe observed-reference sampling uncertainty only; they do not establish policy uncertainty or legal game realism.",
        "",
        "The E2 event sequence was retrospectively sampled from 2022–2025 PBP and is not protected from 2022 weeks 6–9 donor rows. The observed comparison excludes those weeks, but the frozen generated fixture itself is not blind-holdout evidence.",
        "",
        "## Provenance",
        "",
        f"- Frozen E2 fixture SHA-256: `{result['sources']['E2_fixture_sha256']}`; upstream payload SHA-256: `{result['sources']['E2_upstream_payload_sha256']}`.",
        f"- Frozen two-regime development baseline SHA-256: `{result['sources']['two_regime_training_baseline_sha256']}`.",
        f"- Weeks 1–5 clock-state crosswalk SHA-256: `{result['sources']['two_regime_training_state_crosswalk_sha256']}`.",
        f"- Observed fixture manifest SHA-256: `{result['sources']['observed_fixture_manifest_sha256']}`.",
        f"- Observed source PBP fingerprint SHA-256: `{result['sources']['observed_fixture_source_nfl_pbp_sha256']}`; checked-in game/drive/play distribution table hashes: `{json.dumps(result['sources']['observed_fixture_table_sha256'], sort_keys=True)}`.",
        f"- Observed PBP subset SHA-256: `{result['sources']['observed_PBP_clock_subset_sha256']}`; schedule subset SHA-256: `{result['sources']['observed_schedule_subset_sha256']}`.",
        "- The machine-readable report retains per-play clock replay values and all four comparison distributions.",
        "",
        "## Reproduction",
        "",
        "```bash",
        "python scripts/research/e3_game_level_clock_realism_gap.py \\",
        "  --db /root/legendarypicks/backend/data/picks.dev.db \\",
        "  --json-output docs/evidence/e3/game-level-clock-realism-gap-seed1-2022-2025-2026-10-24.json \\",
        "  --markdown-output docs/evidence/e3/GAME-LEVEL-CLOCK-REALISM-GAP-SEED1-2022-2025-2026-10-24.md",
        "```",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DB_DEFAULT)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = build(args.db)
    except (OSError, sqlite3.Error, ValueError, KeyError, RuntimeError) as exc:
        parser.error(str(exc))
    result["sources"]["report_builder_sha256"] = sha256_file(Path(__file__))
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    _write_markdown(result, args.markdown_output)
    print(f"E2 fixture: seed={result['sources']['E2_seed']}; valid_full_game={result['sources']['E2_valid_full_game']}")
    print(f"Observed reference games={result['observed_coverage']['games']}; rows={result['observed_coverage']['PBP_rows']}; 2022 weeks 6-9 excluded")
    for name in METRIC_NAMES:
        a = result["scenario_metrics"][name]["scenarios"]["current_sampled_runoff"]["seed1_value"]
        b = result["scenario_metrics"][name]["scenarios"]["two_regime_presnap_clock"]["seed1_value"]
        print(f"{name}: current={a}; two_regime={b}")
    print(f"Output SHA-256={sha256_file(args.json_output)}")


if __name__ == "__main__":
    main()
