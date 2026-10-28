#!/usr/bin/env python3
"""Historical-only movement baselines for Part B (2022 calibration, 2023 validation)."""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path('/root/gridiron-playbooks-research')
TRACK_2022 = Path('/root/nfl-tracking-data/bdb2025')
TRACK_2023 = Path('/root/nfl-tracking-data/bdb2026-prediction')
OUT = ROOT / 'data/playbooks/research-2026-10-28-partb-movement'
PROTOCOL = ROOT / 'docs/research/PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md'
HORIZONS = (5, 10)
DT = 0.1
YD_TO_M = 0.9144
BOOTSTRAPS = 2000
BOOT_SEED = 20261028


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def solve_linear(matrix, vector):
    """Small Gauss-Jordan solve for the two- or three-coefficient baseline fit."""
    a = [list(map(float, row)) + [float(value)] for row, value in zip(matrix, vector)]
    n = len(a)
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(a[row][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise RuntimeError('singular polynomial fit')
        a[col], a[pivot] = a[pivot], a[col]
        scale = a[col][col]
        a[col] = [value / scale for value in a[col]]
        for row in range(n):
            if row == col:
                continue
            scale = a[row][col]
            a[row] = [value - scale * pivot_value for value, pivot_value in zip(a[row], a[col])]
    return [a[row][-1] for row in range(n)]


def fit_predict(history: list[tuple[float, float]], horizon_steps: int, degree: int):
    points = history[-6:]
    times = [(-len(points) + 1 + i) * DT for i in range(len(points))]
    size = degree + 1
    matrix = [[sum(t ** (i + j) for t in times) for j in range(size)] for i in range(size)]
    betas = []
    for axis in (0, 1):
        vector = [sum((t ** i) * point[axis] for t, point in zip(times, points)) for i in range(size)]
        betas.append(solve_linear(matrix, vector))
    return [tuple(sum(betas[axis][power] * (step * DT) ** power for power in range(size))
                  for axis in (0, 1)) for step in range(1, horizon_steps + 1)]


def position_scores(history, truth, horizon_steps):
    cv = fit_predict(history, horizon_steps, 1)
    ca = fit_predict(history, horizon_steps, 2)
    return scores_from_paths(cv, ca, truth, horizon_steps), cv, ca


def scores_from_paths(cv, ca, truth, horizon_steps):
    observed = truth[:horizon_steps]
    cv_dist = [math.dist(a, b) for a, b in zip(cv, observed)]
    ca_dist = [math.dist(a, b) for a, b in zip(ca, observed)]
    return {
        'cv_end': cv_dist[-1], 'ca_end': ca_dist[-1],
        'cv_ade': statistics.fmean(cv_dist), 'ca_ade': statistics.fmean(ca_dist),
    }


def trajectory_summary(points, horizon_steps):
    values = points[:horizon_steps]
    if len(values) < 2:
        return {'path_speed_m_s': None, 'accel_m_s2': None, 'turn_deg': None}
    velocity = [((b[0] - a[0]) / DT, (b[1] - a[1]) / DT) for a, b in zip(values, values[1:])]
    speed = [math.hypot(v[0], v[1]) for v in velocity]
    accel = [math.hypot(b[0] - a[0], b[1] - a[1]) / DT for a, b in zip(velocity, velocity[1:])]
    turn = []
    for a, b in zip(velocity, velocity[1:]):
        denom = math.hypot(*a) * math.hypot(*b)
        if denom > 1e-8:
            cosine = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / denom))
            turn.append(math.degrees(math.acos(cosine)))
    return {
        'path_speed_m_s': statistics.fmean(speed) if speed else None,
        'accel_m_s2': statistics.fmean(accel) if accel else None,
        'turn_deg': statistics.fmean(turn) if turn else None,
    }


