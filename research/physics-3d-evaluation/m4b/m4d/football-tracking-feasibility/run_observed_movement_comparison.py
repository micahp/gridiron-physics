#!/usr/bin/env python3
"""Read-only, conditional movement comparison for frozen BDB2025 tackle IDs."""

import csv
import hashlib
import html
import io
import json
import math
import os
import statistics
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "observed-tackle-movement-2026-10-24"
DATA = Path(os.environ.get("BDB2025_ROOT", "/root/nfl-tracking-data/bdb2025"))
ENGINE = Path(os.environ.get("GRIDIRON_PHYSICS_ROOT", "/root/gridiron-physics"))
MANIFEST = Path(os.environ.get("BDB2025_TACKLE_MANIFEST", "/root/lp-nfl-tracking/docs/research/bdb2025-observed-tackle-manifest-v1.csv"))
WEEKS = (1, 2, 3, 4, 5)  # weeks 6-9 remain outside this descriptive sample
YARDS_TO_METERS, TRACK_DT = 0.9144, 0.1
ORIGIN_OFFSET, HISTORY_INTERVALS, HORIZON = 5, 5, 0.5
REFERENCE = {"vmaxMps": 9.0, "f0N": 1100.0, "lateralAccelerationMps2": 6.5,
             "frictionCoefficient": 0.95, "responseSeconds": 0.12, "carrierSpeedCapFactor": 0.97}
ENGINE_COMMIT = "a09329185451faad44ef7453c7c47bea9d7253a4"
WORLD_SHA = "bc82736164fcd06fffd379efea5b71f6a1373b3dadeb27fe5fa3c1be0f9c0dac"
CONSTANTS_SHA = "98c39f0e2c9deaf4ed390f5f11546de4556642b65c1e10011b4dbeacb132b498"


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def source_manifest():
    out = {}
    for line in (DATA / "SHA256SUMS.txt").read_text().splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            out[parts[1].lstrip("* ")] = parts[0]
    return out


def engine_provenance():
    world = ENGINE / "engine" / "world.js"
    constants = ENGINE / "engine" / "constants.js"
    wh, ch = digest(world), digest(constants)
    if (wh, ch) != (WORLD_SHA, CONSTANTS_SHA):
        raise RuntimeError("Pinned movement-controller source hash mismatch")
    return {"sourceCommit": ENGINE_COMMIT, "worldJsSha256": wh, "constantsJsSha256": ch,
            "checkout": str(ENGINE)}


def load_tables():
    base = DATA / "code-data"
    with (base / "plays.csv").open(newline="", encoding="utf-8") as f:
        plays = {(r["gameId"], r["playId"]): r for r in csv.DictReader(f)}
    with (base / "players.csv").open(newline="", encoding="utf-8") as f:
        players = {r["nflId"]: r for r in csv.DictReader(f)}
    play_players = defaultdict(list)
    with (base / "player_play.csv").open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            play_players[(r["gameId"], r["playId"])].append(r)
    return plays, players, play_players


def defender_labels(rows, defensive_team):
    out = []
    for r in rows:
        flags = {k: r.get(k, "0") == "1" for k in ("soloTackle", "tackleAssist", "assistedTackle")}
        if r["teamAbbr"] == defensive_team and any(flags.values()):
            out.append({"nflId": r["nflId"], "team": r["teamAbbr"], "flags": flags})
    return out


