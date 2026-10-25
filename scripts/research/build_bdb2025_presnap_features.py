#!/usr/bin/env python3
"""Extract all-player, strictly pre-snap tracking aggregates for 2022 weeks 1-5.

The canonical manifest contributes only BDB play keys, snap frame, week and
pre-snap possession/defense teams. The LP crosswalk contributes only join keys.
Tracking rows at or after the manifest snap frame are never retained or read
for feature values. No terminal event or carrier-candidate information is read.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

WEEKS = (1, 2, 3, 4, 5)
FRAME_SECONDS = 0.1
MANIFEST_SHA256 = "45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a"
CROSSWALK_SHA256 = "f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9"
TRACKING_SHA256 = {
    1: "dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c",
    2: "d735b37f04bdf324132b9cb0f084a4ca583fadbbf02653e1873dad39c36924aa",
    3: "db2965ad61a5ad3895a8878a3754c3d3e4bf4b2dce75732c0b6b4d9d094887bb",
    4: "2e931bc9cd7f6126d6cd1e7eb71a3c711b748a0cece9d04dcace870e7298774f",
    5: "1c10136562b82f3e2d5405247540d890fc02f38804109bdaaba5e63bd816c3e9",
}


def validate_weeks(weeks):
    selected = tuple(sorted(set(int(week) for week in weeks)))
    if not selected or any(week not in WEEKS for week in selected):
        raise ValueError("pre-snap builder permits weeks 1-5 only; weeks 6-9 are reserved")
    return selected


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class HashingLines:
    def __init__(self, source, digest):
        self.source, self.digest = source, digest

    def __iter__(self):
        for raw in self.source:
            self.digest.update(raw)
            yield raw.decode("utf-8")


def parse_key(game, play):
    return int(float(game)), int(float(play))


def read_manifest(path: Path):
    digest = sha256_file(path)
    if digest != MANIFEST_SHA256:
        raise ValueError(f"canonical manifest SHA-256 mismatch: {digest}")
    rows = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            week = int(row["week"])
            if week not in WEEKS:
                raise ValueError(f"manifest week {week} is outside allowed weeks 1-5")
            key = parse_key(row["gameId"], row["playId"])
            if key in rows:
                raise ValueError(f"duplicate BDB manifest key {key}")
            rows[key] = {
                "week": week,
                "snap_frame": int(row["origin_frame"]),
                "offense_team": row["possessionTeam"].strip(),
                "defense_team": row["defensiveTeam"].strip(),
            }
    return rows, digest


def read_crosswalk(path: Path):
    digest = sha256_file(path)
    if digest != CROSSWALK_SHA256:
        raise ValueError(f"LP crosswalk SHA-256 mismatch: {digest}")
    rows = {}
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        required = {"bdb_game", "bdb_play", "lp_game_id", "lp_play_id"}
        if not required <= set(reader.fieldnames or ()):
            raise ValueError("crosswalk is missing one or more identifier columns")
        for row in reader:
            key = parse_key(row["bdb_game"], row["bdb_play"])
            game_id, play_id = row["lp_game_id"].strip(), row["lp_play_id"].strip()
            if not game_id or not play_id:
                continue
            if key in rows:
                raise ValueError(f"duplicate BDB key in LP crosswalk {key}")
            rows[key] = {"lp_game_id": game_id, "lp_play_id": int(float(play_id))}
    return rows, digest


def _number(value):
    if value in ("", "NA", "NaN", "nan", "NULL"):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _distance(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def _nearest_mean(players, others=None):
    distances = []
    for player in players:
        pool = others if others is not None else [candidate for candidate in players if candidate["nfl_id"] != player["nfl_id"]]
        if pool:
            distances.append(min(_distance(player, candidate) for candidate in pool))
    return statistics.mean(distances) if distances else None


def _team_stats(players_by_id, frame_ids):
    current, prior, prior2 = (frame_ids[frame] for frame in (0, 1, 2))
    p0 = [current[nfl_id] for nfl_id in sorted(current)]
    speeds, accelerations = [], []
    for nfl_id in sorted(current):
        a, b, c = current[nfl_id], prior[nfl_id], prior2[nfl_id]
        vx = (a["x"] - b["x"]) / FRAME_SECONDS
        vy = (a["y"] - b["y"]) / FRAME_SECONDS
        pvx = (b["x"] - c["x"]) / FRAME_SECONDS
        pvy = (b["y"] - c["y"]) / FRAME_SECONDS
        speeds.append(math.hypot(vx, vy))
        accelerations.append(math.hypot((vx - pvx) / FRAME_SECONDS, (vy - pvy) / FRAME_SECONDS))
    return {
        "count": len(p0),
        "mean_speed_yards_per_second": statistics.mean(speeds),
        "speed_sd_yards_per_second": statistics.pstdev(speeds),
        "mean_acceleration_magnitude_yards_per_second_squared": statistics.mean(accelerations),
        "mean_nearest_teammate_distance_yards": _nearest_mean(p0),
        "lateral_span_yards": max(p["y"] for p in p0) - min(p["y"] for p in p0),
        "depth_span_yards": max(p["x"] for p in p0) - min(p["x"] for p in p0),
        "centroid_x_yards": statistics.mean(p["x"] for p in p0),
        "centroid_y_yards": statistics.mean(p["y"] for p in p0),
    }


def summarize_play(key, meta, frames, lp_keys):
    expected = meta["snap_frame"]
    wanted_frames = (expected - 1, expected - 2, expected - 3)
    if any(frame not in frames for frame in wanted_frames):
        return None, "missing_pre_snap_frame"
    frame_rows = [frames[frame] for frame in wanted_frames]
    ids = [set(frame) for frame in frame_rows]
    if ids[0] != ids[1] or ids[1] != ids[2] or len(ids[0]) != 22:
        return None, "pre_snap_player_history_not_same_22"
    teams_by_id = {nfl_id: player["club"] for nfl_id, player in frame_rows[0].items()}
    offense_ids = [nfl_id for nfl_id, club in teams_by_id.items() if club == meta["offense_team"]]
    defense_ids = [nfl_id for nfl_id, club in teams_by_id.items() if club == meta["defense_team"]]
    if len(offense_ids) != 11 or len(defense_ids) != 11:
        return None, "pre_snap_team_counts_not_11v11"
    teams = []
    for rows in frame_rows:
        teams.append({nfl_id: rows[nfl_id] for nfl_id in ids[0]})
    # Features use only frame snap-1 positions and finite differences across the
    # three strictly pre-snap frames snap-3, snap-2, snap-1.
    f_off = [frame for frame in teams]
    off_stats = _team_stats(None, [
        {n: f[n] for n in offense_ids} for f in f_off
    ])
    def_stats = _team_stats(None, [
        {n: f[n] for n in defense_ids} for f in f_off
    ])
    off_players = [teams[0][n] for n in offense_ids]
    def_players = [teams[0][n] for n in defense_ids]
    off_def_nearest = _nearest_mean(off_players, def_players)
    centroid_gap = math.hypot(
        off_stats["centroid_x_yards"] - def_stats["centroid_x_yards"],
        off_stats["centroid_y_yards"] - def_stats["centroid_y_yards"],
    )
    snap_features = {
        "offense_mean_speed_yards_per_second": off_stats["mean_speed_yards_per_second"],
        "defense_mean_speed_yards_per_second": def_stats["mean_speed_yards_per_second"],
        "offense_speed_sd_yards_per_second": off_stats["speed_sd_yards_per_second"],
        "defense_speed_sd_yards_per_second": def_stats["speed_sd_yards_per_second"],
        "offense_mean_acceleration_magnitude_yards_per_second_squared": off_stats["mean_acceleration_magnitude_yards_per_second_squared"],
        "defense_mean_acceleration_magnitude_yards_per_second_squared": def_stats["mean_acceleration_magnitude_yards_per_second_squared"],
        "offense_mean_nearest_teammate_distance_yards": off_stats["mean_nearest_teammate_distance_yards"],
        "defense_mean_nearest_teammate_distance_yards": def_stats["mean_nearest_teammate_distance_yards"],
        "offense_lateral_span_yards": off_stats["lateral_span_yards"],
        "defense_lateral_span_yards": def_stats["lateral_span_yards"],
        "offense_defense_mean_nearest_distance_yards": off_def_nearest,
        "offense_defense_centroid_distance_yards": centroid_gap,
        "offense_defense_centroid_x_gap_yards": abs(off_stats["centroid_x_yards"] - def_stats["centroid_x_yards"]),
    }
    result = {
        "game_id": key[0], "play_id": key[1], "week": meta["week"],
        "lp_game_id": lp_keys.get(key, {}).get("lp_game_id"),
        "lp_play_id": lp_keys.get(key, {}).get("lp_play_id"),
        "snap_frame": expected, "last_input_frame": expected - 1,
        "input_frame_range": [expected - 3, expected - 1],
        "players_at_each_input_frame": {str(frame): 22 for frame in wanted_frames},
        "offense_team": meta["offense_team"], "defense_team": meta["defense_team"],
        "tracking_features": snap_features,
    }
    return result, None


def scan_week(path: Path, week: int, plays: dict, lp_keys: dict):
    expected_sha = TRACKING_SHA256[week]
    digest = hashlib.sha256()
    results, exclusions, row_count = [], Counter(), 0
    week_keys = {key for key, meta in plays.items() if meta["week"] == week}
    buffered = defaultdict(dict)
    with path.open("rb") as source:
        reader = csv.reader(HashingLines(source, digest))
        header = next(reader)
        required = ("gameId", "playId", "nflId", "frameId", "club", "x", "y")
        missing = sorted(set(required) - set(header))
        if missing:
            raise ValueError(f"tracking week {week} is missing columns: {missing}")
        ix = {name: header.index(name) for name in required}
        for row in reader:
            row_count += 1
            try:
                key = parse_key(row[ix["gameId"]], row[ix["playId"]])
            except (ValueError, IndexError):
                continue
            meta = plays.get(key)
            if meta is None or meta["week"] != week:
                continue
            try:
                frame = int(row[ix["frameId"]])
            except (ValueError, IndexError):
                continue
            # Deliberately exclude the snap frame and every later frame before
            # reading coordinates or any event-marker field.
            if not meta["snap_frame"] - 3 <= frame < meta["snap_frame"]:
                continue
            nfl_id = row[ix["nflId"]].strip()
            club = row[ix["club"]].strip()
            if nfl_id in ("", "NA", "nan", "NaN") or club not in (meta["offense_team"], meta["defense_team"]):
                continue
            x, y = _number(row[ix["x"]]), _number(row[ix["y"]])
            if x is None or y is None:
                continue
            slot = buffered[key].setdefault(frame, {})
            if nfl_id in slot:
                raise ValueError(f"duplicate player tracking row {key=} {frame=} {nfl_id=}")
            slot[nfl_id] = {"nfl_id": nfl_id, "club": club, "x": x, "y": y}
    actual_sha = digest.hexdigest()
    if actual_sha != expected_sha:
        raise ValueError(f"tracking week {week} SHA-256 mismatch: {actual_sha}")
    for key in sorted(week_keys):
        item, reason = summarize_play(key, plays[key], buffered.get(key, {}), lp_keys)
        if item is None:
            exclusions[reason] += 1
        else:
            results.append(item)
    return results, dict(exclusions), actual_sha, row_count


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracking-root", type=Path, required=True)
    parser.add_argument("--cohort-manifest", type=Path, required=True)
    parser.add_argument("--lp-crosswalk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    validate_weeks(WEEKS)
    plays, manifest_sha = read_manifest(args.cohort_manifest)
    lp_keys, crosswalk_sha = read_crosswalk(args.lp_crosswalk)
    all_rows, exclusions, input_files = [], Counter(), []
    for week in WEEKS:
        path = args.tracking_root / f"tracking_week_{week}.csv"
        rows, skipped, digest, count = scan_week(path, week, plays, lp_keys)
        all_rows.extend(rows)
        exclusions.update(skipped)
        input_files.append({"week": week, "sha256": digest, "rows_scanned": count})
        print(f"Week {week}: pre-snap complete 22-player plays={len(rows)}; raw rows scanned={count}")
    if len({(r["game_id"], r["play_id"]) for r in all_rows}) != len(all_rows):
        raise RuntimeError("duplicate emitted BDB play key")
    document = {
        "schema": "gridiron.bdb2025.presnap_tracking_features.v1",
        "date": "2026-10-24",
        "scope": {
            "season": 2022, "weeks": list(WEEKS),
            "selection": "all 22 distinct player IDs present at each of snap_frame-3, snap_frame-2, snap_frame-1; 11 offense and 11 defense at the latest pre-snap frame",
            "feature_cutoff": "strictly before ball_snap; max input frame is snap_frame-1",
            "excluded_inputs": ["snap frame and all later tracking coordinates", "tracking event/frameType markers", "carrier candidates", "terminal events", "PBP outcomes and play type"],
            "reserved_weeks": [6, 7, 8, 9],
            "holdout_status": "weeks 6-9 were previously examined; all results are development-only and not holdout-validated",
        },
        "source": {
            "tracking_mirror": "b00nk3r/NFL-Big-Data-Bowl-2025",
            "tracking_source_commit": "e28d3b25725799ef2213680016db5325f6f90014",
            "cohort_manifest_sha256": manifest_sha,
            "LP_crosswalk_sha256": crosswalk_sha,
            "tracking_files": input_files,
        },
        "method": {
            "coordinate_units": "yards; positions use BDB x/y at the three strictly pre-snap frames",
            "velocity": "finite difference of x/y between snap_frame-2 and snap_frame-1 at 10 Hz",
            "acceleration": "second finite difference of x/y over snap_frame-3 through snap_frame-1 at 10 Hz",
            "selection": "the canonical manifest contributes only game/play identifiers, week, snap frame, possession team and defensive team; the manifest eligible_input and outcome fields are not accessed",
            "row_access": "only gameId, playId, nflId, frameId, club, x and y are parsed from raw tracking; rows at or after snap_frame are discarded before coordinates are read",
            "aggregation": "team-level means/spreads and within-/between-team distances over the full 11-player units; individual IDs are not emitted",
        },
        "coverage": {
            "manifest_plays_weeks1to5": len(plays),
            "pre_snap_complete_all22_plays": len(all_rows),
            "LP_keyed_emitted_plays": sum(r["lp_game_id"] is not None for r in all_rows),
            "excluded_plays": dict(exclusions),
        },
        "plays": sorted(all_rows, key=lambda row: (row["game_id"], row["play_id"])),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Pre-snap feature plays={len(all_rows)}; weeks 6-9 untouched")
    print(f"Output SHA-256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