def bootstrap_mean_ci(rows, value_key, seed):
    games = sorted({row['game'] for row in rows})
    if len(games) < 2 or not rows:
        return [None, None]
    by_game = defaultdict(lambda: [0.0, 0])
    for row in rows:
        by_game[row['game']][0] += float(row[value_key])
        by_game[row['game']][1] += 1
    rng = random.Random(seed)
    samples = []
    for _ in range(BOOTSTRAPS):
        chosen = [rng.choice(games) for _ in games]
        total = sum(by_game[game][0] for game in chosen)
        count = sum(by_game[game][1] for game in chosen)
        if count:
            samples.append(total / count)
    samples.sort()
    return [samples[int(0.025 * len(samples))], samples[min(len(samples) - 1, int(0.975 * len(samples)))]]


def summarize_records(records, dataset):
    grouped = defaultdict(list)
    for row in records:
        grouped[('all', 'all')].append(row)
        grouped[('role', row['role'])].append(row)
        grouped[('position', row['position'])].append(row)
        grouped[('role_position', f"{row['role']}|{row['position']}")].append(row)
        if row.get('down'):
            grouped[('down_role', f"down={row['down']}|{row['role']}")].append(row)
    out = []
    for horizon in HORIZONS:
        for (kind, name), candidates in sorted(grouped.items()):
            subset = [r for r in candidates if r['horizon'] == horizon]
            if not subset:
                continue
            row = {'dataset': dataset, 'horizon_frames': horizon, 'horizon_seconds': horizon * DT,
                   'group': kind, 'value': name, 'tracks': len(subset),
                   'games': len({x['game'] for x in subset})}
            for metric in ('cv_end', 'ca_end', 'cv_ade', 'ca_ade'):
                vals = [x[metric] for x in subset]
                row[f'{metric}_mean_m'] = statistics.fmean(vals)
                row[f'{metric}_rmse_m'] = math.sqrt(statistics.fmean(v * v for v in vals))
            row['ca_minus_cv_endpoint_mean_m'] = statistics.fmean(x['ca_end'] - x['cv_end'] for x in subset)
            delta_rows = [{'game': x['game'], 'delta': x['ca_end'] - x['cv_end']} for x in subset]
            row['ca_minus_cv_endpoint_95ci_m'] = bootstrap_mean_ci(delta_rows, 'delta', BOOT_SEED + horizon + len(out))
            for metric in ('path_speed_m_s', 'accel_m_s2', 'turn_deg'):
                usable = [x[metric] for x in subset if x.get(metric) is not None]
                row[f'observed_{metric}_mean'] = statistics.fmean(usable) if usable else None
            out.append(row)
    return out


