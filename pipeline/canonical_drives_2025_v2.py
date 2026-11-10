"""Canonical 2025 drives, version 2. Validation revision. Read-only research.

Version 1 (`canonical_drives_2025.py`) is not changed. Version 2 reuses its splitter and differs in four places:
  - Two timings. `kickoff_to_end_seconds` runs from the drive's first row. `possession_seconds` runs from its first
    offensive play. Both end at an explicit boundary: the next drive's first row, or a half or game end row.
  - A drive end is classed from explicit row fields. The quarter number is never evidence. nflverse's
    `fixed_drive_result` is used only as a cross-check.
  - A safety belongs to the team in `posteam`, the team that gave it up. Version 1 read `defteam`, the scorer.
  - Continuity exceptions are traced row by row, with the text evidence found for each. Unknowns stay unknown.
"""
import collections
import csv
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402
import canonical_drives_2025 as v1  # noqa: E402
import reconcile_2025_drives_scores as rec  # noqa: E402

SEASON = 2025
OUT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-canonical-drives-2025-v2'
DRIVE_CSV = os.path.join(OUT_DIR, 'canonical_drives_2025_v2.csv')
EXCEPTION_CSV = os.path.join(OUT_DIR, 'continuity_exceptions_2025_v2.csv')
DISAGREE_CSV = os.path.join(OUT_DIR, 'end_class_disagreements_2025_v2.csv')
SUMMARY_JSON = os.path.join(OUT_DIR, 'canonical_drives_2025_v2_summary.json')
SMALL_N = 30
OFFENSE = {'run', 'pass', 'qb_kneel', 'qb_spike', 'punt', 'field_goal'}
SCRIMMAGE = {'run', 'pass', 'qb_kneel', 'qb_spike'}
# nflverse fixed_drive_result, and the v2 end classes it should agree with.
FIXED_TO_CLASS = {
    'Touchdown': {'touchdown_scored'},
    'Opp touchdown': {'touchdown_allowed'},
    'Safety': {'safety_allowed'},
    'Punt': {'punt', 'blocked_punt'},
    'Field goal': {'field_goal_made'},
    'Missed field goal': {'field_goal_missed'},
    'Turnover': {'interception', 'fumble_lost'},
    'Turnover on downs': {'turnover_on_downs'},
    'End of half': {'end_of_half', 'end_of_game'},
}
# nflverse drive_end_transition, and the v2 end classes it should agree with. A touchdown returned by the defence can
# end a drive under any of these transitions, so those classes are allowed for each.
TRANSITION_TO_CLASS = {
    'TOUCHDOWN': {'touchdown_scored', 'touchdown_allowed'},
    'PUNT': {'punt', 'touchdown_allowed'},
    'BLOCKED_PUNT': {'blocked_punt', 'touchdown_allowed'},
    'FIELD_GOAL': {'field_goal_made', 'touchdown_allowed'},
    'MISSED_FG': {'field_goal_missed', 'touchdown_allowed'},
    'BLOCKED_FG': {'field_goal_missed', 'touchdown_allowed'},
    'BLOCKED_FG,_DOWNS': {'field_goal_missed', 'turnover_on_downs'},
    'BLOCKED_PUNT,_DOWNS': {'blocked_punt', 'turnover_on_downs'},
    'INTERCEPTION': {'interception', 'touchdown_allowed'},
    'FUMBLE': {'fumble_lost', 'kickoff_fumble_lost', 'touchdown_allowed'},
    'DOWNS': {'turnover_on_downs', 'onside_kick_lost'},
    'SAFETY': {'safety_allowed'},
    'END_HALF': {'end_of_half'},
    'END_GAME': {'end_of_game'},
}
# Text evidence for a continuity exception with no penalty flag. The first pattern that matches is reported.
EVIDENCE = [
    ('penalty_text_not_flagged', re.compile(r'PENALTY', re.I)),
    ('reversal_text', re.compile(r'REVERSED|NULLIFIED', re.I)),
    ('timeout_text', re.compile(r'Timeout', re.I)),
]


def num(x):
    return v1.num(x)


def gsr(r):
    return num(r.get('game_seconds_remaining'))


def sub(r):
    return r.get('play_type') or 'admin_row'