def select_sample(plays, play_players, manifest_rows):
    if not MANIFEST.is_file():
        raise RuntimeError(f"Frozen tackle manifest not found: {MANIFEST}")
    selected = []
    seen = set()
    for row in manifest_rows:
        if row.get("included", "").lower() != "true":
            continue
        week = int(row["week"])
        key = (row["game_id"], row["play_id"])
        if week not in WEEKS or row["split"] not in ("exploratory_visual", "development"):
            raise RuntimeError(f"Manifest includes a prohibited split/week: {row['split']} week {week}")
        if key in seen:
            raise RuntimeError(f"Duplicate included play in frozen manifest: {key}")
        seen.add(key)
        play, rows = plays.get(key), play_players.get(key, [])
        if not play:
            raise RuntimeError(f"Manifest play missing from plays.csv: {key}")
        carrier_ids = {r["nflId"] for r in rows if r.get("hadRushAttempt") == "1" or r.get("hadPassReception") == "1"}
        labels = defender_labels(rows, play.get("defensiveTeam", ""))
        credited_ids = sorted(x for x in row["credited_ids"].split(";") if x)
        label_ids = sorted(x["nflId"] for x in labels)
        if len(carrier_ids) != 1 or next(iter(carrier_ids)) != row["carrier_id"]:
            raise RuntimeError(f"Manifest carrier does not match player_play.csv for {key}")
        if credited_ids != label_ids:
            raise RuntimeError(f"Manifest credited defenders do not match player_play.csv for {key}: {credited_ids} vs {label_ids}")
        if not row.get("tackle_frame"):
            raise RuntimeError(f"Included manifest play has no tackle frame: {key}")
        selected.append({"week": week, "gameId": key[0], "playId": key[1],
            "sampleId": f"w{week}-{key[0]}-{key[1]}", "split": row["split"],
            "visualLabel": row.get("visual_label", ""), "identityConfidence": row["identity_confidence"],
            "manifestTackleFrame": int(row["tackle_frame"]), "carrierId": row["carrier_id"],
            "creditedIds": credited_ids, "defenderLabels": labels, "play": play})
    if not selected:
        raise RuntimeError("Frozen manifest has no included plays in the permitted weeks/splits")
    return selected


def read_selected_rows(week, cases):
    path = DATA / "code-data" / f"tracking_week_{week}.csv"
    patterns = sorted({f'{x["gameId"]},{x["playId"]},' for x in cases})
    command = ["rg", "--no-line-number", "--no-filename", "--fixed-strings"]
    for pattern in patterns:
        command.extend(("-e", pattern))
    command.append(str(path))
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"Tracking filter failed: {result.stderr.strip()}")
    with path.open(encoding="utf-8") as f:
        header = f.readline()
    keys = {(x["gameId"], x["playId"]) for x in cases}
    rows = []
    for row in csv.DictReader(io.StringIO(header + result.stdout)):
        if (row["gameId"], row["playId"]) in keys:
            rows.append(row)
    return rows


def vsub(a, b):
    return [a[0]-b[0], a[1]-b[1]]


def norm(a):
    return math.hypot(a[0], a[1])


def lin_slope(times, values):
    mt, mv = statistics.mean(times), statistics.mean(values)
    return sum((t-mt)*(v-mv) for t, v in zip(times, values)) / sum((t-mt)**2 for t in times)


def decorate_case(case, rows, players):
    event_frames = {int(r["frameId"]) for r in rows if r["event"] == "tackle"}
    if len(event_frames) != 1:
        raise RuntimeError(f"{case['sampleId']}: expected one tackle-event frame, found {sorted(event_frames)}")
    event = case["eventFrame"] = next(iter(event_frames))
    if event != case["manifestTackleFrame"]:
        raise RuntimeError(f"{case['sampleId']}: tracking event frame {event} != frozen manifest tackle frame {case['manifestTackleFrame']}")
    positions = defaultdict(dict)
    event_entities = 0
    for r in rows:
        pid, frame = r["nflId"], int(r["frameId"])
        event_entities += int(r["event"] == "tackle" and frame == event)
        if pid in ("", "NA") or not event-10 <= frame <= event:
            continue
        positions[pid][frame] = {"p": [float(r["x"])*YARDS_TO_METERS, float(r["y"])*YARDS_TO_METERS],
                                 "club": r["club"], "name": r["displayName"]}
    carrier_id = case["carrierId"]
    if carrier_id not in positions or event not in positions[carrier_id]:
        raise RuntimeError(f"{case['sampleId']}: missing carrier track")
    labeled_ids = [pid for pid in case["creditedIds"] if event in positions.get(pid, {})]
    if not labeled_ids:
        raise RuntimeError(f"{case['sampleId']}: no player_play-credited defender track at event")
    if len(labeled_ids) == 1:
        focal = labeled_ids[0]
        focal_rule = "sole player_play-credited tackler"
    else:
        cpos = positions[carrier_id][event]["p"]
        focal = min(labeled_ids, key=lambda pid: norm(vsub(positions[pid][event]["p"], cpos)))
        focal_rule = "nearest player_play-credited tackler at tackle-event frame (conditional post-event choice)"

    case["focalDefenderId"], case["focalDefenderRule"] = focal, focal_rule
    case["allLabeledDefenderIds"] = labeled_ids
    case["eventRowsAtFrame"] = event_entities
    case["playDescription"] = case["play"].get("playDescription", "")
    case["carrierName"], case["defenderName"] = players[carrier_id]["displayName"], players[focal]["displayName"]
    case["actorData"] = {}
    for role, pid in (("carrier", carrier_id), ("defender", focal)):
        frames = list(range(event-10, event+1))
        if any(frame not in positions[pid] for frame in frames):
            raise RuntimeError(f"{case['sampleId']}: incomplete 1.0 s track for {pid}")
        path = [positions[pid][frame]["p"] for frame in frames]
        velocity_samples = [vsub(path[i+1], path[i]) for i in range(HISTORY_INTERVALS)]
        velocity_samples = [[v[0]/TRACK_DT, v[1]/TRACK_DT] for v in velocity_samples]
        times = [-0.45 + i*TRACK_DT for i in range(HISTORY_INTERVALS)]
        acceleration = [lin_slope(times, [v[axis] for v in velocity_samples]) for axis in (0, 1)]
        mass_kg = float(players[pid]["weight"]) * 0.45359237
        case["actorData"][role] = {
            "id": pid, "name": players[pid]["displayName"], "team": positions[pid][event]["club"],
            "massKg": mass_kg, "hasBall": role == "carrier", "fullPathM": path,
            "observedPredictionPathM": path[5:], "originM": path[5],
            "velocityMps": velocity_samples[4], "accelerationProposalMps2": acceleration,
        }
    case["observedSeparationFullM"] = [norm(vsub(a, b)) for a, b in zip(
        case["actorData"]["carrier"]["fullPathM"], case["actorData"]["defender"]["fullPathM"])]
    case["observedSeparationForecastM"] = case["observedSeparationFullM"][5:]
    return case