def load_2022():
    audit = TRACK_2022 / 'audit/bdb2025-snap-all-player-parts-v1'
    records = []
    weekly = []
    presnap = []
    source_hashes = {}
    for week in range(1, 6):
        summary_path = audit / f'week-{week}.json'
        summary = json.loads(summary_path.read_text())
        obs_path = audit / f'week-{week}.jsonl.gz'
        observed_hash = sha256(obs_path)
        if observed_hash != summary['observationsSha256']:
            raise RuntimeError(f'2022 prepared observation hash mismatch in week {week}')
        source_hashes[str(week)] = {
            'prepared_observations_sha256': observed_hash,
            'source_tracking_sha256_from_staged_manifest': summary['sourceSha256FromStagedManifest'][f'code-data/tracking_week_{week}.csv'],
        }
        play_count = 0
        with gzip.open(obs_path, 'rt', encoding='utf-8') as stream:
            for line in stream:
                play = json.loads(line)
                play_count += 1
                game = str(play['gameId'])
                metadata = play['metadata']
                down = str(metadata.get('down', ''))
                for player in play['players']:
                    history = [tuple(x) for x in player['inputPositionsM']]
                    labels = [tuple(x) for x in player['labelPositionsM']]
                    if len(history) != 6 or len(labels) != 11:
                        raise RuntimeError('unexpected 2022 snap-anchored trajectory span')
                    role = player['role']
                    pos = player['position']
                    cv_path = fit_predict(history, max(HORIZONS), 1)
                    ca_path = fit_predict(history, max(HORIZONS), 2)
                    for horizon in HORIZONS:
                        scores = scores_from_paths(cv_path, ca_path, labels[1:], horizon)
                        movement = trajectory_summary(labels[:horizon + 1], horizon + 1)
                        records.append({
                            'dataset': '2022', 'game': game, 'play': str(play['playId']),
                            'week': week, 'role': role, 'position': pos, 'down': down,
                            'horizon': horizon, **scores, **movement,
                        })
                    # The final four 10-Hz intervals are the available 0.4 s pre-snap window.
                    pre = history[-5:]
                    displacement = math.dist(pre[-1], pre[0])
                    speed = displacement / 0.4
                    if role == 'offense':
                        presnap.append({'game': game, 'position': pos, 'speed_m_s': speed,
                                        'displacement_m': displacement,
                                        'motion_proxy': speed > 0.566928 and displacement > 1.09728})
        counts = summary['countsByWeek'][str(week)]
        weekly.append({'week': week, 'games': 16, 'plays_in_tracking': counts['plays_in_tracking'],
                       'all_player_complete_plays': counts['included'], 'scored_plays': play_count,
                       'source_tracking_sha256': source_hashes[str(week)]['source_tracking_sha256_from_staged_manifest']})
        if play_count != counts['included']:
            raise RuntimeError(f'2022 prepared coverage count mismatch in week {week}')
    presnap_rows = []
    for position in sorted({r['position'] for r in presnap}):
        rows = [r for r in presnap if r['position'] == position]
        presnap_rows.append({'position': position, 'players': len(rows),
                             'mean_speed_m_s_final_0_4s': statistics.fmean(r['speed_m_s'] for r in rows),
                             'motion_proxy_players': sum(r['motion_proxy'] for r in rows),
                             'motion_proxy_share': statistics.fmean(float(r['motion_proxy']) for r in rows)})
    return records, {'weeks': weekly, 'plays': sum(r['scored_plays'] for r in weekly),
                     'games': 80, 'players_per_play': 22, 'input_frames_per_player': 6,
                     'label_frames_per_player': 11, 'ball_rows_per_play': 11,
                     'prepared_observation_hashes': source_hashes,
                     'presnap_motion_proxy_by_position': presnap_rows}


