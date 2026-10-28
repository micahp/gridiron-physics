"""Formation-gap audit: ordinary run or pass plays, 2022 to 2025, with no participation formation label.

Read-only with respect to every rev3 output. Writes a new audit directory only.
The 162 rows are defined the same way the builder defines a missing formation: no participation row, or a blank
offense_formation, on an ordinary scrimmage play. The audit reconciles them to the rev3 profile counts.
"""
import collections
import csv
import glob
import json
import os
import sys

sys.path.insert(0, '/root/gridiron-playbooks-research/pipeline')
import build_playbooks as b  # noqa: E402

REV3 = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev3'
AUDIT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-27-rev3-audit'
CSV_OUT = os.path.join(AUDIT_DIR, 'formation_gap_audit.csv')
JSON_OUT = os.path.join(AUDIT_DIR, 'formation_gap_summary.json')
COLUMNS = [
    'season', 'game_id', 'old_game_id', 'play_id', 'week', 'posteam', 'defteam', 'qtr', 'time', 'down', 'ydstogo',
    'play_type', 'desc', 'pbp_shotgun', 'ftn_qb_location', 'explicit_formation_evidence',
    'participation_row_present', 'participation_offense_formation', 'offense_personnel', 'defense_personnel',
    'pbp_two_point_attempt', 'reason_code', 'reason_detail', 'unusual_flags', 'shotgun_resolved', 'shotgun_source',
    'proposed_disposition',
]
SPECIAL = {'ABORTED', 'SPIKE', 'KNEEL', 'TWO_POINT', 'PUNT_TEXT', 'KICK_TEXT', 'PENALTY_TEXT'}


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def flags(row):
    d = row.get('desc') or ''
    dl = d.lower()
    out = []
    if 'wildcat' in dl:
        out.append('WILDCAT_TEXT')
    if 'direct snap' in dl:
        out.append('DIRECT_SNAP')
    if 'scramble' in dl or num(row.get('qb_scramble')) == 1:
        out.append('QB_SCRAMBLE')
    if 'aborted' in dl:
        out.append('ABORTED')
    if 'spike' in dl or num(row.get('qb_spike')) == 1:
        out.append('SPIKE')
    if 'kneel' in dl or num(row.get('qb_kneel')) == 1:
        out.append('KNEEL')
    if num(row.get('two_point_attempt')) == 1 or 'two-point' in dl or 'two point' in dl:
        out.append('TWO_POINT')
    if 'lateral' in dl or 'reverse' in dl:
        out.append('TRICK_TEXT')
    if 'punt' in dl:
        out.append('PUNT_TEXT')
    if 'field goal' in dl or 'extra point' in dl:
        out.append('KICK_TEXT')
    if 'no play' in dl or 'penalty' in dl:
        out.append('PENALTY_TEXT')
    if '(shotgun)' in dl:
        out.append('DESC_TAG_SHOTGUN')
    if '(no huddle)' in dl:
        out.append('DESC_TAG_NO_HUDDLE')
    return out


def reason(old, pid, part, games_in_part, label):
    if not old:
        return 'JOIN_OR_PARSE_ISSUE', 'PBP old_game_id is blank, so the participation key falls back to game_id'
    if not pid or not pid.isdigit():
        return 'JOIN_OR_PARSE_ISSUE', 'play_id is not a parseable integer'
    if part is None:
        if old in games_in_part:
            return 'PARTICIPATION_ROW_ABSENT', 'game is in participation; no row for this play_id'
        return 'PARTICIPATION_ROW_ABSENT', 'no participation rows for this game'
    if not label:
        return 'PARTICIPATION_FORMATION_BLANK', 'participation row present; offense_formation blank'
    return 'UNRECOGNIZED_FORMATION_LABEL', f'label {label!r} is not in the season vocabulary'


def explicit_evidence(ftn_q, flag_list):
    if ftn_q in ('S', 'P', 'U'):
        return f'ftn_qb_location_{ftn_q}'
    if 'DESC_TAG_SHOTGUN' in flag_list:
        return 'desc_tag_shotgun'
    return 'none'


def disposition(row, flag_list):
    dl = (row.get('desc') or '').lower()
    if 'TWO_POINT' in flag_list:
        return 'exclude_candidate: two-point attempt (PBP two_point_attempt flag or two-point text)'
    if 'KICK_TEXT' in flag_list and '(field goal formation)' in dl:
        return 'exclude_candidate: fake field goal (Field Goal formation with a run or pass action)'
    if 'ABORTED' in flag_list:
        return 'review: aborted snap, source text only'
    return 'keep_ordinary: formation null, shotgun value retained'