def run_controller(cases):
    payload = {"referencePhysics": REFERENCE, "cases": [{"id": c["sampleId"], "actors": {
        role: {k: actor[k] for k in ("id", "team", "originM", "velocityMps", "accelerationProposalMps2", "massKg", "hasBall")}
        for role, actor in c["actorData"].items()}} for c in cases]}
    runner = HERE / "run_locomotion_baseline.mjs"
    proc = subprocess.run(["node", str(runner)], input=json.dumps(payload), text=True, capture_output=True,
                          env={**os.environ, "GRIDIRON_PHYSICS_ROOT": str(ENGINE)}, check=False)
    if proc.returncode:
        raise RuntimeError(f"Locomotion runner failed: {proc.stderr.strip()}")
    return {x["id"]: x["actors"] for x in json.loads(proc.stdout)["output"]}


def evaluate(case, controller):
    times = [0, .1, .2, .3, .4, .5]
    case["timesFromOriginSeconds"] = times
    case["models"] = {"constantVelocity": {}, "locomotionController": {}}
    for role, actor in case["actorData"].items():
        p, v = actor["originM"], actor["velocityMps"]
        case["models"]["constantVelocity"][role] = [[p[0]+v[0]*t, p[1]+v[1]*t] for t in times]
        case["models"]["locomotionController"][role] = [row["p"] for row in controller[case["sampleId"]][role]]
    obs_sep = case["observedSeparationForecastM"]
    separations = {"observed": obs_sep}
    for model in ("constantVelocity", "locomotionController"):
        separations[model] = [norm(vsub(a, b)) for a, b in zip(
            case["models"][model]["carrier"], case["models"][model]["defender"])]
    case["separationModelsM"] = separations
    observed_min = min(obs_sep)
    observed_tmin = times[obs_sep.index(observed_min)]
    case["metrics"] = {"observedSeparationAtOriginM": obs_sep[0], "observedSeparationAtEventM": obs_sep[-1], "models": {}}
    for model in ("constantVelocity", "locomotionController"):
        actor_errors = {}
        for role, actor in case["actorData"].items():
            actual = actor["observedPredictionPathM"]
            pred = case["models"][model][role]
            actor_errors[role] = [distance(a, b) for a, b in zip(actual, pred)]
        sep_err = [abs(a-b) for a, b in zip(obs_sep, separations[model])]
        pred_sep = separations[model]
        predicted_min = min(pred_sep)
        predicted_tmin = times[pred_sep.index(predicted_min)]
        case["metrics"]["models"][model] = {
            "carrierPositionRmseM": math.sqrt(statistics.mean(x*x for x in actor_errors["carrier"])),
            "defenderPositionRmseM": math.sqrt(statistics.mean(x*x for x in actor_errors["defender"])),
            "separationRmseM": math.sqrt(statistics.mean(x*x for x in sep_err)),
            "eventSeparationErrorM": pred_sep[-1]-obs_sep[-1],
            "observedMinimumSeparationM": observed_min,
            "observedTimeOfMinimumSecondsAfterOrigin": observed_tmin,
            "minimumPredictedSeparationM": predicted_min,
            "timeOfMinimumSecondsAfterOrigin": predicted_tmin,
            "minimumSeparationErrorM": predicted_min-observed_min,
            "timeOfMinimumErrorSeconds": predicted_tmin-observed_tmin,
            "predictedClosingSpeedMps": (pred_sep[0]-pred_sep[-1])/HORIZON,
        }
        case.setdefault("positionErrorsM", {})[model] = actor_errors
        case.setdefault("separationAbsErrorsM", {})[model] = sep_err
    return case


def distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])


def aggregate(cases):
    fields = ("carrierPositionRmseM", "defenderPositionRmseM", "separationRmseM", "eventSeparationErrorM",
              "minimumPredictedSeparationM", "timeOfMinimumSecondsAfterOrigin", "minimumSeparationErrorM",
              "timeOfMinimumErrorSeconds", "predictedClosingSpeedMps")
    result = {}
    for model in ("constantVelocity", "locomotionController"):
        result[model] = {}
        for field in fields:
            values = [c["metrics"]["models"][model][field] for c in cases]
            result[model][field] = {"mean": statistics.mean(values), "median": statistics.median(values)}
    return result


def xy_chart(case):
    carrier, defender = case["actorData"]["carrier"], case["actorData"]["defender"]
    c0 = carrier["observedPredictionPathM"][0]
    v = carrier["velocityMps"]
    speed = norm(v)
    if speed < .2:
        v = vsub(carrier["observedPredictionPathM"][-1], c0)
        speed = norm(v)
    forward = [v[0]/max(speed, 1e-8), v[1]/max(speed, 1e-8)]
    left = [-forward[1], forward[0]]
    def transform(p):
        d = vsub(p, c0)
        return [d[0]*forward[0]+d[1]*forward[1], d[0]*left[0]+d[1]*left[1]]
    lines = []
    for role, color in (("carrier", "#1769aa"), ("defender", "#bd3b35")):
        lines.append((f"{role} observed", color, "", [transform(p) for p in case["actorData"][role]["fullPathM"]]))
        for model, dash in (("constantVelocity", "7 4"), ("locomotionController", "2 4")):
            lines.append((f"{role} {model}", color, dash, [transform(p) for p in case["models"][model][role]]))
    pts = [p for _, _, _, path in lines for p in path]
    xmin, xmax = min(p[0] for p in pts)-.3, max(p[0] for p in pts)+.3
    ymin, ymax = min(p[1] for p in pts)-.3, max(p[1] for p in pts)+.3
    return svg("relative XY paths (m)", lines, xmin, xmax, ymin, ymax, "forward", "lateral", 680, 240)


def separation_chart(case):
    series = [
        ("observed", "#26834a", "", list(zip([-1+i*.1 for i in range(11)], case["observedSeparationFullM"]))),
        ("constant velocity", "#1769aa", "7 4", list(zip([-.5+i*.1 for i in range(6)], case["separationModelsM"]["constantVelocity"]))),
        ("existing locomotion response", "#c46a15", "2 4", list(zip([-.5+i*.1 for i in range(6)], case["separationModelsM"]["locomotionController"]))),
    ]
    vals = [p[1] for _, _, _, points in series for p in points]
    return svg("carrier–defender separation", series, -1, 0, max(0, min(vals)-.2), max(vals)+.2,
               "seconds relative to event", "centre separation (m)", 680, 240, vline=0)


