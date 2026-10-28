"""Part B movement experiment 1, under docs/research/PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md. Read only.

Order (fixed in the protocol): calibration on 2022 Weeks 1 to 3 (fits one scalar k for the damped constant-acceleration
predictor); development check on 2022 Weeks 4 to 5; validation on the 2023 train split, Weeks 1 to 7, with k frozen.

2022 input: window CSVs written by extract_2022_windows.py (Weeks 1 to 5 only).
2023 input: input_2023_wNN.csv and output_2023_wNN.csv from the train split only.

Any path touching 2022 Weeks 6 to 9, a 2026 file, or a non-train 2023 split stops the run.
"""
import bisect
import collections
import csv
import hashlib
import json
import math
import os
import random
import statistics
import sys

csv.field_size_limit(sys.maxsize)

BDB22 = '/root/nfl-tracking-data/bdb2025/code-data'
BDB23 = '/root/nfl-tracking-data/bdb2026-prediction/train'
SCRATCH = '/tmp/claude-0/-root/4a715766-ff4b-4980-99e5-dc209eaac7d4/scratchpad/partb'
OUT = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-partb-movement-experiment-1'
CAL_WEEKS = (1, 2, 3)
DEV_WEEKS = (4, 5)
VAL_WEEKS = (1, 2, 3, 4, 5, 6, 7)
K_GRID = [round(0.1 * i, 1) for i in range(11)]
HORIZONS = {5: '0.5s', 10: '1.0s', 20: '2.0s'}
YD_TO_M = 0.9144
BOOT = 2000
SEED = 20261028
GROUP_MAP = {
    'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE', 'T': 'OL', 'G': 'OL', 'C': 'OL', 'OL': 'OL',
    'DE': 'DL', 'DT': 'DL', 'NT': 'DL', 'DL': 'DL', 'LB': 'LB', 'ILB': 'LB', 'OLB': 'LB', 'MLB': 'LB',
    'CB': 'CB', 'S': 'S', 'FS': 'S', 'SS': 'S', 'DB': 'S',
}


def guard(path):
    p = path.replace('\\', '/')
    if '2026' in os.path.basename(p) and 'bdb2026-prediction' not in p:
        raise RuntimeError(f'2026 path refused: {path}')
    if 'bdb2026-prediction' in p and '/train/' not in p:
        raise RuntimeError(f'non-train 2023 path refused: {path}')
    for w in (6, 7, 8, 9):
        if f'tracking_week_{w}' in p or f'week{w}_' in p:
            raise RuntimeError(f'reserved 2022 week refused: {path}')
    return path


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def role_group(pos):
    return GROUP_MAP.get((pos or '').upper(), 'other')


# ----------------------------------------------------------------- predictors
def predict(p, name, k, t):
    """Position at horizon t seconds from the origin. p holds x0, y0 and the two prior positions."""
    x0, y0, xm1, ym1, xm2, ym2 = p['x0'], p['y0'], p['xm1'], p['ym1'], p['xm2'], p['ym2']
    vx, vy = (x0 - xm1) / 0.1, (y0 - ym1) / 0.1
    ax = ((x0 - xm1) - (xm1 - xm2)) / 0.01
    ay = ((y0 - ym1) - (ym1 - ym2)) / 0.01
    if name == 'hold':
        return x0, y0
    if name == 'cv':
        return x0 + vx * t, y0 + vy * t
    if name == 'ca':
        return x0 + vx * t + 0.5 * ax * t * t, y0 + vy * t + 0.5 * ay * t * t
    if name == 'dca':
        return x0 + vx * t + 0.5 * k * ax * t * t, y0 + vy * t + 0.5 * k * ay * t * t
    raise ValueError(name)


PREDICTORS = ('hold', 'cv', 'ca', 'dca')


def speed_change_error(p, name, k, obs_post_speed, obs_origin_speed):
    """Predicted change in speed over 1.0 s against the observed change, both in yards per second."""
    x0, y0, xm1, ym1 = p['x0'], p['y0'], p['xm1'], p['ym1']
    v0 = math.hypot(x0 - xm1, y0 - ym1) / 0.1
    if name == 'hold':
        pred_change = -v0
    else:
        xa, ya = predict(p, name, k, 1.0)
        xb, yb = predict(p, name, k, 0.9)
        pred_speed = math.hypot(xa - xb, ya - yb) / 0.1
        pred_change = pred_speed - v0
    obs_change = obs_post_speed - obs_origin_speed
    return abs(pred_change - obs_change) * YD_TO_M


