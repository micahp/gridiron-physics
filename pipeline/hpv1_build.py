"""Build the HPV1 contract counts from the 2022 to 2025 participation and play-by-play files.

Writes counts only (no play IDs, no player IDs) to docs/research/hpv1-contract-2026-11-02/. Run:
    python3 pipeline/hpv1_build.py
"""
import collections
import hashlib
import json
import os
import subprocess

import pandas as pd

import hpv1_contract as hc

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = '/root/gridiron-playbooks-research/data/raw'
OUT = os.path.join(ROOT, 'docs', 'research', 'hpv1-contract-2026-11-02')
SEASONS = hc.SEASONS
PARTICIPATION_COLUMNS = ['nflverse_game_id', 'play_id', 'possession_team', 'offense_formation', 'offense_personnel',
                         'defense_personnel', 'n_offense', 'offense_players', 'offense_names', 'offense_positions',
                         'offense_numbers']
PBP_COLUMNS = ['game_id', 'play_id', 'play_type', 'season_type', 'posteam', 'week', 'down', 'ydstogo', 'yardline_100',
               'desc', 'two_point_attempt']
UNKNOWN = hc.UNKNOWN
ROSTER_COLUMNS = ['season', 'team', 'gsis_id', 'week', 'game_type', 'status']


def participation_path(season):
    return os.path.join(RAW, f'pbp_participation_{season}.csv')


def pbp_path(season):
    return os.path.join(RAW, f'pbp_{season}.csv.gz')


INPUT_PATHS = ([participation_path(s) for s in SEASONS] + [pbp_path(s) for s in SEASONS]
               + [os.path.join(RAW, 'roster_weekly_2025.csv.gz'), os.path.join(RAW, 'players.csv')])


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def tokens(text):
    counts = collections.Counter()
    for part in str(text).split(','):
        number, _, position = part.strip().partition(' ')
        counts[position] += int(number)
    return counts


def season_frame(season):
    header = pd.read_csv(participation_path(season), nrows=0).columns
    present = [c for c in PARTICIPATION_COLUMNS if c in header]
    absent = [c for c in PARTICIPATION_COLUMNS if c not in header]
    part = pd.read_csv(participation_path(season), usecols=present, low_memory=False)
    pbp = pd.read_csv(pbp_path(season), compression='gzip', low_memory=False, usecols=PBP_COLUMNS)
    merged, coverage = hc.join_participation(part, pbp)
    coverage['season'] = season
    coverage['participation_columns_absent'] = absent
    coverage['pbp_only_run_pass'] = int(((merged['_merge'] == 'right_only') & merged['play_type'].isin(hc.RUN_PASS)).sum())
    rows = merged[merged['_merge'] != 'right_only'].copy()
    rows['season'] = season
    rows['participation_only'] = rows['_merge'] == 'left_only'
    parsed = rows['offense_personnel'].map(lambda text: hc.parse_personnel(text, season))
    rows['status'] = parsed.map(lambda p: p['status'])
    rows['personnel_reason'] = parsed.map(lambda p: p['reason'])
    rows['vocabulary'] = parsed.map(lambda p: p['vocabulary'])
    rows['package'] = parsed.map(lambda p: p['package'])
    rows['package_comparable'] = parsed.map(lambda p: p['package_comparable'])
    rows['rb'] = parsed.map(lambda p: p['rb'])
    rows['te'] = parsed.map(lambda p: p['te'])
    rows['wr'] = parsed.map(lambda p: p['wr'])
    rows['fb'] = parsed.map(lambda p: p['fb'])
    rows['players_listed'] = parsed.map(lambda p: p['players_listed'])
    rows['two_point'] = rows['two_point_attempt'].fillna(0).astype(int)
    rows['play_class'] = [
        'participation_only' if only else hc.classify_play(pt if not pd.isna(pt) else None, tp, desc, reason)
        for only, pt, tp, desc, reason in zip(rows['participation_only'], rows['play_type'], rows['two_point'],
                                              rows['desc'], rows['personnel_reason'])]
    rows['play_family'] = rows['play_type'].where(rows['play_type'].isin(hc.RUN_PASS), UNKNOWN)
    rows['formation'] = [hc.formation_label(f, season) for f in rows['offense_formation']]
    rows['down_label'] = rows['down'].map(lambda d: UNKNOWN if pd.isna(d) else str(int(d)))
    rows['distance'] = [distance_label(y) for y in rows['ydstogo']]
    rows['red_zone'] = [hc.red_zone(y) for y in rows['yardline_100']]
    return rows, coverage


