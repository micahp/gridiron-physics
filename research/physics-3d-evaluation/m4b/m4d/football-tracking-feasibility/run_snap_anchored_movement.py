#!/usr/bin/env python3
"""Snap-anchored, all-22-player movement benchmark on BDB2025 weeks 1-5 (weeks 6-9 reserved).

Preregistered in the LP repo: docs/research/BDB2025-SNAP-ANCHORED-BENCHMARK-PREREG-2026-10-24.md.
Inputs are frames <= origin (the ball_snap frame). Predictions are scored on origin+1..origin+10.
Football is a label only. No play, player or horizon is chosen using anything after the snap.
"""
import csv
import hashlib
import json
import math
import os
import random
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import movement_arms as arms  # noqa: E402

DATA = Path('/root/nfl-tracking-data/bdb2025/code-data')
STAGE = Path('/root/nfl-tracking-data/bdb2025/snap-anchored-v1')
MANIFEST = Path(os.environ.get('LP_SNAP_MANIFEST',
                               '/root/lp-nfl-snap-benchmark/docs/research/bdb2025-snap-anchored-cohort-v1.csv'))
OUT = HERE / 'results' / 'snap-anchored-movement-2026-10-24'
WEEKS = (1, 2, 3, 4, 5)
YD, LB_TO_KG = 0.9144, 0.45359237
HORIZONS = (5, 10)  # frames after origin: 0.5 s and 1.0 s
PLAY_CHUNK = 250  # plays per locomotion-runner call, so one process never holds the whole cohort's JSON
SEED = 20261024
ARMS = arms.ARMS


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs)


def mean_pair(points):
    return mean(dist(a, b) for a, b in combinations(points, 2))