def parse_2023():
    train = TRACK_2023 / 'train'
    manifest = TRACK_2023 / 'SHA256SUMS.txt'
    manifest_hashes = {}
    wanted = {f'{kind}_2023_w{week:02d}.csv' for kind in ('input', 'output') for week in range(1, 8)}
    for line in manifest.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) >= 2:
            name = parts[-1].lstrip('*').split('/')[-1]
            if name in wanted:
                manifest_hashes[name] = parts[0]
    if set(manifest_hashes) != wanted:
        raise RuntimeError('2023 manifest does not contain exactly the fourteen approved train files')

    all_records = []
    weekly = []
    target_roles = Counter()
    target_positions = Counter()
    target_horizon_counts = Counter()
    pair_coverage = Counter()
    all_games = set()
    all_plays = 0
    input_rows_total = output_rows_total = 0
    for week in range(1, 8):
        in_name, out_name = f'input_2023_w{week:02d}.csv', f'output_2023_w{week:02d}.csv'
        hashes = {name: sha256(train / name) for name in (in_name, out_name)}
        if any(hashes[name] != manifest_hashes[name] for name in hashes):
            raise RuntimeError(f'2023 train file hash mismatch in week {week}')
        tracks = {}
        plays = set()
        input_rows = 0
        with (train / in_name).open(newline='', encoding='utf-8') as stream:
            for row in csv.DictReader(stream):
                input_rows += 1
                game, play = row['game_id'], row['play_id']
                plays.add((game, play))
                if row['player_to_predict'].strip().lower() not in ('true', '1'):
                    continue
                key = (game, play, row['nfl_id'])
                track = tracks.setdefault(key, {'game': game, 'play': play, 'week': week,
                    'role': row['player_role'], 'position': row['player_position'],
                    'side': row['player_side'], 'history': [], 'expected': set()})
                if (track['role'], track['position'], track['side']) != (row['player_role'], row['player_position'], row['player_side']):
                    raise RuntimeError(f'2023 target identity fields vary within track {key}')
                track['history'].append((int(row['frame_id']),
                                         (float(row['x']) * YD_TO_M, float(row['y']) * YD_TO_M)))
                track['expected'].add(int(row['num_frames_output']))
        outputs = defaultdict(dict)
        output_rows = 0
        with (train / out_name).open(newline='', encoding='utf-8') as stream:
            for row in csv.DictReader(stream):
                output_rows += 1
                key = (row['game_id'], row['play_id'], row['nfl_id'])
                frame = int(row['frame_id'])
                outputs[key][frame] = (float(row['x']) * YD_TO_M, float(row['y']) * YD_TO_M)
        if set(outputs) != set(tracks):
            raise RuntimeError(f'2023 input/output target identities differ in week {week}')
        for key, track in tracks.items():
            track['history'].sort(key=lambda item: item[0])
            frame_ids = [item[0] for item in track['history']]
            if not frame_ids or frame_ids != list(range(frame_ids[0], frame_ids[-1] + 1)):
                raise RuntimeError(f'2023 target input frames are not contiguous: {key}')
            track['history_positions'] = [item[1] for item in track['history']]
            track['output'] = outputs[key]
            out_ids = sorted(track['output'])
            if out_ids != list(range(1, len(out_ids) + 1)):
                raise RuntimeError(f'2023 output frame ids are not contiguous from one: {key}')
            if len(track['expected']) != 1 or next(iter(track['expected'])) != len(out_ids):
                raise RuntimeError(f'2023 num_frames_output mismatch: {key}')
            if len(track['history_positions']) < 6:
                raise RuntimeError(f'2023 target has fewer than six input positions: {key}')
            track['cv_path'] = fit_predict(track['history_positions'], max(HORIZONS), 1)
            track['ca_path'] = fit_predict(track['history_positions'], max(HORIZONS), 2)
            target_roles[track['role']] += 1
            target_positions[track['position']] += 1
            for horizon in HORIZONS:
                if len(out_ids) >= horizon:
                    target_horizon_counts[(track['role'], horizon)] += 1
                    truth = [track['output'][i] for i in range(1, horizon + 1)]
                    scores = scores_from_paths(track['cv_path'], track['ca_path'], truth, horizon)
                    movement = trajectory_summary(truth, horizon)
                    all_records.append({**scores, **movement, 'game': track['game'], 'play': track['play'],
                        'week': week, 'role': track['role'], 'position': track['position'],
                        'horizon': horizon})
        # Pair support is measured by role and horizon before future coordinates are summarized.
        by_play = defaultdict(list)
        for key, track in tracks.items():
            by_play[(track['game'], track['play'])].append((key, track))
        for play_key, members in by_play.items():
            for horizon in HORIZONS:
                recs = [t for _, t in members if t['role'] == 'Targeted Receiver' and len(t['output']) >= horizon]
                defs = [t for _, t in members if t['role'] == 'Defensive Coverage' and len(t['output']) >= horizon]
                if recs and defs:
                    pair_coverage[horizon] += 1
        all_games.update(game for game, _ in plays)
        all_plays += len(plays)
        input_rows_total += input_rows
        output_rows_total += output_rows
        weekly.append({'week': week, 'games': len({g for g, _ in plays}), 'plays': len(plays),
            'input_rows': input_rows, 'target_tracks': len(tracks), 'output_target_rows': output_rows,
            'target_tracks_h5': sum(1 for t in tracks.values() if len(t['output']) >= 5),
            'target_tracks_h10': sum(1 for t in tracks.values() if len(t['output']) >= 10),
            'input_sha256': hashes[in_name], 'output_sha256': hashes[out_name]})
    return all_records, {'weeks': weekly, 'games': len(all_games), 'plays': all_plays,
        'input_rows': input_rows_total, 'target_tracks': sum(target_roles.values()),
        'output_rows': output_rows_total, 'target_tracks_by_role': dict(target_roles),
        'target_tracks_by_position': dict(target_positions),
        'target_tracks_by_role_horizon': {f'{role}|h{h}': n for (role, h), n in target_horizon_counts.items()},
        'plays_with_receiver_and_coverage_labels_by_horizon': {str(h): n for h, n in pair_coverage.items()},
        'manifest_path': str(TRACK_2023 / 'SHA256SUMS.txt')}