def points_events(r):
    """(team, points) for each scoring event on a row. Same rules as `reconcile_2025_drives_scores.py`, which ties
    to the official final scores."""
    out = []
    if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team'):
        out.append((r['td_team'], 6))
    if r.get('extra_point_result') == 'good' and r.get('posteam'):
        out.append((r['posteam'], 1))
    if b.clean_int(r.get('defensive_two_point_conv')) == 1 and r.get('defteam'):
        out.append((r['defteam'], 2))
    elif r.get('two_point_conv_result') == 'success' and r.get('posteam'):
        out.append((r['posteam'], 2))
    if r.get('field_goal_result') == 'made' and r.get('posteam'):
        out.append((r['posteam'], 3))
    if b.clean_int(r.get('safety')) == 1 and r.get('defteam'):
        out.append((r['defteam'], 2))
    return out


def drive_points(rows, team):
    """Points the drive's team scored, and points the opponent scored, while this drive was on."""
    pf = pa = 0
    for r in rows:
        for who, pts in points_events(r):
            if who == team:
                pf += pts
            else:
                pa += pts
    return pf, pa


def boundary(rows):
    """gsr and basis of an explicit half or game end row in the drive. END QUARTER 1 and 3 are mid-half breaks, so
    they are not boundaries."""
    for r in rows:
        desc = r.get('desc') or ''
        g = gsr(r)
        if g is None:
            continue
        if desc.startswith('END QUARTER 2'):
            return g, 'half_end_row'
        if desc.startswith('END QUARTER 4') or desc.startswith('END GAME'):
            return g, 'game_end_row'
    return None, None


def end_time(segs, i):
    """Clock value at which drive i ended, and where it came from."""
    g, basis = boundary(segs[i]['rows'])
    if g is not None:
        return g, basis
    if i + 1 < len(segs):
        for r in segs[i + 1]['rows']:
            if gsr(r) is not None:
                return gsr(r), 'next_drive_first_row'
    timed = [gsr(r) for r in segs[i]['rows'] if gsr(r) is not None]
    return (timed[-1], 'last_row_start') if timed else (None, 'none')


def timing(rows, end):
    """(kickoff_to_end_seconds, possession_seconds). Both are None when the clock is missing."""
    starts = [gsr(r) for r in rows if gsr(r) is not None]
    first_off = next((gsr(r) for r in rows if r.get('play_type') in OFFENSE and gsr(r) is not None), None)
    start = starts[0] if starts else None
    kick_to_end = start - end if (start is not None and end is not None) else None
    possession = first_off - end if (first_off is not None and end is not None) else None
    return kick_to_end, possession


def return_cause(r):
    """What put the ball in the defence's hands on the row that was returned for a touchdown."""
    if b.clean_int(r.get('interception')) == 1:
        return 'interception_return'
    if b.clean_int(r.get('fumble_lost')) == 1:
        return 'fumble_return'
    if r.get('play_type') == 'punt':
        return 'blocked_punt_return' if b.clean_int(r.get('punt_blocked')) == 1 else 'punt_return'
    if r.get('field_goal_result') in ('missed', 'blocked'):
        return 'field_goal_return'
    if r.get('play_type') == 'kickoff':
        return 'kickoff_return'
    return 'other:' + sub(r)


def onside_recovered_by_kicker(r):
    """The kicking team recovered an onside kick. On a kickoff row the kicking team is `defteam`, and the text
    names the recovering team."""
    desc = r.get('desc') or ''
    return (r.get('play_type') == 'kickoff' and 'onside' in desc.lower() and bool(r.get('defteam'))
            and re.search(r'RECOVERED by ' + re.escape(r['defteam']) + r'-', desc) is not None)


