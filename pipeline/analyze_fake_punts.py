"""Fake-punt frequency and outcomes, regular season 2022 to 2026. Read-only.

Fake punt: a run or pass snap whose description says Punt formation (nflverse codes it as a scrimmage play).
Punt situation: a real punt (play_type punt) or a fake punt, for the team that had the ball.
A rate is printed only where the denominator reaches MIN_N. Smaller cells print the count alone.
"""
import collections
import math
import csv
import gzip
import os
import re

import pyarrow.parquet as pq

RAW = '/root/lp-snapshots/nfl-backfill-2026-10-27/raw'
PIN = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-27/inputs'
SNAP = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27/data/playbooks/research-2026-10-27/inputs'
MIN_N = 30
COLS = ['season', 'season_type', 'game_id', 'play_id', 'posteam', 'defteam', 'down', 'ydstogo', 'yardline_100',
        'play_type', 'desc', 'first_down', 'yards_gained', 'interception', 'fumble_lost', 'punt_attempt']


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load():
    rows = []
    for s in range(2022, 2026):
        for r in pq.read_table(f'{RAW}/pbp/play_by_play_{s}.parquet', columns=COLS).to_pylist():
            r['season'] = s
            rows.append(r)
    p26 = next(p for p in [f'{PIN}/pbp_2026_week7.csv.gz', f'{SNAP}/pbp_2026_week7.csv.gz'] if os.path.exists(p))
    for r in csv.DictReader(gzip.open(p26, 'rt', newline='')):
        rows.append(r)
    return rows


def kind(r):
    desc = (r.get('desc') or '').lower()
    if r.get('season_type') != 'REG':
        return None
    if r.get('play_type') == 'punt':
        return 'punt'
    if r.get('play_type') in ('run', 'pass') and 'punt formation' in desc:
        if re.search(r'\bpunts\b', desc):
            raise ValueError('punt formation play described as a punt')
        return 'fake'
    return None


def dist_bucket(d):
    if d is None:
        return 'unknown'
    if d <= 3:
        return '1 to 3'
    if d <= 6:
        return '4 to 6'
    if d <= 9:
        return '7 to 9'
    return '10 or more'


def field_bucket(y):
    if y is None:
        return 'unknown'
    if y >= 75:
        return 'own 1 to 25'
    if y >= 50:
        return 'own 26 to 49'
    if y >= 25:
        return 'opponent 49 to 26'
    return 'opponent 25 or closer'


def first_down(r):
    v = r.get('first_down')
    return (num(v) == 1.0) if v not in (None, '') else None


def main():
    rows = load()
    situations = [(r, kind(r)) for r in rows]
    situations = [(r, k) for r, k in situations if k]
    print('punt situations 2022 to 2026:', collections.Counter(k for _, k in situations))
    fakes = [(r, k) for r, k in situations if k == 'fake']
    print('fake punts by season:', dict(sorted(collections.Counter(int(r['season']) for r, _ in fakes).items())))
    print('fake punts that gained a first down:', sum(1 for r, _ in fakes if first_down(r)), 'of', len(fakes))

    def table(name, key):
        tot = collections.Counter()
        fk = collections.Counter()
        for r, k in situations:
            cell = key(r)
            tot[cell] += 1
            if k == 'fake':
                fk[cell] += 1
        print(f'\n{name}: fake punts / punt situations')
        for cell in sorted(tot):
            n = tot[cell]
            f = fk[cell]
            rate = f'{f / n:.3f}' if n >= MIN_N else 'n too small'
            print(f'  {cell:22s} {f:3d} / {n:4d}  {rate}')

    table('by down', lambda r: str(int(float(r['down']))) if r.get('down') not in (None, '') else 'unknown')
    table('by distance', lambda r: dist_bucket(num(r.get('ydstogo'))))
    table('by field position', lambda r: field_bucket(num(r.get('yardline_100'))))

    print('\nby team (fake punts / punt situations, pooled 2022 to 2026)')
    team_tot = collections.Counter()
    team_fake = collections.Counter()
    for r, k in situations:
        team_tot[r['posteam']] += 1
        if k == 'fake':
            team_fake[r['posteam']] += 1
    league = sum(team_fake.values()) / sum(team_tot.values())
    print(f'  league rate {league:.5f}; upper-tail binomial p is shown against that rate')
    for t in sorted(team_tot):
        n = team_tot[t]
        f = team_fake[t]
        upper = sum(math.comb(n, i) * league ** i * (1 - league) ** (n - i) for i in range(f, n + 1)) if f else 1.0
        print(f'  {t:4s} {f:2d} / {n:3d}  {(f / n):.3f}  expected {n * league:.2f}  p {upper:.4f}')

    print('\nfake-punt outcomes (all fakes; small n, counts only)')
    print('  first down:', sum(1 for r, _ in fakes if first_down(r)), ' turnovers:',
          sum(1 for r, _ in fakes if (num(r.get('interception')) or 0) + (num(r.get('fumble_lost')) or 0) > 0),
          ' mean yards:', round(sum(num(r.get('yards_gained')) or 0 for r, _ in fakes) / len(fakes), 2))


if __name__ == '__main__':
    main()
