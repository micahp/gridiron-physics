"""Extract the frame windows the Part B protocol needs from the 2022 development weeks. Read only.

Weeks 1 to 5 only. Weeks 6 to 9 are reserved and are not opened; the week list is asserted before any read.
For each protocol-eligible play (LP `eligible_input` and a ball_snap frame), keeps every player row with a frame from
origin - 2 to origin + 20, where origin is the ball_snap frame. Writes a compact CSV per week to the scratch directory.
Positions are kept as recorded. Nothing is written to the repository.
"""
import csv
import multiprocessing as mp
import os
import sys

csv.field_size_limit(sys.maxsize)

BDB22 = '/root/nfl-tracking-data/bdb2025/code-data'
COHORT = '/root/nfl-tracking-data/bdb2025/snap-anchored-v1'
INVENTORY = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-partb-tracking-inventory/tracking_2022_weeks1to5_per_play.csv'
SCRATCH = '/tmp/claude-0/-root/4a715766-ff4b-4980-99e5-dc209eaac7d4/scratchpad/partb'
WEEKS = (1, 2, 3, 4, 5)
RESERVED = (6, 7, 8, 9)
REL_MIN, REL_MAX = -2, 20


def eligible_origins(week):
    """(gameId, playId) -> origin (ball_snap frame) for plays the LP cohort marks eligible in this week."""
    cohort = {}
    with open(os.path.join(COHORT, f'cohort_week_{week}.csv'), newline='') as f:
        for r in csv.DictReader(f):
            if r['eligible_input'] == 'True':
                cohort[(r['gameId'], r['playId'])] = True
    origins = {}
    with open(INVENTORY, newline='') as f:
        for r in csv.DictReader(f):
            if r['week'] != str(week):
                continue
            key = (r['gameId'], r['playId'])
            if key in cohort and r['snap_frame'] not in ('', None):
                origins[key] = int(r['snap_frame'])
    return origins


def positions(path):
    out = {}
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            out[r['nflId']] = r['position']
    return out


def extract(week):
    assert week in WEEKS and week not in RESERVED, f'week {week} is not a permitted development week'
    origins = eligible_origins(week)
    pos = positions(os.path.join(BDB22, 'players.csv'))
    os.makedirs(SCRATCH, exist_ok=True)
    out_path = os.path.join(SCRATCH, f'window_2022_w{week}.csv')
    kept = 0
    with open(os.path.join(BDB22, f'tracking_week_{week}.csv'), newline='') as f, \
            open(out_path, 'w', newline='') as g:
        w = csv.writer(g)
        w.writerow(['week', 'gameId', 'playId', 'origin_frame', 'rel_frame', 'nflId', 'position', 'club',
                    'frameType', 'x', 'y', 's', 'a', 'o', 'dir'])
        rd = csv.DictReader(f)
        for r in rd:
            if r['nflId'] in ('NA', ''):
                continue
            origin = origins.get((r['gameId'], r['playId']))
            if origin is None:
                continue
            rel = int(r['frameId']) - origin
            if rel < REL_MIN or rel > REL_MAX:
                continue
            w.writerow([week, r['gameId'], r['playId'], origin, rel, r['nflId'], pos.get(r['nflId'], ''), r['club'],
                        r['frameType'], r['x'], r['y'], r['s'], r['a'], r['o'], r['dir']])
            kept += 1
    return {'week': week, 'eligible_plays': len(origins), 'rows_kept': kept, 'path': out_path}


def main():
    with mp.Pool(3) as pool:
        results = pool.map(extract, WEEKS)
    for r in results:
        print(r)


if __name__ == '__main__':
    main()