# ------------------------------------------------------------------- 2022 cohort
def load_2022_week(week):
    """Rows of one 2022 window file, grouped by play and player."""
    path = guard(os.path.join(SCRATCH, f'window_2022_w{week}.csv'))
    plays = collections.defaultdict(lambda: {'players': collections.defaultdict(dict), 'club': {}, 'pos': {}})
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            key = (r['gameId'], r['playId'])
            pl = plays[key]
            rel = int(r['rel_frame'])
            pl['players'][r['nflId']][rel] = (float(r['x']), float(r['y']))
            pl['club'][r['nflId']] = r['club']
            pl['pos'][r['nflId']] = r['position']
    return plays


def samples_2022(week, plays, play_meta):
    rows, sep_rows, route_rows, dropped = [], [], [], collections.Counter()
    for key, pl in plays.items():
        game_id, play_id = key
        qb_clubs = {pl['club'][n] for n, pos in pl['pos'].items() if pos == 'QB'}
        if len(pl['players']) < 22:
            dropped['play_under_22_players'] += 1
            continue
        for nid, fr in pl['players'].items():
            need = [-2, -1, 0, 5, 10, 20, 9, 11]
            if any(t not in fr for t in need):
                dropped['player_missing_frames'] += 1
                continue
            p = {'x0': fr[0][0], 'y0': fr[0][1], 'xm1': fr[-1][0], 'ym1': fr[-1][1],
                 'xm2': fr[-2][0], 'ym2': fr[-2][1]}
            group = role_group(pl['pos'][nid])
            for h, label in HORIZONS.items():
                ox, oy = fr[h]
                for name in PREDICTORS:
                    for k in (K_GRID if name == 'dca' else [None]):
                        px, py = predict(p, name, k if k is not None else 0.0, h / 10.0)
                        rows.append({'cohort': f'2022_w{week}', 'week': week, 'gameId': game_id, 'playId': play_id,
                                     'nflId': nid, 'group': group, 'horizon': label, 'predictor': name,
                                     'k': '' if k is None else k,
                                     'err_m': math.hypot(px - ox, py - oy) * YD_TO_M,
                                     'speed_change_err_m': ''})
            obs_origin_speed = math.hypot(fr[0][0] - fr[-1][0], fr[0][1] - fr[-1][1]) / 0.1
            obs_post_speed = math.hypot(fr[11][0] - fr[9][0], fr[11][1] - fr[9][1]) / 0.2
            for name in PREDICTORS:
                for k in (K_GRID if name == 'dca' else [None]):
                    rows.append({'cohort': f'2022_w{week}', 'week': week, 'gameId': game_id, 'playId': play_id,
                                 'nflId': nid, 'group': group, 'horizon': '1.0s', 'predictor': name,
                                 'k': '' if k is None else k, 'err_m': '',
                                 'speed_change_err_m': speed_change_error(p, name, k if k is not None else 0.0,
                                                                          obs_post_speed, obs_origin_speed)})
        # separation: each skill player to nearest opponent, at the origin and at 1.0 s
        if len(qb_clubs) == 1:
            off = next(iter(qb_clubs))
            defenders = [(n, fr) for n, fr in pl['players'].items() if pl['club'][n] != off and 0 in fr and 10 in fr]
            for nid, fr in pl['players'].items():
                if pl['club'][nid] != off or pl['pos'][nid] not in ('WR', 'TE', 'RB', 'FB'):
                    continue
                if 0 not in fr or 10 not in fr or not defenders:
                    continue
                s0 = min(math.hypot(fr[0][0] - d[0][0], fr[0][1] - d[0][1]) for _, d in defenders)
                s10 = min(math.hypot(fr[10][0] - d[10][0], fr[10][1] - d[10][1]) for _, d in defenders)
                sep_rows.append({'cohort': f'2022_w{week}', 'gameId': game_id, 'playId': play_id, 'nflId': nid,
                                 'group': role_group(pl['pos'][nid]), 'sep0_yd': s0, 'sep1_yd': s10})
    return rows, sep_rows, route_rows, dropped


def load_routes():
    """routeRan label per (gameId, playId, nflId) from player_play, 2022 development weeks only."""
    labels = {}
    path = guard(os.path.join(BDB22, 'player_play.csv'))
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            if r.get('routeRan') not in (None, '', 'NA'):
                labels[(r['gameId'], r['playId'], r['nflId'])] = r['routeRan']
    return labels


def route_timing(fr, route):
    """First time after the snap at which heading changes by at least 30 degrees over 0.3 s at speed of at least 2 yd/s.
    Returns the break time in seconds, or None if no break within the window."""
    steps = []
    for t in range(0, 20):
        if t in fr and t + 1 in fr:
            steps.append((fr[t + 1][0] - fr[t][0], fr[t + 1][1] - fr[t][1]))
        else:
            steps.append(None)
    for t in range(0, len(steps) - 3):
        a, b = steps[t], steps[t + 3]
        if a is None or b is None:
            continue
        sa = math.hypot(*a) * 10
        sb = math.hypot(*b) * 10
        if sa < 2.0 or sb < 2.0:
            continue
        ang = math.degrees(abs(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])))
        if ang >= 30.0:
            return t / 10.0
    return None


