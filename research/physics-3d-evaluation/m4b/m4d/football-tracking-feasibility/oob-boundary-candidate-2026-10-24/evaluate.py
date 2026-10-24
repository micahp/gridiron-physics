#!/usr/bin/env python3
"""Evaluate a research-only disc-edge sideline trigger against observed OOB labels.

The input tracking extracts are generated from the canonical LP weeks 1-5
cohort. They are deliberately kept outside Git. This script compares the
current center +0.3 yd threshold with first contact by the engine's player-disc
radius range; it does not modify engine/play.js or tune a radius to these plays.
"""
import argparse
import csv
import hashlib
import json
import statistics
from collections import defaultdict
from pathlib import Path

FIELD_W_YD = 160 / 3
YD_PER_M = 1 / 0.9144
DEFAULT_MANIFEST = Path("/root/lp-nfl-snap-benchmark/docs/research/bdb2025-snap-anchored-cohort-v1.csv")
RATINGS = Path(__file__).resolve().parents[6] / "data" / "ratings.json"


def quantile(values, q):
    ordered = sorted(values)
    if not ordered:
        return None
    return ordered[round((len(ordered) - 1) * q)]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_eligible(manifest):
    with manifest.open(newline="", encoding="utf-8") as f:
        return {
            (int(r["week"]), r["gameId"], r["playId"])
            for r in csv.DictReader(f)
            if r["eligible_input"].lower() == "true"
        }


def load_cases(path):
    with path.open(newline="", encoding="utf-8") as f:
        cases = list(csv.DictReader(f))
    keyed = {}
    for case in cases:
        key = (int(case["week"]), case["gameId"], case["playId"])
        if key in keyed:
            raise ValueError(f"duplicate OOB case {key}")
        keyed[key] = case
    return keyed


def load_tracks(extract_dir, cases):
    tracks = defaultdict(lambda: {"runner": {}, "ball": {}, "handoffs": set(), "directions": set(), "oob_event": False})
    for week in sorted({key[0] for key in cases}):
        path = extract_dir / f"gridiron_oob_track_rows_wk{week}.csv"
        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.reader(f):
                if len(row) < 18:
                    continue
                key = (week, row[0], row[1])
                case = cases.get(key)
                if not case:
                    continue
                frame = int(row[4])
                actor_id = row[2]
                event = row[17]
                entry = tracks[key]
                if row[9] not in ("", "NA"):
                    entry["directions"].add(row[9])
                if event == "handoff":
                    entry["handoffs"].add(frame)
                if actor_id == case["rusherId"]:
                    entry["runner"][frame] = (float(row[10]), float(row[11]))
                elif actor_id == "NA" and row[3].lower() == "football":
                    entry["ball"][frame] = (float(row[10]), float(row[11]))
                    if event == "out_of_bounds":
                        entry["oob_event"] = True
    return tracks


def first_crossing(points, live_frame, boundary, threshold, strict=False):
    """Return first sampled frame entering the threshold, or its preexisting state."""
    relevant = [(frame, boundary - y if boundary > FIELD_W_YD / 2 else y)
                for frame, (_x, y) in sorted(points.items())
                if frame >= live_frame]
    if not relevant:
        return None, False
    condition = (lambda d: d < threshold) if strict else (lambda d: d <= threshold)
    if condition(relevant[0][1]):
        return None, True
    for (prev_frame, prev_d), (frame, d) in zip(relevant, relevant[1:]):
        if condition(d) and not condition(prev_d):
            return frame, False
    return None, False


def ball_x_at(ball, frame):
    if frame in ball:
        return ball[frame][0]
    lo = max((f for f in ball if f < frame), default=None)
    hi = min((f for f in ball if f > frame), default=None)
    if lo is None or hi is None:
        return None
    frac = (frame - lo) / (hi - lo)
    return ball[lo][0] + frac * (ball[hi][0] - ball[lo][0])


