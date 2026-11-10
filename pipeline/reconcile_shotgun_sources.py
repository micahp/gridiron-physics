"""Gate 3 reconciliation for the shotgun flag, 2022 to 2024. Read-only research.

Reports, per team-season, the three source values for every eligible offense scrimmage play, kept separate:
  - PBP flag (`shotgun` field, unchanged),
  - participation formation mapped to shotgun (`participation_shotgun_equivalent`),
  - FTN `qb_location` (S or P = shotgun, U = under center, anything else = no value).
It also reports the value the builder's documented hierarchy would assign (`shotgun_with_source`: FTN, then
participation, then the PBP flag only in FTN-charted games), with the source of each play.

The old gate (PBP share vs participation share, 1.0 point tolerance) is recomputed first, so the revised gate can be
checked against the committed rev3 numbers. Historical source fields are read, never written.

Rule and thresholds: see docs/research/GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md (written before this run).
"""
import collections
import csv
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

SEASONS = (2022, 2023, 2024)
OUT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-gate3-shotgun-reconciliation'
PROFILE_DIR = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev3'
TEAM_CSV = os.path.join(OUT_DIR, 'team_season_sources.csv')
PLAY_CSV = os.path.join(OUT_DIR, 'unresolved_plays.csv')
SUMMARY_JSON = os.path.join(OUT_DIR, 'gate3_summary.json')
OLD_TOLERANCE_PP = 1.0
AGREE_THRESHOLD = 0.99
FTN_VALUE = {'S': True, 'P': True, 'U': False}


def profile_plays(team, season):
    """Per-play shotgun value and source the rev3 builder wrote for this team-season (read only).

    Keys are (game_id, play_id). The profile lists the play IDs behind each count, so the comparison is per play.
    """
    path = os.path.join(PROFILE_DIR, f'{team}-{season}.json')
    prof = json.load(open(path, encoding='utf-8'))['offense']['profile']
    vals, srcs = {}, {}
    for cat, v in prof['shotgun']['categories'].items():
        for sid in v.get('source_ids', []):
            vals[(sid['game_id'], str(sid['play_id']))] = (cat == 'True')
    for cat, v in prof.get('shotgun_source', {}).get('categories', {}).items():
        for sid in v.get('source_ids', []):
            srcs[(sid['game_id'], str(sid['play_id']))] = cat
    return vals, srcs


def r2_check(records, team, season):
    """R2: every profile play matches this run's value and source. The profile may omit only special-teams run and
    pass plays, which the current classes keep out of ordinary plays. Anything else it omits is a mismatch."""
    vals, srcs = profile_plays(team, season)
    shared = [k for k in vals if k in records]
    value_mismatch = [k for k in shared if records[k][0] != vals[k]]
    source_mismatch = [k for k in shared if records[k][1] != srcs.get(k)]
    missing_from_run = [k for k in vals if k not in records]
    omitted = [k for k in records if k not in vals]
    omitted_other = [k for k in omitted if records[k][2] != 'special_teams_run_pass']
    return {
        'r2_profile_plays': len(vals), 'r2_shared': len(shared),
        'r2_value_mismatch': len(value_mismatch), 'r2_source_mismatch': len(source_mismatch),
        'r2_profile_only': len(missing_from_run), 'r2_omitted_special_teams': len(omitted) - len(omitted_other),
        'r2_omitted_other': len(omitted_other),
        'r2_pass': not value_mismatch and not source_mismatch and not missing_from_run and not omitted_other,
    }


def ftn_value(ftn):
    return FTN_VALUE.get((ftn or {}).get('qb_location'))


def pbp_value(row):
    v = b.clean_int(row.get('shotgun'))
    return bool(v) if v in (0, 1) else None