def score_2023_pairs():
    train = TRACK_2023 / 'train'
    pair_rows = []
    for week in range(1, 8):
        tracks = {}
        with (train / f'input_2023_w{week:02d}.csv').open(newline='', encoding='utf-8') as stream:
            for row in csv.DictReader(stream):
                if row['player_to_predict'].strip().lower() not in ('true', '1'):
                    continue
                key = (row['game_id'], row['play_id'], row['nfl_id'])
                t = tracks.setdefault(key, {'game': row['game_id'], 'play': row['play_id'], 'week': week,
                    'role': row['player_role'], 'position': row['player_position'], 'history': []})
                t['history'].append((int(row['frame_id']),
                    (float(row['x']) * YD_TO_M, float(row['y']) * YD_TO_M)))
        outputs = defaultdict(dict)
        with (train / f'output_2023_w{week:02d}.csv').open(newline='', encoding='utf-8') as stream:
            for row in csv.DictReader(stream):
                outputs[(row['game_id'], row['play_id'], row['nfl_id'])][int(row['frame_id'])] = (
                    float(row['x']) * YD_TO_M, float(row['y']) * YD_TO_M)
        by_play = defaultdict(list)
        for key, t in tracks.items():
            t['history'].sort(key=lambda item: item[0])
            t['history_positions'] = [p for _, p in t['history']]
            t['output'] = outputs[key]
            by_play[(t['game'], t['play'])].append(t)
        for (game, play), members in by_play.items():
            receivers = [t for t in members if t['role'] == 'Targeted Receiver']
            defenders = [t for t in members if t['role'] == 'Defensive Coverage']
            for horizon in HORIZONS:
                for receiver in receivers:
                    if len(receiver['output']) < horizon:
                        continue
                    rframe = {f: p for f, p in receiver['history']}
                    candidates = []
                    for defender in defenders:
                        if len(defender['output']) < horizon:
                            continue
                        dframe = {f: p for f, p in defender['history']}
                        shared = sorted(set(rframe) & set(dframe))
                        if not shared:
                            continue
                        origin_frame = shared[-1]
                        candidates.append((math.dist(rframe[origin_frame], dframe[origin_frame]), defender,
                                           origin_frame, rframe[origin_frame], dframe[origin_frame]))
                    if not candidates:
                        continue
                    _, defender, origin, r0, d0 = min(candidates, key=lambda item: item[0])
                    r_hist = [p for f, p in receiver['history'] if f <= origin]
                    d_hist = [p for f, p in defender['history'] if f <= origin]
                    if len(r_hist) < 6 or len(d_hist) < 6:
                        continue
                    cv_r = fit_predict(r_hist, horizon, 1)[-1]
                    ca_r = fit_predict(r_hist, horizon, 2)[-1]
                    cv_d = fit_predict(d_hist, horizon, 1)[-1]
                    ca_d = fit_predict(d_hist, horizon, 2)[-1]
                    actual_r = receiver['output'][horizon]
                    actual_d = defender['output'][horizon]
                    actual_sep = math.dist(actual_r, actual_d)
                    origin_sep = math.dist(r0, d0)
                    cv_sep = math.dist(cv_r, cv_d)
                    ca_sep = math.dist(ca_r, ca_d)
                    pair_rows.append({'game': game, 'play': play, 'week': week, 'horizon': horizon,
                        'receiver_position': receiver['position'], 'origin_separation_m': origin_sep,
                        'actual_separation_m': actual_sep, 'observed_closure_m': origin_sep - actual_sep,
                        'cv_separation_error_m': abs(cv_sep - actual_sep),
                        'ca_separation_error_m': abs(ca_sep - actual_sep),
                        'ca_minus_cv_separation_error_m': abs(ca_sep - actual_sep) - abs(cv_sep - actual_sep)})
    return pair_rows


