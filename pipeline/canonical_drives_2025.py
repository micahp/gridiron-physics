"""Canonical 2025 drives built from possession, not from nflverse drive IDs. Read-only research.

Rules, applied to each regular-season game in file order:
  - A drive starts when the possession team changes. The possession team of a row is its posteam. Kickoffs carry the
    receiving team, so a receipt starts a drive. A kickoff recovered by the kicking team changes possession on the
    next row and starts a new drive for that team.
  - A drive starts at the first row of each half (quarters 1 and 2, quarters 3 and 4, overtime). It does not split at
    the end of quarters 1 and 3.
  - Administrative rows with no possession team stay with the current drive.
  - Penalties (no_play rows) stay in the drive they occur in.

Plays counted for a drive: run, pass, qb_kneel, qb_spike, punt and field_goal rows. Kickoffs, extra points, two-point
conversions and administrative rows are not plays for drive statistics.
"""
import collections
import csv
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

SEASON = 2025
OUT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-canonical-drives-2025'
DRIVE_CSV = os.path.join(OUT_DIR, 'canonical_drives_2025.csv')
SUMMARY_JSON = os.path.join(OUT_DIR, 'canonical_drives_2025_summary.json')
PLAY_TYPES = {'run', 'pass', 'qb_kneel', 'qb_spike', 'punt', 'field_goal'}
SCRIMMAGE = {'run', 'pass', 'qb_kneel', 'qb_spike'}


def half_of(row):
    q = b.clean_int(row.get('qtr'))
    if q is None:
        return None
    return 1 if q <= 2 else 2 if q <= 4 else 'OT'


def is_conversion(row):
    """Extra points and two-point attempts follow a score in the same possession. They never start a drive."""
    return (row.get('play_type') or '') == 'extra_point' or b.clean_int(row.get('two_point_attempt')) == 1


def split_game(rows):
    """Split one game's rows into canonical drives.

    A drive ends when the possession team changes or a touchdown is scored. After a touchdown, only the conversion
    attempt and any penalty or administrative rows stay with the scoring drive. The next play starts a new drive.
    """
    drives = []
    cur = None
    scored = False
    for r in rows:
        h = half_of(r)
        pt = r.get('posteam') or ''
        ptype = r.get('play_type') or ''
        new = False
        if cur is None or h != cur['half']:
            new = True
        elif scored:
            if not (is_conversion(r) or ptype in ('no_play', '')):
                new = True
        elif pt and cur['team'] and pt != cur['team'] and not is_conversion(r):
            new = True
        if new:
            cur = {'half': h, 'team': pt or None, 'rows': []}
            drives.append(cur)
            scored = False
        elif pt and cur['team'] is None:
            cur['team'] = pt
        cur['rows'].append(r)
        if b.clean_int(r.get('touchdown')) == 1:
            scored = True
    return drives


def drive_facts(d):
    team = d['team']
    rows = d['rows']
    plays = [r for r in rows if (r.get('play_type') or '') in PLAY_TYPES]
    scrim = [r for r in plays if r['play_type'] in SCRIMMAGE]
    points = 0
    for r in rows:
        if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team') == team:
            points += 6
        if r.get('extra_point_result') == 'good' and r.get('posteam') == team:
            points += 1
        if r.get('two_point_conv_result') == 'success' and r.get('posteam') == team \
                and b.clean_int(r.get('defensive_two_point_conv')) != 1:
            points += 2
        if r.get('field_goal_result') == 'made' and r.get('posteam') == team:
            points += 3
    points_against = 0
    for r in rows:
        if b.clean_int(r.get('safety')) == 1 and r.get('defteam') == team:
            points_against += 2
        if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team') and r.get('td_team') != team:
            points_against += 6
    yards = sum(num(r.get('yards_gained')) or 0 for r in rows if r.get('play_type') in ('run', 'pass'))
    gsr = [num(r.get('game_seconds_remaining')) for r in rows if num(r.get('game_seconds_remaining')) is not None]
    seconds = (gsr[0] - gsr[-1]) if len(gsr) >= 2 else None
    start_y = next((num(r.get('yardline_100')) for r in scrim), None)
    first_down = any(b.clean_int(r.get('first_down')) == 1 for r in scrim if r['play_type'] in ('run', 'pass'))
    ended = end_reason(d, team)
    return {
        'team': team, 'half': d['half'], 'first_row_game_id': rows[0].get('game_id'),
        'plays': len(plays), 'scrimmage_plays': len(scrim), 'yards_run_pass': yards,
        'seconds': seconds, 'points_for': points, 'points_against': points_against,
        'start_yardline_100': start_y, 'first_down_gained': first_down, 'end_reason': ended,
    }


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def end_reason(d, team):
    rows = d['rows']
    if any(b.clean_int(r.get('touchdown')) == 1 and r.get('td_team') == team for r in rows):
        return 'touchdown'
    if any(b.clean_int(r.get('safety')) == 1 and r.get('defteam') == team for r in rows):
        return 'safety_against'
    last = [r for r in rows if (r.get('play_type') or '') in PLAY_TYPES]
    if not last:
        return 'no_offensive_play'
    final = last[-1]
    if final.get('field_goal_result') == 'made':
        return 'field_goal_made'
    if final.get('field_goal_result') in ('missed', 'blocked'):
        return 'field_goal_missed'
    if final.get('play_type') == 'punt':
        return 'punt'
    if any(b.clean_int(r.get('interception')) == 1 or b.clean_int(r.get('fumble_lost')) == 1 for r in last):
        return 'turnover'
    if any((r.get('fixed_drive_result') or '') == 'Turnover on downs' for r in rows):
        return 'turnover_on_downs'
    if final.get('qtr') in ('2', '4') and final is last[-1]:
        return 'end_of_half_or_game'
    return 'other'


