#!/usr/bin/env python3
"""Score sampled, PBP-only, and BDB-2022 pre-snap clock models once on E3 weeks 6-9."""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
import sqlite3
import statistics
import subprocess
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts/bdb"))

from scripts.bdb.e3_three_way_clock_comparison import (  # noqa: E402
    E1_MIN_POOL,
    SAMPLE_DRAWS,
    build_e1_pools,
    e1_cell,
    e1_classify,
    group_next,
    key_of,
    sample_draws,
)
from scripts.research.e3_presnap_clock_models import (  # noqa: E402
    make_pbp_features,
    make_tracking_features,
    predict,
    train_model,
)

LP_REPO_DEFAULT = Path("/root/lp-nfl-bdb-join")
PBP_DB_DEFAULT = Path("/root/legendarypicks/backend/data/picks.dev.db")
TRACKING_ROOT_DEFAULT = Path("/root/nfl-tracking-data/bdb2025/code-data")
LP_COMMIT = "6a169bead09496d4a569000522a6e293d7176548"
LP_COVERAGE_PATH = "docs/research/e3-tracking-coverage-2026-10-24.json"
LP_JOIN_PATH = "docs/research/e3-tracking-join-pairs-2026-10-24.csv"
LP_COVERAGE_SHA256 = "d6c11dd5d502d181c11a6ffa008326bcc5569e2eefa72a8cf540921b4855380b"
LP_JOIN_SHA256 = "80d8911697b34434fc16d32afe3ecb5f8d3e83ad0446cc7e4788382469bcf1ac"
HOLDOUT_PROTOCOL_PATH = ROOT / "docs/research/E3-PRESNAP-CLOCK-HOLDOUT-PROTOCOL-2026-10-24.json"
HOLDOUT_PROTOCOL_SHA256 = "e9d0920ff9d54d88bb45fa8f263e01483571c9b73482ce1541cab3c2b3b42392"
DEV_FEATURE_PATH = ROOT / "docs/research/gridiron-e3-presnap-tracking-features-weeks1-5-2026-10-24.json"
DEV_FEATURE_SHA256 = "5ca5cabd3ed5c262fbf60a96af62f7921d0402fab11b7dfc0274dfbfc816e506"
DEV_TRACKING_SHA256 = {
    1: "dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c",
    2: "d735b37f04bdf324132b9cb0f084a4ca583fadbbf02653e1873dad39c36924aa",
    3: "db2965ad61a5ad3895a8878a3754c3d3e4bf4b2dce75732c0b6b4d9d094887bb",
    4: "2e931bc9cd7f6126d6cd1e7eb71a3c711b748a0cece9d04dcace870e7298774f",
    5: "1c10136562b82f3e2d5405247540d890fc02f38804109bdaaba5e63bd816c3e9",
}
HOLDOUT_TRACKING_SHA256 = {
    6: "684692991ba0875ea7bce45406cf3e47882c88528d876887aa455c40a23a1c32",
    7: "29fb1b4737a40c28dbc4422bca6588cdfaa85e5e513ba8b9c06075c2ce22aee7",
    8: "b27824f46a9b5cdd8a5064b46beb6f1d536f659f26a04a49380d5edec8e48b77",
    9: "bb51989c1e2b796e0185bfbeab9d07515e24994b8a4a40fc297a53440beaa349",
}
TRAIN_WEEKS = (1, 2, 3, 4, 5)
EVAL_WEEKS = (6, 7, 8, 9)
FRAME_SECONDS = 0.1
MIN_BUCKET = 25
PBP_FIELDS = (
    "game_id", "play_id", "season", "week", "posteam", "defteam", "qtr", "down", "ydstogo",
    "yardline_100", "game_seconds_remaining", "play_type", "yards_gained", "complete_pass",
    "touchdown", "interception", "fumble_lost", "sack", "qb_scramble", "penalty",
    "two_point_attempt", "drive",
)
TEAM_ALIASES = {"LA": "LAR", "LAR": "LAR", "WAS": "WSH", "WSH": "WSH", "JAC": "JAX", "JAX": "JAX"}
MODEL_KEYS = ("A_sampled_runoff", "B_pbp_presnap", "C_tracking_presnap")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_sha(rows) -> str:
    raw = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return sha256_bytes(raw)


def validate_eval_weeks(weeks):
    selected = tuple(sorted(set(int(week) for week in weeks)))
    if selected != EVAL_WEEKS:
        raise ValueError("frozen E3 evaluation requires exactly weeks 6-9")
    return selected


def normalize_team(value):
    code = str(value or "").strip().upper()
    return TEAM_ALIASES.get(code, code)


