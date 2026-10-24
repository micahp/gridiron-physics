#!/usr/bin/env python3
"""Research a snap-anchored hierarchical movement prior and 22-player seed.

The model features are built only from the snap and the preceding 1.0 s.
Frames +5/+10 are used only as supervised targets/scoring labels. Weeks 1-4
fit the descriptive prior; week 5 is a held-out development check. Weeks 6-9
are never opened by this builder.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import subprocess
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path

YARDS_TO_METERS = 0.9144
HORIZONS = ((5, 0.5), (10, 1.0))
ROSTER_OFFENSE = {"QB": 1, "RB": 1, "TE": 1, "WR": 3, "OL": 5}
DEFAULT_DEFENSE = {"DL": 4, "LB": 2, "DB": 5}
TRAIN_WEEKS = (1, 2, 3, 4)
EVAL_WEEK = 5
TEAM_PRIOR_PLAYS = 50.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        yield from csv.DictReader(handle)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def as_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_int(value, default=None):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def role_for(position: str) -> str | None:
    p = (position or "").upper().strip()
    if p == "QB":
        return "QB"
    if p in {"RB", "HB", "FB"}:
        return "RB"
    if p == "TE":
        return "TE"
    if p == "WR":
        return "WR"
    if p in {"T", "G", "C", "OL", "OT", "OG"}:
        return "OL"
    if p in {"DE", "DT", "NT", "DL", "EDGE"}:
        return "DL"
    if p in {"LB", "ILB", "MLB", "OLB"}:
        return "LB"
    if p in {"CB", "DB", "FS", "SS", "S"}:
        return "DB"
    return None


def action_for(play: dict) -> str | None:
    if (play.get("qbKneel") or "").strip() not in ("", "0", "FALSE", "False", "NA"):
        return None
    if (play.get("qbSpike") or "").strip().upper() in {"TRUE", "1", "Y"}:
        return None
    value = (play.get("isDropback") or "").strip().upper()
    if value == "TRUE":
        return "pass"
    if value == "FALSE":
        return "run"
    return None


def formation_family(value: str) -> str:
    text = (value or "").upper().replace("_", " ")
    if "SHOTGUN" in text:
        return "shotgun"
    if "PISTOL" in text:
        return "pistol"
    if "I FORM" in text or text == "I-FORM":
        return "i_formation"
    if "SINGLEBACK" in text or "UNDER CENTER" in text:
        return "under_center"
    if "EMPTY" in text:
        return "empty"
    return "other"


def offense_direction(ball_x_yards: float, play: dict) -> tuple[int, bool]:
    """Infer attack direction from the snap ball and charted field position.

    The playable goal lines are x=10 and x=110 in the tracking coordinate
    system. Ambiguous midfield cases are retained and marked as such.
    """
    ytg = as_float(play.get("yardlineNumber"))
    offense = (play.get("possessionTeam") or "").strip()
    side = (play.get("yardlineSide") or "").strip()
    if ytg is None or not side or not offense:
        return 1, False
    left_error = abs((ball_x_yards - 10.0) - ytg)
    right_error = abs((110.0 - ball_x_yards) - ytg)
    left_is_near = left_error < right_error
    confident = abs(left_error - right_error) >= 4.0
    if side == offense:  # yardlineNumber is measured from own goal line
        direction = 1 if left_is_near else -1
    else:  # measured from opponent goal line
        direction = -1 if left_is_near else 1
    return direction, confident


def category_key(item: dict, include_alignment=True):
    base = (item["role"], item["side"], item["action"], item["formation"])
    if not include_alignment:
        return base
    f = item["features"]
    return base + (f["x_bin"], f["y_bin"], f["proximity_bin"], f["speed_bin"])


def add_stat(table: dict, key: tuple, residual: tuple[float, float], play_key: tuple):
    row = table.setdefault(key, {"sx": 0.0, "sy": 0.0, "n": 0, "plays": set()})
    row["sx"] += residual[0]
    row["sy"] += residual[1]
    row["n"] += 1
    row["plays"].add(play_key)


def mean_residual(row):
    if not row or row["n"] == 0:
        return (0.0, 0.0)
    return row["sx"] / row["n"], row["sy"] / row["n"]


def position_bins(rx: float, ry: float, speed: float, nearest: float):
    xb = "back" if rx < -1.8 else "line" if rx <= 2.0 else "beyond"
    ay = abs(ry)
    yb = "core" if ay <= 2.75 else "slot" if ay <= 9.15 else "wide"
    if ry < -2.75:
        yb += "_left"
    elif ry > 2.75:
        yb += "_right"
    pb = "contact" if nearest < 1.5 else "close" if nearest < 4.0 else "space"
    sb = "still" if speed < 0.5 else "moving" if speed < 2.0 else "fast"
    return xb, yb, pb, sb


def player_features(player, ball, direction, opponents):
    scale = YARDS_TO_METERS
    frames = player["frames"]
    p0 = (frames[0][0] * scale * direction, frames[0][1] * scale)
    p5 = (frames[-5][0] * scale * direction, frames[-5][1] * scale)
    p10 = (frames[-10][0] * scale * direction, frames[-10][1] * scale)
    v0 = ((p0[0] - p5[0]) / 0.5, (p0[1] - p5[1]) / 0.5)
    vprev = ((p5[0] - p10[0]) / 0.5, (p5[1] - p10[1]) / 0.5)
    acceleration = ((v0[0] - vprev[0]) / 0.5, (v0[1] - vprev[1]) / 0.5)
    b0 = (ball[0] * scale * direction, ball[1] * scale)
    rx, ry = p0[0] - b0[0], p0[1] - b0[1]
    opps = [q for q in opponents]
    if opps:
        nearest_player = min(opps, key=lambda q: math.hypot(q[0] - p0[0], q[1] - p0[1]))
        nearest_distance = math.hypot(nearest_player[0] - p0[0], nearest_player[1] - p0[1])
    else:
        nearest_distance = 99.0
    speed = math.hypot(*v0)
    xb, yb, pb, sb = position_bins(rx, ry, speed, nearest_distance)
    return {
        "p0": p0,
        "v0": v0,
        "acceleration": acceleration,
        "ball0": b0,
        "rx": rx,
        "ry": ry,
        "nearest_distance": nearest_distance,
        "x_bin": xb,
        "y_bin": yb,
        "proximity_bin": pb,
        "speed_bin": sb,
    }


def build_observations(play_key, meta, tracking, players):
    ball_trace = tracking.get("NA")
    if not ball_trace or 0 not in ball_trace:
        return None, "missing_snap_ball"
    participant_ids = [pid for pid, frames in tracking.items() if pid != "NA" and 0 in frames]
    if len(participant_ids) != 22 or len(set(participant_ids)) != 22:
        return None, "not_22_players_at_snap"
    role_by_id = {pid: role_for(players.get(pid, {}).get("position", "")) for pid in participant_ids}
    if any(role_by_id[pid] is None for pid in participant_ids):
        return None, "unmapped_position"
    input_required = {-10, -5, 0}
    if any(not input_required.issubset(tracking[pid]) for pid in participant_ids):
        return None, "missing_snap_available_history"
    action = meta.get("action")
    if action is None:
        return None, "not_run_or_pass"
    formation = formation_family(meta["play"].get("offenseFormation", ""))
    direction, direction_confident = offense_direction(ball_trace[0][0], meta["play"])
    offense = meta["play"].get("possessionTeam", "")
    defense = meta["play"].get("defensiveTeam", "")
    player_rows = []
    for pid in participant_ids:
        club = meta["club_by_id"].get(pid, "")
        side = "offense" if club == offense else "defense" if club == defense else None
        if side is None:
            return None, "team_membership_mismatch"
        player_rows.append({"pid": pid, "role": role_by_id[pid], "side": side, "club": club,
                            "frames": tracking[pid]})
    ball0 = ball_trace[0]
    for p in player_rows:
        p["action"] = action
        p["formation"] = formation
        opponents = []
        for q in player_rows:
            if p["side"] != q["side"]:
                qpos = q["frames"][0]
                opponents.append((qpos[0] * YARDS_TO_METERS * direction,
                                  qpos[1] * YARDS_TO_METERS))
        p["features"] = player_features(p, ball0, direction, opponents)
    for horizon_frame, horizon_seconds in HORIZONS:
        for p in player_rows:
            if horizon_frame not in p["frames"]:
                continue
            feat = p["features"]
            truth_yards = p["frames"][horizon_frame]
            truth = (truth_yards[0] * YARDS_TO_METERS * direction,
                     truth_yards[1] * YARDS_TO_METERS)
            dx = truth[0] - feat["p0"][0]
            dy = truth[1] - feat["p0"][1]
            ax, ay = feat["acceleration"]
            vx, vy = feat["v0"]
            base = (vx * horizon_seconds + 0.5 * ax * horizon_seconds**2,
                    vy * horizon_seconds + 0.5 * ay * horizon_seconds**2)
            p.setdefault("targets", {})[horizon_seconds] = {
                "truth": truth,
                "base": (feat["p0"][0] + base[0], feat["p0"][1] + base[1]),
                "residual": (dx - base[0], dy - base[1]),
            }
    scorable = all(all(h in p.get("targets", {}) for h in (0.5, 1.0)) for p in player_rows)
    out = {
        "key": play_key,
        "week": meta["week"],
        "game_id": play_key[0],
        "play_id": play_key[1],
        "team_offense": offense,
        "team_defense": defense,
        "action": action,
        "formation": formation,
        "direction": direction,
        "direction_confident": direction_confident,
        "players": player_rows,
        "ball_snap": (ball0[0] * YARDS_TO_METERS * direction, ball0[1] * YARDS_TO_METERS),
        "scorable_all_22_at_both_horizons": scorable,
    }
    return out, None


def ingest_week(week, tracking_root, eligible, metadata, players, on_play):
    path = tracking_root / "snap-anchored-v1" / f"window_week_{week}.csv"
    seen_plays = set()
    input_22 = 0
    complete_22_labels = 0
    eligible_seen = 0
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for key, records in groupby(reader, key=lambda r: (r["gameId"], r["playId"])):
            rows = list(records)
            if key not in eligible[week]:
                continue
            if key in seen_plays:
                raise ValueError(f"non-contiguous tracking play group: week={week} key={key}")
            seen_plays.add(key)
            eligible_seen += 1
            traces = defaultdict(dict)
            club_by_id = {}
            for row in rows:
                pid = row["nflId"]
                frame = as_int(row["rel_frame"])
                if frame is None:
                    continue
                point = (as_float(row["x"]), as_float(row["y"]))
                if point[0] is None or point[1] is None:
                    continue
                if pid == "NA":
                    if frame == 0:
                        traces["NA"][0] = point
                    continue
                traces[pid][frame] = point
                club_by_id[pid] = row["club"]
            meta = metadata.get(key)
            if not meta:
                continue
            meta = {**meta, "week": week, "club_by_id": club_by_id}
            play, reason = build_observations(key, meta, traces, players)
            if play is None:
                on_play(None, reason)
                continue
            input_22 += 1
            if play["scorable_all_22_at_both_horizons"]:
                complete_22_labels += 1
            on_play(play, None)
    return {"eligible_rows_seen": eligible_seen, "snap_input_22_player_plays": input_22,
            "scorable_22_player_plays": complete_22_labels,
            "eligible_rows_missing_from_window": len(eligible[week]) - eligible_seen}


def load_inputs(args):
    tracking_root = args.tracking_root.resolve()
    prototype_root = args.prototype_root.resolve()
    manifest_path = args.cohort.resolve()
    manifest_rows = list(read_csv(manifest_path))
    eligible = {week: set() for week in range(1, 6)}
    manifest_by_key = {}
    for row in manifest_rows:
        week = as_int(row.get("week"))
        if week not in eligible or row.get("eligible_input", "").lower() != "true":
            continue
        key = (row["gameId"], row["playId"])
        eligible[week].add(key)
        manifest_by_key[key] = row

    plays_path = tracking_root / "code-data" / "plays.csv"
    metadata = {}
    allowed = {"gameId", "playId", "possessionTeam", "defensiveTeam", "offenseFormation",
               "isDropback", "yardlineSide", "yardlineNumber", "qbKneel", "qbSpike"}
    for row in read_csv(plays_path):
        key = (row["gameId"], row["playId"])
        if key not in manifest_by_key:
            continue
        play = {field: row.get(field, "") for field in allowed}
        metadata[key] = {"week": as_int(manifest_by_key[key]["week"]), "play": play,
                         "action": action_for(play)}

    player_path = tracking_root / "code-data" / "players.csv"
    players = {row["nflId"]: row for row in read_csv(player_path) if row.get("nflId")}
    inputs = {
        "canonical_cohort": manifest_path,
        "bdb_plays": plays_path,
        "bdb_players": player_path,
        "tracking_week_1": tracking_root / "snap-anchored-v1" / "window_week_1.csv",
        "tracking_week_2": tracking_root / "snap-anchored-v1" / "window_week_2.csv",
        "tracking_week_3": tracking_root / "snap-anchored-v1" / "window_week_3.csv",
        "tracking_week_4": tracking_root / "snap-anchored-v1" / "window_week_4.csv",
        "tracking_week_5": tracking_root / "snap-anchored-v1" / "window_week_5.csv",
        "current_roster_snapshot": prototype_root / "data/teams/matchup-2026-10-22.json",
        "ne_playbook": prototype_root / "data/playbooks/NE-2025.json",
        "chi_playbook": prototype_root / "data/playbooks/CHI-2025.json",
        "coaching_continuity": prototype_root / "data/teams/coaching-continuity-2026-10-22.json",
    }
    missing = [str(p) for p in inputs.values() if not p.is_file()]
    if missing:
        raise FileNotFoundError("missing pinned research inputs: " + ", ".join(missing))
    return tracking_root, prototype_root, eligible, metadata, players, manifest_rows, inputs


def update_model(stats, team_stats, play):
    for player in play["players"]:
        broad = category_key(player, include_alignment=False)[:4]
        full = category_key(player, include_alignment=True)
        for horizon, label in ((0.5, "0.5"), (1.0, "1.0")):
            if horizon not in player.get("targets", {}):
                continue
            residual = player["targets"][horizon]["residual"]
            add_stat(stats[(horizon, "full")], full, residual, play["key"])
            add_stat(stats[(horizon, "broad")], broad, residual, play["key"])
            add_stat(team_stats[(horizon, "broad")], (player["club"],) + broad, residual, play["key"])


def capture_template(templates, play, requested, expected_counts):
    for team, side in requested:
        if play["action"] != requested[(team, side)][0] or play["formation"] != requested[(team, side)][1]:
            continue
        members = [p for p in play["players"] if p["side"] == side]
        signature = Counter(p["role"] for p in members)
        if dict(signature) != expected_counts[(team, side)]:
            continue
        key = (team, side, play["action"], play["formation"])
        source_team = play[f"team_{side}"]
        existing = templates.get(key)
        same_team = source_team == team
        if existing and (existing["source_team"] == team or not same_team):
            continue
        out_players = []
        for player in members:
            frames = player["frames"]
            points = []
            for frame in (-10, -5, 0):
                x, y = frames[frame]
                points.append((x * YARDS_TO_METERS * play["direction"] - play["ball_snap"][0],
                               y * YARDS_TO_METERS - play["ball_snap"][1]))
            out_players.append({"source_id": player["pid"], "role": player["role"],
                                "snap": points[2], "history": points})
        templates[key] = {"players": out_players, "key": play["key"],
                          "counts": dict(signature), "source_team": source_team}


def predict_residual(stats, team_stats, player, play, horizon, include_team):
    broad = category_key(player, include_alignment=False)[:4]
    full = category_key(player, include_alignment=True)
    full_row = stats[(horizon, "full")].get(full)
    broad_row = stats[(horizon, "broad")].get(broad)
    if full_row and len(full_row["plays"]) >= 8:
        estimate = mean_residual(full_row)
        source = "role-context-alignment"
    elif broad_row and len(broad_row["plays"]) >= 8:
        estimate = mean_residual(broad_row)
        source = "role-context"
    else:
        estimate = (0.0, 0.0)
        source = "constant-acceleration-fallback"
    if not include_team:
        return estimate, source, 0.0
    team_row = team_stats[(horizon, "broad")].get((player["club"],) + broad)
    if not team_row or not broad_row:
        return estimate, source, 0.0
    effective_plays = len(team_row["plays"])
    alpha = effective_plays / (effective_plays + TEAM_PRIOR_PLAYS)
    team_mean = mean_residual(team_row)
    global_mean = mean_residual(broad_row)
    correction = (alpha * (team_mean[0] - global_mean[0]),
                  alpha * (team_mean[1] - global_mean[1]))
    return (estimate[0] + correction[0], estimate[1] + correction[1]), source, alpha


def score_play(play, stats, team_stats):
    output = {"key": play["key"], "week": play["week"], "game_id": play["game_id"],
              "play_id": play["play_id"], "action": play["action"], "players": {}}
    for horizon in (0.5, 1.0):
        errors = {"constant_acceleration": [], "role_prior": [], "role_team": []}
        for player in play["players"]:
            truth = player["targets"][horizon]["truth"]
            base = player["targets"][horizon]["base"]
            role_res, _, _ = predict_residual(stats, team_stats, player, play, horizon, False)
            team_res, _, _ = predict_residual(stats, team_stats, player, play, horizon, True)
            preds = {"constant_acceleration": base,
                     "role_prior": (base[0] + role_res[0], base[1] + role_res[1]),
                     "role_team": (base[0] + team_res[0], base[1] + team_res[1])}
            for name, pred in preds.items():
                errors[name].append(math.hypot(pred[0] - truth[0], pred[1] - truth[1]))
            if horizon == 1.0:
                output["players"][player["pid"]] = {
                    "role": player["role"], "side": player["side"],
                    "observed_error_m": {name: round(vals[-1], 6) for name, vals in errors.items()},
                }
        for arm in errors:
            output.setdefault("errors", {})[f"{arm}_{horizon:.1f}s_m"] = sum(errors[arm]) / len(errors[arm])
    return output


def bootstrap_game_ci(rows, arm, baseline, horizon, reps=1200, seed=731):
    delta_field = f"{arm}_{horizon:.1f}s_m"
    base_field = f"{baseline}_{horizon:.1f}s_m"
    by_game = defaultdict(list)
    for row in rows:
        by_game[row["game_id"]].append(row["errors"][delta_field] - row["errors"][base_field])
    games = sorted(by_game)
    if not games:
        return [None, None]
    rng = random.Random(seed)
    estimates = []
    for _ in range(reps):
        picked = [rng.choice(games) for _ in games]
        values = [x for game in picked for x in by_game[game]]
        estimates.append(sum(values) / len(values))
    estimates.sort()
    return [round(estimates[int(0.025 * reps)], 6), round(estimates[int(0.975 * reps)], 6)]


def run_model_eval(tracking_root, eligible, metadata, players, requested_templates, expected_counts):
    stats = {(h, kind): {} for h in (0.5, 1.0) for kind in ("full", "broad")}
    team_stats = {(h, kind): {} for h in (0.5, 1.0) for kind in ("broad",)}
    week_counts = {}
    sample = []
    templates = {}
    skip_counts = Counter()
    for week in TRAIN_WEEKS:
        def train_cb(play, reason):
            if play is None:
                skip_counts[f"week{week}:{reason}"] += 1
                return
            if not play["scorable_all_22_at_both_horizons"]:
                skip_counts[f"week{week}:incomplete_future_label"] += 1
            update_model(stats, team_stats, play)
            capture_template(templates, play, requested_templates, expected_counts)
        week_counts[str(week)] = ingest_week(week, tracking_root, eligible, metadata, players, train_cb)
    for week in TRAIN_WEEKS:
        if week_counts[str(week)]["eligible_rows_missing_from_window"]:
            raise ValueError(f"week {week} has eligible cohort plays absent from its snap window")

    def eval_cb(play, reason):
        if play is None:
            skip_counts[f"week{EVAL_WEEK}:{reason}"] += 1
            return
        if not play["scorable_all_22_at_both_horizons"]:
            skip_counts[f"week{EVAL_WEEK}:incomplete_future_label"] += 1
            return
        sample.append(score_play(play, stats, team_stats))
    week_counts[str(EVAL_WEEK)] = ingest_week(EVAL_WEEK, tracking_root, eligible, metadata, players, eval_cb)
    return stats, team_stats, week_counts, sample, skip_counts, templates


def top_candidate(playbook, family):
    candidates = playbook["offense"]["play_candidates"][family]["candidates"]
    return max(candidates, key=lambda row: (row["count"], row["candidate_id"]))


def top_profile_code(playbook, side: str, key: str, fallback: str):
    categories = playbook[side]["profile"].get(key, {}).get("categories", {})
    if not categories:
        return fallback
    return max(categories.items(), key=lambda pair: (pair[1].get("count", 0), pair[0]))[0]


def role_counts_from_code(code: str, side: str):
    try:
        parts = code.split("-")
        if side == "offense" and len(parts) == 1 and len(parts[0]) == 3:
            parts = list(parts[0])
        first, second, third = (int(v) for v in parts)
        if side == "offense":
            counts = {"QB": 1, "RB": first, "TE": second, "WR": third, "OL": 5}
        else:
            counts = {"DL": first, "LB": second, "DB": third}
        if sum(counts.values()) != 11:
            raise ValueError
        return counts
    except (ValueError, TypeError):
        return dict(ROSTER_OFFENSE if side == "offense" else DEFAULT_DEFENSE)


def roster_role(player, offense: bool):
    candidates = [player.get("depth_chart_position"), player.get("position"), player.get("rating_position")]
    for value in candidates:
        role = role_for(value or "")
        if role and ((offense and role in ROSTER_OFFENSE) or (not offense and role in DEFAULT_DEFENSE)):
            return role
    return None


def roster_rank(player):
    value = as_float(player.get("overall_estimate"))
    if value is not None:
        return value
    ratings = player.get("ratings", {})
    return sum(as_float(ratings.get(key), 50.0) for key in ("AWR", "SPD", "ACC", "AGI")) / 4


def choose_roster(team, roster, role_counts, offense):
    by_role = defaultdict(list)
    for player in roster:
        if player.get("availability") != "available":
            continue
        role = roster_role(player, offense)
        if role:
            by_role[role].append(player)
    chosen = []
    for role, count in role_counts.items():
        candidates = sorted(by_role[role], key=lambda p: (-roster_rank(p), p.get("gsis_id", "")))
        if len(candidates) < count:
            raise ValueError(f"{team} has {len(candidates)} eligible {role}, needs {count}")
        chosen.extend((role, p) for p in candidates[:count])
    if len(chosen) != 11:
        raise ValueError(f"{team} lineup has {len(chosen)} players, expected 11")
    return chosen


def make_seed_scene(prototype_root, players_by_id, stats, team_stats, train_templates):
    snapshot = read_json(prototype_root / "data/teams/matchup-2026-10-22.json")
    continuity = read_json(prototype_root / "data/teams/coaching-continuity-2026-10-22.json")
    ne = read_json(prototype_root / "data/playbooks/NE-2025.json")
    chi = read_json(prototype_root / "data/playbooks/CHI-2025.json")
    run_pass = ne["offense"]["profile"]["run_pass"]["categories"]
    family = max(run_pass.items(), key=lambda item: (item[1].get("count", 0), item[0]))[0]
    play_candidate = top_candidate(ne, family)
    offense_code = top_profile_code(ne, "offense", "personnel_code", "1-1-3")
    defense_code = top_profile_code(chi, "defense", "personnel_code", "4-2-5")
    offense_counts = role_counts_from_code(offense_code, "offense")
    if sum(offense_counts.values()) != 11:
        offense_code = "1-1-3"
        offense_counts = dict(ROSTER_OFFENSE)
    defense_counts = role_counts_from_code(defense_code, "defense")
    if sum(defense_counts.values()) != 11:
        defense_code = "4-2-5"
        defense_counts = dict(DEFAULT_DEFENSE)

    rosters = snapshot["teams"]
    offense_roster = choose_roster("NE", rosters["NE"]["roster"], offense_counts, True)
    defense_roster = choose_roster("CHI", rosters["CHI"]["roster"], defense_counts, False)
    action = family
    form = formation_family(play_candidate["attributes"].get("formation", ""))
    # Team-level historical tendencies are reported but not applied to 2026:
    # the continuity source bridges 2025-26, not 2022-26.
    selected = []
    for side, lineup, team in (("offense", offense_roster, "NE"), ("defense", defense_roster, "CHI")):
        template = train_templates.get((team, side, action, form))
        if not template:
            raise ValueError(f"no 2022 {team} {side} template for {action}/{form}")
        by_role = defaultdict(list)
        for source in template["players"]:
            by_role[source["role"]].append(source)
        for role in by_role:
            by_role[role].sort(key=lambda p: (p["snap"][1], p["source_id"]))
        current_by_role = defaultdict(list)
        for role, player in lineup:
            current_by_role[role].append(player)
        for role, roster_players in current_by_role.items():
            roster_players.sort(key=lambda p: (roster_rank(p), p.get("gsis_id", "")))
            source_players = by_role[role]
            if len(roster_players) != len(source_players):
                raise ValueError(f"template role count mismatch {team} {role}: {len(source_players)} vs {len(roster_players)}")
            for index, (current, source) in enumerate(zip(roster_players, source_players)):
                selected.append({
                    "id": current["gsis_id"], "name": current.get("name"), "team": team,
                    "side": side, "role": role, "assignment_slot": index,
                    "snap_template_source_team": template["source_team"],
                    "snap_template_source_play": {"game_id": template["key"][0], "play_id": template["key"][1]},
                    "position": current.get("position"), "depth_chart_position": current.get("depth_chart_position"),
                    "ratings": current.get("ratings", {}), "physics": current.get("physics", {}),
                    "rating_confidence_by_attribute": current.get("rating_confidence_by_attribute", {}),
                    "availability": current.get("availability"),
                    "snap": source["snap"], "history": source["history"],
                    "source_tracking_player_id": source["source_id"],
                })
    # Recompute geometry features on the stitched 22-player line-up; the
    # offensive and defensive templates have different source plays.
    ball = (0.0, 0.0)
    for player in selected:
        f0, f5, f10 = player["history"]
        v0 = ((f0[0] - f5[0]) / 0.5, (f0[1] - f5[1]) / 0.5)
        vp = ((f5[0] - f10[0]) / 0.5, (f5[1] - f10[1]) / 0.5)
        acc = ((v0[0] - vp[0]) / 0.5, (v0[1] - vp[1]) / 0.5)
        others = [q for q in selected if q["side"] != player["side"]]
        nearest = min(others, key=lambda q: math.hypot(q["snap"][0] - player["snap"][0], q["snap"][1] - player["snap"][1]))
        nd = math.hypot(nearest["snap"][0] - player["snap"][0], nearest["snap"][1] - player["snap"][1])
        xb, yb, pb, sb = position_bins(player["snap"][0], player["snap"][1], math.hypot(*v0), nd)
        model_player = {"role": player["role"], "side": player["side"], "action": action,
                        "formation": form, "club": player["team"],
                        "features": {"x_bin": xb, "y_bin": yb, "proximity_bin": pb, "speed_bin": sb}}
        outputs = {}
        player["initial_velocity_mps"] = [round(v0[0], 4), round(v0[1], 4)]
        for horizon in (0.5, 1.0):
            base = (player["snap"][0] + v0[0] * horizon + 0.5 * acc[0] * horizon**2,
                    player["snap"][1] + v0[1] * horizon + 0.5 * acc[1] * horizon**2)
            residual, source, alpha = predict_residual(stats, team_stats, model_player, None, horizon, True)
            role_res, role_source, _ = predict_residual(stats, team_stats, model_player, None, horizon, False)
            # Team residuals are exposed for comparison but withheld from the
            # generated 2026 path because their 2022->2026 bridge is unknown.
            outputs[f"{horizon:.1f}s"] = {
                "generic_constant_acceleration_m": [round(base[0], 4), round(base[1], 4)],
                "role_prior_m": [round(base[0] + role_res[0], 4), round(base[1] + role_res[1], 4)],
                "historical_team_prior_m_not_applied": [round(base[0] + residual[0], 4), round(base[1] + residual[1], 4)],
                "prior_source": role_source,
                "historical_team_shrinkage_weight": round(alpha, 4),
            }
        player["predicted_position_relative_to_snap_m"] = outputs
        del player["history"]
    c_ne = continuity["teams"]["NE"]
    c_chi = continuity["teams"]["CHI"]
    continuity_summary = {
        "NE_2025_2026_offense_coordinator_identity_score": c_ne["offense"]["coordinator"]["continuity_score"],
        "NE_2025_2026_play_caller_identity_score": c_ne["offense"]["play_caller"]["continuity_score"],
        "CHI_2025_2026_offense_coordinator_identity_score": c_chi["offense"]["coordinator"]["continuity_score"],
        "CHI_2025_2026_play_caller_identity_score": c_chi["offense"]["play_caller"]["continuity_score"],
        "use_limit": "These values bridge 2025 to 2026 only; they do not establish 2022-to-2026 movement-system continuity.",
    }
    return {
        "schema_version": "gridiron.team-movement-seed.v1",
        "status": "research reconstruction; no play outcome generated",
        "coordinate_frame": {"origin": "snap ball", "x": "offense-relative longitudinal meters", "y": "lateral meters", "units": "meters"},
        "play_selection": {
            "team": "NE", "source": "observed_2025 team playbook profile",
            "action_family": family, "candidate_id": play_candidate["candidate_id"],
            "attributes": play_candidate["attributes"], "count": play_candidate["count"],
            "denominator": play_candidate["denominator"], "claim_limit": play_candidate["claim_limit"],
            "offensive_personnel_code": offense_code, "defensive_team": "CHI",
            "defensive_personnel_code": defense_code,
        },
        "roster_snapshot": snapshot["snapshot"],
        "lineup_selection": {
            "rule": "available roster players with the highest estimated overall within the required positional role counts",
            "offense_personnel": offense_code,
            "defense_personnel": defense_code,
            "within_role_slot_order": "current players ranked by estimated overall are mapped in order to historical template players sorted by lateral alignment",
            "claim_limit": "synthetic lineup and slot assignment; the snapshot does not identify a verified starting 22 or assignment sheet",
        },
        "historical_movement_source": {
            "season": 2022, "weeks": [1, 2, 3, 4],
            "NE_offense_template_source_team": train_templates[("NE", "offense", action, form)]["source_team"],
            "CHI_defense_template_source_team": train_templates[("CHI", "defense", action, form)]["source_team"],
            "template_use": "snap alignment and pre-snap motion history only; a non-CHI defense template is a league-role reconstruction",
            "movement_prior": "league role/context residual; historical NE/CHI team residual shown but withheld from current generated paths",
        },
        "continuity": continuity_summary,
        "execution_limit": "The role-prior waypoints are passed through the unchanged 120 Hz Player.locomote() using each current player's physics profile. Other-player geometry is only snap-time nearest-opponent context; there is no post-snap assignment response or collision handling. Madden-style ratings are retained as current roster attributes, but no 2022-to-2026 ratings-to-motion mapping is calibrated.",
        "ball": {"snap_position_m": [0.0, 0.0], "future_trajectory": None,
                 "note": "The BDB source tracks the football, but this seed only uses its snap position and does not model its future path."},
        "players": selected,
    }


def render_report(path, week_counts, skipped, rows, inputs_hashes, eval_summary, scene_hash):
    lines = [
        "# Team movement prior pilot (2026-10-24)", "",
        "Research branch base: `research/gridiron-e3-physical-timing-2026-10-24` at `13b18faa9d9dbe78570df7d45636f2313f25d8ea`; this work is isolated from E3 artifacts.", "",
        "This is a development-only pilot. It does not predict tackles, play outcomes, yards, scores, or games.", "",
        "## Method", "",
        "- Canonical LP snap cohort, weeks 1-5 only; 9,289 eligible play rows in the manifest.",
        "- Weeks 1-4 fit the role-conditioned residual means and 2022 club residuals. Week 5 is held out for this check.",
        "- Every arm uses only frames -10 through 0, the snap ball location, player position group, offense/defense side, play family, formation family, and nearest-opponent geometry to form inputs.",
        "- Frames +5 and +10 are targets only. The football is read only at frame 0. No tackle frame, credited tackler, or play outcome field is used.",
        "- The baseline extrapolates constant acceleration from the 1.0 s pre-snap history. The role arm adds a shrinkable historical role/context residual; the team arm adds a 2022 club residual shrunk by `n_plays/(n_plays+50)`. All errors are paired by play.",
        "- Current roster seed is NE offense vs CHI defense, selected from the Oct. 22, 2026 roster snapshot. NE's top 2025 observed play attribute combination and team personnel profiles select the context.",
        "",
        "## Week 5 paired position error", "",
        "Mean of per-play mean Euclidean error across 22 players; meters. The bootstrap resamples games. These 16 games are development data, not a sealed test.",
        "",
        "| Horizon | Constant acceleration | Role prior | Role + historical team | Role − baseline (95% game CI) | Role + team − baseline (95% game CI) | Plays |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for h in (0.5, 1.0):
        entries = [r["errors"] for r in rows]
        fields = [f"constant_acceleration_{h:.1f}s_m", f"role_prior_{h:.1f}s_m", f"role_team_{h:.1f}s_m"]
        means = [sum(e[f] for e in entries) / max(1, len(entries)) for f in fields]
        role_ci = bootstrap_game_ci(rows, "role_prior", "constant_acceleration", h)
        team_ci = bootstrap_game_ci(rows, "role_team", "constant_acceleration", h)
        lines.append(f"| {h:.1f}s | {means[0]:.3f} | {means[1]:.3f} | {means[2]:.3f} | {means[1]-means[0]:+.3f} [{role_ci[0]:+.3f}, {role_ci[1]:+.3f}] | {means[2]-means[0]:+.3f} [{team_ci[0]:+.3f}, {team_ci[1]:+.3f}] | {len(rows)} |")
    lines += [
        "", "## Incremental team effect", "",
    ]
    for h in (0.5, 1.0):
        role_team_delta = eval_summary[f"{h:.1f}s"]["role_team"] - eval_summary[f"{h:.1f}s"]["role_prior"]
        team_ci = bootstrap_game_ci(rows, "role_team", "role_prior", h)
        lines.append(f"At {h:.1f} s, adding the 2022 club residual changes error by {role_team_delta * 1000:+.2f} mm (95% game bootstrap [{team_ci[0] * 1000:+.2f}, {team_ci[1] * 1000:+.2f}] mm).")
    lines += [
        "This is a small within-season development gain, and the 2022 team effect cannot be carried into 2026 from 2025-26 coach continuity alone. It does not justify a more complex current-team movement policy yet. The role-conditioned prior merits a later untouched evaluation; weeks 6-9 remain reserved.",
        "", "## Cohort and limits", "",
        f"Week 5 tracked eligible rows seen: {week_counts[str(EVAL_WEEK)]['eligible_rows_seen']}; plays with snap-available 22-player inputs: {week_counts[str(EVAL_WEEK)]['snap_input_22_player_plays']}; full-22 labels at both horizons and scored plays: {len(rows)}.",
        "The full manifest is preserved. Non-run/pass administrative snaps remain in the cohort inventory but are not used to fit this movement prior. Future-frame availability censors scoring labels only; it is not used to choose players, form inputs, or choose the generated snap template.",
        "The existing all-week generic locomotion comparison reported 0.206 m at 0.5 s and 0.921 m at 1.0 s, but this report's fair paired comparison is the week-5 constant-acceleration arm above; the folds and model inputs differ from that descriptive all-week result.",
        "The 22-person lineup uses available roster players ranked by estimated overall within positional role; it maps those players into historical lateral-rank slots. This is a synthetic lineup proxy, not a verified starting 22 or an assignment sheet.",
        "2022 NE/CHI residuals are historical franchise labels, not 2026 system labels. The available continuity file bridges 2025-26 only; therefore the generated 2026 roster paths use the league role prior and expose, but do not apply, the 2022 team residual.",
        "The seed has 22 current players, role and roster/rating/physics fields, and 0/0.5/1.0 s position estimates. The unchanged 120 Hz Player.locomote() applies each player's current physics profile to the role-prior waypoints. Other-player geometry is only snap-time context; there is no post-snap assignment response, collision response, or future ball trajectory. Madden-style ratings are retained for analysis but are not directly mapped to movement because the historical tracking cohort has no matched Madden ratings for these players.",
        "Tracking is 10 Hz, has no whistle timestamp, and has no stoppage attribution. Weeks 6-9 were not opened.",
        "",
        "## Input and output hashes", "",
        *[f"- `{name}`: `{digest}`" for name, digest in sorted(inputs_hashes.items())],
        f"- generated seed scene SHA-256: `{scene_hash}`",
        "",
        "The week-5 per-play CSV and machine-readable summary are beside this document.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracking-root", type=Path, default=Path("/root/nfl-tracking-data/bdb2025"))
    parser.add_argument("--prototype-root", type=Path, default=Path("/root/gridiron-physics"))
    parser.add_argument("--cohort", type=Path, default=Path("/root/lp-nfl-snap-benchmark/docs/research/bdb2025-snap-anchored-cohort-v1.csv"))
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[2] / "data/research/team-movement")
    parser.add_argument("--report", type=Path, default=Path(__file__).resolve().parents[2] / "docs/research/TEAM-MOVEMENT-PRIOR-PILOT-2026-10-24.md")
    args = parser.parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    tracking_root, prototype_root, eligible, metadata, players_by_id, manifest_rows, inputs = load_inputs(args)
    hashes = {name: sha256(path) for name, path in inputs.items()}
    playbooks = {t: read_json(prototype_root / f"data/playbooks/{t}-2025.json") for t in ("NE", "CHI")}
    family = max(playbooks["NE"]["offense"]["profile"]["run_pass"]["categories"].items(),
                 key=lambda item: (item[1].get("count", 0), item[0]))[0]
    candidate = top_candidate(playbooks["NE"], family)
    action = family
    form = formation_family(candidate["attributes"].get("formation", ""))
    offense_code = top_profile_code(playbooks["NE"], "offense", "personnel_code", "1-1-3")
    defense_code = top_profile_code(playbooks["CHI"], "defense", "personnel_code", "4-2-5")
    expected_counts = {
        ("NE", "offense"): role_counts_from_code(offense_code, "offense"),
        ("CHI", "defense"): role_counts_from_code(defense_code, "defense"),
    }
    requested_templates = {
        ("NE", "offense"): (action, form),
        ("CHI", "defense"): (action, form),
    }
    stats, team_stats, week_counts, per_play, skip_counts, templates = run_model_eval(
        tracking_root, eligible, metadata, players_by_id, requested_templates, expected_counts)
    scene = make_seed_scene(prototype_root, players_by_id, stats, team_stats, templates)
    prior_path = args.output_root / "seed-ne-offense-chi-defense-priors.json"
    prior_path.write_text(json.dumps(scene, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    scene_path = args.output_root / "seed-ne-offense-chi-defense.json"
    runner = Path(__file__).with_name("run_team_movement_seed.mjs")
    subprocess.run(["node", str(runner), str(prior_path), str(scene_path)], check=True)
    scene_hash = sha256(scene_path)
    (args.output_root / "input-sha256.json").write_text(
        json.dumps({name: {"path": str(path), "sha256": hashes[name]} for name, path in sorted(inputs.items())},
                   sort_keys=True, indent=2) + "\n", encoding="utf-8")

    per_play_path = args.output_root / "week5-per-play-errors.csv"
    fields = ["week", "game_id", "play_id", "action"]
    for horizon in (0.5, 1.0):
        for arm in ("constant_acceleration", "role_prior", "role_team"):
            fields.append(f"{arm}_{horizon:.1f}s_m")
    with per_play_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in per_play:
            out = {k: row[k] for k in ("week", "game_id", "play_id", "action")}
            out.update(row["errors"])
            writer.writerow(out)

    eval_summary = {}
    for horizon in (0.5, 1.0):
        means = {}
        for arm in ("constant_acceleration", "role_prior", "role_team"):
            key = f"{arm}_{horizon:.1f}s_m"
            means[arm] = sum(row["errors"][key] for row in per_play) / max(1, len(per_play))
        eval_summary[f"{horizon:.1f}s"] = means
    summary = {
        "schema_version": "gridiron.team-movement-prior-eval.v1",
        "training_weeks": list(TRAIN_WEEKS), "evaluation_week": EVAL_WEEK,
        "weeks_6_9_read": False,
        "cohort_manifest_rows": len(manifest_rows),
        "eligible_input_plays_weeks_1_5": sum(len(eligible[w]) for w in range(1, 6)),
        "week_counts": week_counts,
        "week5_scored_plays": len(per_play),
        "skipped": dict(skip_counts),
        "mean_per_play_error_m": eval_summary,
        "paired_differences_role_minus_constant_acceleration_m": {
            f"{h:.1f}s": {
                "mean": round(eval_summary[f"{h:.1f}s"]["role_prior"] - eval_summary[f"{h:.1f}s"]["constant_acceleration"], 6),
                "game_bootstrap_95": bootstrap_game_ci(per_play, "role_prior", "constant_acceleration", h),
            } for h in (0.5, 1.0)
        },
        "paired_differences_team_minus_constant_acceleration_m": {
            f"{h:.1f}s": {
                "mean": round(eval_summary[f"{h:.1f}s"]["role_team"] - eval_summary[f"{h:.1f}s"]["constant_acceleration"], 6),
                "game_bootstrap_95": bootstrap_game_ci(per_play, "role_team", "constant_acceleration", h),
            } for h in (0.5, 1.0)
        },
        "paired_differences_team_minus_role_prior_m": {
            f"{h:.1f}s": {
                "mean": round(eval_summary[f"{h:.1f}s"]["role_team"] - eval_summary[f"{h:.1f}s"]["role_prior"], 6),
                "game_bootstrap_95": bootstrap_game_ci(per_play, "role_team", "role_prior", h),
            } for h in (0.5, 1.0)
        },
        "input_hashes": hashes,
        "generated_scene_sha256": scene_hash,
        "claims": ["development-only movement metric", "not a tackle or play-outcome prediction", "team residuals are 2022 historical tendencies"],
    }
    summary_path = args.output_root / "week5-summary.json"
    summary_path.write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    render_report(args.report, week_counts, skip_counts, per_play, hashes, eval_summary, scene_hash)
    print(json.dumps({"summary": str(summary_path), "scene": str(scene_path), "scene_sha256": scene_hash,
                      "week5_scored_plays": len(per_play), "week_counts": week_counts,
                      "mean_per_play_error_m": eval_summary,
                      "report": str(args.report)}, indent=2))


if __name__ == "__main__":
    main()
