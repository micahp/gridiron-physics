"""Part B tracking inventory, read only. Covers the 2022 development weeks and the 2023 train split.

2022 (bdb2025): Weeks 1 to 5 only. Weeks 6 to 9 are reserved for model-level held-out evaluation and are never opened
here. Each week's frame-level file is streamed once. Per play we keep counts and frame markers, not trajectories.

2023 (bdb2026-prediction, train split): Weeks 1 to 7 input and output files. The hidden test split is not on disk and is
not read.

Writes per-play coverage and joins, plus a per-week summary, to the inventory directory. Positions are not written.
"""
import collections
import csv
import json
import multiprocessing as mp
import os
import statistics
import sys

csv.field_size_limit(sys.maxsize)

BDB22 = '/root/nfl-tracking-data/bdb2025/code-data'
BDB22_AUDIT = '/root/nfl-tracking-data/bdb2025/snap-anchored-v1'
BDB23 = '/root/nfl-tracking-data/bdb2026-prediction/train'
OUT = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-partb-tracking-inventory'
WEEKS_22_DEV = (1, 2, 3, 4, 5)
RESERVED_22 = (6, 7, 8, 9)
WEEKS_23_TRAIN = (1, 2, 3, 4, 5, 6, 7)
MARKER_EVENTS = ('line_set', 'ball_snap', 'huddle_break_offense', 'man_in_motion', 'handoff', 'pass_forward',
                 'pass_arrived', 'pass_outcome_caught', 'first_contact', 'tackle', 'out_of_bounds', 'touchdown')


def stream_week_22(week):
    """One pass over a 2022 tracking week. Returns per-play coverage keyed by (gameId, playId)."""
    assert week in WEEKS_22_DEV, f'week {week} is reserved; not read'
    path = os.path.join(BDB22, f'tracking_week_{week}.csv')
    plays = {}
    rows = 0
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            rows += 1
            key = (r['gameId'], r['playId'])
            p = plays.get(key)
            if p is None:
                p = plays[key] = {'frames': set(), 'frame_types': {}, 'players': {}, 'ball_rows': 0,
                                  'events': collections.Counter(), 'snap_frame': None, 'line_set_frame': None,
                                  'motion_frame': None, 'before_frames': set(), 'snap_players': set(),
                                  'min_frame': None, 'max_frame': None}
            fid = int(r['frameId'])
            p['frames'].add(fid)
            if p['min_frame'] is None or fid < p['min_frame']:
                p['min_frame'] = fid
            if p['max_frame'] is None or fid > p['max_frame']:
                p['max_frame'] = fid
            ft = r['frameType']
            p['frame_types'].setdefault(ft, set()).add(fid)
            if ft == 'BEFORE_SNAP':
                p['before_frames'].add(fid)
            ev = r['event']
            if ev and ev != 'NA':
                p['events'][ev] += 1
                if ev == 'ball_snap' and p['snap_frame'] is None:
                    p['snap_frame'] = fid
                if ev == 'line_set' and p['line_set_frame'] is None:
                    p['line_set_frame'] = fid
                if ev == 'man_in_motion' and p['motion_frame'] is None:
                    p['motion_frame'] = fid
            nid = r['nflId']
            if nid in ('NA', ''):
                p['ball_rows'] += 1
                continue
            p['players'].setdefault(nid, {'club': r['club'], 'frames': 0})['frames'] += 1
            if ft == 'SNAP':
                p['snap_players'].add(nid)
    return {'rows': rows, 'plays': plays}


def summarise_week_22(week, res):
    plays = res['plays']
    per_play = []
    for (game_id, play_id), p in plays.items():
        n_players = len(p['players'])
        frame_counts = [v['frames'] for v in p['players'].values()]
        per_play.append({
            'week': week, 'gameId': game_id, 'playId': play_id, 'frames': len(p['frames']),
            'before_snap_frames': len(p['before_frames']),
            'min_frame': p['min_frame'], 'max_frame': p['max_frame'],
            'players_tracked': n_players, 'ball_rows': p['ball_rows'],
            'snap_frame': p['snap_frame'] if p['snap_frame'] is not None else '',
            'line_set_frame': p['line_set_frame'] if p['line_set_frame'] is not None else '',
            'motion_frame': p['motion_frame'] if p['motion_frame'] is not None else '',
            'players_at_snap_frame': len(p['snap_players']),
            'min_player_frames': min(frame_counts) if frame_counts else 0,
            'median_player_frames': statistics.median(frame_counts) if frame_counts else 0,
            'has_snap_marker': p['snap_frame'] is not None,
            'has_line_set': p['line_set_frame'] is not None,
            'has_motion_marker': p['motion_frame'] is not None,
            'events': ';'.join(sorted(p['events'])),
            'clubs': ';'.join(sorted({v['club'] for v in p['players'].values()})),
        })
    return {'week': week, 'raw_rows': res['rows'], 'plays': per_play}


def inventory_22(weeks=WEEKS_22_DEV):
    with mp.Pool(min(3, len(weeks))) as pool:
        results = pool.map(stream_week_22, weeks)
    out = {}
    for week, res in zip(weeks, results):
        out[week] = summarise_week_22(week, res)
    return out