def season_rows(season):
    path = os.path.join(b.RAW, b.RESEARCH_PBP_FILES[season])
    return [r for r in b.open_rows(path)
            if b.clean_int(r.get('season')) == season and r.get('season_type') == 'REG']


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    team_rows, unresolved = [], []
    for season in SEASONS:
        rows = season_rows(season)
        part_idx = b.participation_index(b.open_rows(os.path.join(b.RAW, b.RESEARCH_PART_FILES[season])))
        ftn_rows = b.open_rows(os.path.join(b.RAW, b.RESEARCH_FTN_FILES[season]))
        ftn_idx = b.ftn_index(ftn_rows, season)
        ftn_games = {k[0] for k in ftn_idx}
        agg = collections.defaultdict(collections.Counter)
        play_records = collections.defaultdict(dict)
        for r in rows:
            if not b.is_scrimmage(r) or not r.get('posteam'):
                continue
            team = r['posteam']
            p = part_idx.get((r.get('old_game_id') or r.get('game_id') or '', b.play_id(r.get('play_id'))))
            f = ftn_idx.get((r.get('game_id') or '', b.play_id(r.get('play_id'))))
            r['_ftn'] = f
            r['_ftn_game_charted'] = r.get('game_id') in ftn_games
            pv = pbp_value(r)
            part = b.participation_shotgun_equivalent((p or {}).get('offense_formation'), season)
            fv = ftn_value(f)
            hv, src = b.shotgun_with_source(r, p)
            c = agg[team]
            c['plays'] += 1
            c['pbp_known'] += pv is not None
            c['part_known'] += part is not None
            c['ftn_known'] += fv is not None
            if pv is not None and part is not None:
                c['paired_pbp_part'] += 1
                c['pbp_true_paired'] += pv
                c['part_true_paired'] += part
                if pv != part:
                    c['pbp_part_disagree'] += 1
                    if fv is None:
                        c['pbp_part_disagree_ftn_missing'] += 1
                        unresolved.append((season, team, r.get('game_id'), b.play_id(r.get('play_id')),
                                           'pbp vs participation, no FTN value', pv, part, fv))
                    elif fv == part and fv != pv:
                        c['pbp_part_disagree_ftn_sides_participation'] += 1
                    elif fv == pv:
                        c['pbp_part_disagree_ftn_sides_pbp'] += 1
                    else:
                        c['pbp_part_disagree_all_three_differ'] += 1
                        unresolved.append((season, team, r.get('game_id'), b.play_id(r.get('play_id')),
                                           'three values differ', pv, part, fv))
            if fv is not None and part is not None:
                c['ftn_part_both'] += 1
                c['ftn_part_agree'] += fv == part
                if fv != part:
                    unresolved.append((season, team, r.get('game_id'), b.play_id(r.get('play_id')),
                                       'ftn vs participation', pv, part, fv))
            if fv is not None and pv is not None:
                c['ftn_pbp_both'] += 1
                c['ftn_pbp_agree'] += fv == pv
            c['source_' + src if src else 'source_none'] += 1
            if src == 'pbp_flag':
                unresolved.append((season, team, r.get('game_id'), b.play_id(r.get('play_id')),
                                   'hierarchy falls back to PBP flag', pv, part, fv))
            if hv is not None:
                c['hier_known'] += 1
                c['hier_true'] += hv
            if pv is not None and hv is not None and pv != hv:
                c['pbp_vs_hierarchy_disagree'] += 1
            play_records[team][(r.get('game_id'), b.play_id(r.get('play_id')))] = (
                hv, src, b.snap_kind({'pbp': r, 'participation': p}))
        for team in sorted(agg):
            c = agg[team]
            row = {'season': season, 'team': team, 'plays': c['plays']}
            n = c['paired_pbp_part']
            pbp_share = c['pbp_true_paired'] / n if n else None
            part_share = c['part_true_paired'] / n if n else None
            row['old_gate_paired'] = n
            row['old_gate_pbp_share'] = round(pbp_share, 6) if n else None
            row['old_gate_part_share'] = round(part_share, 6) if n else None
            row['old_gate_diff_pp'] = round(abs(pbp_share - part_share) * 100, 3) if n else None
            row['old_gate_fails'] = bool(n and abs(pbp_share - part_share) * 100 > OLD_TOLERANCE_PP)
            row['pbp_part_disagree'] = c['pbp_part_disagree']
            row['pbp_part_disagree_ftn_sides_participation'] = c['pbp_part_disagree_ftn_sides_participation']
            row['pbp_part_disagree_ftn_sides_pbp'] = c['pbp_part_disagree_ftn_sides_pbp']
            row['pbp_part_disagree_all_three_differ'] = c['pbp_part_disagree_all_three_differ']
            row['pbp_part_disagree_ftn_missing'] = c['pbp_part_disagree_ftn_missing']
            row['ftn_known'] = c['ftn_known']
            row['ftn_part_both'] = c['ftn_part_both']
            row['ftn_part_agree'] = c['ftn_part_agree']
            row['ftn_part_agreement'] = round(c['ftn_part_agree'] / c['ftn_part_both'], 6) if c['ftn_part_both'] else None
            row['ftn_pbp_both'] = c['ftn_pbp_both']
            row['ftn_pbp_agree'] = c['ftn_pbp_agree']
            row['source_ftn'] = c['source_ftn']
            row['source_participation'] = c['source_participation']
            row['source_pbp_flag'] = c['source_pbp_flag']
            row['source_none'] = c['source_none']
            row['hier_share'] = round(c['hier_true'] / c['hier_known'], 6) if c['hier_known'] else None
            row['pbp_vs_hierarchy_disagree'] = c['pbp_vs_hierarchy_disagree']
            row.update(r2_check(play_records[team], team, season))
            team_rows.append(row)
    with open(TEAM_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(team_rows[0].keys()))
        w.writeheader()
        w.writerows(team_rows)
    with open(PLAY_CSV, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['season', 'team', 'game_id', 'play_id', 'reason', 'pbp_shotgun', 'participation_shotgun',
                    'ftn_shotgun'])
        w.writerows(unresolved)
    old_fail = [r for r in team_rows if r['old_gate_fails']]
    summary = {
        'team_seasons': len(team_rows),
        'old_gate_failures_pp_over_1': len(old_fail),
        'old_gate_failing_team_seasons': [f"{r['season']} {r['team']} {r['old_gate_diff_pp']}" for r in old_fail],
        'ftn_participation_below_threshold': [f"{r['season']} {r['team']} {r['ftn_part_agreement']}"
                                              for r in team_rows if r['ftn_part_agreement'] is not None
                                              and r['ftn_part_agreement'] < AGREE_THRESHOLD],
        'unresolved_play_rows': len(unresolved),
        'r2_pass_team_seasons': sum(1 for r in team_rows if r['r2_pass']),
        'r2_failing_team_seasons': [f"{r['season']} {r['team']}" for r in team_rows if not r['r2_pass']],
        'thresholds': {'old_tolerance_pp': OLD_TOLERANCE_PP, 'ftn_participation_agreement': AGREE_THRESHOLD},
    }
    with open(SUMMARY_JSON, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    print(json.dumps(summary, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