def summarize_pairs(rows):
    output = []
    groups = defaultdict(list)
    for row in rows:
        groups[('all', 'all')].append(row)
        groups[('receiver_position', row['receiver_position'])].append(row)
    for horizon in HORIZONS:
        for (kind, name), members in sorted(groups.items()):
            subset = [r for r in members if r['horizon'] == horizon]
            if not subset:
                continue
            result = {'horizon_frames': horizon, 'horizon_seconds': horizon * DT, 'group': kind,
                'value': name, 'pairs': len(subset), 'games': len({r['game'] for r in subset}),
                'origin_separation_mean_m': statistics.fmean(r['origin_separation_m'] for r in subset),
                'observed_separation_mean_m': statistics.fmean(r['actual_separation_m'] for r in subset),
                'observed_closure_mean_m': statistics.fmean(r['observed_closure_m'] for r in subset),
                'cv_separation_error_mean_m': statistics.fmean(r['cv_separation_error_m'] for r in subset),
                'ca_separation_error_mean_m': statistics.fmean(r['ca_separation_error_m'] for r in subset),
                'ca_minus_cv_separation_error_mean_m': statistics.fmean(r['ca_minus_cv_separation_error_m'] for r in subset)}
            delta = [{'game': r['game'], 'd': r['ca_minus_cv_separation_error_m']} for r in subset]
            result['ca_minus_cv_separation_error_95ci_m'] = bootstrap_mean_ci(delta, 'd', BOOT_SEED + horizon + len(output))
            output.append(result)
    return output


def main():
    if not PROTOCOL.is_file():
        raise RuntimeError('frozen 2023 validation protocol is missing')
    protocol_hash = sha256(PROTOCOL)
    OUT.mkdir(parents=True, exist_ok=True)

    records_2022, coverage_2022 = load_2022()
    records_2023, coverage_2023 = parse_2023()
    pairs_2023 = score_2023_pairs()
    result = {
        'scope': '2022 weeks 1-5 development; 2023 train weeks 1-7 frozen historical validation only',
        'protocol_sha256': protocol_hash,
        'protocol_path': str(PROTOCOL),
        'source_code_sha256': sha256(Path(__file__)),
        'bootstrap': {'replicates': BOOTSTRAPS, 'seed': BOOT_SEED, 'cluster': 'game'},
        'coverage_2022': coverage_2022,
        'coverage_2023': coverage_2023,
        'metrics_2022_by_role_situation_position': summarize_records(records_2022, '2022_development'),
        'metrics_2023_by_role_situation_position': summarize_records(records_2023, '2023_validation'),
        'separation_pursuit_2023': summarize_pairs(pairs_2023),
        'pair_rows_2023': len(pairs_2023),
    }
    path = OUT / 'movement_metrics.json'
    path.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'output': str(path), 'protocol_sha256': protocol_hash,
        '2022_plays': coverage_2022['plays'], '2023_plays': coverage_2023['plays'],
        '2023_target_tracks': coverage_2023['target_tracks'], '2023_pair_rows': len(pairs_2023)}, sort_keys=True))


if __name__ == '__main__':
    main()