def distance_label(ydstogo):
    if pd.isna(ydstogo):
        return UNKNOWN
    if not 1 <= int(ydstogo) <= 99:
        return 'OUT_OF_RANGE'
    return hc.distance_bucket(ydstogo)


def missingness(rows):
    fields = ['offense_personnel', 'offense_formation', 'offense_players', 'offense_names', 'offense_positions',
              'offense_numbers', 'play_type', 'down', 'ydstogo', 'yardline_100']
    out = {}
    for field in fields:
        if field in rows:
            out[field] = {'null': int(rows[field].isna().sum()), 'rows': int(len(rows))}
    return out


def identity(scrimmage, season, crosswalk):
    out = {'scrimmage_rows': int(len(scrimmage))}
    ids = scrimmage['offense_players'].map(lambda v: str(v).split(';') if isinstance(v, str) else [])
    out['offense_ids_equal_n_offense'] = int((ids.map(len) == scrimmage['n_offense']).sum())
    flat = [g for row in ids for g in row]
    out['offense_ids'] = len(flat)
    out['offense_ids_in_players_csv'] = int(sum(g in crosswalk for g in flat))
    if 'offense_positions' in scrimmage and season >= hc.FULL_VOCABULARY_FROM:
        agree = sum(collections.Counter(p.strip() for p in str(pos).split(';')) == tokens(personnel)
                    for pos, personnel in zip(scrimmage['offense_positions'], scrimmage['offense_personnel']))
        out['positions_equal_personnel_tokens'] = int(agree)
        out['names_null'] = int(scrimmage['offense_names'].isna().sum())
        out['numbers_null'] = int(scrimmage['offense_numbers'].isna().sum())
    return out


def reconciliation(rows, scrimmage, joint, season):
    """Every DEF or special-teams label is in exactly one class, and the joint table sums to the scrimmage count."""
    def label_positions(frame, group):
        found = collections.Counter()
        for text in frame['offense_personnel']:
            for position, n in tokens(text).items():
                if position in group:
                    found[position] += n
        return {k: int(v) for k, v in sorted(found.items())}
    def_rows = rows[rows['personnel_reason'] == 'cross_side_label']
    st_rows = rows[rows['personnel_reason'] == 'special_teams_token']
    return {
        'def_label_rows': int(len(def_rows)),
        'def_label_rows_by_class': {k: int(v) for k, v in def_rows['play_class'].value_counts().items()},
        'def_label_positions_scrimmage': label_positions(def_rows[def_rows['play_class'] == 'cross_side_label'],
                                                         hc.DEF_POSITIONS),
        'special_teams_label_rows': int(len(st_rows)),
        'special_teams_label_rows_by_class': {k: int(v) for k, v in st_rows['play_class'].value_counts().items()},
        'special_teams_label_positions': label_positions(st_rows, hc.ST_POSITIONS),
        'joint_total': int(joint.sum()),
        'scrimmage_total': int(len(scrimmage)),
        'joint_equals_scrimmage': int(joint.sum()) == int(len(scrimmage)),
    }


def roster_coverage(scrimmage, roster):
    keys = set(zip(roster['team'], roster['week'], roster['gsis_id']))
    hit = total = plays_with_miss = 0
    for team, week, ids in zip(scrimmage['posteam'], scrimmage['week'], scrimmage['offense_players']):
        missed = False
        for gsis in str(ids).split(';'):
            total += 1
            if (team, week, gsis) in keys:
                hit += 1
            else:
                missed = True
        plays_with_miss += missed
    return {'offense_ids': total, 'matched_to_team_week': hit, 'plays': int(len(scrimmage)),
            'plays_with_unmatched_id': plays_with_miss}