def classify_end(rows, team):
    """Drive-end class from explicit row fields only. Returns (end_class, subtype).

    A touchdown or safety against the drive's team takes precedence over the last play, as nflverse's own
    'Opp touchdown' and 'Safety' results do. The cause of a returned touchdown is kept in the subtype."""
    for r in rows:
        if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team') == team:
            return 'touchdown_scored', sub(r)
    for r in rows:
        if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team') and r.get('td_team') != team:
            return 'touchdown_allowed', return_cause(r)
    for r in rows:
        if b.clean_int(r.get('safety')) == 1 and r.get('posteam') == team:
            return 'safety_allowed', sub(r)
    off = [r for r in rows if r.get('play_type') in OFFENSE]
    if not off:
        # A kickoff segment with no scrimmage play. The kickoff row carries the transition that ended it.
        if any(onside_recovered_by_kicker(r) for r in rows):
            return 'onside_kick_lost', ''
        transitions = {r.get('drive_end_transition') or '' for r in rows} - {''}
        if 'END_HALF' in transitions:
            return 'end_of_half', 'kickoff_return'
        if 'END_GAME' in transitions:
            return 'end_of_game', 'kickoff_return'
        if 'FUMBLE' in transitions:
            return 'kickoff_fumble_lost', ''
        if 'DOWNS' in transitions:
            return 'onside_kick_lost', ''
        return 'no_offensive_play', ''
    last = off[-1]
    if last.get('field_goal_result') == 'made':
        return 'field_goal_made', ''
    if last.get('field_goal_result') in ('missed', 'blocked'):
        return 'field_goal_missed', last['field_goal_result']
    if last.get('play_type') == 'punt':
        if b.clean_int(last.get('punt_blocked')) == 1 or last.get('drive_end_transition') == 'BLOCKED_PUNT':
            return 'blocked_punt', ''
        return 'punt', 'fumble_on_return' if b.clean_int(last.get('fumble_lost')) == 1 else ''
    if b.clean_int(last.get('interception')) == 1:
        return 'interception', sub(last)
    if b.clean_int(last.get('fumble_lost')) == 1:
        return 'fumble_lost', sub(last)
    transition = last.get('drive_end_transition') or ''
    if transition == 'DOWNS':
        return 'turnover_on_downs', ''
    if transition == 'END_HALF':
        return 'end_of_half', ''
    if transition == 'END_GAME':
        return 'end_of_game', ''
    return 'unclassified', transition


def nflverse_fixed(rows):
    off = [r for r in rows if r.get('play_type') in OFFENSE]
    src = off[-1] if off else (rows[-1] if rows else {})
    return src.get('fixed_drive_result') or ''


def crosscheck(end_class, fixed):
    if not fixed:
        return 'no_nflverse_value'
    if fixed not in FIXED_TO_CLASS:
        return 'unmapped'
    return 'agree' if end_class in FIXED_TO_CLASS[fixed] else 'disagree'


def transition_of(rows):
    return next((r.get('drive_end_transition') for r in reversed(rows) if r.get('drive_end_transition')), '')


def transition_status(end_class, transition):
    if not transition:
        return 'no_nflverse_value'
    if transition not in TRANSITION_TO_CLASS:
        return 'unmapped'
    return 'agree' if end_class in TRANSITION_TO_CLASS[transition] else 'disagree'


def bucket_field(y):
    if y is None:
        return 'unknown'
    if y >= 80:
        return 'own 0-19'
    if y >= 50:
        return 'own 20-49'
    if y >= 20:
        return 'opp 49-20'
    return 'opp 19-0'


def bucket_score(d):
    if d is None:
        return 'unknown'
    if d <= -8:
        return '-8 or less'
    if d < 0:
        return '-7 to -1'
    if d == 0:
        return 'tied'
    if d < 8:
        return '+1 to +7'
    return '+8 or more'


def evidence(group, team):
    joined = ' | '.join(x.get('desc') or '' for x in group)
    for name, pat in EVIDENCE:
        if pat.search(joined):
            return name
    # A fumble the offence kept (its own recovery, or the ball went out of bounds): the spot moves to the fumble
    # point, which yards_gained does not record. The text names the recovering team, or says "recovers at" or
    # "out of bounds" when the player recovered his own fumble.
    if re.search(r'FUMBLES', joined) and re.search(
            r'recovered by ' + re.escape(team) + r'-|and recovers at|out of bounds|touched at', joined):
        return 'fumble_kept_by_offense'
    if re.search(r'FUMBLE', joined):
        return 'fumble_text_not_resolved'
    return 'unknown'


