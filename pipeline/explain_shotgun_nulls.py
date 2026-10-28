"""Explain every null in the rev2 shotgun tendency. Read-only.

Uses the builder's own loaders and classifier, so the null set is the one the builder counts. Each null play gets a
reason from FTN (game absent, play absent, or qb_location zero or blank) and from participation (season absent,
row absent, or formation blank). Totals are reconciled against the rev2 profiles for both sides.
"""
import collections
import csv
import glob
import json
import os
import sys

sys.path.insert(0, '/root/gridiron-playbooks-research/pipeline')
import build_playbooks as b  # noqa: E402

REV2 = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev3'
OUT = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-27-rev3/shotgun_null_plays.csv'
COLUMNS = ['season', 'game_id', 'week', 'play_id', 'posteam', 'defteam', 'down', 'qtr', 'time', 'play_type',
           'pbp_shotgun', 'ftn_state', 'participation_state', 'snap_type', 'reason', 'desc_class', 'desc']


def ftn_state(ftn_idx, game_ids, game, play):
    if (game, play) in ftn_idx:
        return 'zero_or_blank' if ftn_idx[(game, play)].get('qb_location') in ('0', '', None) else 'charted'
    if game not in game_ids:
        return 'game_absent'
    return 'play_absent'


def part_state(part_idx, part):
    if part_idx is None:
        return 'season_absent'
    if part is None:
        return 'row_absent'
    if not part.get('offense_formation'):
        return 'formation_blank'
    return 'formation_present'


def desc_class(desc, play_type):
    d = (desc or '').lower()
    if 'kneel' in d:
        return 'qb kneel'
    if 'spike' in d:
        return 'qb spike'
    if 'punt formation' in d or ' punt' in d:
        return 'punt formation'
    if 'field goal' in d or 'extra point' in d:
        return 'field goal or extra point'
    if 'no play' in d or 'false start' in d or 'penalty' in d:
        return 'penalty or no play'
    if 'timeout' in d:
        return 'timeout'
    if 'two-point' in d or 'two point' in d:
        return 'two-point attempt'
    if 'aborted' in d:
        return 'aborted play'
    return f'ordinary {play_type}'


def reason_text(f, p, season):
    if f == 'game_absent':
        ftn = ('FTN has no rows for this game; the FTN 2026 file was last pulled 2026-10-27 21:49 UTC '
               '(16:49 CDT) and the game was played 2026-10-26; FTN charting typically lags games by 24 to 48 hours')
    elif f == 'play_absent':
        ftn = 'FTN has rows for this game but none for this play'
    elif f == 'zero_or_blank':
        ftn = 'FTN qb_location is 0 or blank'
    else:
        ftn = 'FTN charted'
    if p == 'season_absent':
        part = f'no participation data for {season}'
    elif p == 'row_absent':
        part = 'no participation row for this play'
    elif p == 'formation_blank':
        part = 'participation row has a blank offense_formation'
    else:
        part = 'participation formation present'
    return f'{ftn}; {part}'


def main():
    nulls = []
    for season in range(2022, 2027):
        input_root = b.PINNED_INPUTS if season == 2026 else b.RAW
        pbp_path = os.path.join(input_root, b.RESEARCH_PBP_FILES[season])
        ftn_path = os.path.join(input_root, b.RESEARCH_FTN_FILES[season])
        part_path = os.path.join(b.RAW, b.RESEARCH_PART_FILES[season]) if season in b.RESEARCH_PART_FILES else None
        max_week = 7 if season == 2026 else 18
        pbp_rows = list(b.open_rows(pbp_path))
        part_idx = b.participation_index(b.open_rows(part_path)) if part_path else None
        ftn_idx = b.ftn_index(b.open_rows(ftn_path), season, max_week=max_week)
        ftn_games = {k[0] for k in ftn_idx}
        game_ids = {v.get('nflverse_game_id') for v in ftn_idx.values()}
        count = 0
        for row in pbp_rows:
            if b.clean_int(row.get('season')) != season or row.get('season_type') != 'REG':
                continue
            week = b.clean_int(row.get('week'))
            if max_week is not None and (week is None or week > max_week):
                continue
            if not b.is_scrimmage(row):
                continue
            key = (row.get('old_game_id') or row.get('game_id') or '', b.play_id(row.get('play_id')))
            part = part_idx.get(key) if part_idx is not None else None
            ftn = ftn_idx.get((row.get('game_id') or '', b.play_id(row.get('play_id'))))
            row['_ftn'] = ftn
            row['_ftn_game_charted'] = row.get('game_id') in ftn_games
            if b.value_for(row, part, 'shotgun_ftn_first') is not None:
                continue
            count += 1
            fs = ftn_state(ftn_idx, game_ids, row.get('game_id'), b.play_id(row.get('play_id')))
            ps = part_state(part_idx, part)
            nulls.append({
                'season': season, 'game_id': row.get('game_id'), 'week': week,
                'play_id': b.play_id(row.get('play_id')), 'posteam': row.get('posteam'),
                'defteam': row.get('defteam'), 'down': row.get('down'), 'qtr': row.get('qtr'),
                'time': row.get('time'), 'play_type': row.get('play_type'),
                'pbp_shotgun': row.get('shotgun'), 'ftn_state': fs, 'participation_state': ps,
                'snap_type': b.value_for(row, part, 'snap_type'),
                'reason': reason_text(fs, ps, season), 'desc_class': desc_class(row.get('desc'), row.get('play_type')),
                'desc': (row.get('desc') or '')[:160],
            })
        print(f'{season}: null plays (one side each) {count}', flush=True)

    # Each null play is null for the offense of posteam and the defense of defteam.
    by_team = collections.Counter()
    by_reason = collections.Counter()
    for n in nulls:
        if n['snap_type'] == 'fake_punt':
            continue
        by_team[(n['season'], n['posteam'], 'offense')] += 1
        by_team[(n['season'], n['defteam'], 'defense')] += 1
        by_reason[(n['season'], n['ftn_state'], n['participation_state'])] += 1
    print('\nnull plays by season, FTN state, participation state:')
    for k, v in sorted(by_reason.items()):
        print('  ', k, v)

    # Reconcile with the rev2 profiles.
    mismatch = []
    for side in ('offense', 'defense'):
        for path in sorted(glob.glob(os.path.join(REV2, '*-20*.json'))):
            j = json.load(open(path))
            name = os.path.basename(path)
            team, season = name.split('-')[0], int(name.split('-')[1][:4])
            miss = j[side]['profile']['shotgun']['missing']
            mine = by_team.get((season, team, side), 0)
            if miss != mine:
                mismatch.append((name, side, miss, mine))
    print(f'\nprofile shotgun missing vs explained nulls: {len(mismatch)} mismatches')
    for m in mismatch[:10]:
        print('  ', m)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for n in nulls:
            w.writerow(n)
    print(f'\nwrote {len(nulls)} rows to {OUT}')


if __name__ == '__main__':
    main()