def build():
    hc.check_input_paths(INPUT_PATHS)
    crosswalk = set(pd.read_csv(os.path.join(RAW, 'players.csv'), usecols=['gsis_id'], low_memory=False)['gsis_id'].dropna())
    roster = pd.read_csv(os.path.join(RAW, 'roster_weekly_2025.csv.gz'), compression='gzip', low_memory=False,
                         usecols=ROSTER_COLUMNS)
    roster = roster[roster['game_type'] == 'REG']
    report = {'contract': 'HPV1 data contract, 2022 to 2025', 'seasons': list(SEASONS), 'seasons_detail': {}}
    class_rows, package_rows, joint_rows = [], [], []
    for season in SEASONS:
        rows, coverage = season_frame(season)
        scrimmage = rows[rows['play_class'] == 'scrimmage']
        report['seasons_detail'][str(season)] = {
            'coverage': coverage,
            'classes': {k: int(v) for k, v in rows['play_class'].value_counts().items()},
            'personnel_status': {k: int(v) for k, v in rows['status'].value_counts().items()},
            'vocabulary_scrimmage': {k: int(v) for k, v in scrimmage['vocabulary'].value_counts().items()},
            'package_rb_only_scrimmage': {k: int(v) for k, v in scrimmage['package'].value_counts().items()},
            'package_comparable_scrimmage': {k: int(v) for k, v in scrimmage['package_comparable'].value_counts().items()},
            'personnel_reason_scrimmage': {k: int(v) for k, v in scrimmage['personnel_reason'].value_counts().items()},
            'players_listed_scrimmage': {str(k): int(v) for k, v in scrimmage['players_listed'].value_counts(dropna=False).items()},
            'fb_plays_scrimmage': int((scrimmage['fb'] > 0).sum()) if season >= hc.FULL_VOCABULARY_FROM else None,
            'formation_scrimmage': {k: int(v) for k, v in scrimmage['formation'].value_counts().items()},
            'distance_scrimmage': {k: int(v) for k, v in scrimmage['distance'].value_counts().items()},
            'down_scrimmage': {k: int(v) for k, v in scrimmage['down_label'].value_counts().items()},
            'missingness_participation': missingness(rows),
            'identity': identity(scrimmage, season, crosswalk),
        }
        if season == 2025:
            report['seasons_detail']['2025']['roster_coverage_reg_scrimmage'] = roster_coverage(
                scrimmage[scrimmage['season_type'] == 'REG'], roster)
        class_rows.append(rows.groupby(['season', 'play_class'], dropna=False).size().rename('plays').reset_index())
        package_rows.append(scrimmage.groupby(['season', 'package', 'package_comparable', 'vocabulary'],
                                               dropna=False).size().rename('plays').reset_index())
        joint = hc.joint_counts(scrimmage.assign(down=scrimmage['down_label'],
                                                 package=scrimmage['package_comparable']))
        joint_rows.append(joint.rename('plays').reset_index())
        recon = reconciliation(rows, scrimmage, joint, season)
        if not recon['joint_equals_scrimmage']:
            raise ValueError(f'{season}: joint total {recon["joint_total"]} != scrimmage {recon["scrimmage_total"]}')
        report['seasons_detail'][str(season)]['reconciliation'] = recon
    return report, pd.concat(class_rows), pd.concat(package_rows), pd.concat(joint_rows)


def main():
    report, classes, packages, joint = build()
    os.makedirs(OUT, exist_ok=True)
    commit = subprocess.run(['git', '-C', ROOT, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    report['manifest'] = {'builder_commit': commit,
                          'inputs': {os.path.basename(p): {'sha256': sha256(p), 'bytes': os.path.getsize(p)}
                                     for p in INPUT_PATHS}}
    with open(os.path.join(OUT, 'hpv1-counts.json'), 'w', encoding='utf-8') as stream:
        json.dump(report, stream, indent=1, sort_keys=True)
        stream.write('\n')
    classes.to_csv(os.path.join(OUT, 'play-classes.csv'), index=False)
    packages.to_csv(os.path.join(OUT, 'package-counts.csv'), index=False)
    joint.to_csv(os.path.join(OUT, 'joint-observed-counts.csv'), index=False)
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