def exception(kind, gid, team, a, between, c, detail):
    group = [a] + between + [c]
    return {'kind': kind, 'game_id': gid, 'team': team, 'play_id_a': a.get('play_id'),
            'play_id_c': c.get('play_id'), 'between_play_ids': ';'.join(str(x.get('play_id')) for x in between),
            'evidence': evidence(group, team), 'detail': detail,
            'desc_a': (a.get('desc') or '')[:160], 'desc_c': (c.get('desc') or '')[:160]}


def continuity(drives):
    """Same pairing and checks as `canonical_drives_2025.continuity`, with every exception kept as a row.

    Returns (counts, exceptions). Exceptions list every unexplained field-position, down, score and clock mismatch.
    Explained ones (a penalty flag on the pair) are counted but not listed."""
    counts = collections.Counter()
    exceptions = []
    for d in drives:
        gid, team = d['rows'][0].get('game_id'), d['team']
        rows = [r for r in d['rows'] if (r.get('play_type') or '') != '']
        scrim = [i for i, r in enumerate(rows) if r.get('play_type') in ('run', 'pass')]
        for i, j in zip(scrim, scrim[1:]):
            a, c = rows[i], rows[j]
            between = rows[i + 1:j]
            if b.clean_int(a.get('touchdown')) == 1 or any(
                    b.clean_int(x.get('two_point_attempt')) == 1 for x in [a, c] + between):
                counts['pairs_skipped_scoring_or_two_point'] += 1
                continue
            if any(x.get('play_type') != 'no_play' for x in between):
                counts['pairs_skipped_non_scrimmage_between'] += 1
                continue
            counts['pairs_checked'] += 1
            pen = any(b.clean_int(x.get('penalty')) == 1 for x in [a] + between + [c])
            turn = any(b.clean_int(x.get(k)) == 1 for x in [a] + between for k in ('interception', 'fumble_lost'))
            ya_d, ga = num(a.get('ydstogo')), num(a.get('yards_gained'))
            if a.get('down') and c.get('down') and ya_d is not None and ga is not None and not turn:
                expected = 1 if ga >= ya_d else int(float(a['down'])) + 1
                if expected > 4:
                    expected = 1
                actual = int(float(c['down']))
                if actual != expected:
                    key = 'down_progression_explained' if pen else 'down_progression_unexplained'
                    counts[key] += 1
                    if not pen:
                        exceptions.append(exception(
                            'down_progression', gid, team, a, between, c,
                            f'down {a.get("down")} to {c.get("down")}, ydstogo {ya_d:g}, yards {ga:g}, '
                            f'expected down {expected}, observed {actual}'))
            y_a, y_c = num(a.get('yardline_100')), num(c.get('yardline_100'))
            if y_a is not None and y_c is not None and ga is not None and a.get('posteam') == c.get('posteam') \
                    and not turn and abs(y_c - (y_a - ga)) > 0.5:
                key = 'field_position_explained' if pen else 'field_position_unexplained'
                counts[key] += 1
                if not pen:
                    exceptions.append(exception(
                        'field_position', gid, team, a, between, c,
                        f'yardline_100 {y_a:g} to {y_c:g}, yards {ga:g}, expected {y_a - ga:g}, '
                        f'delta {y_c - (y_a - ga):+g}'))
            if a.get('posteam') == c.get('posteam') and a.get('posteam_score_post') not in (None, '') \
                    and c.get('posteam_score') not in (None, '') \
                    and num(a['posteam_score_post']) != num(c['posteam_score']):
                counts['score_continuity_violation'] += 1
                exceptions.append(exception('score', gid, team, a, between, c,
                                            f'posteam_score_post {a.get("posteam_score_post")} to '
                                            f'posteam_score {c.get("posteam_score")}'))
            g_a, g_c = gsr(a), gsr(c)
            if g_a is not None and g_c is not None and g_c > g_a:
                counts['clock_increase_within_drive'] += 1
                exceptions.append(exception('clock', gid, team, a, between, c,
                                            f'game_seconds_remaining {g_a:g} to {g_c:g}'))
    return counts, exceptions


def build_games():
    rows = [r for r in b.open_rows(os.path.join(b.RAW, b.RESEARCH_PBP_FILES[SEASON]))
            if b.clean_int(r.get('season')) == SEASON and r.get('season_type') == 'REG']
    games = collections.OrderedDict()
    for r in rows:
        games.setdefault(r['game_id'], []).append(r)
    return games