# ------------------------------------------------------------------- 2023 cohort
def load_2023_week(week):
    inp = guard(os.path.join(BDB23, f'input_2023_w{week:02d}.csv'))
    outp = guard(os.path.join(BDB23, f'output_2023_w{week:02d}.csv'))
    plays = collections.defaultdict(lambda: {'in': collections.defaultdict(dict), 'role': {}, 'pos': {},
                                             'target': None, 'out': collections.defaultdict(dict)})
    with open(inp, newline='') as f:
        for r in csv.DictReader(f):
            pl = plays[(r['game_id'], r['play_id'])]
            fid = int(r['frame_id'])
            pl['in'][r['nfl_id']][fid] = (float(r['x']), float(r['y']))
            pl['role'][r['nfl_id']] = r['player_role']
            pl['pos'][r['nfl_id']] = r['player_position']
            if r['player_to_predict'] in ('True', 'true', '1'):
                pl['target'] = r['nfl_id']
    with open(outp, newline='') as f:
        for r in csv.DictReader(f):
            key = (r['game_id'], r['play_id'])
            if key in plays:
                plays[key]['out'][r['nfl_id']][int(r['frame_id'])] = (float(r['x']), float(r['y']))
    return plays


def samples_2023(week, plays):
    rows, dropped, align_fail = [], collections.Counter(), 0
    for key, pl in plays.items():
        tgt = pl['target']
        if tgt is None or tgt not in pl['out']:
            dropped['no_target_or_output'] += 1
            continue
        fin = pl['in'].get(tgt, {})
        origin = max(max(v) for v in pl['in'].values())
        out = pl['out'][tgt]
        if min(out) != origin + 1:
            align_fail += 1
            continue
        if any(t not in fin for t in (origin - 2, origin - 1, origin)):
            dropped['target_missing_input_frames'] += 1
            continue
        if any(t not in out for t in (origin + 5, origin + 10, origin + 20)):
            dropped['target_missing_output_frames'] += 1
            continue
        p = {'x0': fin[origin][0], 'y0': fin[origin][1], 'xm1': fin[origin - 1][0], 'ym1': fin[origin - 1][1],
             'xm2': fin[origin - 2][0], 'ym2': fin[origin - 2][1]}
        group = role_group(pl['pos'][tgt])
        role = pl['role'][tgt]
        for h, label in HORIZONS.items():
            ox, oy = out[origin + h]
            for name in PREDICTORS:
                for k in (K_GRID if name == 'dca' else [None]):
                    px, py = predict(p, name, k if k is not None else 0.0, h / 10.0)
                    for g in (group, 'role:' + role):
                        rows.append({'cohort': f'2023_w{week}', 'week': week, 'gameId': key[0], 'playId': key[1],
                                     'nflId': tgt, 'group': g, 'horizon': label, 'predictor': name,
                                     'k': '' if k is None else k,
                                     'err_m': math.hypot(px - ox, py - oy) * YD_TO_M, 'speed_change_err_m': ''})
    return rows, dropped, align_fail


# ----------------------------------------------------------------- statistics
def summarize(rows, cohort_filter):
    """Mean and median error by predictor, horizon and group, for rows that match cohort_filter."""
    agg = collections.defaultdict(list)
    for r in rows:
        if not cohort_filter(r) or r['err_m'] == '':
            continue
        agg[(r['predictor'], r['k'], r['horizon'], r['group'])].append(r['err_m'])
    out = {}
    for (pred, k, hz, grp), vals in agg.items():
        key = f"{pred}{'' if k == '' else '(k=' + str(k) + ')'}|{hz}|{grp}"
        out[key] = {'n': len(vals), 'mean_m': round(statistics.mean(vals), 4),
                    'median_m': round(statistics.median(vals), 4)}
    return out


