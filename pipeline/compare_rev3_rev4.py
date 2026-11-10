"""rev3 versus rev4 impact at profile level, and the DEN at LAC 2025 sensitivity. Read-only.

Each profile is read on its own and reduced to the counts used here, so memory stays small.
"""
import collections
import glob
import json
import os
import sys

sys.path.insert(0, '/root/gridiron-playbooks-research/pipeline')
import build_playbooks as b  # noqa: E402

REV3 = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev3'
REV4 = '/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev4'
GAP_GAME = '2025_03_DEN_LAC'


def reduce_profile(path):
    j = json.load(open(path))
    side = {}
    for s in ('offense', 'defense'):
        block = j[s]
        side[s] = {
            'ordinary': block['profile']['eligible_scrimmage_plays'],
            'formation_observed': block['profile']['formation']['observed'],
            'formation_missing': block['profile']['formation']['missing'],
            'punt_special': block['special_teams'].get('run_pass_from_punt_formation',
                                                       block['special_teams'].get('fake_punts', 0)),
        }
    o = j['offense']
    side['event_counts'] = dict(o.get('event_counts', {}))
    side['fg_origin'] = o['special_teams'].get('run_pass_from_field_goal_formation', 0)
    return side


def main():
    totals = collections.Counter()
    bad = []
    for path4 in sorted(glob.glob(os.path.join(REV4, '*-20*.json'))):
        name = os.path.basename(path4)[:-5]
        r3 = reduce_profile(os.path.join(REV3, name + '.json'))
        r4 = reduce_profile(path4)
        ec = r4['event_counts']
        leave = (ec.get('two_point_conversion', 0) + ec.get('aborted_snap', 0) + ec.get('aborted_play', 0)
                 + ec.get('other_scrimmage', 0) + r4['fg_origin'])
        drop = r3['offense']['ordinary'] - r4['offense']['ordinary']
        if drop != leave:
            bad.append((name, drop, leave))
        totals['offense ordinary rev3'] += r3['offense']['ordinary']
        totals['offense ordinary rev4'] += r4['offense']['ordinary']
        totals['two_point moved out'] += ec.get('two_point_conversion', 0)
        totals['aborted_snap moved out'] += ec.get('aborted_snap', 0)
        totals['aborted_play moved out'] += ec.get('aborted_play', 0)
        totals['field-goal-origin moved out'] += r4['fg_origin']
        totals['punt-origin special rev3'] += r3['offense']['punt_special']
        totals['punt-origin special rev4'] += r4['offense']['punt_special']
        totals['defense ordinary rev3'] += r3['defense']['ordinary']
        totals['defense ordinary rev4'] += r4['defense']['ordinary']
        totals['offense formation observed rev3'] += r3['offense']['formation_observed']
        totals['offense formation observed rev4'] += r4['offense']['formation_observed']
        totals['offense formation missing rev3'] += r3['offense']['formation_missing']
        totals['offense formation missing rev4'] += r4['offense']['formation_missing']
    for k in sorted(totals):
        print(f'  {k:38s} {totals[k]}')
    print('team-sides where the ordinary drop differs from the plays that left:', len(bad), bad[:4])

    cnt_all, cnt_ex = collections.Counter(), collections.Counter()
    season = 2025
    pbp_path = os.path.join(b.RAW, b.RESEARCH_PBP_FILES[season])
    part_idx = b.participation_index(b.open_rows(os.path.join(b.RAW, b.RESEARCH_PART_FILES[season])))
    for r in b.open_rows(pbp_path):
        if b.clean_int(r.get('season')) != season or r.get('season_type') != 'REG':
            continue
        if r.get('play_type') not in ('run', 'pass') or not (r.get('posteam') and r.get('defteam')):
            continue
        if b.event_class(r)[0] != 'scrimmage':
            continue
        key = (r.get('old_game_id') or r.get('game_id') or '', b.play_id(r.get('play_id')))
        label = ((part_idx.get(key) or {}).get('offense_formation') or '').strip()
        cnt_all[label or '(missing)'] += 1
        if r['game_id'] != GAP_GAME:
            cnt_ex[label or '(missing)'] += 1

    def show(c):
        obs = sum(v for k, v in c.items() if k != '(missing)')
        return {k: (v, round(v / obs, 4)) for k, v in sorted(c.items()) if k != '(missing)'}, c.get('(missing)', 0)
    print('\n2025 offense formation tendency, observed only:')
    print('  all games:', show(cnt_all))
    print('  excluding', GAP_GAME, ':', show(cnt_ex))


if __name__ == '__main__':
    main()