def qtr_label(row):
    q = num(row.get('qtr'))
    if q is None:
        return ''
    return 'OT' if q > 4 else str(int(q))


def build_drives(games):
    """Kept drives per game, each with its v2 facts. Administrative-only segments are dropped, as in version 1."""
    out = collections.OrderedDict()
    for gid, grows in games.items():
        segs = v1.split_game(grows)
        kept = []
        for i, seg in enumerate(segs):
            if all((r.get('play_type') or '') == '' for r in seg['rows']):
                continue
            end, basis = end_time(segs, i)
            kick_to_end, possession = timing(seg['rows'], end)
            team = seg['team']
            off = [r for r in seg['rows'] if r.get('play_type') in OFFENSE]
            ref = off[0] if off else seg['rows'][0]
            scrim = [r for r in off if r.get('play_type') in SCRIMMAGE]
            end_class, subtype = classify_end(seg['rows'], team)
            pf, pa = drive_points(seg['rows'], team)
            score_diff = None
            if ref.get('posteam_score') not in (None, '') and ref.get('defteam_score') not in (None, ''):
                score_diff = int(float(ref['posteam_score'])) - int(float(ref['defteam_score']))
            v1f = v1.drive_facts(seg)
            fixed = nflverse_fixed(seg['rows'])
            transition = transition_of(seg['rows'])
            kept.append({
                'game_id': gid, 'drive_index': i + 1, 'team': team, 'half': seg['half'],
                'quarter': qtr_label(ref),
                'offense_plays': len(off), 'scrimmage_plays': len(scrim),
                'yards_run_pass': sum(num(r.get('yards_gained')) or 0 for r in scrim
                                      if r.get('play_type') in ('run', 'pass')),
                'first_down_gained': any(b.clean_int(r.get('first_down')) == 1 for r in scrim
                                         if r.get('play_type') in ('run', 'pass')),
                'start_yardline_100': num(scrim[0].get('yardline_100')) if scrim else None,
                'score_diff_at_start': score_diff,
                'kickoff_to_end_seconds': kick_to_end, 'possession_seconds': possession,
                'end_time_basis': basis, 'end_class': end_class, 'end_subtype': subtype,
                'nflverse_fixed_drive_result': fixed, 'crosscheck': crosscheck(end_class, fixed),
                'nflverse_drive_end_transition': transition,
                'transition_crosscheck': transition_status(end_class, transition),
                'points_for': pf, 'points_against': pa, 'offensive': len(off) > 0,
                'v1_end_reason': v1f['end_reason'], 'v1_seconds': v1f['seconds'],
                'v1_points_for': v1f['points_for'], 'v1_points_against': v1f['points_against'],
                'rows': seg['rows'],
            })
        # A kickoff segment with no scrimmage play can carry nflverse's drive-level result for the possession after
        # it. Each disagreement is re-tested against that next possession. It is explained only if the next drive's
        # end class matches the nflverse value, or the two share an nflverse drive ID. Otherwise it stays a disagreement.
        for i, d in enumerate(kept[:-1]):
            if d['offensive']:
                continue
            nxt = kept[i + 1]
            shared_id = bool(({r.get('drive') for r in d['rows']} & {r.get('drive') for r in nxt['rows']}) - {None})
            if d['crosscheck'] == 'disagree':
                if shared_id:
                    d['crosscheck'] = 'nflverse_id_spans_next_drive'
                elif crosscheck(nxt['end_class'], d['nflverse_fixed_drive_result']) == 'agree':
                    d['crosscheck'] = 'fixed_result_is_next_possession'
            if d['transition_crosscheck'] == 'disagree':
                if shared_id:
                    d['transition_crosscheck'] = 'nflverse_id_spans_next_drive'
                elif transition_status(nxt['end_class'], d['nflverse_drive_end_transition']) == 'agree':
                    d['transition_crosscheck'] = 'transition_is_next_possession'
        out[gid] = kept
    return out