def _distance(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def _nearest_mean(players, others=None):
    distances = []
    for player in players:
        candidates = others if others is not None else [p for p in players if p["nfl_id"] != player["nfl_id"]]
        if candidates:
            distances.append(min(_distance(player, candidate) for candidate in candidates))
    return statistics.mean(distances) if distances else None


def summarize_pre_snap_frames(frames, snap_frame, offense_team, defense_team):
    """Summarize only the exact all-22 frames snap-3 through snap-1."""
    wanted = (int(snap_frame) - 3, int(snap_frame) - 2, int(snap_frame) - 1)
    if any(frame not in frames for frame in wanted):
        return None, "missing_pre_snap_frame"
    snapshots = [frames[frame] for frame in wanted]
    ids = [set(snapshot) for snapshot in snapshots]
    if ids[0] != ids[1] or ids[1] != ids[2] or len(ids[0]) != 22:
        return None, "pre_snap_player_history_not_same_22"
    offense = normalize_team(offense_team)
    defense = normalize_team(defense_team)
    teams_by_id = {pid: snapshots[-1][pid]["club"] for pid in sorted(ids[-1])}
    off_ids = [pid for pid, club in teams_by_id.items() if club == offense]
    def_ids = [pid for pid, club in teams_by_id.items() if club == defense]
    if len(off_ids) != 11 or len(def_ids) != 11:
        return None, "pre_snap_team_counts_not_11v11"
    for pid in ids[0]:
        if len({snapshot[pid]["club"] for snapshot in snapshots}) != 1:
            return None, "player_club_changed_in_pre_snap_window"

    def summarize(team_ids):
        positions = [snapshots[-1][pid] for pid in team_ids]
        speeds, accelerations = [], []
        for pid in team_ids:
            p0, p1, p2 = (snapshot[pid] for snapshot in snapshots)
            vx1, vy1 = (p1["x"] - p0["x"]) / FRAME_SECONDS, (p1["y"] - p0["y"]) / FRAME_SECONDS
            vx2, vy2 = (p2["x"] - p1["x"]) / FRAME_SECONDS, (p2["y"] - p1["y"]) / FRAME_SECONDS
            speeds.append(math.hypot(vx2, vy2))
            accelerations.append(math.hypot((vx2 - vx1) / FRAME_SECONDS, (vy2 - vy1) / FRAME_SECONDS))
        return {
            "mean_speed": statistics.mean(speeds),
            "mean_acceleration": statistics.mean(accelerations),
            "mean_nearest_teammate": _nearest_mean(positions),
        }

    off, deff = summarize(off_ids), summarize(def_ids)
    result = {
        "offense_mean_speed_yards_per_second": off["mean_speed"],
        "defense_mean_speed_yards_per_second": deff["mean_speed"],
        "offense_mean_acceleration_magnitude_yards_per_second_squared": off["mean_acceleration"],
        "defense_mean_acceleration_magnitude_yards_per_second_squared": deff["mean_acceleration"],
        "offense_mean_nearest_teammate_distance_yards": off["mean_nearest_teammate"],
        "defense_mean_nearest_teammate_distance_yards": deff["mean_nearest_teammate"],
    }
    return result, None


class HashingLines:
    def __init__(self, source, digest):
        self.source, self.digest = source, digest

    def __iter__(self):
        for raw in self.source:
            self.digest.update(raw)
            yield raw.decode("utf-8")


def _parse_bdb_key(row):
    try:
        return str(int(float(row["gameId"]))), int(float(row["playId"]))
    except (KeyError, TypeError, ValueError):
        return None


def scan_tracking_week(path: Path, week: int, selected, expected_sha256: str):
    """Read verified joined plays; discard SNAP and later coordinates before parsing x/y."""
    digest = hashlib.sha256()
    results, exclusions = {}, Counter()
    rows_scanned = 0
    with path.open("rb") as source:
        reader = csv.reader(HashingLines(source, digest))
        header = next(reader)
        required = {"gameId", "playId", "nflId", "frameId", "frameType", "club", "x", "y"}
        missing = sorted(required - set(header))
        if missing:
            raise ValueError(f"tracking week {week} missing required columns: {missing}")
        ix = {name: header.index(name) for name in required}

        def group_key(values):
            try:
                return str(int(float(values[ix["gameId"]]))), int(float(values[ix["playId"]]))
            except (IndexError, TypeError, ValueError):
                return None

        for key, group in itertools.groupby(reader, key=group_key):
            if key is None:
                raise ValueError(f"malformed BDB tracking key in week {week}")
            if key not in selected:
                for _ in group:
                    rows_scanned += 1
                continue
            rows_scanned += 0  # selected groups increment once per row below
            meta = selected[key]
            recent = deque(maxlen=3)
            current_frame = None
            current_players = {}
            snap_frame = None
            last_frame = None
            for row in group:
                rows_scanned += 1
                if len(row) <= max(ix.values()):
                    exclusions["short_csv_row"] += 1
                    continue
                try:
                    frame = int(row[ix["frameId"]])
                except (TypeError, ValueError):
                    exclusions["invalid_frame_id"] += 1
                    continue
                if snap_frame is not None:
                    continue
                if last_frame is not None and frame < last_frame:
                    raise ValueError(f"BDB rows are not frame ordered for {key} in week {week}")
                last_frame = frame
                if current_frame is None:
                    current_frame = frame
                elif frame != current_frame:
                    recent.append((current_frame, current_players))
                    current_frame, current_players = frame, {}
                if row[ix["frameType"]] == "SNAP":
                    snap_frame = frame
                    continue
                nfl_id = str(row[ix["nflId"]] or "").strip()
                club = normalize_team(row[ix["club"]])
                if not nfl_id or nfl_id.upper() in {"NA", "NAN", "NULL"} or club not in {meta["offense_team"], meta["defense_team"]}:
                    continue
                try:
                    x, y = float(row[ix["x"]]), float(row[ix["y"]])
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(x) or not math.isfinite(y):
                    continue
                if nfl_id in current_players:
                    raise ValueError(f"duplicate player row at {key=} {frame=} {nfl_id=}")
                current_players[nfl_id] = {"nfl_id": nfl_id, "club": club, "x": x, "y": y}
            if snap_frame is None:
                exclusions["missing_snap_frame"] += 1
                continue
            frame_map = dict(recent)
            feature, reason = summarize_pre_snap_frames(
                frame_map, snap_frame, meta["offense_team"], meta["defense_team"]
            )
            if feature is None:
                exclusions[reason] += 1
                continue
            lp_key = meta["lp_key"]
            results[lp_key] = {
                "week": week,
                "lp_game_id": lp_key[0],
                "lp_play_id": lp_key[1],
                "bdb_game_id": int(key[0]),
                "bdb_play_id": key[1],
                "snap_frame": snap_frame,
                "last_input_frame": snap_frame - 1,
                "input_frame_range": [snap_frame - 3, snap_frame - 1],
                "players_at_each_input_frame": {str(frame): 22 for frame in range(snap_frame - 3, snap_frame)},
                "tracking_features": feature,
            }
    actual = digest.hexdigest()
    if actual != expected_sha256:
        raise ValueError(f"tracking week {week} sha256 mismatch: {actual}")
    return results, {"rows_scanned": rows_scanned, "complete_features": len(results), "exclusions": dict(exclusions), "sha256": actual}


def _load_lp_artifact(lp_repo: Path, relpath: str, expected_sha256: str):
    proc = subprocess.run(
        ["git", "-C", str(lp_repo), "show", f"{LP_COMMIT}:{relpath}"],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    actual = sha256_bytes(proc.stdout)
    if actual != expected_sha256:
        raise ValueError(f"LP pinned input hash mismatch for {relpath}: {actual}")
    return proc.stdout


def load_lp_join(lp_repo: Path):
    coverage_raw = _load_lp_artifact(lp_repo, LP_COVERAGE_PATH, LP_COVERAGE_SHA256)
    join_raw = _load_lp_artifact(lp_repo, LP_JOIN_PATH, LP_JOIN_SHA256)
    coverage = json.loads(coverage_raw)
    if coverage.get("status_counts", {}).get("verified") != 15768:
        raise ValueError("LP pinned coverage report's verified-play count changed")
    by_bdb, by_lp = {}, {}
    reader = csv.DictReader(join_raw.decode("utf-8").splitlines())
    required = {"bdb_gameId", "bdb_playId", "lp_game_id", "lp_play_id", "has_snap_frame", "status"}
    if not required <= set(reader.fieldnames or ()):
        raise ValueError("LP join pairs file is missing required identifier/status fields")
    for row in reader:
        if row["status"] != "verified":
            continue
        if row["has_snap_frame"] != "1":
            raise ValueError("LP marks a verified play without a snap frame")
        bdb_key = (str(int(float(row["bdb_gameId"]))), int(float(row["bdb_playId"])))
        lp_key = (str(row["lp_game_id"]), int(float(row["lp_play_id"])))
        if bdb_key in by_bdb or lp_key in by_lp:
            raise ValueError("duplicate key in LP verified join pairs")
        by_bdb[bdb_key] = {"lp_key": lp_key}
        by_lp[lp_key] = bdb_key
    if len(by_bdb) != 15768:
        raise ValueError(f"expected 15768 verified LP join pairs, found {len(by_bdb)}")
    return by_bdb, by_lp, {
        "commit": LP_COMMIT,
        "coverage_path": LP_COVERAGE_PATH,
        "coverage_sha256": LP_COVERAGE_SHA256,
        "join_path": LP_JOIN_PATH,
        "join_sha256": LP_JOIN_SHA256,
        "verified_join_pairs": len(by_bdb),
        "tracking_plays": coverage["scope"]["bdb_tracked_plays"],
        "unverified_status_counts": coverage["status_counts"],
        "uncovered_lp_scrimmage_plays": coverage["lp_scrimmage_plays_tracking"],
    }


def load_pbp(db_path: Path):
    connection = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        placeholders = ",".join("?" for _ in range(9))
        rows = [dict(row) for row in connection.execute(
            f"SELECT {', '.join(PBP_FIELDS)} FROM nfl_pbp WHERE season=2022 AND week IN ({placeholders}) ORDER BY game_id, play_id",
            tuple(range(1, 10)),
        )]
    finally:
        connection.close()
    return rows


def make_targets(rows):
    eligible = [row for row in rows if row.get("play_type") is not None]
    by_game = defaultdict(list)
    for row in eligible:
        by_game[str(row["game_id"])].append(row)
    targets, following_play = {}, {}
    for plays in by_game.values():
        plays.sort(key=lambda row: int(float(row["play_id"])))
        for i, row in enumerate(plays):
            key = key_of(row)
            nxt = plays[i + 1] if i + 1 < len(plays) else None
            following_play[key] = nxt
            if nxt is None or row.get("qtr") is None or nxt.get("qtr") is None or row["qtr"] != nxt["qtr"]:
                continue
            try:
                current_clock, next_clock = float(row["game_seconds_remaining"]), float(nxt["game_seconds_remaining"])
            except (TypeError, ValueError):
                continue
            delta = current_clock - next_clock
            if math.isfinite(delta) and delta >= 0:
                targets[key] = round(delta, 3)
    return eligible, targets, following_play


def load_development_features(path: Path, by_lp):
    if sha256_file(path) != DEV_FEATURE_SHA256:
        raise ValueError("weeks 1-5 all-22 feature artifact SHA-256 mismatch")
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != "gridiron.bdb2025.presnap_tracking_features.v1":
        raise ValueError("unexpected weeks 1-5 feature schema")
    source_files = {int(item["week"]): item["sha256"] for item in document["source"]["tracking_source"]["files"]}
    if source_files != DEV_TRACKING_SHA256:
        raise ValueError("weeks 1-5 feature input tracking-file hashes differ from frozen values")
    output = {}
    for item in document["plays"]:
        week = int(item["week"])
        if week not in TRAIN_WEEKS:
            raise ValueError(f"development features contain a reserved week: {week}")
        snap = int(item["snap_frame"])
        if int(item["last_input_frame"]) != snap - 1 or item["input_frame_range"] != [snap - 3, snap - 1]:
            raise ValueError("development feature window is not exactly snap-3 through snap-1")
        if set(item["players_at_each_input_frame"].values()) != {22}:
            raise ValueError("development feature is not all-22 at every pre-snap frame")
        lp_key = (str(item["lp_game_id"]), int(item["lp_play_id"]))
        if lp_key not in by_lp:
            continue
        if lp_key in output:
            raise ValueError(f"duplicate development feature LP key: {lp_key}")
        output[lp_key] = item
    return output


def _mean(values):
    return statistics.mean(values) if values else None


def _quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    index = probability * (len(ordered) - 1)
    lo, hi = math.floor(index), math.ceil(index)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)


def _drive_key(row):
    if row.get("drive") is None:
        return None
    return (str(row["game_id"]), int(float(row["drive"])))


def _period_clock(row):
    try:
        qtr = int(float(row["qtr"]))
        game_clock = float(row["game_seconds_remaining"])
    except (TypeError, ValueError):
        return None
    return game_clock - (4 - qtr) * 900 if 1 <= qtr <= 4 else None


def stop_bucket_flags(row, target_s):
    flags = []
    if target_s == 0:
        flags.append("zero_displayed_clock_delta")
    if row.get("play_type") == "pass" and row.get("complete_pass") == 0:
        flags.append("incomplete_pass_source_flag")
    if row.get("penalty") == 1:
        flags.append("penalty_flag")
    qtr_clock = _period_clock(row)
    try:
        quarter = int(float(row["qtr"]))
    except (TypeError, ValueError):
        quarter = None
    if quarter in (2, 4) and qtr_clock is not None and qtr_clock <= 120:
        flags.append("late_half_pre_snap_context")
    if row.get("play_type") == "no_play":
        flags.append("no_play_row")
    if row.get("touchdown") == 1:
        flags.append("touchdown_flag")
    return flags


def _model_summaries(scored):
    predictions = {name: [row["predictions"][name]["point_s"] for row in scored] for name in MODEL_KEYS}
    truth = [row["target_s"] for row in scored]
    errors = {name: [prediction - target for prediction, target in zip(values, truth)] for name, values in predictions.items()}
    drives = {_drive_key(row["pbp"]) for row in scored}
    games = {str(row["pbp"]["game_id"]) for row in scored}
    metrics = {}
    for name in MODEL_KEYS:
        abs_errors = [abs(x) for x in errors[name]]
        metrics[name] = {
            "plays": len(scored),
            "drives": len({x for x in drives if x is not None}),
            "games": len(games),
            "mae_s": _mean(abs_errors),
            "p90_abs_error_s": _quantile(abs_errors, 0.90),
            "p99_abs_error_s": _quantile(abs_errors, 0.99),
            "mean_signed_error_s": _mean(errors[name]),
        }
    per_game = defaultdict(lambda: {name: {"predicted_s": 0.0} for name in MODEL_KEYS} | {"observed_s": 0.0, "plays": 0, "drives": set()})
    for row in scored:
        bucket = per_game[str(row["pbp"]["game_id"])]
        bucket["observed_s"] += row["target_s"]
        bucket["plays"] += 1
        drive = _drive_key(row["pbp"])
        if drive is not None:
            bucket["drives"].add(drive)
        for name in MODEL_KEYS:
            bucket[name]["predicted_s"] += row["predictions"][name]["point_s"]
    game_metrics = {}
    game_rows = []
    for game_id, item in sorted(per_game.items()):
        out = {"game_id": game_id, "plays": item["plays"], "drives": len(item["drives"]), "observed_clock_span_s": round(item["observed_s"], 3)}
        game_rows.append(out)
        for name in MODEL_KEYS:
            gap = item[name]["predicted_s"] - item["observed_s"]
            game_metrics.setdefault(name, []).append(gap)
            out[name] = {"predicted_clock_span_s": round(item[name]["predicted_s"], 3), "gap_s": round(gap, 3)}
    summary = {}
    for name, gaps in game_metrics.items():
        abs_gaps = [abs(x) for x in gaps]
        summary[name] = {
            "games": len(gaps),
            "mean_signed_cumulative_gap_s_per_game": _mean(gaps),
            "mae_cumulative_gap_s_per_game": _mean(abs_gaps),
            "p90_abs_cumulative_gap_s_per_game": _quantile(abs_gaps, 0.90),
        }
    return metrics, summary, game_rows


def _stoppage_summaries(scored):
    grouped = defaultdict(list)
    for row in scored:
        for flag in row["stop_buckets"]:
            grouped[flag].append(row)
    output = {}
    for flag, rows in sorted(grouped.items()):
        item = {"rows": len(rows), "drives": len({k for k in (_drive_key(r["pbp"]) for r in rows) if k is not None})}
        for name in MODEL_KEYS:
            errors = [r["predictions"][name]["point_s"] - r["target_s"] for r in rows]
            item[name] = {
                "mae_s": _mean([abs(x) for x in errors]),
                "mean_signed_error_s": _mean(errors),
                "positive_prediction_on_zero_delta_rows": sum(
                    r["predictions"][name]["point_s"] > 0 for r in rows if r["target_s"] == 0
                ),
            }
        output[flag] = item
    return output


def build(args):
    validate_eval_weeks(EVAL_WEEKS)
    protocol_raw = HOLDOUT_PROTOCOL_PATH.read_bytes()
    if sha256_bytes(protocol_raw) != HOLDOUT_PROTOCOL_SHA256:
        raise ValueError("frozen clock holdout protocol SHA-256 mismatch")
    protocol = json.loads(protocol_raw)
    if protocol.get("data_scope", {}).get("reserved_evaluation_weeks") != list(EVAL_WEEKS):
        raise ValueError("frozen protocol does not reserve weeks 6-9")
    by_bdb, by_lp, lp_source = load_lp_join(args.lp_repo)
    pbp_rows = load_pbp(args.db)
    eligible, targets, following_play = make_targets(pbp_rows)
    pbp_by_key = {key_of(row): row for row in eligible}
    if len(pbp_by_key) != len(eligible):
        raise ValueError("duplicate PBP game/play key")
    all_rows_sha = canonical_sha(pbp_rows)
    dev_rows_sha = canonical_sha([r for r in pbp_rows if int(r["week"]) in TRAIN_WEEKS])
    eval_rows_sha = canonical_sha([r for r in pbp_rows if int(r["week"]) in EVAL_WEEKS])

    dev_track = load_development_features(DEV_FEATURE_PATH, by_lp)
    training_pbp = [r for r in eligible if int(r["week"]) in TRAIN_WEEKS and key_of(r) in targets]
    b_training = [{"week": int(r["week"]), "target_s": targets[key_of(r)], "features": make_pbp_features(r)} for r in training_pbp]
    c_training = []
    for row in training_pbp:
        lp_key = key_of(row)
        track = dev_track.get(lp_key)
        if track is None:
            continue
        combined = {**make_pbp_features(row), **make_tracking_features(track)}
        c_training.append({"week": int(row["week"]), "target_s": targets[lp_key], "features": combined})
    if not b_training or not c_training:
        raise ValueError("empty development training population")
    b_model = train_model(b_training, "pbp_presnap")
    c_model = train_model(c_training, "tracking_presnap")
    training_source_rows = [r for r in pbp_rows if int(r["week"]) in TRAIN_WEEKS]
    e1_pools = build_e1_pools(training_source_rows, group_next(training_source_rows))
    all_next = group_next(pbp_rows)

    target_by_eval_week = defaultdict(dict)
    for row in eligible:
        week = int(row["week"])
        key = key_of(row)
        if week in EVAL_WEEKS and key in targets:
            target_by_eval_week[week][key] = row
    tracking_metadata = {}
    for lp_key, bdb_key in by_lp.items():
        row = pbp_by_key.get(lp_key)
        if row is None or int(row["week"]) not in EVAL_WEEKS or lp_key not in targets:
            continue
        post, defense = normalize_team(row.get("posteam")), normalize_team(row.get("defteam"))
        if not post or not defense or post == defense:
            continue
        tracking_metadata[bdb_key] = {"lp_key": lp_key, "week": int(row["week"]), "offense_team": post, "defense_team": defense}

    eval_features, tracking_week_summaries = {}, {}
    for week in EVAL_WEEKS:
        week_meta = {key: meta for key, meta in tracking_metadata.items() if meta["week"] == week}
        path = args.tracking_root / f"tracking_week_{week}.csv"
        week_features, summary = scan_tracking_week(path, week, week_meta, HOLDOUT_TRACKING_SHA256[week])
        overlap = set(eval_features).intersection(week_features)
        if overlap:
            raise ValueError(f"duplicate holdout tracking LP keys across weeks: {next(iter(overlap))}")
        eval_features.update(week_features)
        tracking_week_summaries[str(week)] = summary

    target_eval = [r for r in eligible if int(r["week"]) in EVAL_WEEKS and key_of(r) in targets]
    eval_prediction_rows = []
    native = Counter()
    for row in target_eval:
        key = key_of(row)
        target = targets[key]
        pbp_features = make_pbp_features(row)
        b_prediction = predict(b_model, pbp_features, "pbp_presnap")
        native["B_pbp_presnap"] += 1
        track = eval_features.get(key)
        c_prediction = None
        if track is not None:
            c_features = {**pbp_features, **make_tracking_features(track)}
            c_prediction = predict(c_model, c_features, "tracking_presnap")
            native["C_tracking_presnap"] += 1
        following = all_next.get(key)
        e1_hit = e1_classify(row, following)
        cell = e1_cell(row)
        a_prediction = None
        if e1_hit is not None and cell is not None:
            cell_rows = e1_pools.get(cell, [])
            donors = [item for item in cell_rows if item["event"] == e1_hit[0]]
            if len(cell_rows) >= E1_MIN_POOL and donors:
                draws = sample_draws(donors, key, int(row["week"]), SAMPLE_DRAWS)
                a_prediction = {
                    "point_s": round(statistics.mean(draws), 4),
                    "draw_median_s": round(statistics.median(draws), 3),
                    "draws": SAMPLE_DRAWS,
                    "donor_event": e1_hit[0],
                    "donor_rows": len(donors),
                    "cell_rows": len(cell_rows),
                }
                native["A_sampled_runoff"] += 1
        if a_prediction is None or c_prediction is None:
            continue
        eval_prediction_rows.append({
            "pbp": row,
            "target_s": target,
            "stop_buckets": stop_bucket_flags(row, target),
            "predictions": {
                "A_sampled_runoff": a_prediction,
                "B_pbp_presnap": {"point_s": round(float(b_prediction["p50_s"]), 4), "backoff_level": b_prediction["level"]},
                "C_tracking_presnap": {"point_s": round(float(c_prediction["p50_s"]), 4), "backoff_level": c_prediction["level"]},
            },
        })
    if not eval_prediction_rows:
        raise ValueError("no common weeks 6-9 target rows have predictions from all three models")

    per_play, per_game, game_rows = _model_summaries(eval_prediction_rows)
    stoppage = _stoppage_summaries(eval_prediction_rows)
    all22_eval = len(eval_features)
    eval_targets_with_track = sum(key_of(row) in eval_features for row in eligible if int(row["week"]) in EVAL_WEEKS and key_of(row) in targets)
    raw_target_counts = Counter(int(r["week"]) for r in target_eval)
    unresolved_counts = Counter(int(r["week"]) for r in eligible if int(r["week"]) in EVAL_WEEKS and key_of(r) not in targets)
    return {
        "schema": "gridiron.e3.tracking_presnap_clock_holdout.v1",
        "interpretation": "Retrospective scoring of a frozen weeks 6-9 evaluation cohort; those weeks were previously examined, so this is not blind holdout validation.",
        "provenance": {
            "LP_tracking_join": lp_source,
            "LP_repository": str(args.lp_repo),
            "PBP_database": str(args.db),
            "PBP_selected_rows_sha256_weeks1_9": all_rows_sha,
            "PBP_selected_rows_sha256_weeks1_5": dev_rows_sha,
            "PBP_selected_rows_sha256_weeks6_9": eval_rows_sha,
            "frozen_protocol_sha256": HOLDOUT_PROTOCOL_SHA256,
            "development_presnap_tracking_features_sha256": DEV_FEATURE_SHA256,
            "development_presnap_feature_source_hashes": DEV_TRACKING_SHA256,
            "tracking_weeks6_9_sha256": HOLDOUT_TRACKING_SHA256,
            "model_script_sha256": sha256_file(Path(__file__).resolve()),
        },
        "cohort": {
            "season": 2022,
            "training_weeks": list(TRAIN_WEEKS),
            "evaluation_weeks": list(EVAL_WEEKS),
            "target": "current PBP game_seconds_remaining minus next non-null-play_type row in the same quarter; negative/missing/quarter-crossing intervals unresolved",
            "target_label": "inferred PBP inter-play delta; not whistle time or live-play duration",
            "eligible_resolved_eval_rows": len(target_eval),
            "resolved_targets_by_week": dict(sorted(raw_target_counts.items())),
            "unresolved_targets_by_week": dict(sorted(unresolved_counts.items())),
            "all22_verified_tracking_rows": all22_eval,
            "verified_tracking_rows_with_resolved_targets": eval_targets_with_track,
            "common_rows_scored_by_all_models": len(eval_prediction_rows),
            "common_drives": per_play["A_sampled_runoff"]["drives"],
            "common_games": per_play["A_sampled_runoff"]["games"],
            "tracking_feature_cutoff": "frames snap-3, snap-2, snap-1 only; 22 same players with 11 per side; SNAP and later coordinates never used",
            "stoppage_bucket_policy": "zero displayed delta is observed; incomplete-pass is inferred from PBP; penalty flag is observed but its clock effect is unresolved; timeout and out-of-bounds causes are unavailable in this PBP schema",
        },
        "training": {
            "B_pbp_presnap_rows": len(b_training),
            "B_pbp_presnap_weeks": list(TRAIN_WEEKS),
            "C_tracking_presnap_rows": len(c_training),
            "C_tracking_presnap_weeks": list(TRAIN_WEEKS),
            "A_sampled_runoff_source_rows": sum(len(v) for v in e1_pools.values()),
            "A_sampled_runoff_pool_min_cell_rows": E1_MIN_POOL,
            "A_deterministic_draws_per_holdout_play": SAMPLE_DRAWS,
            "B_form": "PBP-only pre-snap conditional median, exact pinned single-model backoff levels, minimum bucket 25",
            "C_form": "same PBP features plus binned offense/defense mean speed, acceleration and nearest-teammate spacing; same pinned tracking-model backoff levels, minimum bucket 25",
            "C_training_population": "only weeks 1-5 target rows with a complete all-22 pre-snap record and verified LP join",
        },
        "models": {
            "A_sampled_runoff": "E1 event-and-state-conditioned sample of observed runoff donors; held-out event family is supplied from PBP, so this is retrospective and not a pre-snap prediction",
            "B_pbp_presnap": "PBP-only state-conditional median; no play_type, outcome, or future fields in predictors",
            "C_tracking_presnap": "B plus verified 2022 BDB all-22 pre-snap team aggregates from snap-3 through snap-1; no play outcome or future tracking fields",
        },
        "metrics_on_identical_common_rows": {
            "per_play_clock_error": per_play,
            "game_level_cumulative_clock_gap": {
                "definition": "sum predicted inter-play deltas minus sum observed PBP deltas over the same common tracked plays within each game; not a complete-game simulation",
                "models": per_game,
                "per_game_rows": game_rows,
            },
            "stopped_clock_buckets": stoppage,
        },
        "native_prediction_coverage": {
            "eligible_resolved_eval_rows": len(target_eval),
            "A_sampled_runoff": native["A_sampled_runoff"],
            "B_pbp_presnap": native["B_pbp_presnap"],
            "C_tracking_presnap": native["C_tracking_presnap"],
            "common_rows_all_three": len(eval_prediction_rows),
            "out_of_bounds_source_field": "absent; reason-specific OOB bucket unresolvable",
            "timeout_source_field": "absent; reason-specific timeout bucket unresolvable",
        },
        "tracking_scan_by_week": tracking_week_summaries,
        "per_play": [
            {
                "game_id": row["pbp"]["game_id"],
                "play_id": int(float(row["pbp"]["play_id"])),
                "week": int(row["pbp"]["week"]),
                "drive": row["pbp"].get("drive"),
                "target_s": row["target_s"],
                "play_type_observed_for_bucket_only": row["pbp"].get("play_type"),
                "penalty_flag_observed": row["pbp"].get("penalty"),
                "stop_buckets": row["stop_buckets"],
                "predictions": row["predictions"],
            }
            for row in eval_prediction_rows
        ],
        "limitations": [
            "Weeks 6-9 were examined in earlier E3 work; frozen scoring does not restore blind holdout status.",
            "PBP target is an inter-play clock-stamp delta. It cannot separate live duration, between-play time, timeout, out-of-bounds, and other stoppages.",
            "A uses the observed held-out PBP event family to select donor runoffs; only B and C are pre-snap state predictions.",
            "The game-level cumulative gap aggregates only common tracked target rows and does not simulate missed plays, period transitions, game scores, or outcomes.",
            "LP coverage marks 356 tracked plays unverified and reports 1,019 LP scrimmage plays without a BDB play; neither is treated as a valid tracked example.",
        ],
    }


def render_markdown(data):
    p = data["metrics_on_identical_common_rows"]["per_play_clock_error"]
    g = data["metrics_on_identical_common_rows"]["game_level_cumulative_clock_gap"]["models"]
    stop = data["metrics_on_identical_common_rows"]["stopped_clock_buckets"]
    lines = [
        "# BDB-2022 tracking-informed clock model: frozen weeks 6–9 evaluation", "",
        "> Weeks 6–9 were previously examined in E3. These results are a frozen retrospective evaluation, not blind holdout validation.", "",
        "## Shared target and common cohort", "",
        f"The target is same-quarter PBP game-clock seconds remaining at the current play minus the next non-null-play_type play row. The common table scores **{data['cohort']['common_rows_scored_by_all_models']:,} plays**, **{data['cohort']['common_drives']:,} drives**, and **{data['cohort']['common_games']:,} games** where all three models produced a prediction and a resolved target.", "",
        "All models use the same common rows. The game-level metric sums predicted and observed PBP inter-play deltas over those rows within each game; it is not a complete-game simulation.", "",
        "| Model | Information available | Plays | MAE / play (s) | P90 abs error (s) | P99 abs error (s) | Mean signed game gap (s) | Game-gap MAE (s) |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    descriptions = {
        "A_sampled_runoff": "E1 donor sample; held-out event family observed",
        "B_pbp_presnap": "PBP pre-snap state only",
        "C_tracking_presnap": "PBP pre-snap state + BDB all-22 pre-snap motion",
    }
    for key in MODEL_KEYS:
        m = p[key]
        gm = g[key]
        lines.append(f"| {key} | {descriptions[key]} | {m['plays']} | {m['mae_s']:.4f} | {m['p90_abs_error_s']:.3f} | {m['p99_abs_error_s']:.3f} | {gm['mean_signed_cumulative_gap_s_per_game']:.2f} | {gm['mae_cumulative_gap_s_per_game']:.2f} |")
    lines += ["", "## Native coverage", "", "| Model | Predictions on resolved weeks 6–9 target rows |", "| --- | ---: |"]
    for key, count in data["native_prediction_coverage"].items():
        if key in MODEL_KEYS:
            lines.append(f"| {key} | {count:,} |")
    lines += ["", "## Stopped-clock and stoppage-context buckets", "",
              "The zero-delta bucket is directly observed from adjacent PBP clock stamps. Incomplete-pass and late-half buckets are inferred from PBP state; the penalty flag is observed but does not establish its clock effect. Conditional MAE is descriptive, not a binary legal-clock pass/fail.", "",
              "| Bucket | Rows | A MAE (s) | B MAE (s) | C MAE (s) | A positive on zero-delta rows | B positive on zero-delta rows | C positive on zero-delta rows |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for name, bucket in stop.items():
        lines.append(f"| {name} | {bucket['rows']} | {bucket['A_sampled_runoff']['mae_s']:.3f} | {bucket['B_pbp_presnap']['mae_s']:.3f} | {bucket['C_tracking_presnap']['mae_s']:.3f} | {bucket['A_sampled_runoff']['positive_prediction_on_zero_delta_rows']} | {bucket['B_pbp_presnap']['positive_prediction_on_zero_delta_rows']} | {bucket['C_tracking_presnap']['positive_prediction_on_zero_delta_rows']} |")
    lines += ["", "Timeout and out-of-bounds causes cannot be separately scored: those source fields are absent from the pinned PBP schema. Quarter-boundary intervals are unresolved under the frozen target and excluded.", "",
              "## Scope and interpretation", "",
              f"- Training weeks: {data['cohort']['training_weeks']}; evaluation weeks: {data['cohort']['evaluation_weeks']}. All model fitting uses weeks 1–5 only.",
              f"- LP tracking join: `{data['provenance']['LP_tracking_join']['commit']}`; verified pairs `{data['provenance']['LP_tracking_join']['verified_join_pairs']:,}`. Unverified joins are excluded.",
              f"- Weeks 6–9 raw tracking hashes and scan counts are recorded by week in the JSON. Model C uses frames snap−3 through snap−1 only, with 11 players per side.",
              "- Model A is retrospective because it receives the held-out event family. B and C use pre-snap predictors only.",
              "- The target includes both live-play clock reduction and whatever time passes before the next play stamp; it is not whistle time or possession duration.",
              "- E2 files, LP E2 legality, and the shared v1 contract were not read or changed.", "",
              "## Reproduction", "", "```bash",
              "python scripts/research/e3_tracking_presnap_clock_holdout.py \\",
              "  --lp-repo /root/lp-nfl-bdb-join \\",
              "  --db /root/legendarypicks/backend/data/picks.dev.db \\",
              "  --tracking-root /root/nfl-tracking-data/bdb2025/code-data \\",
              "  --json-output docs/evidence/e3/tracking-presnap-clock-holdout-weeks6-9-2026-10-24.json \\",
              "  --markdown-output docs/evidence/e3/TRACKING-PRESNAP-CLOCK-HOLDOUT-WEEKS6-9-2026-10-24.md",
              "```", "",
              f"PBP input hashes: weeks 1–5 `{data['provenance']['PBP_selected_rows_sha256_weeks1_5']}`, weeks 6–9 `{data['provenance']['PBP_selected_rows_sha256_weeks6_9']}`.",
              f"Weeks 6–9 JSON SHA-256 is recorded at publication; model script SHA-256: `{data['provenance']['model_script_sha256']}`.", ""]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--lp-repo", type=Path, default=LP_REPO_DEFAULT)
    parser.add_argument("--db", type=Path, default=PBP_DB_DEFAULT)
    parser.add_argument("--tracking-root", type=Path, default=TRACKING_ROOT_DEFAULT)
    parser.add_argument("--json-output", type=Path, default=ROOT / "docs/evidence/e3/tracking-presnap-clock-holdout-weeks6-9-2026-10-24.json")
    parser.add_argument("--markdown-output", type=Path, default=ROOT / "docs/evidence/e3/TRACKING-PRESNAP-CLOCK-HOLDOUT-WEEKS6-9-2026-10-24.md")
    args = parser.parse_args(argv)
    data = build(args)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False).encode() + b"\n"
    args.json_output.write_bytes(raw)
    args.markdown_output.write_text(render_markdown(data), encoding="utf-8")
    print(f"PASS: pinned LP join {LP_COMMIT}; verified rows={data['provenance']['LP_tracking_join']['verified_join_pairs']}")
    print(f"PASS: frozen weeks 6-9 common scoring rows={data['cohort']['common_rows_scored_by_all_models']}; games={data['cohort']['common_games']}; drives={data['cohort']['common_drives']}")
    for name, metrics in data["metrics_on_identical_common_rows"]["per_play_clock_error"].items():
        print(f"{name}: MAE={metrics['mae_s']:.4f}s/game-gap-MAE={data['metrics_on_identical_common_rows']['game_level_cumulative_clock_gap']['models'][name]['mae_cumulative_gap_s_per_game']:.2f}s")
    print(f"JSON SHA-256: {sha256_bytes(raw)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