def paired_vs_ca(rows, cohort_filter, horizon):
    """Paired difference (predictor minus CA) by game, with a game-clustered bootstrap interval."""
    ca = {}
    for r in rows:
        if cohort_filter(r) and r['horizon'] == horizon and r['predictor'] == 'ca' and r['err_m'] != '':
            ca[(r['gameId'], r['playId'], r['nflId'])] = r['err_m']
    result = {}
    for name in ('hold', 'cv', 'dca'):
        by_game = collections.defaultdict(list)
        for r in rows:
            if (cohort_filter(r) and r['horizon'] == horizon and r['predictor'] == name and r['err_m'] != ''
                    and r['k'] in ('', 0.5) or False):
                pass
        diffs = collections.defaultdict(list)
        for r in rows:
            if not cohort_filter(r) or r['horizon'] != horizon or r['predictor'] != name or r['err_m'] == '':
                continue
            if name == 'dca' and r['k'] != FROZEN_K.get('k_used'):
                continue
            key = (r['gameId'], r['playId'], r['nflId'])
            if key in ca:
                diffs[r['gameId']].append(r['err_m'] - ca[key])
        games = sorted(diffs)
        if not games:
            continue
        flat = [d for g in games for d in diffs[g]]
        mean = statistics.mean(flat)
        rng = random.Random(SEED)
        boots = []
        sums = {g: (sum(diffs[g]), len(diffs[g])) for g in games}
        for _ in range(BOOT):
            s = c = 0.0
            for g in (rng.choice(games) for _ in games):
                s += sums[g][0]
                c += sums[g][1]
            boots.append(s / c)
        boots.sort()
        result[name] = {'n': len(flat), 'mean_diff_m': round(mean, 4),
                        'ci95_m': [round(boots[int(0.025 * BOOT)], 4), round(boots[int(0.975 * BOOT) - 1], 4)]}
    return result


FROZEN_K = {}


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {'protocol': 'docs/research/PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md',
              'reserved_2022_weeks_not_read': [6, 7, 8, 9], 'steps': {}}

    # 1. calibration on 2022 Weeks 1 to 3: choose k
    cal_rows = []
    for w in CAL_WEEKS:
        plays = load_2022_week(w)
        rows, _, _, dropped = samples_2022(w, plays, None)
        cal_rows.extend(rows)
        report.setdefault('dropped_2022_cal', collections.Counter()).update(dropped)
    cal_err = collections.defaultdict(list)
    for r in cal_rows:
        if r['predictor'] == 'dca' and r['horizon'] == '1.0s' and r['err_m'] != '':
            cal_err[r['k']].append(r['err_m'])
    curve = {str(k): round(statistics.mean(v), 4) for k, v in sorted(cal_err.items())}
    best = min(cal_err, key=lambda k: (statistics.mean(cal_err[k]), k))
    FROZEN_K['k_used'] = best
    report['steps']['1_calibration_2022_w1to3'] = {
        'k_grid_mean_error_1s_m': curve, 'chosen_k': best,
        'n_samples': len(cal_err[best]),
        'baselines_1s_m': {p: round(statistics.mean(r['err_m'] for r in cal_rows
                                                    if r['predictor'] == p and r['horizon'] == '1.0s'
                                                    and r['err_m'] != ''), 4) for p in PREDICTORS},
    }
    report['steps']['1_calibration_2022_w1to3']['dropped'] = dict(report.pop('dropped_2022_cal', {}))

    # 2. development check on 2022 Weeks 4 to 5, with the frozen k
    dev_rows = []
    for w in DEV_WEEKS:
        plays = load_2022_week(w)
        rows, _, _, dropped = samples_2022(w, plays, None)
        dev_rows.extend(rows)
    dev_filter = lambda r: r['cohort'].startswith('2022_w') and int(r['week']) in DEV_WEEKS and (
        r['predictor'] != 'dca' or r['k'] == best)
    report['steps']['2_development_2022_w4to5'] = {
        'summary': summarize(dev_rows, dev_filter),
        'paired_vs_ca': {h: paired_vs_ca(dev_rows, dev_filter, h) for h in HORIZONS.values()},
    }

    # 3. validation on 2023 train, Weeks 1 to 7, with the frozen k
    val_rows, val_dropped, val_align = [], collections.Counter(), 0
    for w in VAL_WEEKS:
        plays = load_2023_week(w)
        rows, dropped, align_fail = samples_2023(w, plays)
        val_rows.extend(rows)
        val_dropped.update(dropped)
        val_align += align_fail
    total_plays = sum(1 for _ in set((r['gameId'], r['playId']) for r in val_rows))
    report['steps']['3_validation_2023_train_w1to7'] = {
        'frame_alignment_failures': val_align,
        'dropped': dict(val_dropped),
        'plays_scored': total_plays,
        'summary_all': summarize(val_rows, lambda r: r['cohort'].startswith('2023') and (
            r['predictor'] != 'dca' or r['k'] == best) and not r['group'].startswith('role:')),
        'summary_by_role_tag': summarize(val_rows, lambda r: r['cohort'].startswith('2023') and (
            r['predictor'] != 'dca' or r['k'] == best) and r['group'].startswith('role:')),
        'paired_vs_ca': {h: paired_vs_ca(val_rows, lambda r: r['cohort'].startswith('2023') and not
                                         r['group'].startswith('role:'), h) for h in HORIZONS.values()},
    }

    with open(os.path.join(OUT, 'movement_experiment_1.json'), 'w') as f:
        json.dump(report, f, indent=1, sort_keys=True, default=str)
    print(json.dumps({k: v for k, v in report['steps'].items()}, indent=1, sort_keys=True, default=str)[:3000])


if __name__ == '__main__':
    main()