def dist(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    pick = lambda q: vals[min(len(vals) - 1, int(q * (len(vals) - 1)))]
    return {'n': len(vals), 'mean': round(statistics.mean(vals), 3), 'median': pick(0.5), 'p10': pick(0.1),
            'p90': pick(0.9)}


def group_table(drives, key):
    groups = collections.defaultdict(list)
    for d in drives:
        groups[key(d)].append(d)
    out = {}
    for k, ds in sorted(groups.items(), key=lambda kv: str(kv[0])):
        poss = [d['possession_seconds'] for d in ds if d['possession_seconds'] is not None]
        out[str(k)] = {
            'drives': len(ds),
            'small_sample': len(ds) < SMALL_N,
            'plays_per_drive_mean': round(statistics.mean(d['offense_plays'] for d in ds), 3),
            'possession_seconds_median': statistics.median(poss) if poss else None,
            'points_for_per_drive': round(statistics.mean(d['points_for'] for d in ds), 3),
            'points_against_per_drive': round(statistics.mean(d['points_against'] for d in ds), 3),
            'scoring_rate': round(sum(1 for d in ds if d['points_for'] > 0) / len(ds), 4),
        }
    return out


def tie_out(drives_by_game, official):
    """Per game and team: points the team scored (its own drives' points_for plus the opponent's drives'
    points_against) must equal its official final score."""
    ok = bad = 0
    examples = []
    for gid, drs in drives_by_game.items():
        off = official.get(gid)
        if off is None:
            bad += 2
            examples.append({'game_id': gid, 'detail': 'missing from official schedule'})
            continue
        for team, score in ((off['home_team'], off['home_score']), (off['away_team'], off['away_score'])):
            got = sum(d['points_for'] for d in drs if d['team'] == team) \
                + sum(d['points_against'] for d in drs if d['team'] != team)
            if got == score:
                ok += 1
            else:
                bad += 1
                if len(examples) < 10:
                    examples.append({'game_id': gid, 'team': team, 'drives_points': got, 'official': score})
    return {'match': ok, 'mismatch': bad, 'examples': examples}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    official = rec.load_official_scores()
    games = build_games()
    drives_by_game = build_drives(games)
    drives = [d for ds in drives_by_game.values() for d in ds]
    offensive = [d for d in drives if d['offensive']]

    fields = ['game_id', 'drive_index', 'team', 'half', 'quarter', 'offense_plays', 'scrimmage_plays',
              'yards_run_pass', 'first_down_gained', 'start_yardline_100', 'score_diff_at_start',
              'kickoff_to_end_seconds', 'possession_seconds', 'end_time_basis', 'end_class', 'end_subtype',
              'nflverse_fixed_drive_result', 'crosscheck', 'nflverse_drive_end_transition', 'transition_crosscheck',
              'points_for', 'points_against', 'offensive',
              'v1_end_reason', 'v1_seconds', 'v1_points_for', 'v1_points_against']
    with open(DRIVE_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(drives)
    with open(DISAGREE_CSV, 'w', newline='') as f:
        keys = ['game_id', 'drive_index', 'team', 'end_class', 'end_subtype', 'nflverse_fixed_drive_result',
                'crosscheck', 'nflverse_drive_end_transition', 'transition_crosscheck', 'last_offense_play_id',
                'last_offense_desc']
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for d in drives:
            flagged = ('disagree', 'unmapped')
            if d['crosscheck'] in flagged or d['transition_crosscheck'] in flagged:
                off = [r for r in d['rows'] if r.get('play_type') in OFFENSE]
                last = off[-1] if off else {}
                w.writerow({'game_id': d['game_id'], 'drive_index': d['drive_index'], 'team': d['team'],
                            'end_class': d['end_class'], 'end_subtype': d['end_subtype'],
                            'nflverse_fixed_drive_result': d['nflverse_fixed_drive_result'],
                            'crosscheck': d['crosscheck'],
                            'nflverse_drive_end_transition': d['nflverse_drive_end_transition'],
                            'transition_crosscheck': d['transition_crosscheck'],
                            'last_offense_play_id': last.get('play_id'),
                            'last_offense_desc': (last.get('desc') or '')[:160]})

    kept_rows = [{'rows': d['rows'], 'team': d['team']} for d in drives]
    cont_counts, exceptions = continuity(kept_rows)
    v1_counts, _ = v1.continuity([{'rows': d['rows'], 'team': d['team'], 'half': d['half']} for d in drives])
    with open(EXCEPTION_CSV, 'w', newline='') as f:
        keys = ['kind', 'game_id', 'team', 'play_id_a', 'between_play_ids', 'play_id_c', 'evidence', 'detail',
                'desc_a', 'desc_c']
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(exceptions)

    crosstab = collections.Counter(f"{d['v1_end_reason']} -> {d['end_class']}" for d in drives)
    changes = {
        'drives_points_against_changed': sum(1 for d in drives if d['points_against'] != d['v1_points_against']),
        'drives_points_for_changed': sum(1 for d in drives if d['points_for'] != d['v1_points_for']),
        'drives_end_class_changed': sum(1 for d in drives if d['v1_end_reason'] != d['end_class']),
    }
    negatives = sum(1 for d in drives if (d['kickoff_to_end_seconds'] or 0) < 0
                    or (d['possession_seconds'] or 0) < 0)
    summary = {
        'season': SEASON,
        'games': len(games),
        'kept_drives': len(drives),
        'offensive_drives': len(offensive),
        'non_offensive_drives': len(drives) - len(offensive),
        'end_class_counts_all': dict(collections.Counter(d['end_class'] for d in drives)),
        'end_class_counts_offensive': dict(collections.Counter(d['end_class'] for d in offensive)),
        'end_time_basis_counts': dict(collections.Counter(d['end_time_basis'] for d in drives)),
        'negative_elapsed_drives': negatives,
        'timing_offensive': {
            'kickoff_to_end_seconds': dist([d['kickoff_to_end_seconds'] for d in offensive]),
            'possession_seconds': dist([d['possession_seconds'] for d in offensive]),
            'v1_seconds_first_row_to_last_row': dist([d['v1_seconds'] for d in offensive]),
        },
        'plays_per_drive': dist([d['offense_plays'] for d in offensive]),
        'yards_run_pass_per_drive': dist([d['yards_run_pass'] for d in offensive]),
        'points_for_per_drive': dist([d['points_for'] for d in offensive]),
        'points_against_per_drive': dist([d['points_against'] for d in offensive]),
        'scoring_rate': round(sum(1 for d in offensive if d['points_for'] > 0) / len(offensive), 4),
        'turnover_rate': round(sum(1 for d in offensive if d['end_class'] in
                                   ('interception', 'fumble_lost', 'turnover_on_downs')) / len(offensive), 4),
        'by_team': group_table(offensive, lambda d: d['team']),
        'by_start_field': group_table(offensive, lambda d: bucket_field(d['start_yardline_100'])),
        'by_quarter': group_table(offensive, lambda d: d['quarter']),
        'by_score_diff_at_start': group_table(offensive, lambda d: bucket_score(d['score_diff_at_start'])),
        'by_end_class': group_table(offensive, lambda d: d['end_class']),
        'crosscheck_counts': dict(collections.Counter(d['crosscheck'] for d in drives)),
        'transition_crosscheck_counts': dict(collections.Counter(d['transition_crosscheck'] for d in drives)),
        'transition_disagreements': dict(collections.Counter(
            f"{d['end_class']} | {d['nflverse_drive_end_transition']}" for d in drives
            if d['transition_crosscheck'] == 'disagree')),
        'v1_to_v2_end_class': dict(crosstab),
        'v1_to_v2_changes': changes,
        'continuity_v2': dict(cont_counts),
        'continuity_v1': dict(v1_counts),
        'continuity_matches_v1': {k: cont_counts.get(k, 0) == v1_counts.get(k, 0) for k in v1_counts},
        'continuity_unexplained_evidence': dict(collections.Counter(
            f"{e['kind']} | {e['evidence']}" for e in exceptions)),
        'points_tie_out_to_official': tie_out(drives_by_game, official),
    }
    with open(SUMMARY_JSON, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True, default=str)
    print(json.dumps({k: summary[k] for k in ('kept_drives', 'offensive_drives', 'end_class_counts_offensive',
                                              'end_time_basis_counts', 'negative_elapsed_drives', 'crosscheck_counts',
                                              'continuity_v2', 'continuity_matches_v1',
                                              'continuity_unexplained_evidence', 'points_tie_out_to_official',
                                              'v1_to_v2_changes')},
                     indent=1, sort_keys=True, default=str))


if __name__ == '__main__':
    main()