def main():
    os.makedirs(AUDIT_DIR, exist_ok=True)
    audit_rows = []
    vocab_check = []
    for season in range(2022, 2026):
        part_path = os.path.join(b.RAW, b.RESEARCH_PART_FILES[season])
        part_rows = list(b.open_rows(part_path))
        for value, count in sorted(collections.Counter(r.get('offense_formation') or '' for r in part_rows).items()):
            if value == '':
                vocab_check.append((season, '(blank)', count, 'None (missing)'))
                continue
            mapped = b.value_for({'season': str(season), '_ftn': None}, {'offense_formation': value},
                                 'shotgun_ftn_first')
            vocab_check.append((season, value, count, f'{mapped} (not None: {mapped is not None})'))
        part_idx = b.participation_index(part_rows)
        games_in_part = {r['old_game_id'] for r in part_rows}
        ftn_idx = b.ftn_index(b.open_rows(os.path.join(b.RAW, b.RESEARCH_FTN_FILES[season])), season, max_week=18)
        ftn_games = {k[0] for k in ftn_idx}
        pbp_path = os.path.join(b.RAW, b.RESEARCH_PBP_FILES[season])
        for row in b.open_rows(pbp_path):
            if b.clean_int(row.get('season')) != season or row.get('season_type') != 'REG':
                continue
            if not b.is_scrimmage(row):
                continue
            old = row.get('old_game_id') or ''
            pid = b.play_id(row.get('play_id'))
            key = (old or row.get('game_id') or '', pid)
            part = part_idx.get(key)
            label = ((part or {}).get('offense_formation') or '').strip()
            if part is not None and label:
                continue
            row['_ftn'] = ftn_idx.get((row.get('game_id') or '', pid))
            row['_ftn_game_charted'] = row.get('game_id') in ftn_games
            if b.value_for(row, part, 'snap_type') != 'scrimmage':
                continue
            code, detail = reason(old, pid, part, games_in_part, label)
            flag_list = flags(row)
            ftn_q = (row['_ftn'] or {}).get('qb_location')
            shot, source = b.shotgun_with_source(row, part)
            audit_rows.append({
                'season': season, 'game_id': row.get('game_id'), 'old_game_id': old, 'play_id': pid,
                'week': row.get('week'), 'posteam': row.get('posteam'), 'defteam': row.get('defteam'),
                'qtr': row.get('qtr'), 'time': row.get('time'), 'down': row.get('down'),
                'ydstogo': row.get('ydstogo'), 'play_type': row.get('play_type'), 'desc': row.get('desc') or '',
                'pbp_shotgun': row.get('shotgun'), 'ftn_qb_location': ftn_q or '',
                'explicit_formation_evidence': explicit_evidence(ftn_q, flag_list),
                'participation_row_present': part is not None,
                'participation_offense_formation': (part or {}).get('offense_formation') or '',
                'offense_personnel': (part or {}).get('offense_personnel') or '',
                'defense_personnel': (part or {}).get('defense_personnel') or '',
                'pbp_two_point_attempt': row.get('two_point_attempt') or '',
                'reason_code': code, 'reason_detail': detail, 'unusual_flags': ';'.join(flag_list),
                'shotgun_resolved': '' if shot is None else shot, 'shotgun_source': source or '',
                'proposed_disposition': disposition(row, flag_list),
            })

    with open(CSV_OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for r in audit_rows:
            w.writerow(r)

    summary = {
        'rows': len(audit_rows),
        'by_season_play_type': {f'{k[0]}|{k[1]}': n for k, n in collections.Counter((r['season'], r['play_type']) for r in audit_rows).items()},
        'by_team': collections.Counter(r['posteam'] for r in audit_rows),
        'by_reason': collections.Counter(r['reason_code'] for r in audit_rows),
        'by_disposition': collections.Counter(r['proposed_disposition'].split(':')[0] for r in audit_rows),
        'two_point_flag_on_two_point_rows': collections.Counter(r['pbp_two_point_attempt'] for r in audit_rows if 'TWO_POINT' in r['unusual_flags']),
        'by_flag': collections.Counter(f for r in audit_rows for f in r['unusual_flags'].split(';') if f),
        'by_explicit_evidence': collections.Counter(r['explicit_formation_evidence'] for r in audit_rows),
        'by_shotgun_source': collections.Counter(r['shotgun_source'] for r in audit_rows),
        'vocab_check': vocab_check,
    }
    profile_missing = collections.Counter()
    for path in glob.glob(os.path.join(REV3, '*-20*.json')):
        name = os.path.basename(path)
        season = int(name.split('-')[1][:4])
        if season > 2025:
            continue
        j = json.load(open(path))
        profile_missing[season] += j['offense']['profile']['formation']['missing']
    summary['profile_offense_formation_missing_2022_2025'] = dict(profile_missing)
    summary['profile_offense_formation_missing_total_2022_2025'] = sum(profile_missing.values())
    with open(JSON_OUT, 'w') as f:
        json.dump(summary, f, indent=1, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o),
                  sort_keys=True)
    print('rows written:', len(audit_rows), '->', CSV_OUT)
    print('by season and play type:', summary['by_season_play_type'])
    print('by reason:', dict(summary['by_reason']))
    print('by disposition:', dict(summary['by_disposition']))
    print('flags:', dict(summary['by_flag']))
    print('explicit evidence:', dict(summary['by_explicit_evidence']))
    print('shotgun source:', dict(summary['by_shotgun_source']))
    print('profile offense formation missing 2022 to 2025:', dict(profile_missing),
          'total', sum(profile_missing.values()))
    print('vocabulary check:')
    for v in vocab_check:
        print('  ', v)


if __name__ == '__main__':
    main()
