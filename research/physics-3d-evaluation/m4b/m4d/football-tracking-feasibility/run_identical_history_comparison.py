#!/usr/bin/env python3
"""Identical-history comparison on the frozen 40 development plays, origin excluded from every error window.

Reuses the frozen manifest, selection and tracking decoding from run_observed_movement_comparison.py. The four
arms receive the same origin position, origin velocity and five pre-origin velocity samples. The earlier
origin-included metrics are recomputed as a reproduction check, so the harness can be compared with the
published summary.
"""
import csv
import hashlib
import json
import math
import random
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_observed_movement_comparison as old  # noqa: E402
import movement_arms as arms  # noqa: E402

OUT = HERE / 'results' / 'identical-history-2026-10-24'
TIMES05 = [0.1, 0.2, 0.3, 0.4, 0.5]
HORIZON = 0.5
SEED = 20261024


def norm(v):
    return math.hypot(v[0], v[1])


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def build_cases():
    plays, players, play_players = old.load_tables()
    with old.MANIFEST.open(newline='', encoding='utf-8') as f:
        manifest_rows = list(csv.DictReader(f))
    selected = old.select_sample(plays, play_players, manifest_rows)
    cases = []
    for week in old.WEEKS:
        week_cases = [c for c in selected if c['week'] == week]
        rows = old.read_selected_rows(week, week_cases)
        grouped = {}
        for r in rows:
            grouped.setdefault((r['gameId'], r['playId']), []).append(r)
        for c in week_cases:
            c = dict(c)
            c['week'] = week
            cases.append(old.decorate_case(c, grouped.get((c['gameId'], c['playId']), []), players))
    if len(cases) != len(selected):
        raise RuntimeError(f'Decoded {len(cases)} of {len(selected)} selected plays')
    return cases


def predictions(cases):
    """Return {arm: {case_id: {role: [5 positions]}}} and the 0.5 s locomotion samples."""
    payload = []
    for c in cases:
        actors = {}
        for role, a in c['actorData'].items():
            actors[role] = {'id': a['id'], 'team': a['team'], 'originM': a['originM'],
                            'velocityMps': a['velocityMps'], 'accelerationProposalMps2': a['accelerationProposalMps2'],
                            'massKg': a['massKg'], 'hasBall': role == 'carrier'}
        payload.append((c['sampleId'], actors))
    loc = arms.run_locomotion(payload, HORIZON)
    out = {arm: {} for arm in arms.ARMS}
    for c in cases:
        cid = c['sampleId']
        for role, a in c['actorData'].items():
            p0, v0, acc = a['originM'], a['velocityMps'], a['accelerationProposalMps2']
            out['constantVelocity'].setdefault(cid, {})[role] = arms.kinematic(p0, v0, [0.0, 0.0], TIMES05)[0]
            out['constantAcceleration'].setdefault(cid, {})[role] = arms.kinematic(p0, v0, acc, TIMES05)[0]
            out['boundedAcceleration'].setdefault(cid, {})[role] = arms.kinematic(
                p0, v0, acc, TIMES05, bound=arms.BOUND_MPS2)[0]
            out['locomotionController'].setdefault(cid, {})[role] = [s['p'] for s in loc[cid][role][1:]]
    return out, loc