def centroid(points):
    return [mean(p[0] for p in points), mean(p[1] for p in points)]


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def load_manifest():
    with MANIFEST.open(newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    eligible = defaultdict(dict)
    for r in rows:
        week = int(r['week'])
        if week not in WEEKS:
            raise RuntimeError(f'Manifest contains week {week}, which is reserved for held-out confirmation')
        if r['eligible_input'] == 'True':
            eligible[week][(r['gameId'], r['playId'])] = r
    return eligible, rows


def load_players():
    with (DATA / 'players.csv').open(newline='', encoding='utf-8') as f:
        return {r['nflId']: {'kg': float(r['weight']) * LB_TO_KG, 'position': r['position']}
                for r in csv.DictReader(f)}


def load_window(week, eligible):
    plays = defaultdict(lambda: {'pl': {}, 'ball': {}})
    with (STAGE / f'window_week_{week}.csv').open(newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader)
        for gid, pid, _origin, nfl, rel, club, x, y in reader:
            pos = (float(x) * YD, float(y) * YD)
            if nfl == 'NA':
                plays[(gid, pid)]['ball'][int(rel)] = pos
            else:
                plays[(gid, pid)]['pl'].setdefault(nfl, {})[int(rel)] = (pos, club)
    if set(plays) != set(eligible):
        raise RuntimeError(f'week {week}: staged window has {len(plays)} plays, manifest eligible {len(eligible)}')
    return plays


def build_play(meta, play, players):
    """Snap-available inputs for all tracked players, plus observed future labels for scoring."""
    pl = play['pl']
    ids = sorted(pl)
    if len(ids) != 22:
        raise RuntimeError(f"{meta['gameId']}/{meta['playId']}: {len(ids)} players in window")
    info = {}
    for nfl in ids:
        track = pl[nfl]
        hist = [track[r][0] for r in range(-5, 1)]  # KeyError here means the manifest eligibility is wrong
        v0, a = arms.acceleration_proposal(hist)
        club = track[0][1]
        side = 'off' if club == meta['possessionTeam'] else 'def' if club == meta['defensiveTeam'] else None
        if side is None:
            raise RuntimeError(f"{meta['gameId']}/{meta['playId']}: club {club} matches neither team")
        info[nfl] = {'club': club, 'side': side, 'p0': hist[-1], 'v0': v0, 'a': a,
                     'kg': players[nfl]['kg'], 'position': players[nfl]['position']}
    obs = {nfl: [pl[nfl][r][0] if r in pl[nfl] else None for r in range(0, 11)] for nfl in ids}
    offs = [i for i in ids if info[i]['side'] == 'off']
    defs = [i for i in ids if info[i]['side'] == 'def']
    if len(offs) != 11 or len(defs) != 11:
        raise RuntimeError(f"{meta['gameId']}/{meta['playId']}: split {len(offs)}/{len(defs)}")
    pairs = {o: min(defs, key=lambda d: (dist(obs[o][0], obs[d][0]), d)) for o in offs}
    return {'ids': ids, 'info': info, 'obs': obs, 'offs': offs, 'defs': defs, 'pairs': pairs,
            'ball': play['ball']}


def observed_quantities(p):
    obs, ids, offs, defs = p['obs'], p['ids'], p['offs'], p['defs']
    q = {}
    for H in HORIZONS:
        O = {i: obs[i][H] for i in ids}
        q[H] = {
            'cen': {s: centroid([O[i] for i in ids if p['info'][i]['side'] == s]) for s in ('off', 'def')},
            'sp': (mean_pair([O[i] for i in ids]), mean_pair([O[i] for i in offs]), mean_pair([O[i] for i in defs])),
            'persist': mean(min(defs, key=lambda d: (dist(O[o], O[d]), d)) == p['pairs'][o] for o in offs),
        }
    return q


def score(p, pred, oq):
    """Metrics for one arm. pred[nfl][k] for k = 0..10 (k = 0 is the shared origin)."""
    obs, info, ids, offs, defs, pairs = p['obs'], p['info'], p['ids'], p['offs'], p['defs'], p['pairs']
    out = {}
    for H in HORIZONS:
        P = {i: pred[i][H] for i in ids}
        O = {i: obs[i][H] for i in ids}
        errs = {i: dist(P[i], O[i]) for i in ids}
        out[f'pos{H:02d}'] = mean(errs.values())
        out[f'posOff{H:02d}'] = mean(errs[i] for i in offs)
        out[f'posDef{H:02d}'] = mean(errs[i] for i in defs)
        cen = []
        for s in ('off', 'def'):
            grp = [i for i in ids if info[i]['side'] == s]
            cen.append(dist(centroid([P[i] for i in grp]), oq[H]['cen'][s]))
        out[f'cen{H:02d}'] = mean(cen)
        out[f'spAll{H:02d}'] = abs(mean_pair([P[i] for i in ids]) - oq[H]['sp'][0])
        out[f'spOff{H:02d}'] = abs(mean_pair([P[i] for i in offs]) - oq[H]['sp'][1])
        out[f'spDef{H:02d}'] = abs(mean_pair([P[i] for i in defs]) - oq[H]['sp'][2])
        Pp = {i: pred[i][H - 1] for i in ids}
        Op = {i: obs[i][H - 1] for i in ids}
        vel_err, spd_err = [], []
        for i in ids:
            vh = [(P[i][0] - Pp[i][0]) / 0.1, (P[i][1] - Pp[i][1]) / 0.1]
            vo = [(O[i][0] - Op[i][0]) / 0.1, (O[i][1] - Op[i][1]) / 0.1]
            vel_err.append(dist(vh, vo))  # |(vhat - v0) - (v - v0)|: the common origin velocity cancels
            spd_err.append(abs(math.hypot(*vh) - math.hypot(*vo)))
        out[f'velErr{H:02d}'] = mean(vel_err)
        out[f'spdErr{H:02d}'] = mean(spd_err)
        pair_err, agree = [], []
        for o in offs:
            d = pairs[o]
            pair_err.append(abs(dist(P[o], P[d]) - dist(O[o], O[d])))
            pa = min(defs, key=lambda x: (dist(P[o], P[x]), x))
            oa = min(defs, key=lambda x: (dist(O[o], O[x]), x))
            agree.append(pa == oa)
        out[f'pairErr{H:02d}'] = mean(pair_err)
        out[f'agree{H:02d}'] = mean(agree)
        out[f'persist{H:02d}'] = oq[H]['persist']
    min_err = {H: [] for H in HORIZONS}
    min_time = {H: [] for H in HORIZONS}
    min_bound = {H: [] for H in HORIZONS}
    for o in offs:
        d = pairs[o]
        sp = [dist(pred[o][k], pred[d][k]) for k in range(1, 11)]
        so = [dist(obs[o][k], obs[d][k]) for k in range(1, 11)]
        for H in HORIZONS:
            mp = min(sp[:H])
            mo = min(so[:H])
            tp = sp[:H].index(mp) + 1
            to = so[:H].index(mo) + 1
            min_err[H].append(abs(mp - mo))
            min_time[H].append(abs(tp - to) * 0.1)
            min_bound[H].append(tp == H or to == H)
    for H in HORIZONS:
        out[f'minErr{H:02d}'] = mean(min_err[H])
        out[f'minTimeErr{H:02d}'] = mean(min_time[H])
        out[f'minBoundary{H:02d}'] = mean(min_bound[H])
    out['pos_by_frame'] = [mean(dist(pred[i][k], obs[i][k]) for i in ids) for k in range(1, 11)]
    return out


def make_predictions(cases):
    """cases: list of (key, play). Returns {arm: {key: {nfl: [11 positions]}}}, plus per-player 1.0 s errors."""
    payload = []
    for key, p in cases:
        actors = {}
        for nfl in p['ids']:
            i = p['info'][nfl]
            actors[nfl] = {'id': nfl, 'team': i['club'], 'originM': i['p0'], 'velocityMps': i['v0'],
                           'accelerationProposalMps2': i['a'], 'massKg': i['kg'], 'hasBall': False}
        payload.append((key, actors))
    loc = arms.run_locomotion(payload, 1.0)
    out = {arm: {} for arm in ARMS}
    for key, p in cases:
        for nfl in p['ids']:
            i = p['info'][nfl]
            out['constantVelocity'].setdefault(key, {})[nfl] = arms.kinematic(
                i['p0'], i['v0'], [0.0, 0.0], [0.1 * k for k in range(1, 11)])[0]
            out['constantAcceleration'].setdefault(key, {})[nfl] = arms.kinematic(
                i['p0'], i['v0'], i['a'], [0.1 * k for k in range(1, 11)])[0]
            out['boundedAcceleration'].setdefault(key, {})[nfl] = arms.kinematic(
                i['p0'], i['v0'], i['a'], [0.1 * k for k in range(1, 11)], bound=arms.BOUND_MPS2)[0]
            samples = loc[key][nfl]
            for s in samples:
                if not all(math.isfinite(x) for x in s['p'] + s['v']):
                    raise RuntimeError(f'{key}/{nfl}: non-finite locomotion sample')
            out['locomotionController'].setdefault(key, {})[nfl] = [s['p'] for s in samples[1:]]
    for arm in ARMS:
        for key, p in cases:
            for nfl in p['ids']:
                out[arm][key][nfl] = [p['info'][nfl]['p0']] + out[arm][key][nfl]
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    eligible, manifest_rows = load_manifest()
    players = load_players()
    per_play, per_frame = [], defaultdict(lambda: defaultdict(list))
    group_err = defaultdict(lambda: defaultdict(list))
    ball_labels = []
    scored_counts = {'plays': 0, 'scored05': 0, 'scored10': 0}
    for week in WEEKS:
        keys = eligible[week]
        window = load_window(week, keys)
        cases = []
        for key in sorted(keys):
            meta = keys[key]
            p = build_play(dict(meta, gameId=key[0], playId=key[1]), window[key], players)
            p['meta'] = meta
            cases.append((f'{week}|{key[0]}|{key[1]}', p))
        scored_counts['plays'] += len(cases)
        for c0 in range(0, len(cases), PLAY_CHUNK):
            chunk = cases[c0:c0 + PLAY_CHUNK]
            preds = make_predictions(chunk)
            for key, p in chunk:
                oq = observed_quantities(p)
                week_key, gid, pid = key.split('|')
                if p['meta']['scoring_0_5'] != 'True' or p['meta']['scoring_1_0'] != 'True':
                    raise RuntimeError(f'{key}: eligible play lacks scoring presence at 1.0 s; cohort is inconsistent')
                scored_counts['scored05'] += 1
                scored_counts['scored10'] += 1
                if 10 in p['ball'] and 0 in p['ball']:
                    ball_labels.append((int(week), math.hypot(p['ball'][10][0] - p['ball'][0][0],
                                                              p['ball'][10][1] - p['ball'][0][1])))
                for arm in ARMS:
                    pred = {nfl: preds[arm][key][nfl] for nfl in p['ids']}
                    m = score(p, pred, oq)
                    frames = m.pop('pos_by_frame')
                    for k, v in enumerate(frames, start=1):
                        per_frame[arm][k].append(v)
                    for nfl in p['ids']:
                        group_err[arm][p['info'][nfl]['position']].append(dist(pred[nfl][10], p['obs'][nfl][10]))
                    per_play.append({'week': int(week), 'gameId': gid, 'playId': pid, 'arm': arm,
                                     **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in m.items()}})
        print(f'week {week}: {len(cases)} eligible plays scored', flush=True)

    rows_by_arm = defaultdict(list)
    for r in per_play:
        rows_by_arm[r['arm']].append(r)
    metric_names = [k for k in per_play[0] if k not in ('week', 'gameId', 'playId', 'arm')]
    summary = {'arms': {}, 'pairedComparisons': {}, 'decisionRule': {}}
    for arm in ARMS:
        summary['arms'][arm] = {m: {'median': statistics.median(r[m] for r in rows_by_arm[arm]),
                                    'mean': mean(r[m] for r in rows_by_arm[arm])}
                                for m in metric_names if m not in ('persist05', 'persist10')}
        summary['arms'][arm]['persist05'] = {'mean': mean(r['persist05'] for r in rows_by_arm[arm])}
        summary['arms'][arm]['persist10'] = {'mean': mean(r['persist10'] for r in rows_by_arm[arm])}
        summary['arms'][arm]['growthMedianPos_by_frame'] = {
            str(k): statistics.median(per_frame[arm][k]) for k in range(1, 11)}
        summary['arms'][arm]['position_1s_by_group'] = {
            g: {'n': len(v), 'medianM': statistics.median(v)} for g, v in sorted(group_err[arm].items())}

    rng = random.Random(SEED)

    def paired_for(a, b, metric):
        ra = {(r['week'], r['gameId'], r['playId']): r[metric] for r in rows_by_arm[a]}
        rb = {(r['week'], r['gameId'], r['playId']): r[metric] for r in rows_by_arm[b]}
        keys = sorted(ra)
        out = arms.paired([ra[k] for k in keys], [rb[k] for k in keys], rng)
        out['weekSigns'] = {}
        for w in WEEKS:
            wk = [k for k in keys if k[0] == w]
            out['weekSigns'][str(w)] = mean(ra[k] - rb[k] for k in wk)
        return out

    pairs_to_run = [('locomotionController', 'constantVelocity'), ('locomotionController', 'constantAcceleration'),
                    ('locomotionController', 'boundedAcceleration'), ('constantAcceleration', 'constantVelocity'),
                    ('boundedAcceleration', 'constantVelocity')]
    for metric in ('pos05', 'pos10', 'posOff10', 'posDef10', 'cen10', 'spAll10', 'spOff10', 'spDef10',
                   'pairErr10', 'velErr10', 'spdErr10', 'minErr10', 'minErr05', 'agree10'):
        for a, b in pairs_to_run:
            summary['pairedComparisons'][f'{a}_minus_{b}:{metric}'] = paired_for(a, b, metric)

    kinematic = ('constantVelocity', 'constantAcceleration', 'boundedAcceleration')
    checks = {}
    for metric in ('pos10', 'pairErr10', 'velErr10'):
        beats, sign_ok = {}, {}
        for other in kinematic:
            res = summary['pairedComparisons'][f'locomotionController_minus_{other}:{metric}']
            beats[other] = res['ci95'][1] < 0 and res['meanDiff'] < 0 and res['medianDiff'] < 0
            sign_ok[other] = all(v < 0 for v in res['weekSigns'].values())
        checks[metric] = {'beatsEachKinematicArm_CI': beats, 'negativeInEveryWeek': sign_ok}
    primary_ok = all(checks['pos10']['beatsEachKinematicArm_CI'].values()) and \
        all(checks['pos10']['negativeInEveryWeek'].values())
    secondary_ok = all(all(checks[m]['beatsEachKinematicArm_CI'].values()) for m in ('pairErr10', 'velErr10'))
    summary['decisionRule'] = {'checks': checks, 'primaryMetricPasses': primary_ok,
                               'secondaryMetricsPass': secondary_ok,
                               'moreSophisticatedPolicyJustified': primary_ok and secondary_ok}

    summary['ballLabel'] = {'plays': len(ball_labels),
                            'medianDisplacement10FrameM': statistics.median(x for _, x in ball_labels) if ball_labels else None}
    counts = {}
    for w in WEEKS:
        cf = STAGE / f'counts_week_{w}.json'
        counts[str(w)] = json.loads(cf.read_text())
    provenance = {
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'manifest': {'path': str(MANIFEST), 'sha256': digest(MANIFEST), 'rows': len(manifest_rows)},
        'window': {f'week{w}': digest(STAGE / f'window_week_{w}.csv') for w in WEEKS},
        'stagingCounts': counts,
        'runnerSha256': digest(arms.RUNNER), 'analysisCodeSha256': {
            p.name: digest(p) for p in (HERE / 'movement_arms.py', Path(__file__).resolve())},
        'engineSourceCommit': 'a09329185451faad44ef7453c7c47bea9d7253a4',
        'horizonsSeconds': [0.5, 1.0], 'origin': 'ball_snap frame (manifest origin_frame)',
        'boundMps2': arms.BOUND_MPS2, 'seed': SEED, 'bootstrapResamples': 2000,
        'playsScored': len(per_play) // len(ARMS), 'scoredFlags': scored_counts,
    }
    result = {'provenance': provenance, 'summary': summary}
    (OUT / 'summary.json').write_text(json.dumps(result, indent=2))
    with (OUT / 'per_play.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(per_play[0].keys()))
        w.writeheader()
        w.writerows(per_play)
    print(json.dumps({'playsScored': provenance['playsScored'],
                      'decision': summary['decisionRule']['moreSophisticatedPolicyJustified'],
                      'pos10_median': {a: round(summary['arms'][a]['pos10']['median'], 4) for a in ARMS},
                      'pos05_median': {a: round(summary['arms'][a]['pos05']['median'], 4) for a in ARMS}}, indent=2))


if __name__ == '__main__':
    main()
