#!/usr/bin/env python3
"""Run fair observed-play movement baselines and a separate snap-anchored cohort."""

import csv
import gzip
import hashlib
import importlib.util
import itertools
import json
import math
import os
import statistics
import subprocess
from pathlib import Path


HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "observed-football-movement-review-v2-2026-10-24"
LP_ROOT = Path("/root/lp-nfl-tracking")
TRACKING_ROOT = Path("/root/nfl-tracking-data/bdb2025")
TACKLE_MANIFEST = LP_ROOT / "docs/research/bdb2025-observed-tackle-manifest-v1.csv"
SNAP_MANIFEST = LP_ROOT / "docs/research/bdb2025-snap-all-player-manifest-v1.csv"
SNAP_COHORT_SUMMARY = LP_ROOT / "docs/research/bdb2025-snap-all-player-cohort-v1.json"
SNAP_OBSERVATIONS = TRACKING_ROOT / "audit/bdb2025-snap-all-player-observations-v1-combined.jsonl.gz"
NODE_RUNNER = HERE / "run_movement_baselines.mjs"
MODEL_NAMES = ("constantVelocity", "constantAcceleration", "boundedAcceleration", "locomotionController")
SNAP_HORIZONS = ((0.5, 5), (1.0, 10))
TRACK_DT = 0.1
REFERENCE = {
    "vmaxMps": 9.0,
    "f0N": 1100.0,
    "lateralAccelerationMps2": 6.5,
    "frictionCoefficient": 0.95,
    "responseSeconds": 0.12,
    "boundedAccelerationRule": "min(6.5 m/s^2, 1100 N / listed player mass)",
}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_legacy_module():
    path = HERE / "run_observed_movement_comparison.py"
    spec = importlib.util.spec_from_file_location("legacy_observed_movement", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def open_predictor():
    return subprocess.Popen(
        ["node", str(NODE_RUNNER), "--ndjson"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "GRIDIRON_PHYSICS_ROOT": "/root/gridiron-physics"},
    )


def predict_one(process, request):
    process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
    process.stdin.flush()
    line = process.stdout.readline()
    if not line:
        raise RuntimeError("Movement runner closed stdout before returning a prediction")
    return json.loads(line)


def close_predictor(process):
    process.stdin.close()
    return_code = process.wait()
    process.stdout.close()
    if return_code:
        raise RuntimeError(f"Movement runner exited with status {return_code}")


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def mean(values):
    return statistics.mean(values) if values else None


def median(values):
    return statistics.median(values) if values else None


def rmse(values):
    return math.sqrt(statistics.mean(x * x for x in values)) if values else None


def aggregate_metric(rows, model, metric):
    values = [row.get("models", row)[model][metric] for row in rows
              if row.get("models", row)[model][metric] is not None]
    return {"n": len(values), "mean": mean(values), "median": median(values), "rmse": rmse(values)}


def paired_summary(rows, model, baseline, metric, smaller_is_better=True):
    pairs = [(row.get("models", row)[model][metric], row.get("models", row)[baseline][metric]) for row in rows
             if row.get("models", row)[model][metric] is not None
             and row.get("models", row)[baseline][metric] is not None]
    deltas = [candidate - reference for candidate, reference in pairs]
    improved = [candidate < reference for candidate, reference in pairs] if smaller_is_better else [candidate > reference for candidate, reference in pairs]
    tied = [candidate == reference for candidate, reference in pairs]
    return {
        "nPairedPlays": len(pairs),
        "meanDeltaVsBaseline": mean(deltas),
        "medianDeltaVsBaseline": median(deltas),
        "improvementShare": sum(improved) / len(pairs) if pairs else None,
        "tieShare": sum(tied) / len(pairs) if pairs else None,
    }


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def prepare_event_diagnostic(legacy):
    legacy.ENGINE = Path("/root/gridiron-physics")
    engine = legacy.engine_provenance()
    with TACKLE_MANIFEST.open(newline="", encoding="utf-8") as f:
        manifest_rows = list(csv.DictReader(f))
    if len(manifest_rows) != 49 or digest(TACKLE_MANIFEST) != "3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353":
        raise RuntimeError("Frozen 49-row tackle manifest changed; refusing to score")
    old_comparison_path = HERE / "results/observed-tackle-movement-2026-10-24/comparison.json"
    with old_comparison_path.open(encoding="utf-8") as f:
        old_comparison = json.load(f)
    cases = [case for case in old_comparison["cases"] if case["split"] == "development"]
    manifest_development = {
        f"w{row['week']}-{row['game_id']}-{row['play_id']}"
        for row in manifest_rows
        if row.get("included", "").lower() == "true" and row["split"] == "development"
    }
    if len(cases) != 40 or {case["sampleId"] for case in cases} != manifest_development:
        raise RuntimeError("Prior comparison does not match the unchanged 40-play development manifest")
    if old_comparison["provenance"]["inputHashesFromStagedManifestOrLocalSha256"]["tackleManifestCsv"] != digest(TACKLE_MANIFEST):
        raise RuntimeError("Prior comparison was generated from a different tackle manifest")
    return cases, engine, manifest_rows, digest(old_comparison_path)


def score_event_diagnostic(cases):
    requests = []
    for case in cases:
        actors = []
        for role in ("carrier", "defender"):
            actor = case["actorData"][role]
            actors.append({
                "key": role,
                "id": actor["id"],
                "team": actor["team"],
                "massKg": actor["massKg"],
                "hasBall": role == "carrier",
                "historyPositionsM": actor["fullPathM"][:6],
            })
        requests.append({
            "id": case["sampleId"],
            "actors": actors,
            "sampleTimes": [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        })

    process = open_predictor()
    per_play = []
    try:
        for case, request in zip(cases, requests):
            prediction = predict_one(process, request)
            if prediction["id"] != case["sampleId"]:
                raise RuntimeError(f"Prediction key mismatch: {prediction['id']} != {case['sampleId']}")
            observed_separation = case["observedSeparationForecastM"]
            case_result = {"sampleId": case["sampleId"], "week": case["week"],
                           "gameId": case["gameId"], "playId": case["playId"], "split": case["split"],
                           "observedMinimumAtOrigin": observed_separation.index(min(observed_separation)) == 0,
                           "models": {}}
            observed_future = observed_separation[1:]
            observed_min = min(observed_future)
            observed_min_index = observed_future.index(observed_min) + 1
            for model in MODEL_NAMES:
                predicted_positions = prediction["models"][model]
                actor_errors = {}
                for role in ("carrier", "defender"):
                    actual = case["actorData"][role]["observedPredictionPathM"]
                    predicted = predicted_positions[role]
                    actor_errors[role] = [distance(actual[i], predicted[i]["p"]) for i in range(1, 6)]
                predicted_separation = [
                    distance(predicted_positions["carrier"][i]["p"], predicted_positions["defender"][i]["p"])
                    for i in range(6)
                ]
                future_separation_errors = [abs(observed_separation[i] - predicted_separation[i]) for i in range(1, 6)]
                predicted_future = predicted_separation[1:]
                predicted_min = min(predicted_future)
                predicted_min_index = predicted_future.index(predicted_min) + 1
                full_predicted_min_index = predicted_separation.index(min(predicted_separation))
                event_signed = predicted_separation[5] - observed_separation[5]
                case_result["models"][model] = {
                    "carrierPositionMaeM": mean(actor_errors["carrier"]),
                    "defenderPositionMaeM": mean(actor_errors["defender"]),
                    "positionMaeM": mean(actor_errors["carrier"] + actor_errors["defender"]),
                    "separationMaeM": mean(future_separation_errors),
                    "eventSeparationAbsErrorM": abs(event_signed),
                    "eventSeparationSignedErrorM": event_signed,
                    "minimumSeparationAbsErrorM": abs(predicted_min - observed_min),
                    "minimumSeparationSignedErrorM": predicted_min - observed_min,
                    "minimumTimeAbsErrorSeconds": abs(predicted_min_index * 0.1 - observed_min_index * 0.1),
                    "observedMinimumSeparationM": observed_min,
                    "predictedMinimumSeparationM": predicted_min,
                    "observedMinimumTimeSeconds": observed_min_index * 0.1,
                    "predictedMinimumTimeSeconds": predicted_min_index * 0.1,
                    "predictedMinimumAtOrigin": full_predicted_min_index == 0,
                }
            per_play.append(case_result)
    finally:
        close_predictor(process)

    summary = {}
    numeric_metrics = (
        "carrierPositionMaeM", "defenderPositionMaeM", "positionMaeM", "separationMaeM",
        "eventSeparationAbsErrorM", "eventSeparationSignedErrorM", "minimumSeparationAbsErrorM",
        "minimumSeparationSignedErrorM", "minimumTimeAbsErrorSeconds", "observedMinimumSeparationM",
        "predictedMinimumSeparationM", "observedMinimumTimeSeconds", "predictedMinimumTimeSeconds",
    )
    for model in MODEL_NAMES:
        summary[model] = {metric: aggregate_metric(per_play, model, metric) for metric in numeric_metrics}
        summary[model]["fullWindowMinimumAtOriginCount"] = sum(
            row["models"][model]["predictedMinimumAtOrigin"] for row in per_play
        )
    paired = {}
    for model in MODEL_NAMES[1:]:
        paired[model] = {
            metric: paired_summary(per_play, model, "constantVelocity", metric)
            for metric in ("positionMaeM", "separationMaeM", "eventSeparationAbsErrorM", "minimumSeparationAbsErrorM")
        }
    return per_play, {"nDevelopmentPlays": len(per_play), "models": summary, "pairedVsConstantVelocity": paired,
                      "observedMinimumAtOriginCount": sum(row["observedMinimumAtOrigin"] for row in per_play)}


def vector_mean(vectors):
    return [statistics.mean(v[0] for v in vectors), statistics.mean(v[1] for v in vectors)]


def signed_turn_degrees(v0, velocity):
    if math.hypot(*v0) < 0.3 or math.hypot(*velocity) < 0.3:
        return None
    origin = math.atan2(v0[1], v0[0])
    heading = math.atan2(velocity[1], velocity[0])
    return math.degrees((heading - origin + math.pi) % (2 * math.pi) - math.pi)


def lateral_acceleration(v0, vh, horizon):
    speed = math.hypot(*v0)
    delta = [vh[0] - v0[0], vh[1] - v0[1]]
    if speed < 0.3:
        return math.hypot(*delta) / horizon
    unit = [v0[0] / speed, v0[1] / speed]
    parallel = delta[0] * unit[0] + delta[1] * unit[1]
    lateral = [delta[0] - parallel * unit[0], delta[1] - parallel * unit[1]]
    return math.hypot(*lateral) / horizon


def nearest(defender_ids, positions, offense_position):
    return min(defender_ids, key=lambda pid: (distance(positions[pid], offense_position), pid))


def snap_play_metrics(record, prediction):
    actors = {actor["nflId"]: actor for actor in record["players"]}
    if len(actors) != 22:
        raise RuntimeError(f"{record['gameId']}/{record['playId']}: expected 22 tracked players")
    offense_ids = sorted(pid for pid, actor in actors.items() if actor["role"] == "offense")
    defense_ids = sorted(pid for pid, actor in actors.items() if actor["role"] == "defense")
    if len(offense_ids) != 11 or len(defense_ids) != 11:
        raise RuntimeError(f"{record['gameId']}/{record['playId']}: role split is not 11-on-11")
    actual_at_snap = {pid: actors[pid]["labelPositionsM"][0] for pid in actors}
    origin_nearest = {pid: nearest(defense_ids, actual_at_snap, actual_at_snap[pid]) for pid in offense_ids}
    result_rows = []

    for horizon, label_index in SNAP_HORIZONS:
        model_metrics = {}
        actual_positions = {pid: actors[pid]["labelPositionsM"][label_index] for pid in actors}
        actual_velocities = {
            pid: [(actors[pid]["labelPositionsM"][label_index][axis]
                   - actors[pid]["labelPositionsM"][label_index - 1][axis]) / TRACK_DT for axis in (0, 1)]
            for pid in actors
        }
        actual_spacing_pairs = {
            role: list(itertools.combinations(offense_ids if role == "offense" else defense_ids, 2))
            for role in ("offense", "defense")
        }
        actual_team_centroids = {
            role: vector_mean([actual_positions[pid] for pid in (offense_ids if role == "offense" else defense_ids)])
            for role in ("offense", "defense")
        }
        for model in MODEL_NAMES:
            states = prediction["models"][model]
            prediction_state = {pid: states[pid][label_index // 5] for pid in actors}
            predicted_positions = {pid: prediction_state[pid]["p"] for pid in actors}
            predicted_velocities = {pid: prediction_state[pid]["v"] for pid in actors}
            position_errors = [distance(predicted_positions[pid], actual_positions[pid]) for pid in actors]
            velocity_errors = [distance(predicted_velocities[pid], actual_velocities[pid]) for pid in actors]
            speed_change_errors = []
            turn_errors = []
            predicted_speed_over_cap = 0
            predicted_lateral_over_cap = 0
            for pid, actor in actors.items():
                history = actor["inputPositionsM"]
                v0 = [(history[-1][axis] - history[-2][axis]) / TRACK_DT for axis in (0, 1)]
                observed_change = [actual_velocities[pid][axis] - v0[axis] for axis in (0, 1)]
                predicted_change = [predicted_velocities[pid][axis] - v0[axis] for axis in (0, 1)]
                speed_change_errors.append(abs(math.hypot(*observed_change) - math.hypot(*predicted_change)))
                predicted_turn = signed_turn_degrees(v0, predicted_velocities[pid])
                observed_turn = signed_turn_degrees(v0, actual_velocities[pid])
                if predicted_turn is not None and observed_turn is not None:
                    turn_errors.append(abs((predicted_turn - observed_turn + 180) % 360 - 180))
                predicted_speed_over_cap += int(math.hypot(*predicted_velocities[pid]) > REFERENCE["vmaxMps"] + 1e-9)
                predicted_lateral_over_cap += int(
                    lateral_acceleration(v0, predicted_velocities[pid], horizon)
                    > REFERENCE["lateralAccelerationMps2"] + 1e-9
                )

            spacing_errors = []
            for pairs in actual_spacing_pairs.values():
                spacing_errors.extend(
                    abs(distance(predicted_positions[a], predicted_positions[b])
                        - distance(actual_positions[a], actual_positions[b]))
                    for a, b in pairs
                )
            origin_nearest_pair_errors = [
                abs(distance(predicted_positions[pid], predicted_positions[origin_nearest[pid]])
                    - distance(actual_positions[pid], actual_positions[origin_nearest[pid]]))
                for pid in offense_ids
            ]
            nearest_distance_errors = []
            nearest_identity_matches = 0
            for pid in offense_ids:
                predicted_nearest_id = nearest(defense_ids, predicted_positions, predicted_positions[pid])
                actual_nearest_id = nearest(defense_ids, actual_positions, actual_positions[pid])
                nearest_identity_matches += int(predicted_nearest_id == actual_nearest_id)
                predicted_nearest_distance = distance(predicted_positions[pid], predicted_positions[predicted_nearest_id])
                actual_nearest_distance = distance(actual_positions[pid], actual_positions[actual_nearest_id])
                nearest_distance_errors.append(abs(predicted_nearest_distance - actual_nearest_distance))

            predicted_team_centroids = {
                role: vector_mean([predicted_positions[pid] for pid in (offense_ids if role == "offense" else defense_ids)])
                for role in ("offense", "defense")
            }
            predicted_team_velocities = {
                role: vector_mean([predicted_velocities[pid] for pid in (offense_ids if role == "offense" else defense_ids)])
                for role in ("offense", "defense")
            }
            actual_team_velocities = {
                role: vector_mean([actual_velocities[pid] for pid in (offense_ids if role == "offense" else defense_ids)])
                for role in ("offense", "defense")
            }
            team_centroid_errors = {
                role: distance(predicted_team_centroids[role], actual_team_centroids[role])
                for role in ("offense", "defense")
            }
            team_centroid_velocity_errors = {
                role: distance(predicted_team_velocities[role], actual_team_velocities[role])
                for role in ("offense", "defense")
            }
            pred_interteam = distance(predicted_team_centroids["offense"], predicted_team_centroids["defense"])
            actual_interteam = distance(actual_team_centroids["offense"], actual_team_centroids["defense"])
            model_metrics[model] = {
                "positionMaeM": mean(position_errors),
                "positionRmseM": rmse(position_errors),
                "velocityVectorMaeMps": mean(velocity_errors),
                "speedChangeMaeMps": mean(speed_change_errors),
                "turnAngleErrorMeanDegrees": mean(turn_errors),
                "turnAngleEligiblePlayers": len(turn_errors),
                "spacingPairMaeM": mean(spacing_errors),
                "snapNearestPairDistanceMaeM": mean(origin_nearest_pair_errors),
                "nearestDefenderDistanceMaeM": mean(nearest_distance_errors),
                "nearestDefenderIdentityAgreement": nearest_identity_matches / len(offense_ids),
                "offenseCentroidDisplacementErrorM": team_centroid_errors["offense"],
                "defenseCentroidDisplacementErrorM": team_centroid_errors["defense"],
                "meanTeamCentroidDisplacementErrorM": mean(list(team_centroid_errors.values())),
                "teamCentroidVelocityErrorMps": mean(list(team_centroid_velocity_errors.values())),
                "interTeamCentroidSeparationErrorM": abs(pred_interteam - actual_interteam),
                "predictedSpeedOver9mpsShare": predicted_speed_over_cap / len(actors),
                "predictedLateralAccelerationOver6p5Share": predicted_lateral_over_cap / len(actors),
            }
        result_rows.append({
            "week": record["week"], "gameId": record["gameId"], "playId": record["playId"],
            "horizonSeconds": horizon, "models": model_metrics,
        })
    return result_rows


def score_snap_cohort():
    if not SNAP_MANIFEST.is_file() or not SNAP_COHORT_SUMMARY.is_file() or not SNAP_OBSERVATIONS.is_file():
        raise RuntimeError("Snap cohort outputs are missing; run the LP snap cohort builder first")
    with SNAP_COHORT_SUMMARY.open(encoding="utf-8") as f:
        cohort_summary = json.load(f)
    if cohort_summary["weeksScanned"] != [1, 2, 3, 4, 5] or cohort_summary["weeksReserved"] != [6, 7, 8, 9]:
        raise RuntimeError("Snap cohort does not have the approved week boundaries")
    with SNAP_MANIFEST.open(newline="", encoding="utf-8") as f:
        manifest_rows = list(csv.DictReader(f))
    if len(manifest_rows) != cohort_summary["includedTotal"]:
        raise RuntimeError("Snap cohort manifest count disagrees with its build summary")
    for row in manifest_rows:
        if int(row["week"]) not in (1, 2, 3, 4, 5) or int(row["players_total"]) != 22:
            raise RuntimeError(f"Invalid snap cohort manifest row: {row['game_id']}/{row['play_id']}")

    output_rows = []
    process = open_predictor()
    n_observations = 0
    try:
        with gzip.open(SNAP_OBSERVATIONS, "rt", encoding="utf-8") as f:
            for line in f:
                record = json.loads(line)
                n_observations += 1
                snap = int(record["snapFrame"])
                if record["inputFrameIds"] != list(range(snap - 5, snap + 1)):
                    raise RuntimeError(f"Invalid as-of input span in {record['gameId']}/{record['playId']}")
                if record["labelFrameIds"] != list(range(snap, snap + 11)):
                    raise RuntimeError(f"Invalid scoring span in {record['gameId']}/{record['playId']}")
                if len(record["players"]) != 22 or len(record["footballLabelsM"]) != 11:
                    raise RuntimeError(f"Incomplete observable labels in {record['gameId']}/{record['playId']}")
                request = {
                    "id": f"w{record['week']}-{record['gameId']}-{record['playId']}",
                    "week": record["week"], "gameId": record["gameId"], "playId": record["playId"],
                    "sampleTimes": [0.0, 0.5, 1.0],
                    "players": [{
                        "nflId": actor["nflId"], "team": actor["team"], "role": actor["role"],
                        "position": actor["position"], "weightKg": actor["weightKg"],
                        "inputPositionsM": actor["inputPositionsM"],
                    } for actor in record["players"]],
                }
                prediction = predict_one(process, request)
                if prediction["id"] != request["id"]:
                    raise RuntimeError(f"Snap prediction key mismatch for {request['id']}")
                output_rows.extend(snap_play_metrics(record, prediction))
    finally:
        close_predictor(process)
    if n_observations != len(manifest_rows):
        raise RuntimeError(f"Observation rows {n_observations} != manifest rows {len(manifest_rows)}")

    metric_names = tuple(output_rows[0]["models"][MODEL_NAMES[0]].keys())
    summary = {
        "nPlays": n_observations,
        "perWeek": cohort_summary["includedByWeek"],
        "metrics": {},
    }
    for horizon, _ in SNAP_HORIZONS:
        horizon_rows = [row for row in output_rows if row["horizonSeconds"] == horizon]
        summary["metrics"][str(horizon)] = {}
        for model in MODEL_NAMES:
            summary["metrics"][str(horizon)][model] = {
                metric: aggregate_metric(horizon_rows, model, metric)
                for metric in metric_names
            }
        summary["metrics"][str(horizon)]["pairedVsConstantVelocity"] = {
            model: {
                metric: paired_summary(
                    horizon_rows, model, "constantVelocity", metric,
                    smaller_is_better=metric != "nearestDefenderIdentityAgreement",
                )
                for metric in (
                    "positionMaeM", "velocityVectorMaeMps", "speedChangeMaeMps", "spacingPairMaeM",
                    "snapNearestPairDistanceMaeM", "nearestDefenderDistanceMaeM",
                    "nearestDefenderIdentityAgreement", "meanTeamCentroidDisplacementErrorM",
                    "teamCentroidVelocityErrorMps", "interTeamCentroidSeparationErrorM",
                )
            }
            for model in MODEL_NAMES[1:]
        }
    return output_rows, summary, cohort_summary


def flatten_event_rows(rows):
    fields = ["sampleId", "week", "gameId", "playId", "split", "observedMinimumAtOrigin"]
    metrics = (
        "carrierPositionMaeM", "defenderPositionMaeM", "positionMaeM", "separationMaeM",
        "eventSeparationAbsErrorM", "eventSeparationSignedErrorM", "minimumSeparationAbsErrorM",
        "minimumSeparationSignedErrorM", "minimumTimeAbsErrorSeconds", "observedMinimumSeparationM",
        "predictedMinimumSeparationM", "observedMinimumTimeSeconds", "predictedMinimumTimeSeconds",
        "predictedMinimumAtOrigin",
    )
    fields += [f"{model}_{metric}" for model in MODEL_NAMES for metric in metrics]
    flat = []
    for row in rows:
        item = {k: row[k] for k in ("sampleId", "week", "gameId", "playId", "split", "observedMinimumAtOrigin")}
        for model in MODEL_NAMES:
            item.update({f"{model}_{metric}": row["models"][model][metric] for metric in metrics})
        flat.append(item)
    return flat, fields


def flatten_snap_rows(rows):
    fields = ["week", "gameId", "playId", "horizonSeconds"]
    metrics = tuple(rows[0]["models"][MODEL_NAMES[0]].keys())
    fields += [f"{model}_{metric}" for model in MODEL_NAMES for metric in metrics]
    flat = []
    for row in rows:
        item = {k: row[k] for k in ("week", "gameId", "playId", "horizonSeconds")}
        for model in MODEL_NAMES:
            item.update({f"{model}_{metric}": row["models"][model][metric] for metric in metrics})
        flat.append(item)
    return flat, fields


def fmt(value, digits=3):
    return "—" if value is None else f"{value:.{digits}f}"


def event_report_table(summary):
    lines = [
        "| Model | Position MAE (m), mean / median | Separation MAE (m), mean / median | Event separation MAE (m), mean / median | Origin was full-window predicted min | Origin-excluded min error (m), median |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for model, label in (("constantVelocity", "Constant velocity"),
                         ("constantAcceleration", "Constant acceleration"),
                         ("boundedAcceleration", "Bounded acceleration"),
                         ("locomotionController", "Existing locomotion controller")):
        m = summary["models"][model]
        n = summary["nDevelopmentPlays"]
        origin_count = m["fullWindowMinimumAtOriginCount"]
        share = origin_count / n if n else 0
        lines.append(
            f"| {label} | {fmt(m['positionMaeM']['mean'])} / {fmt(m['positionMaeM']['median'])} "
            f"| {fmt(m['separationMaeM']['mean'])} / {fmt(m['separationMaeM']['median'])} "
            f"| {fmt(m['eventSeparationAbsErrorM']['mean'])} / {fmt(m['eventSeparationAbsErrorM']['median'])} "
            f"| {origin_count}/{n} ({share:.1%}) | {fmt(m['minimumSeparationAbsErrorM']['median'])} |"
        )
    return lines


def paired_report_table(summary):
    lines = [
        "| Model vs constant velocity | Position MAE: mean paired Δ / improved plays | Separation MAE: mean paired Δ / improved plays | Event separation MAE: mean paired Δ / improved plays |",
        "| --- | ---: | ---: | ---: |",
    ]
    for model, label in (("constantAcceleration", "Constant acceleration"),
                         ("boundedAcceleration", "Bounded acceleration"),
                         ("locomotionController", "Existing locomotion controller")):
        paired = summary["pairedVsConstantVelocity"][model]
        cells = []
        for metric in ("positionMaeM", "separationMaeM", "eventSeparationAbsErrorM"):
            p = paired[metric]
            cells.append(f"{fmt(p['meanDeltaVsBaseline'])} m / {p['improvementShare']:.1%}")
        lines.append(f"| {label} | {cells[0]} | {cells[1]} | {cells[2]} |")
    return lines


def snap_report_tables(summary):
    sections = []
    for horizon, _ in SNAP_HORIZONS:
        metrics = summary["metrics"][str(horizon)]
        lines = [
            f"### {horizon:.1f} s",
            "",
            "| Model | Position MAE (m) | Velocity vector MAE (m/s) | Spacing pair MAE (m) | Nearest defender distance MAE (m) | Nearest defender ID agreement | Team centroid displacement error (m) |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        labels = {
            "constantVelocity": "Constant velocity",
            "constantAcceleration": "Constant acceleration",
            "boundedAcceleration": "Bounded acceleration",
            "locomotionController": "Existing locomotion controller",
        }
        for model in MODEL_NAMES:
            row = metrics[model]
            lines.append(
                f"| {labels[model]} | {fmt(row['positionMaeM']['mean'])} | {fmt(row['velocityVectorMaeMps']['mean'])} "
                f"| {fmt(row['spacingPairMaeM']['mean'])} | {fmt(row['nearestDefenderDistanceMaeM']['mean'])} "
                f"| {fmt(row['nearestDefenderIdentityAgreement']['mean'] * 100, 1)}% "
                f"| {fmt(row['meanTeamCentroidDisplacementErrorM']['mean'])} |"
            )
        sections.extend(lines)
        sections.append("")
        paired = metrics["pairedVsConstantVelocity"]
        sections += [
            "| Model vs constant velocity | Position MAE: mean paired Δ / improved plays | Spacing MAE: mean paired Δ / improved plays | Velocity error: mean paired Δ / improved plays | Team centroid error: mean paired Δ / improved plays |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for model in MODEL_NAMES[1:]:
            cells = []
            for metric in ("positionMaeM", "spacingPairMaeM", "velocityVectorMaeMps", "meanTeamCentroidDisplacementErrorM"):
                p = paired[model][metric]
                unit = "m/s" if metric == "velocityVectorMaeMps" else "m"
                cells.append(f"{fmt(p['meanDeltaVsBaseline'])} {unit} / {p['improvementShare']:.1%}")
            sections.append(f"| {model} | {cells[0]} | {cells[1]} | {cells[2]} | {cells[3]} |")
        sections += [
            "",
            f"Mean speed above 9 m/s: " + "; ".join(
                f"{model} {metrics[model]['predictedSpeedOver9mpsShare']['mean']:.1%}" for model in MODEL_NAMES
            ) + ".",
            f"Mean predicted lateral acceleration above 6.5 m/s²: " + "; ".join(
                f"{model} {metrics[model]['predictedLateralAccelerationOver6p5Share']['mean']:.1%}" for model in MODEL_NAMES
            ) + ".",
            "",
        ]
    return sections


def write_report(path, event_summary, snap_summary, cohort_summary, provenance):
    lines = [
        "# Observed football movement review: fair baselines and snap cohort",
        "",
        "**Decision:** Movement results are descriptive trajectory evidence. They do not establish better tackle probabilities, yards, scoring, play outcomes, drive results, or game forecasts. No movement policy or production solver is adopted here.",
        "",
        "## A. Event-centered 40-play diagnostic",
        "",
        "This preserves the 40-play development population and the previous exploratory artifacts. The frozen 49-row LP manifest was read-only and its published hash was checked before scoring. Forecast origin remains tackle-event frame − 5, and multi-credit focal defender identity remains the nearest eventually credited defender at the event; this is a hindsight-defined conditional diagnostic.",
        "",
        "All four arms receive the same six positions ending at the prediction origin. Velocity and acceleration are derived from those same five 10 Hz intervals. Constant velocity ignores the acceleration estimate; constant acceleration extrapolates it; bounded acceleration clips its magnitude to the smaller of 6.5 m/s² and 1100 N / listed mass; the existing `Player.locomote()` controller receives the same acceleration proposal with its original 0.12 s response and pinned source code. Scoring uses only future samples 0.1–0.5 s; the exactly anchored origin is excluded from position and separation errors.",
        "",
        *event_report_table(event_summary),
        "",
        "Paired per-play differences versus constant velocity (negative is lower error):",
        "",
        *paired_report_table(event_summary),
        "",
        "Minimum separation and timing are recomputed only over 0.1–0.5 s. The last column above is the median absolute difference between predicted and observed minima on that origin-excluded window. The origin-minimum count reports how often including time zero would have selected the anchored starting separation. Event separation error is reported as absolute error; signed error is retained in the per-play CSV.",
        "",
        "## B. Snap-anchored all-player cohort",
        "",
        f"The independent cohort contains **{snap_summary['nPlays']:,} plays** from weeks 1–5: " + ", ".join(
            f"week {week}: {count:,}" for week, count in sorted(snap_summary["perWeek"].items(), key=lambda item: int(item[0]))
        ) + ". Weeks 6–9 remain reserved and were not scanned by this run.",
        "",
        "Eligibility uses a unique `ball_snap` frame, pre-snap play metadata, the 11/11 offense/defense split, and tracking-row presence for all 22 players and the football from snap−0.5 s through snap+1.0 s. Each prediction receives only each player's six positions from snap−0.5 s through the snap, plus listed roster mass for the controller. No future coordinates, football track, play outcomes, tackle frame, tackler credit, or drive outcomes enter the model request. The football is retained as an observable label; these four player-motion arms do not forecast it.",
        "",
        "Constant acceleration and bounded acceleration use the same position-history-derived velocity and acceleration as the other arms. Bounded acceleration applies the fixed 6.5 m/s² / 1100 N-per-mass limit. The existing controller source and reference settings are unchanged. No parameters were fit on this cohort.",
        "",
        *snap_report_tables(snap_summary),
        "",
        "Spacing MAE averages absolute pair-distance error over all 55 within-offense and 55 within-defense pairs per play. The frozen snap-nearest relationship is defined from positions at the prediction origin; its paired distance error is retained in the metrics JSON. Nearest-defender ID agreement compares each offense player's predicted nearest defender at the horizon with the observed nearest defender. Team movement uses offense and defense centroid displacement and centroid velocity errors. The metrics JSON and per-play CSV also report speed changes, turn-angle error, inter-team centroid separation, speed-cap exceedance, and lateral-acceleration exceedance.",
        "",
        "## Outcome boundary and decision",
        "",
        "Play outcomes and drive outcomes are separate evaluation targets and were not scored here. This movement-only comparison cannot establish a change in tackle probability, yards gained, scoring, drive success, or game forecasts. A future sequence evaluation must use its own outcome labels, prediction origin, inputs, and scoring unit; play-level and drive-level results must remain separate.",
        "",
        "No more sophisticated movement policy is justified for adoption by these descriptive development results alone. Keep the four arms as research baselines, preserve weeks 6–9 for the later held-out comparison, and make no production, solver, or Madden-calibration change. Any future complexity decision should be based on paired gains at the snap horizon in the reserved weeks, together with the movement metrics relevant to its intended use.",
        "",
        "## Files and provenance",
        "",
        "- `event-centered-per-play.csv`: paired 40-play errors for all four models.",
        "- `event-centered-summary.json`: paired aggregates and origin-excluded minimum-separation statistics.",
        "- `snap-anchored-per-play.csv`: per-play, per-model metrics at 0.5 and 1.0 s.",
        "- `snap-anchored-summary.json`: aggregate metrics and paired comparisons against constant velocity.",
        "",
        f"- M4d analysis checkout at run: `{provenance['m4dCommitAtRun']}`.",
        f"- LP tracking checkout at run: `{provenance['lpCommitAtRun']}`.",
        f"- Locomotion source commit: `{provenance['engine']['sourceCommit']}`; `world.js` SHA-256 `{provenance['engine']['worldJsSha256']}`.",
        f"- Existing 49-row tackle manifest SHA-256: `{provenance['tackleManifestSha256']}` (unchanged).",
        f"- Reused prior 40-play observation file SHA-256: `{provenance['oldComparisonJsonSha256']}`.",
        f"- Snap manifest SHA-256: `{provenance['snapManifestSha256']}`; cohort builder summary SHA-256 `{provenance['snapSummarySha256']}`.",
        f"- Snap cohort builder SHA-256: `{provenance['snapBuilderSha256']}`.",
        f"- Movement runner SHA-256: `{provenance['movementRunnerSha256']}`; analysis script SHA-256 `{provenance['analysisScriptSha256']}`.",
        "- Tracking source: unofficial mirror of the 2022 season data distributed for Big Data Bowl 2025; staged input hashes are recorded in the LP cohort summary. Rights remain user-reported, not independently certified.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    if OUT.exists():
        raise FileExistsError(f"Refusing to overwrite prior evidence: {OUT}")
    legacy = load_legacy_module()
    event_cases, engine, _, old_comparison_hash = prepare_event_diagnostic(legacy)
    event_rows, event_summary = score_event_diagnostic(event_cases)
    snap_rows, snap_summary, cohort_summary = score_snap_cohort()

    OUT.mkdir(parents=True)
    event_flat, event_fields = flatten_event_rows(event_rows)
    write_csv(OUT / "event-centered-per-play.csv", event_flat, event_fields)
    (OUT / "event-centered-summary.json").write_text(json.dumps(event_summary, indent=2) + "\n", encoding="utf-8")
    snap_flat, snap_fields = flatten_snap_rows(snap_rows)
    write_csv(OUT / "snap-anchored-per-play.csv", snap_flat, snap_fields)
    (OUT / "snap-anchored-summary.json").write_text(json.dumps(snap_summary, indent=2) + "\n", encoding="utf-8")

    provenance = {
        "m4dCommitAtRun": subprocess.run(["git", "-C", str(HERE), "rev-parse", "HEAD"],
                                         capture_output=True, text=True, check=True).stdout.strip(),
        "lpCommitAtRun": subprocess.run(["git", "-C", str(LP_ROOT), "rev-parse", "HEAD"],
                                        capture_output=True, text=True, check=True).stdout.strip(),
        "engine": engine,
        "oldComparisonJsonSha256": old_comparison_hash,
        "tackleManifestSha256": digest(TACKLE_MANIFEST),
        "snapManifestSha256": digest(SNAP_MANIFEST),
        "snapSummarySha256": digest(SNAP_COHORT_SUMMARY),
        "snapBuilderSha256": digest(LP_ROOT / "scripts/bdb2025/snap_cohort_build.py"),
        "movementRunnerSha256": digest(NODE_RUNNER),
        "analysisScriptSha256": digest(Path(__file__)),
    }
    (OUT / "provenance.json").write_text(json.dumps({
        "provenance": provenance,
        "referencePhysics": REFERENCE,
        "eventCentered": event_summary,
        "snapAnchored": snap_summary,
        "snapCohortCountsByWeek": cohort_summary["countsByWeek"],
        "sourceHashesFromStagedManifest": cohort_summary["sourceSha256FromStagedManifest"],
    }, indent=2) + "\n", encoding="utf-8")
    write_report(OUT / "report.md", event_summary, snap_summary, cohort_summary, provenance)
    print(json.dumps({
        "output": str(OUT),
        "eventDevelopmentPlays": event_summary["nDevelopmentPlays"],
        "snapPlays": snap_summary["nPlays"],
        "snapPerWeek": snap_summary["perWeek"],
        "decision": "no adoption; retain as research baselines pending weeks 6-9 holdout",
    }, indent=2))


if __name__ == "__main__":
    main()