def score(case, pred):
    """Origin-excluded metrics and the origin-included reproduction of the earlier metrics."""
    m, old_m = {}, {}
    seps_obs = [norm(sub(o, p)) for o, p in zip(case['actorData']['carrier']['observedPredictionPathM'][1:],
                                                 case['actorData']['defender']['observedPredictionPathM'][1:])]
    seps_pred = [norm(sub(c, d)) for c, d in zip(pred['carrier'], pred['defender'])]
    obs_full = case['actorData']
    origin_obs_sep = norm(sub(obs_full['carrier']['originM'], obs_full['defender']['originM']))
    for role in ('carrier', 'defender'):
        obs = case['actorData'][role]['observedPredictionPathM']
        err = [dist(p, o) for p, o in zip(pred[role], obs[1:])]
        m[f'{role}Mae'] = sum(err) / len(err)
        m[f'{role}End'] = err[-1]
        full = [dist(p, o) for p, o in zip([obs[0]] + pred[role], obs)]
        old_m[f'{role}Rmse'] = math.sqrt(sum(e * e for e in full) / len(full))
    sep_err = [abs(p - o) for p, o in zip(seps_pred, seps_obs)]
    m['sepMae'] = sum(sep_err) / len(sep_err)
    m['sepEnd'] = seps_pred[-1] - seps_obs[-1]
    obs_min, pred_min = min(seps_obs), min(seps_pred)
    m['obsMin'], m['predMin'] = obs_min, pred_min
    m['minErr'] = pred_min - obs_min
    m['obsTmin'] = TIMES05[seps_obs.index(obs_min)]
    m['predTmin'] = TIMES05[seps_pred.index(pred_min)]
    m['timingErr'] = m['predTmin'] - m['obsTmin']
    m['originIsMinObs'] = origin_obs_sep <= obs_min
    m['originIsMinPred'] = origin_obs_sep <= pred_min
    # Earlier definition, origin included, so the earlier table can be reproduced.
    seps_obs_full = [origin_obs_sep] + seps_obs
    seps_pred_full = [origin_obs_sep] + seps_pred
    old_m['sepRmse'] = math.sqrt(sum((p - o) ** 2 for p, o in zip(seps_pred_full, seps_obs_full)) / 6)
    old_m['minErr'] = min(seps_pred_full) - min(seps_obs_full)
    old_m['eventSepErr'] = seps_pred_full[-1] - seps_obs_full[-1]
    return m, old_m


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1]]


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    engine = old.engine_provenance()
    cases = build_cases()
    preds, loc = predictions(cases)

    # Reproduction: the new harness at 0.5 s must match the stored earlier controller output exactly.
    earlier = json.loads((HERE / 'results' / 'observed-tackle-movement-2026-10-24' / 'comparison.json').read_text())
    earlier_cases = {c['sampleId']: c for c in earlier['cases']}
    max_diff = 0.0
    for c in cases:
        for role in c['actorData']:
            stored = earlier_cases[c['sampleId']]['models']['locomotionController'][role]
            for s, row in zip(stored, loc[c['sampleId']][role]):
                max_diff = max(max_diff, abs(s[0] - row['p'][0]), abs(s[1] - row['p'][1]))
    if max_diff > 1e-9:
        raise RuntimeError(f'Runner does not reproduce the earlier locomotion output (max diff {max_diff})')

    rows, scored = [], {}
    for c in cases:
        cid = c['sampleId']
        for arm in arms.ARMS:
            pred = {role: preds[arm][cid][role] for role in ('carrier', 'defender')}
            m, old_m = score(c, pred)
            rows.append({'sampleId': cid, 'week': c['week'], 'split': c['split'], 'arm': arm,
                         **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in m.items()},
                         **{f'old_{k}': round(v, 6) for k, v in old_m.items()}})
            scored.setdefault(arm, []).append((cid, c['split'], m, old_m))

    dev = {arm: [x for x in v if x[1] == 'development'] for arm, v in scored.items()}
    summary = {}
    for arm, vals in dev.items():
        summary[arm] = {}
        for key in ('carrierMae', 'carrierEnd', 'defenderMae', 'defenderEnd', 'sepMae', 'sepEnd', 'minErr', 'timingErr'):
            xs = [m[key] for _, _, m, _ in vals]
            summary[arm][key] = {'median': statistics.median(xs), 'mean': statistics.mean(xs)}
        for key in ('carrierRmse', 'defenderRmse', 'sepRmse', 'minErr', 'eventSepErr'):
            xs = [o[key] for _, _, _, o in vals]
            summary[arm][f'oldStyle_{key}'] = {'median': statistics.median(xs), 'mean': statistics.mean(xs)}
        summary[arm]['share_originIsMinPred'] = sum(m['originIsMinPred'] for _, _, m, _ in vals) / len(vals)
        summary[arm]['share_originIsMinObs'] = sum(m['originIsMinObs'] for _, _, m, _ in vals) / len(vals)

    rng = random.Random(SEED)
    comparisons = {}
    dev_ids = [cid for cid, _, _, _ in dev['constantVelocity']]

    def series(arm, key):
        return [m[key] for _, _, m, _ in dev[arm]]

    for key in ('carrierMae', 'defenderMae', 'sepMae', 'sepEnd'):
        for arm in arms.ARMS[1:]:
            comparisons[f'{arm}_minus_constantVelocity:{key}'] = arms.paired(
                series(arm, key), series('constantVelocity', key), rng)
        for other in arms.KINEMATIC:
            comparisons[f'locomotionController_minus_{other}:{key}'] = arms.paired(
                series('locomotionController', key), series(other, key), rng)
    abs_min ={arm: [abs(m['minErr']) for _, _, m, _ in dev[arm]] for arm in arms.ARMS}
    for other in arms.KINEMATIC:
        comparisons[f'locomotionController_minus_{other}:absMinErr'] = arms.paired(
            abs_min['locomotionController'], abs_min[other], rng)

    provenance = {
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'engine': engine,
        'manifest': {'path': str(old.MANIFEST), 'sha256': digest(old.MANIFEST)},
        'runnerSha256': digest(arms.RUNNER),
        'analysisCodeSha256': {p.name: digest(p) for p in (HERE / 'movement_arms.py', Path(__file__).resolve())},
        'reproductionMaxAbsDiffM': max_diff,
        'horizonSeconds': HORIZON, 'origin': 'eventFrame - 5 (earlier decoded origin, unchanged)',
        'seed': SEED, 'bootstrapResamples': 2000, 'boundMps2': arms.BOUND_MPS2,
    }
    result = {'provenance': provenance, 'developmentPlays': len(dev_ids),
              'exploratoryPlays': sum(1 for c in cases if c['split'] == 'exploratory_visual'),
              'arms': summary, 'pairedComparisons': comparisons}
    (OUT / 'summary.json').write_text(json.dumps(result, indent=2))
    with (OUT / 'per_play.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps({k: result[k] for k in ('developmentPlays', 'exploratoryPlays')}, indent=2))
    print('reproduction max diff (m):', max_diff)
    for arm in arms.ARMS:
        print(arm, {k: round(summary[arm][k]['median'], 3) for k in ('carrierMae', 'defenderMae', 'sepMae', 'minErr')},
              'old-style sepRmse', round(summary[arm]['oldStyle_sepRmse']['median'], 3))


if __name__ == '__main__':
    main()