def summarize(deltas, spot_deltas, preexisting, missing):
    abs_delta = [abs(x) for x in deltas]
    return {
        "crossing_count": len(deltas),
        "preexisting_at_live_start": preexisting,
        "no_crossing_in_available_track": missing,
        "crossing_minus_oob_event_frames": {
            "median": statistics.median(deltas) if deltas else None,
            "p90_absolute": quantile(abs_delta, 0.90),
            "event_precedes_crossing": sum(x > 0 for x in deltas),
            "same_frame": sum(x == 0 for x in deltas),
            "crossing_precedes_event": sum(x < 0 for x in deltas),
            "within_one_frame": sum(x <= 1 for x in abs_delta),
        },
        "forward_ball_spot_delta_yd_vs_event_frame": {
            "count": len(spot_deltas),
            "median_signed": statistics.median(spot_deltas) if spot_deltas else None,
            "median_absolute": statistics.median(abs(x) for x in spot_deltas) if spot_deltas else None,
            "p90_absolute": quantile([abs(x) for x in spot_deltas], 0.90),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extract-dir", type=Path, default=Path("/tmp"))
    ap.add_argument("--cases", type=Path, default=Path("/tmp/gridiron_oob_candidates_wk1-5.csv"))
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--ratings", type=Path, default=RATINGS)
    ap.add_argument("--output", type=Path, default=Path(__file__).with_name("results.json"))
    args = ap.parse_args()

    cases = load_cases(args.cases)
    eligible = load_eligible(args.manifest)
    noncanonical = sorted(set(cases) - eligible)
    if noncanonical:
        raise ValueError(f"OOB cases outside canonical LP cohort: {noncanonical[:5]}")
    tracks = load_tracks(args.extract_dir, cases)
    player_data = json.loads(args.ratings.read_text(encoding="utf-8"))["players"].values()
    radii_m = [float(p["physics"]["radius"]) for p in player_data if p.get("physics", {}).get("radius") is not None]
    radius_range_m = (min(radii_m), max(radii_m))

    methods = {
        "current_center_plus_0.3yd": -0.3,
        "disc_edge_smallest_engine_radius": radius_range_m[0] * YD_PER_M,
        "disc_edge_largest_engine_radius": radius_range_m[1] * YD_PER_M,
    }
    values = {name: {"deltas": [], "spot_deltas": [], "preexisting": 0, "missing": 0, "by_key": {}}
              for name in methods}
    side_counts = {"low_sideline": 0, "high_sideline": 0}
    validated = 0
    for key, case in cases.items():
        observed = tracks.get(key)
        if not observed:
            raise ValueError(f"missing tracking rows for {key}")
        runner = observed["runner"]
        ball = observed["ball"]
        snap = int(case["snapFrame"])
        event_frame = int(case["oobFrame"])
        if event_frame not in runner or event_frame not in ball:
            raise ValueError(f"runner/football absent at OOB frame for {key}")
        if not observed["oob_event"]:
            raise ValueError(f"tracking football OOB event missing for {key}")
        if len(observed["directions"]) != 1:
            raise ValueError(f"ambiguous play direction for {key}: {observed['directions']}")
        direction = next(iter(observed["directions"]))
        event_y = runner[event_frame][1]
        boundary = 0.0 if event_y <= FIELD_W_YD / 2 else FIELD_W_YD
        side_counts["low_sideline" if boundary == 0 else "high_sideline"] += 1
        handoffs = [f for f in observed["handoffs"] if snap <= f <= event_frame]
        live_frame = min(handoffs) if handoffs else snap
        for name, threshold in methods.items():
            frame, preexisting = first_crossing(runner, live_frame, boundary, threshold,
                                                strict=name == "current_center_plus_0.3yd")
            bucket = values[name]
            if preexisting:
                bucket["preexisting"] += 1
            elif frame is None:
                bucket["missing"] += 1
            else:
                delta = frame - event_frame
                bucket["deltas"].append(delta)
                ball_x = ball_x_at(ball, frame)
                event_x = ball_x_at(ball, event_frame)
                spot_delta = None
                if ball_x is not None and event_x is not None:
                    sign = 1 if direction == "right" else -1
                    spot_delta = sign * (ball_x - event_x)
                    bucket["spot_deltas"].append(spot_delta)
                bucket["by_key"][key] = {"frame_delta": delta, "spot_delta": spot_delta}
        validated += 1

    method_results = {name: summarize(x["deltas"], x["spot_deltas"], x["preexisting"], x["missing"])
                      for name, x in values.items()}
    baseline = values["current_center_plus_0.3yd"]["by_key"]
    for name in ("disc_edge_smallest_engine_radius", "disc_edge_largest_engine_radius"):
        candidate = values[name]["by_key"]
        shared = set(baseline) & set(candidate)
        current_frame_abs = [abs(baseline[k]["frame_delta"]) for k in shared]
        candidate_frame_abs = [abs(candidate[k]["frame_delta"]) for k in shared]
        frame_changes = [new - old for old, new in zip(current_frame_abs, candidate_frame_abs)]
        paired_spot = [(abs(candidate[k]["spot_delta"]) - abs(baseline[k]["spot_delta"]))
                       for k in shared if candidate[k]["spot_delta"] is not None and baseline[k]["spot_delta"] is not None]
        method_results[name]["paired_vs_current_center_plus_0.3yd"] = {
            "plays": len(shared),
            "absolute_event_frame_error_change_median": statistics.median(frame_changes) if frame_changes else None,
            "current_within_one_frame": sum(x <= 1 for x in current_frame_abs),
            "candidate_within_one_frame": sum(x <= 1 for x in candidate_frame_abs),
            "frame_error_improved": sum(x < 0 for x in frame_changes),
            "frame_error_tied": sum(x == 0 for x in frame_changes),
            "frame_error_worsened": sum(x > 0 for x in frame_changes),
            "absolute_ball_spot_delta_error_change_median_yd": statistics.median(paired_spot) if paired_spot else None,
            "spot_error_improved": sum(x < 0 for x in paired_spot),
            "spot_error_tied": sum(x == 0 for x in paired_spot),
            "spot_error_worsened": sum(x > 0 for x in paired_spot),
        }

    results = {
        "title": "Research-only sideline disc-edge candidate",
        "cohort": "LP canonical snap-anchored eligible rushing plays, weeks 1-5",
        "plays": validated,
        "weeks_6_9_used": False,
        "model_change": False,
        "candidate_definition": "First sampled runner-frame where the existing 2D player disc touches/crosses the nearest sideline after snap or observed handoff, searched through the available play track.",
        "observation_cadence_seconds": 0.1,
        "field_width_yd": FIELD_W_YD,
        "engine_player_radius_range_m": [radius_range_m[0], radius_range_m[1]],
        "engine_player_radius_range_yd": [r * YD_PER_M for r in radius_range_m],
        "input_sha256": {
            "cases": sha256(args.cases),
            "canonical_manifest": sha256(args.manifest),
            "engine_ratings": sha256(args.ratings),
            "tracking_extracts": {
                f"week_{week}": sha256(args.extract_dir / f"gridiron_oob_track_rows_wk{week}.csv")
                for week in sorted({key[0] for key in cases})
            },
        },
        "sideline_counts": side_counts,
        "limitations": [
            "The radius is a disc proxy, not an observed foot or body-contact point.",
            "Player-specific 2022 tracking identities are not mapped to engine radius profiles; both engine-radius endpoints are shown as a sensitivity range.",
            "Tracking event timing and positions are quantized to 0.1 seconds; sampled crossing time is not an official ruling.",
            "Ball spot deltas use forward x at the candidate crossing frame versus x at the tracking OOB event frame; they are diagnostics, not adjudicated spot error.",
        ],
        "methods": method_results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