def svg(title, series, xmin, xmax, ymin, ymax, xlabel, ylabel, width, height, vline=None):
    left, top, right, bottom = 56, 30, 12, 36
    pw, ph = width-left-right, height-top-bottom
    out = [f'<svg viewBox="0 0 {width} {height}" role="img"><text x="{width/2}" y="18" text-anchor="middle" class="charttitle">{html.escape(title)}</text>',
           f'<rect x="{left}" y="{top}" width="{pw}" height="{ph}" fill="white" stroke="#aab5bf"/>']
    for i in range(5):
        f = i/4; x = left+f*pw; y = top+f*ph
        xv = xmin+f*(xmax-xmin); yv = ymax-f*(ymax-ymin)
        out += [f'<line x1="{x}" y1="{top}" x2="{x}" y2="{top+ph}" stroke="#e5e9ed"/>',
                f'<line x1="{left}" y1="{y}" x2="{left+pw}" y2="{y}" stroke="#e5e9ed"/>',
                f'<text x="{x}" y="{top+ph+15}" text-anchor="middle" class="tick">{xv:.1f}</text>',
                f'<text x="{left-5}" y="{y+3}" text-anchor="end" class="tick">{yv:.2f}</text>']
    if vline is not None:
        x = left+(vline-xmin)/(xmax-xmin)*pw
        out.append(f'<line x1="{x}" y1="{top}" x2="{x}" y2="{top+ph}" stroke="#333"/>')
    legends = []
    for name, color, dash, points in series:
        coords = " ".join(f'{left+(x-xmin)/(xmax-xmin)*pw:.1f},{top+ph-(y-ymin)/(ymax-ymin)*ph:.1f}' for x, y in points)
        d = f' stroke-dasharray="{dash}"' if dash else ""
        out.append(f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="2"{d}/>')
        legends.append(f'<span style="color:{color}">{html.escape(name)}</span>')
    out += [f'<text x="{left+pw/2}" y="{height-4}" text-anchor="middle" class="axis">{html.escape(xlabel)}</text>',
            f'<text x="12" y="{top+ph/2}" text-anchor="middle" transform="rotate(-90 12 {top+ph/2})" class="axis">{html.escape(ylabel)}</text>', '</svg>']
    return "".join(out), " · ".join(legends)


def render_html(cases, metrics):
    metric_cases = [c for c in cases if c["split"] == "development"]
    lines = []
    for key, label in (("constantVelocity", "Constant velocity"), ("locomotionController", "Existing locomotion response")):
        m = metrics[key]
        lines.append(f'<tr><td>{label}</td><td>{m["carrierPositionRmseM"]["median"]:.3f}</td><td>{m["defenderPositionRmseM"]["median"]:.3f}</td><td>{m["separationRmseM"]["median"]:.3f}</td><td>{m["eventSeparationErrorM"]["median"]:+.3f}</td></tr>')
    cards = []
    for c in cases:
        path_svg, path_legend = xy_chart(c)
        sep_svg, sep_legend = separation_chart(c)
        cards.append(f'<details class="case"><summary>Week {c["week"]}: {c["gameId"]}/{c["playId"]} · {html.escape(c["split"])} · {html.escape(c["carrierName"])} vs {html.escape(c["defenderName"])}</summary><p>{html.escape(c["visualLabel"])}<br>{html.escape(c["playDescription"])}<br>tackle frame {c["eventFrame"]}; focal defender: {html.escape(c["focalDefenderRule"])}</p><small>{path_legend}<br>{sep_legend}</small><div class="grid">{path_svg}{sep_svg}</div></details>')
    aggregate_lines = []
    times = [0, .1, .2, .3, .4, .5]
    for model, color, dash, label in (("observed", "#26834a", "", "observed"), ("constantVelocity", "#1769aa", "7 4", "constant velocity"), ("locomotionController", "#c46a15", "2 4", "existing controller")):
        vals = []
        for i in range(6):
            sample = [c["observedSeparationForecastM"][i] if model == "observed" else c["separationModelsM"][model][i] for c in metric_cases]
            vals.append(statistics.median(sample))
        aggregate_lines.append((label, color, dash, list(zip(times, vals))))
    all_vals = [y for _, _, _, series in aggregate_lines for _, y in series]
    ag_svg, ag_legend = svg("Median separation during the prediction window", aggregate_lines, 0, .5,
                            max(0, min(all_vals)-.15), max(all_vals)+.15,
                            "seconds from prediction origin", "separation (m)", 900, 300)
    ag_table = "".join(lines)
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Observed tackle movement</title>
<style>body{{font:14px/1.45 system-ui,sans-serif;max-width:1500px;margin:24px auto;padding:0 18px;color:#17212b;background:#f7f9fb}}.box,.case{{background:#fff;border:1px solid #d5dde5;border-radius:8px;padding:14px 18px;margin:14px 0}}.warning{{background:#fff4d4;border-left:5px solid #d49b19;padding:12px 16px}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(500px,1fr));gap:10px}}svg{{width:100%;height:auto}}.charttitle{{font-size:13px;font-weight:650;fill:#253544}}.tick,.axis{{font-size:10px;fill:#596b7a}}table{{border-collapse:collapse;width:100%;margin:8px 0}}th,td{{border:1px solid #d5dde5;padding:5px 8px;text-align:right}}th:first-child,td:first-child{{text-align:left}}th{{background:#eef2f6}}summary{{font-weight:650;cursor:pointer}}small{{color:#425565}}@media(max-width:600px){{.grid{{grid-template-columns:1fr}}}}</style>
<body><h1>Observed tackle movement comparison</h1><p>{len(cases)} manifest-included cases: {sum(c["split"] == "exploratory_visual" for c in cases)} exploratory-visual and {sum(c["split"] == "development" for c in cases)} development plays, weeks 1–5. Holdout weeks 6–9 are not sampled. Prediction origin is 0.5 s before the tackle event.</p>
<div class="warning"><b>Conditional reconstruction only.</b> Every play has a tackle event; the sample has no misses, escapes, or non-tackle opportunities. It cannot estimate tackle-success probability. No tackle outcomes are trained and no grip forces are calibrated. Controller actuation values are fixed generic references, not historical player estimates.</div>
<section class="box"><h2>Development-split summary (n={sum(c["split"] == "development" for c in cases)})</h2>{ag_svg}<small>{ag_legend}</small><table><thead><tr><th>Arm</th><th>Median carrier RMSE (m)</th><th>Median defender RMSE (m)</th><th>Median separation RMSE (m)</th><th>Signed event separation error (m)</th><th>Median minimum separation (m)</th><th>Median time of minimum (s)</th></tr></thead><tbody>{''.join(f'<tr><td>{label}</td><td>{m["carrierPositionRmseM"]["median"]:.3f}</td><td>{m["defenderPositionRmseM"]["median"]:.3f}</td><td>{m["separationRmseM"]["median"]:.3f}</td><td>{m["eventSeparationErrorM"]["median"]:+.3f}</td><td>{m["minimumPredictedSeparationM"]["median"]:.3f}</td><td>{m["timeOfMinimumSecondsAfterOrigin"]["median"]:.2f}</td></tr>' for label, m in (("Constant velocity", metrics["constantVelocity"]), ("Existing locomotion response", metrics["locomotionController"])))}</tbody></table><p>Development metrics are descriptive medians, with fixed generic inputs and no tuning. Exploratory-visual plays are shown per case and excluded from this aggregate.</p></section>
<h2>Per-play paths and separation</h2>{''.join(cards)}
<section class="box"><h2>Reproduce</h2><code>python3 research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/run_observed_movement_comparison.py</code><p>Reads staged local files only. The controller arm uses <code>Player.locomote()</code> from pinned source {ENGINE_COMMIT}; acceleration is estimated from the preceding 0.5 s only and passed through the existing force–velocity, braking, lateral, and traction limits. There is no pursuit AI or contact resolution in this movement-only comparison.</p><p>Reference parameters: {html.escape(json.dumps(REFERENCE))}. Player mass uses the listed 2022 weight; other actuation values are common, uncalibrated inputs.</p></section></body></html>'''


def write_report(provenance, metrics):
    lines = [
        "# Observed tackle movement comparison", "",
        "**Status:** descriptive movement-only comparison; no outcome training or contact resolution.", "",
        "## Sample and method", "",
        f"The comparison uses every manifest row marked included: {provenance['manifest']['includedRows']} plays across weeks 1–5, comprising {provenance['manifest']['includedBySplit'].get('exploratory_visual', 0)} exploratory-visual and {provenance['manifest']['includedBySplit'].get('development', 0)} development plays. Manifest rows marked excluded are omitted; holdout weeks 6–9 are not sampled. The cohort is conditional on recorded tackle events, so it contains no misses, escapes, or non-tackle opportunities and cannot estimate tackle-success probability.", "",
        "The prediction origin is 0.5 s before the event. For each play, the ball carrier and a focal labeled defender start from the same observed positions and velocities. The constant-velocity arm holds the last observed velocity. The controller arm estimates acceleration from five observed velocity samples in the preceding 0.5 s and passes that proposal through the existing `Player.locomote()` response for 0.5 s. The two players move independently; pursuit AI, teammate avoidance, ball handling, collision and tackle logic are disabled.", "",
        f"Reference controller inputs are fixed across players: `vmax={REFERENCE['vmaxMps']} m/s`, `F0={REFERENCE['f0N']} N`, `alat={REFERENCE['lateralAccelerationMps2']} m/s²`, and `μ={REFERENCE['frictionCoefficient']}`. Mass comes from each player's listed 2022 weight. These are generic uncalibrated visualization inputs, not player measurements or Madden rating mappings.", "",
        "## Development-split descriptive metrics", "",
        f"The aggregate below uses only the {provenance['manifest']['includedBySplit'].get('development', 0)} included development plays. The included exploratory-visual plays are shown individually in the HTML and are excluded from aggregate scoring. No inference, model fitting, or parameter tuning was performed. Minimum separation and its timing are selected from the six 0.1 s samples from prediction origin through event; timing is therefore reported at 0.1 s resolution without interpolation.", "",
        "| Arm | Carrier position RMSE (m) | Defender position RMSE (m) | Separation RMSE (m) | Signed separation error at event (m) | Predicted minimum separation (m) | Time of minimum (s after origin) | Minimum-separation error (m) | Timing error (s) | Median predicted closing speed (m/s) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for model, label in (("constantVelocity", "Constant velocity"), ("locomotionController", "Existing locomotion response")):
        m = metrics[model]
        lines.append(f"| {label} | {m['carrierPositionRmseM']['median']:.3f} | {m['defenderPositionRmseM']['median']:.3f} | {m['separationRmseM']['median']:.3f} | {m['eventSeparationErrorM']['median']:+.3f} | {m['minimumPredictedSeparationM']['median']:.3f} | {m['timeOfMinimumSecondsAfterOrigin']['median']:.2f} | {m['minimumSeparationErrorM']['median']:+.3f} | {m['timeOfMinimumErrorSeconds']['median']:+.2f} | {m['predictedClosingSpeedMps']['median']:+.3f} |")
    lines += [
        "", "Open [comparison.html](comparison.html) for per-play trajectories and separation curves. `sample.json` freezes IDs and labels; `comparison.json` contains sampled movement series and metrics.", "",
        "## Interpretation limits", "",
        "This sample consists of recorded tackle events. It is useful for conditional movement reconstruction only; it cannot establish a tackle-success prediction claim. A later success-prediction study needs an opportunity-based cohort containing misses, escapes, and other non-tackle cases.", "",
        "The tracking event is broadcast across entity rows and does not identify the tackler. Carrier and credited defender IDs come from the frozen manifest, reconciled to `player_play.csv`. For multi-tackler plays, the focal defender is the nearest credited tackler at the event frame; that choice is conditional and post-event. No grip force or tackle outcome is inferred.", "",
        "The controller arm reuses the source locomotion response but not the play director's pursuit or carrier path-selection policy. It tests a past-only acceleration proposal under movement limits, not a complete pursuit model. Body orientation and 3D geometry are not modeled.", "",
        "## Provenance and reproduction", "",
        "Run from the M4d checkout: `python3 research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/run_observed_movement_comparison.py`. The script reads staged local files and does not download data.", "",
        f"- Dataset: unofficial `b00nk3r/NFL-Big-Data-Bowl-2025` mirror, commit `e28d3b25725799ef2213680016db5325f6f90014`; 2022 season.",
        f"- Movement source: main commit `{provenance['engine']['sourceCommit']}`, `engine/world.js` SHA-256 `{provenance['engine']['worldJsSha256']}`, `engine/constants.js` SHA-256 `{provenance['engine']['constantsJsSha256']}`.",
        f"- M4d checkout at run: `{provenance['m4dCommitAtRun']}`.",
        f"- Analysis code SHA-256: `{json.dumps(provenance['analysisCodeSha256'], sort_keys=True)}`.",
        f"- Frozen manifest: `{provenance['manifest']['path']}`, source commit `{provenance['manifest']['sourceCommit']}`, SHA-256 `{provenance['manifest']['sha256']}`; {provenance['manifest']['totalRows']} rows total, {provenance['manifest']['includedRows']} included, {provenance['manifest']['excludedRows']} excluded.",
        f"- Included split counts: `{json.dumps(provenance['manifest']['includedBySplit'], sort_keys=True)}`; only weeks 1–5 are included; holdout weeks 6–9 are untouched.",
        f"- Staged source hashes: `{json.dumps(provenance['inputHashesFromStagedManifestOrLocalSha256'], sort_keys=True)}`.",
        "- Rights are user-reported; no license text was independently assessed.", "",
    ]
    (OUT / "report.md").write_text("\n".join(lines))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    engine = engine_provenance()
    plays, players, play_players = load_tables()
    with MANIFEST.open(newline="", encoding="utf-8") as f:
        manifest_rows = list(csv.DictReader(f))
    selected = select_sample(plays, play_players, manifest_rows)
    by_week = {w: [c for c in selected if c["week"] == w] for w in WEEKS}
    cases = []
    for week, week_cases in by_week.items():
        rows = read_selected_rows(week, week_cases)
        grouped = defaultdict(list)
        for row in rows:
            grouped[(row["gameId"], row["playId"])].append(row)
        for c in week_cases:
            c = dict(c)
            c["week"] = week
            cases.append(decorate_case(c, grouped[(c["gameId"], c["playId"])], players))

    movement = run_controller(cases)
    for c in cases:
        evaluate(c, movement)

    file_hashes = source_manifest()
    used = ["code-data/plays.csv", "code-data/player_play.csv", "code-data/players.csv"]
    used += [f"code-data/tracking_week_{w}.csv" for w in WEEKS]
    missing = [x for x in used if x not in file_hashes and not (DATA / x).is_file()]
    if missing:
        raise RuntimeError(f"Missing source files: {missing}")
    input_hashes = {x: file_hashes[x] if x in file_hashes else digest(DATA / x) for x in used}
    manifest_commit = subprocess.run(["git", "-C", str(MANIFEST.parents[2]), "rev-parse", "HEAD"],
                                     capture_output=True, text=True, check=True).stdout.strip()
    included_rows = [r for r in manifest_rows if r.get("included", "").lower() == "true"]
    included_by_split = {split: sum(r["split"] == split for r in included_rows)
                         for split in sorted({r["split"] for r in included_rows})}
    if len(selected) != len(included_rows):
        raise RuntimeError(f"Selected {len(selected)} plays but manifest has {len(included_rows)} included rows")
    development_cases = [c for c in cases if c["split"] == "development"]
    metrics = aggregate(development_cases)
    provenance = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "weeks": list(WEEKS), "cases": len(cases),
        "engine": engine, "m4dCommitAtRun": subprocess.run(["git", "-C", str(HERE), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip(),
        "dataSource": "unofficial b00nk3r/NFL-Big-Data-Bowl-2025 copy, commit e28d3b25725799ef2213680016db5325f6f90014; 2022 season",
        "inputHashesFromStagedManifestOrLocalSha256": {**input_hashes, "tackleManifestCsv": digest(MANIFEST)},
        "manifest": {"path": str(MANIFEST), "sourceCommit": manifest_commit, "sha256": digest(MANIFEST),
                     "totalRows": len(manifest_rows), "includedRows": len(included_rows),
                     "excludedRows": len(manifest_rows)-len(included_rows), "includedBySplit": included_by_split},
        "analysisCodeSha256": {p.name: digest(p) for p in (HERE / "run_observed_movement_comparison.py", HERE / "run_locomotion_baseline.mjs")},
        "referencePhysics": REFERENCE,
        "controller": {"method": "pursuit-independent Player.locomote response; past-only acceleration proposal",
                       "dtSeconds": 1/120, "forecastSeconds": HORIZON, "predictionOrigin": "eventFrame - 5"},
    }
    selection = [{k: c[k] for k in ("week", "gameId", "playId", "sampleId", "split", "visualLabel", "identityConfidence", "carrierId", "creditedIds", "focalDefenderId", "focalDefenderRule", "allLabeledDefenderIds", "eventFrame", "defenderLabels")} for c in cases]
    (OUT / "sample.json").write_text(json.dumps({"provenance": provenance, "cases": selection}, indent=2))
    (OUT / "comparison.json").write_text(json.dumps({"provenance": provenance, "developmentAggregateMetrics": metrics, "cases": cases}, indent=2))
    (OUT / "comparison.html").write_text(render_html(cases, metrics))
    write_report(provenance, metrics)
    result = {"sampleCount": len(cases), "perWeek": {str(w): len(by_week[w]) for w in WEEKS},
              "perSplit": included_by_split,
              "developmentAggregateMetrics": metrics, "outputDirectory": str(OUT), "engineCommit": ENGINE_COMMIT}
    (OUT / "summary.json").write_text(json.dumps({"provenance": provenance, **result}, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