def continuity(drives):
    """Consecutive scrimmage plays inside one canonical drive. A pair is checked only when nothing other than
    no-play rows lies between them. A penalty on the pair or between them explains a mismatch; a turnover does too."""
    out = collections.Counter()
    examples = collections.defaultdict(list)
    for d in drives:
        rows = [r for r in d['rows'] if (r.get('play_type') or '') != '']
        scrim = [i for i, r in enumerate(rows) if r.get('play_type') in ('run', 'pass')]
        for i, j in zip(scrim, scrim[1:]):
            a, c = rows[i], rows[j]
            between = rows[i + 1:j]
            if b.clean_int(a.get('touchdown')) == 1 or any(
                    b.clean_int(x.get('two_point_attempt')) == 1 for x in [a, c] + between):
                out['pairs_skipped_scoring_or_two_point'] += 1
                continue
            if any(x.get('play_type') != 'no_play' for x in between):
                out['pairs_skipped_non_scrimmage_between'] += 1
                continue
            pen = any(b.clean_int(x.get('penalty')) == 1 for x in [a] + between + [c])
            turn = any(b.clean_int(x.get(k)) == 1 for x in [a] + between for k in ('interception', 'fumble_lost'))
            out['pairs_checked'] += 1
            ya_d, ga = num(a.get('ydstogo')), num(a.get('yards_gained'))
            if a.get('down') and c.get('down') and ya_d is not None and ga is not None and not turn:
                expected = 1 if ga >= ya_d else int(float(a['down'])) + 1
                if expected > 4:
                    expected = 1
                actual = int(float(c['down']))
                if actual != expected:
                    key = 'down_progression_explained' if pen else 'down_progression_unexplained'
                    out[key] += 1
                    if key.endswith('unexplained') and len(examples[key]) < 3:
                        examples[key].append((a.get('game_id'), a.get('play_id'), a.get('down'), a.get('ydstogo'),
                                              a.get('yards_gained'), c.get('down')))
            y_a, y_c = num(a.get('yardline_100')), num(c.get('yardline_100'))
            if y_a is not None and y_c is not None and ga is not None and a.get('posteam') == c.get('posteam') \
                    and not turn:
                if abs(y_c - (y_a - ga)) > 0.5:
                    key = 'field_position_explained' if pen else 'field_position_unexplained'
                    out[key] += 1
                    if key.endswith('unexplained') and len(examples[key]) < 3:
                        examples[key].append((a.get('game_id'), a.get('play_id'), y_a, ga, y_c))
            if a.get('posteam') == c.get('posteam') and a.get('posteam_score_post') not in (None, '') \
                    and c.get('posteam_score') not in (None, ''):
                if num(a['posteam_score_post']) != num(c['posteam_score']):
                    out['score_continuity_violation'] += 1
                    if len(examples['score']) < 3:
                        examples['score'].append((a.get('game_id'), a.get('play_id'), a.get('posteam_score_post'),
                                                  c.get('posteam_score')))
            g_a, g_c = num(a.get('game_seconds_remaining')), num(c.get('game_seconds_remaining'))
            if g_a is not None and g_c is not None and g_c > g_a:
                out['clock_increase_within_drive'] += 1
    return out, examples


