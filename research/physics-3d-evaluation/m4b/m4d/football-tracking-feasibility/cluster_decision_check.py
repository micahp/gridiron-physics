#!/usr/bin/env python3
"""Game-clustered re-check of the snap-anchored decision metrics.

Reads per_play.csv from run_snap_anchored_movement.py. Paired differences A - B are taken per play and
resampled by game (gameId), not by play, because plays within a game share officials, weather and
offensive/defensive scheme. Reports effect sizes in millimetres and the preregistered decision checks
under the game-clustered interval.
"""
import csv
import json
import random
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

HERE = Path(__file__).resolve().parent
RESULTS = HERE / 'results' / 'snap-anchored-movement-2026-10-24'
SEED = 20261024
N_BOOT = 2000
METRICS = ('pos05', 'pos10', 'pairErr10', 'velErr10')
PAIRS = (('locomotionController', 'constantVelocity'), ('locomotionController', 'constantAcceleration'),
         ('locomotionController', 'boundedAcceleration'), ('constantAcceleration', 'constantVelocity'),
         ('boundedAcceleration', 'constantVelocity'))


def load():
    by = defaultdict(dict)
    with (RESULTS / 'per_play.csv').open(newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            by[(r['week'], r['gameId'], r['playId'])][r['arm']] = r
    return by


def clustered(by, a, b, metric, rng):
    games = defaultdict(list)
    weeks = defaultdict(list)
    for (week, gid, pid), arms in by.items():
        d = float(arms[a][metric]) - float(arms[b][metric])
        games[gid].append(d)
        weeks[week].append(d)
    gids = sorted(games)
    diffs = [d for g in gids for d in games[g]]
    point = mean(diffs)
    game_sum = [sum(games[g]) for g in gids]
    game_n = [len(games[g]) for g in gids]
    boot = []
    for _ in range(N_BOOT):
        idx = [rng.randrange(len(gids)) for _ in gids]
        boot.append(sum(game_sum[i] for i in idx) / sum(game_n[i] for i in idx))
    boot.sort()
    return {'n_plays': len(diffs), 'n_games': len(gids), 'meanDiff_m': point,
            'medianDiff_m': median(diffs), 'shareALower': sum(d < 0 for d in diffs) / len(diffs),
            'gameClusterCI95_m': [boot[int(0.025 * N_BOOT)], boot[int(0.975 * N_BOOT) - 1]],
            'weekMeanDiff_m': {str(w): mean(v) for w, v in sorted(weeks.items())}}


def main():
    by = load()
    rng = random.Random(SEED)
    out = {}
    for metric in METRICS:
        for a, b in PAIRS:
            out[f'{a}_minus_{b}:{metric}'] = clustered(by, a, b, metric, rng)
    checks = {}
    for metric in ('pos10', 'pairErr10', 'velErr10'):
        beats = {}
        for other in ('constantVelocity', 'constantAcceleration', 'boundedAcceleration'):
            r = out[f'locomotionController_minus_{other}:{metric}']
            beats[other] = r['gameClusterCI95_m'][1] < 0 and r['meanDiff_m'] < 0 and r['medianDiff_m'] < 0
        checks[metric] = beats
    out['decisionUnderGameClusteredInterval'] = {'checks': checks, 'justified': all(
        all(v) for v in [checks['pos10'].values(), checks['pairErr10'].values(), checks['velErr10'].values()])}
    (RESULTS / 'game_clustered_check.json').write_text(json.dumps(out, indent=2))
    for k in (f'locomotionController_minus_constantAcceleration:pos05', f'locomotionController_minus_constantAcceleration:pos10',
              f'constantAcceleration_minus_constantVelocity:pos05', f'constantAcceleration_minus_constantVelocity:pos10'):
        r = out[k]
        print(f"{k:70s} mean {r['meanDiff_m']*1000:+8.2f} mm  median {r['medianDiff_m']*1000:+8.2f} mm  "
              f"game-CI [{r['gameClusterCI95_m'][0]*1000:+.2f}, {r['gameClusterCI95_m'][1]*1000:+.2f}] mm  "
              f"games {r['n_games']} plays {r['n_plays']}")
    print('decision under game-clustered interval:', out['decisionUnderGameClusteredInterval'])


if __name__ == '__main__':
    main()
