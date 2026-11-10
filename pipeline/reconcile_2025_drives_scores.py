"""Reconcile 2025 regular-season drives and final scores against official records. Read-only.

Official sources (nflverse raw files on this machine):
  - games.parquet: final home and away scores.
  - stats_team_week_2025.parquet: touchdowns by type, per team and week.
There is no official drive count on this machine. Drive checks are therefore internal: they test that the drive
structure in the play-by-play is consistent, and they report the nflverse drive fields as recorded.

Writes a JSON summary and a CSV of every mismatch. Prints the headline counts.
"""
import collections
import csv
import json
import os
import re
import sys

import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

RAW = '/root/lp-snapshots/nfl-backfill-2026-10-27/raw'
SEASON = 2025
OUT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-reconciliation-2025'
SUMMARY = os.path.join(OUT_DIR, 'reconciliation_2025_summary.json')
MISMATCH_CSV = os.path.join(OUT_DIR, 'reconciliation_2025_mismatches.csv')
# receiving_tds repeats passing_tds, and pt_return_tds repeats special_teams_tds. Summing the five fields below
# reproduces the play-by-play touchdown count for every team (checked before this script was written).
TD_TYPES = ('passing_tds', 'rushing_tds', 'special_teams_tds', 'def_tds', 'fumble_recovery_tds')