def reconcile_nflverse(all_drives, games):
    """Compare canonical drives with nflverse drive IDs, game by game.

    Every row in a canonical drive carries an nflverse ID. An nflverse ID that spans more than one canonical drive is
    split. Each split is classed as a half boundary (the canonical drives fall in different halves) or a possession
    change (the same half, with the possession team changing).
    """
    by_game = collections.defaultdict(list)
    for item in all_drives:
        by_game[item['facts']['game_id']].append(item)
    splits = collections.Counter()
    ids_split = 0
    ids_total = set()
    for gid, items in by_game.items():
        owner = collections.defaultdict(list)
        for item in items:
            idx = item['facts']['drive_index']
            for nid in {r.get('drive') for r in item['d']['rows'] if r.get('drive')}:
                owner[nid].append((idx, item['facts']['half'], item['facts']['team']))
            for nid in owner:
                pass
        for nid, parts in owner.items():
            ids_total.add((gid, nid))
            parts = sorted(set(parts))
            if len(parts) > 1:
                ids_split += 1
                for (i1, h1, t1), (i2, h2, t2) in zip(parts, parts[1:]):
                    splits['half_boundary' if h1 != h2 else 'possession_change'] += 1
    return {
        'nflverse_drive_ids': len(ids_total),
        'canonical_drives': len(all_drives),
        'nflverse_ids_spanning_more_than_one_canonical_drive': ids_split,
        'extra_canonical_drives_by_reason': dict(splits),
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = [r for r in b.open_rows(os.path.join(b.RAW, b.RESEARCH_PBP_FILES[SEASON]))
            if b.clean_int(r.get('season')) == SEASON and r.get('season_type') == 'REG']
    games = collections.OrderedDict()
    for r in rows:
        games.setdefault(r['game_id'], []).append(r)

    all_drives = []
    administrative_only = 0
    for gid, grows in games.items():
        for index, d in enumerate(split_game(grows), start=1):
            if all((r.get('play_type') or '') == '' for r in d['rows']):
                administrative_only += 1
                continue
            facts = drive_facts(d)
            facts['game_id'] = gid
            facts['drive_index'] = index
            all_drives.append({'facts': facts, 'd': d})

    fields = ['game_id', 'drive_index', 'team', 'half', 'plays', 'scrimmage_plays', 'yards_run_pass', 'seconds',
              'points_for', 'points_against', 'start_yardline_100', 'first_down_gained', 'end_reason']
    with open(DRIVE_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for item in all_drives:
            w.writerow({k: item['facts'].get(k) for k in fields})

    facts = [item['facts'] for item in all_drives]
    offensive = [x for x in facts if x['scrimmage_plays'] > 0 or x['end_reason'] in ('punt', 'field_goal_made',
                                                                                     'field_goal_missed')]
    scored = [x for x in offensive if x['points_for'] > 0]
    three_and_out = [x for x in offensive if x['scrimmage_plays'] == 3 and x['end_reason'] == 'punt'
                     and not x['first_down_gained']]
    turnover = [x for x in offensive if x['end_reason'] in ('turnover', 'turnover_on_downs')]

    def dist(vals):
        vals = [v for v in vals if v is not None]
        if not vals:
            return None
        vals = sorted(vals)
        pick = lambda q: vals[min(len(vals) - 1, int(q * (len(vals) - 1)))]
        return {'n': len(vals), 'mean': round(statistics.mean(vals), 3), 'median': pick(0.5), 'p10': pick(0.1),
                'p90': pick(0.9)}

    cont, examples = continuity([item['d'] for item in all_drives])
    recon = reconcile_nflverse(all_drives, games)
    summary = {
        'season': SEASON,
        'games': len(games),
        'canonical_drives_total': len(facts),
        'administrative_only_segments_dropped': administrative_only,
        'drives_by_half': dict(collections.Counter(str(x['half']) for x in facts)),
        'offensive_drives': len(offensive),
        'non_offensive_drives': len(facts) - len(offensive),
        'end_reasons': dict(collections.Counter(x['end_reason'] for x in facts)),
        'plays_per_drive': dist([x['plays'] for x in offensive]),
        'yards_run_pass_per_drive': dist([x['yards_run_pass'] for x in offensive]),
        'seconds_per_drive': dist([x['seconds'] for x in offensive]),
        'points_per_drive': dist([x['points_for'] for x in offensive]),
        'scoring_drive_rate': round(len(scored) / len(offensive), 4) if offensive else None,
        'three_and_out_rate': round(len(three_and_out) / len(offensive), 4) if offensive else None,
        'turnover_drive_rate': round(len(turnover) / len(offensive), 4) if offensive else None,
        'start_yardline_100_per_drive': dist([x['start_yardline_100'] for x in offensive]),
        'nflverse_reconciliation': recon,
        'continuity': dict(cont),
        'continuity_examples': {k: v for k, v in examples.items()},
    }
    with open(SUMMARY_JSON, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True, default=str)
    print(json.dumps(summary, indent=1, sort_keys=True, default=str))


if __name__ == '__main__':
    main()