def joins_22(all_plays):
    """Join tracked plays to plays.csv, player_play and the LP snap-anchored cohort (weeks 1 to 5 only)."""
    plays_csv = {}
    with open(os.path.join(BDB22, 'plays.csv'), newline='') as f:
        for r in csv.DictReader(f):
            plays_csv[(r['gameId'], r['playId'])] = r
    pp_keys = collections.Counter()
    pp_routes = collections.Counter()
    with open(os.path.join(BDB22, 'player_play.csv'), newline='') as f:
        for r in csv.DictReader(f):
            key = (r['gameId'], r['playId'])
            pp_keys[key] += 1
            if r.get('routeRan') not in (None, '', 'NA'):
                pp_routes[key] += 1
    cohort = {}
    for week in WEEKS_22_DEV:
        path = os.path.join(BDB22_AUDIT, f'cohort_week_{week}.csv')
        with open(path, newline='') as f:
            for r in csv.DictReader(f):
                cohort[(int(r['week']), r['gameId'], r['playId'])] = r
    summary = collections.Counter()
    for week, res in all_plays.items():
        for p in res['plays']:
            key = (p['gameId'], p['playId'])
            summary['tracked_plays'] += 1
            summary['tracked_with_plays_csv'] += key in plays_csv
            summary['tracked_with_player_play'] += key in pp_keys
            summary['tracked_with_route_labels'] += key in pp_routes
            c = cohort.get((week, p['gameId'], p['playId']))
            if c is not None:
                summary['in_lp_cohort'] += 1
                summary['lp_eligible_input'] += c.get('eligible_input') == 'True'
            summary['snap_marker'] += bool(p['has_snap_marker'])
            summary['line_set_marker'] += bool(p['has_line_set'])
            summary['motion_marker'] += bool(p['has_motion_marker'])
            summary['players_22_at_snap_frame'] += p['players_at_snap_frame'] >= 22
    return summary, {'plays_csv_plays': len(plays_csv), 'player_play_plays': len(pp_keys),
                     'player_play_plays_with_route_labels': len(pp_routes)}


def inventory_23(weeks=WEEKS_23_TRAIN):
    out = {}
    for week in weeks:
        inp = os.path.join(BDB23, f'input_2023_w{week:02d}.csv')
        outp = os.path.join(BDB23, f'output_2023_w{week:02d}.csv')
        plays = collections.defaultdict(lambda: {'input_frames': set(), 'players': set(), 'roles': collections.Counter(),
                                                 'sides': collections.Counter(), 'target': None,
                                                 'num_frames_output': None, 'ball_land': False})
        with open(inp, newline='') as f:
            for r in csv.DictReader(f):
                p = plays[(r['game_id'], r['play_id'])]
                p['input_frames'].add(int(r['frame_id']))
                p['players'].add(r['nfl_id'])
                p['roles'][r['player_role']] += 1
                p['sides'][r['player_side']] += 1
                if r['player_to_predict'] in ('True', 'true', '1'):
                    p['target'] = r['nfl_id']
                p['num_frames_output'] = r['num_frames_output']
                p['ball_land'] = r['ball_land_x'] not in ('', 'NA')
        out_frames = collections.defaultdict(lambda: {'frames': set(), 'nfl': set()})
        with open(outp, newline='') as f:
            for r in csv.DictReader(f):
                q = out_frames[(r['game_id'], r['play_id'])]
                q['frames'].add(int(r['frame_id']))
                q['nfl'].add(r['nfl_id'])
        summary = collections.Counter()
        for key, p in plays.items():
            o = out_frames.get(key)
            summary['input_plays'] += 1
            summary['has_target'] += p['target'] is not None
            summary['has_output'] += o is not None
            if o is not None:
                summary['output_target_matches_input'] += (p['target'] in o['nfl']) if p['target'] else 0
                summary['output_frames_match_num_frames_output'] += (
                    len(o['frames']) == int(p['num_frames_output'])) if p['num_frames_output'] not in (None, '') else 0
            summary['ball_land_present'] += p['ball_land']
            summary['players_22_or_more'] += len(p['players']) >= 22
        out[week] = {'week': week, 'input_plays': summary['input_plays'], 'output_plays': len(out_frames),
                     'has_target': summary['has_target'], 'has_output': summary['has_output'],
                     'output_target_matches_input': summary['output_target_matches_input'],
                     'output_frames_match_num_frames_output': summary['output_frames_match_num_frames_output'],
                     'ball_land_present': summary['ball_land_present'],
                     'players_22_or_more': summary['players_22_or_more'],
                     'roles_seen': sorted({role for p in plays.values() for role in p['roles']}),
                     'sides_seen': sorted({s for p in plays.values() for s in p['sides']})}
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    inv22 = inventory_22()
    per_play_rows = [p for w in sorted(inv22) for p in inv22[w]['plays']]
    join_summary, join_counts = joins_22(inv22)
    inv23 = inventory_23()
    report = {
        'reserved_2022_weeks_not_read': list(RESERVED_22),
        '2022_dev_weeks': {str(w): {'raw_rows': inv22[w]['raw_rows'], 'tracked_plays': len(inv22[w]['plays']),
                                    'plays_with_snap_marker': sum(p['has_snap_marker'] for p in inv22[w]['plays']),
                                    'plays_with_line_set': sum(p['has_line_set'] for p in inv22[w]['plays']),
                                    'plays_with_motion_marker': sum(p['has_motion_marker'] for p in inv22[w]['plays']),
                                    'plays_22_players_at_snap': sum(p['players_at_snap_frame'] >= 22
                                                                    for p in inv22[w]['plays']),
                                    'median_frames_per_play': statistics.median(p['frames'] for p in inv22[w]['plays'])}
                           for w in inv22},
        '2022_joins': {**join_summary, **join_counts},
        '2023_train_weeks': inv23,
    }
    with open(os.path.join(OUT, 'inventory_summary.json'), 'w') as f:
        json.dump(report, f, indent=1, sort_keys=True)
    with open(os.path.join(OUT, 'tracking_2022_weeks1to5_per_play.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(per_play_rows[0].keys()))
        w.writeheader()
        w.writerows(per_play_rows)
    print(json.dumps(report, indent=1, sort_keys=True)[:4000])


if __name__ == '__main__':
    main()
