"""Shared arms and paired statistics for the BDB2025 movement tests.

Every arm takes the same inputs: origin position, origin velocity, and the same five pre-origin velocity
samples, summarised as one acceleration proposal. Nothing here reads a frame after the origin.
"""
import json
import math
import os
import statistics
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNNER = HERE / 'run_locomotion_multi_horizon.mjs'
ENGINE = Path(os.environ.get('GRIDIRON_PHYSICS_ROOT', '/root/gridiron-physics'))
REFERENCE = {"vmaxMps": 9.0, "f0N": 1100.0, "lateralAccelerationMps2": 6.5,
             "frictionCoefficient": 0.95, "responseSeconds": 0.12, "carrierSpeedCapFactor": 0.97}
BOUND_MPS2 = REFERENCE['lateralAccelerationMps2']  # pinned engine alat, not fitted to any player
YD = 0.9144
TIMES = [round(0.1 * k, 1) for k in range(1, 11)]  # 0.1 .. 1.0 s after origin
ARMS = ('constantVelocity', 'constantAcceleration', 'boundedAcceleration', 'locomotionController')
KINEMATIC = ARMS[:3]


def lin_slope(times, values):
    mt, mv = statistics.mean(times), statistics.mean(values)
    return sum((t - mt) * (v - mv) for t, v in zip(times, values)) / sum((t - mt) ** 2 for t in times)


def acceleration_proposal(history_positions):
    """history_positions: six metre positions for frames origin-5..origin. Returns (v0, a)."""
    vel = [[(b[0] - a[0]) / 0.1, (b[1] - a[1]) / 0.1] for a, b in zip(history_positions, history_positions[1:])]
    mid = [-0.45 + 0.1 * i for i in range(len(vel))]
    accel = [lin_slope(mid, [v[axis] for v in vel]) for axis in (0, 1)]
    return vel[-1], accel


def kinematic(p0, v0, a, times, bound=None):
    if bound is not None:
        n = math.hypot(a[0], a[1])
        if n > bound:
            a = [a[0] * bound / n, a[1] * bound / n]
    pos = [[p0[0] + v0[0] * t + 0.5 * a[0] * t * t, p0[1] + v0[1] * t + 0.5 * a[1] * t * t] for t in times]
    vel = [[v0[0] + a[0] * t, v0[1] + a[1] * t] for t in times]
    return pos, vel


def run_locomotion(cases, horizon):
    """cases: list of (case_id, {actor_key: {id, team, originM, velocityMps, accelerationProposalMps2, massKg, hasBall}}).

    Returns {case_id: {actor_key: [{'t', 'p', 'v'} ...]}} with samples every 0.1 s from t=0 through the horizon.
    """
    payload = {"referencePhysics": REFERENCE, "horizonSeconds": horizon,
               "cases": [{"id": cid, "actors": actors} for cid, actors in cases]}
    proc = subprocess.run(['node', str(RUNNER)], input=json.dumps(payload), text=True, capture_output=True,
                          env={**os.environ, 'GRIDIRON_PHYSICS_ROOT': str(ENGINE)}, check=False)
    if proc.returncode:
        raise RuntimeError(f'Locomotion runner failed: {proc.stderr.strip()}')
    out = json.loads(proc.stdout)
    if out['horizonSeconds'] != horizon:
        raise RuntimeError(f"Runner horizon {out['horizonSeconds']} != requested {horizon}")
    return {x['id']: x['actors'] for x in out['output']}


def paired(a_vals, b_vals, rng, n_boot=2000):
    """Paired per-play difference A - B. Negative means A has lower error."""
    diffs = [x - y for x, y in zip(a_vals, b_vals)]
    n = len(diffs)
    boot = sorted(sum(rng.choices(diffs, k=n)) / n for _ in range(n_boot))
    return {'n': n, 'meanDiff': sum(diffs) / n, 'medianDiff': statistics.median(diffs),
            'shareALower': sum(d < 0 for d in diffs) / n,
            'ci95': [boot[int(0.025 * n_boot)], boot[int(0.975 * n_boot) - 1]]}