def num(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def split_reason(drive_rows):
    """Why one drive ID carries two possession teams, if the source records the reason. Otherwise None."""
    for r in drive_rows:
        desc = (r.get('desc') or '')
        if r.get('play_type') == 'kickoff' and 'onside' in desc.lower():
            return 'onside_kickoff'
        if r.get('play_type') == 'kickoff' and r.get('defteam') and re.search(
                r'RECOVERED BY ' + re.escape(r['defteam']) + r'\b', desc.upper()):
            return 'kickoff_recovered_by_kicking_team'
    for r in drive_rows:
        if (r.get('fixed_drive_result') or '') == 'Turnover on downs':
            return 'turnover_on_downs_drive_id_not_split'
    return None


def load_official_scores():
    rows = pq.read_table(f'{RAW}/schedules/games.parquet',
                         columns=['game_id', 'season', 'game_type', 'home_team', 'away_team', 'home_score',
                                  'away_score']).to_pylist()
    return {r['game_id']: r for r in rows if r['season'] == SEASON and r['game_type'] == 'REG'}


def load_official_tds():
    rows = pq.read_table(f'{RAW}/stats_team/stats_team_week_{SEASON}.parquet',
                         columns=['team', 'season_type', *TD_TYPES]).to_pylist()
    out = collections.Counter()
    for r in rows:
        if r['season_type'] != 'REG':
            continue
        out[r['team']] += sum((r.get(k) or 0) for k in TD_TYPES)
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    official = load_official_scores()
    official_td = load_official_tds()
    path = os.path.join(b.RAW, b.RESEARCH_PBP_FILES[SEASON])
    games = collections.defaultdict(list)
    for r in b.open_rows(path):
        if b.clean_int(r.get('season')) != SEASON or r.get('season_type') != 'REG':
            continue
        games[r['game_id']].append(r)

    mismatches = []
    final_ok = final_bad = 0
    pts_ok = pts_bad = 0
    drive_pos_bad = 0
    drive_pos_onside = 0
    drive_reasons = collections.Counter()
    drives_total = 0
    drives_ended_with_score_ok = drives_ended_with_score_bad = 0
    rows_with_drive = rows_without_drive = 0
    pbp_td = collections.Counter()
    pts_by_team_game = {}

    for gid, rows in games.items():
        off = official.get(gid)
        if off is None:
            mismatches.append({'check': 'game_missing_in_official', 'game_id': gid, 'detail': ''})
            continue
        last = rows[-1]
        home, away = last.get('home_team'), last.get('away_team')
        ph, pa = num(last.get('total_home_score')), num(last.get('total_away_score'))
        if (ph, pa) == (off['home_score'], off['away_score']):
            final_ok += 1
        else:
            final_bad += 1
            mismatches.append({'check': 'final_score', 'game_id': gid,
                               'detail': f'PBP {home} {ph}, {away} {pa}; official {off["home_team"]} '
                                         f'{off["home_score"]}, {off["away_team"]} {off["away_score"]}'})

        pts = collections.Counter()
        drive_teams = collections.defaultdict(set)
        drive_scored = collections.defaultdict(bool)
        drive_has_event = collections.defaultdict(bool)
        for r in rows:
            d = r.get('drive')
            if d:
                rows_with_drive += 1
                if r.get('posteam'):
                    drive_teams[d].add(r['posteam'])
            else:
                rows_without_drive += 1
            if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team'):
                pts[r['td_team']] += 6
                pbp_td[r['td_team']] += 1
                if d:
                    drive_has_event[d] = True
            if r.get('extra_point_result') == 'good' and r.get('posteam'):
                pts[r['posteam']] += 1
            # A defensive two-point conversion scores for the defence whatever its result text says: a failed
            # attempt returned by the defence, or a blocked PAT returned for two. Otherwise a successful attempt scores
            # for the offence.
            if b.clean_int(r.get('defensive_two_point_conv')) == 1 and r.get('defteam'):
                pts[r['defteam']] += 2
            elif r.get('two_point_conv_result') == 'success' and r.get('posteam'):
                pts[r['posteam']] += 2
            if r.get('field_goal_result') == 'made' and r.get('posteam'):
                pts[r['posteam']] += 3
                if d:
                    drive_has_event[d] = True
            if b.clean_int(r.get('safety')) == 1 and r.get('defteam'):
                pts[r['defteam']] += 2
                if d:
                    drive_has_event[d] = True
        for team, official_pts in ((off['home_team'], off['home_score']), (off['away_team'], off['away_score'])):
            pts_by_team_game[(gid, team)] = (pts.get(team, 0), official_pts)
            if pts.get(team, 0) == official_pts:
                pts_ok += 1
            else:
                pts_bad += 1
                mismatches.append({'check': 'points_from_events', 'game_id': gid,
                                   'detail': f'{team}: events {pts.get(team, 0)}, official {official_pts}'})

        drive_rows = collections.defaultdict(list)
        for r in rows:
            if r.get('drive'):
                drive_rows[r['drive']].append(r)
        for d, teams in drive_teams.items():
            drives_total += 1
            if len(teams) != 1:
                reason = split_reason(drive_rows[d])
                if reason:
                    drive_pos_onside += 1
                    drive_reasons[reason] += 1
                else:
                    drive_pos_bad += 1
                    mismatches.append({'check': 'drive_multiple_possession_teams', 'game_id': gid,
                                       'detail': f'drive {d}: {sorted(teams)}'})
        ended = collections.defaultdict(lambda: None)
        for r in rows:
            d = r.get('drive')
            if d and r.get('drive_ended_with_score') not in (None, ''):
                ended[d] = b.clean_int(r.get('drive_ended_with_score'))
        for d, flag in ended.items():
            if flag is None:
                continue
            expected = 1 if drive_has_event[d] else 0
            if flag == expected:
                drives_ended_with_score_ok += 1
            else:
                drives_ended_with_score_bad += 1
                mismatches.append({'check': 'drive_ended_with_score', 'game_id': gid,
                                   'detail': f'drive {d}: nflverse flag {flag}, scoring events {expected}'})

    official_team_td = official_td
    td_ok = td_bad = 0
    for team in sorted(set(pbp_td) | set(official_team_td)):
        a, o = pbp_td.get(team, 0), official_team_td.get(team, 0)
        if a == o:
            td_ok += 1
        else:
            td_bad += 1
            mismatches.append({'check': 'touchdowns_by_team', 'game_id': '',
                               'detail': f'{team}: PBP {a}, official {o}'})

    summary = {
        'season': SEASON,
        'games_in_pbp': len(games),
        'games_in_official': len(official),
        'final_score': {'match': final_ok, 'mismatch': final_bad},
        'points_from_events_by_team_game': {'match': pts_ok, 'mismatch': pts_bad},
        'touchdowns_by_team': {'match': td_ok, 'mismatch': td_bad,
                               'pbp_total': sum(pbp_td.values()), 'official_total': sum(official_team_td.values())},
        'drives': {'distinct_drive_ids_in_game_totals': drives_total, 'drives_with_more_than_one_posteam': drive_pos_bad,
                   'drives_with_more_than_one_posteam_explained': drive_pos_onside,
                   'explanations': dict(drive_reasons),
                   'ended_with_score_match': drives_ended_with_score_ok,
                   'ended_with_score_mismatch': drives_ended_with_score_bad,
                   'rows_with_drive_id': rows_with_drive, 'rows_without_drive_id': rows_without_drive},
        'official_drive_count_available': False,
        'mismatch_rows': len(mismatches),
    }
    with open(SUMMARY, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    with open(MISMATCH_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['check', 'game_id', 'detail'])
        w.writeheader()
        for m in mismatches:
            w.writerow(m)
    print(json.dumps(summary, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
