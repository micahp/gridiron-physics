"""Audit of every aborted event in 2022 to 2026 (aborted_play = 1). Read-only.

Source fields only. No intent is inferred. The handling category is decided from the description text, and every
rule is listed in the output so it can be checked.
"""
import collections
import csv
import os
import re
import sys

sys.path.insert(0, '/root/gridiron-playbooks-research/pipeline')
import build_playbooks as b  # noqa: E402

OUT = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-27-aborted-audit/aborted_events_audit.csv'
COLUMNS = ['season', 'game_id', 'play_id', 'posteam', 'defteam', 'qtr', 'down', 'ydstogo', 'play_type', 'play_type_nfl',
           'special_teams_play', 'rush_attempt', 'pass_attempt', 'qb_scramble', 'sack', 'yards_gained', 'fumble',
           'fumble_lost', 'rusher_player_name', 'passer_player_name', 'touchdown', 'interception', 'first_down',
           'drive', 'handling_category', 'handling_rule', 'desc']

SNAP_FUMBLE = re.compile(r'fumbles \(aborted\)')
ABORTED_THEN = re.compile(r'\baborted\.')
KICK_FORMATION = re.compile(r'\((punt|field goal|kick) formation\)')


def categorize(desc, play_type):
    d = desc.lower()
    if KICK_FORMATION.search(d):
        return 'dropped_kicking_operation', 'kicking formation text and aborted flag'
    if SNAP_FUMBLE.search(d):
        return 'fumbled_snap', 'text: FUMBLES (Aborted)'
    if ABORTED_THEN.search(d):
        return 'unknown_handling', 'text: a player "aborted." then a fumble by another player; no source for handoff or backward pass'
    return 'unknown_handling', 'aborted flag with no recognised handling text'


def main():
    rows = []
    for s in range(2022, 2027):
        p = os.path.join(b.PINNED_INPUTS if s == 2026 else b.RAW, b.RESEARCH_PBP_FILES[s])
        for r in b.open_rows(p):
            if b.clean_int(r.get('season')) != s or r.get('season_type') != 'REG':
                continue
            if b.clean_int(r.get('aborted_play')) != 1:
                continue
            desc = r.get('desc') or ''
            cat, rule = categorize(desc, r.get('play_type'))
            rows.append({
                'season': s, 'game_id': r.get('game_id'), 'play_id': b.play_id(r.get('play_id')),
                'posteam': r.get('posteam'), 'defteam': r.get('defteam'), 'qtr': r.get('qtr'), 'down': r.get('down'),
                'ydstogo': r.get('ydstogo'), 'play_type': r.get('play_type'), 'play_type_nfl': r.get('play_type_nfl'),
                'special_teams_play': r.get('special_teams_play'), 'rush_attempt': r.get('rush_attempt'),
                'pass_attempt': r.get('pass_attempt'), 'qb_scramble': r.get('qb_scramble'), 'sack': r.get('sack'),
                'yards_gained': r.get('yards_gained'), 'fumble': r.get('fumble'), 'fumble_lost': r.get('fumble_lost'),
                'rusher_player_name': r.get('rusher_player_name'), 'passer_player_name': r.get('passer_player_name'),
                'touchdown': r.get('touchdown'), 'interception': r.get('interception'),
                'first_down': r.get('first_down'), 'drive': r.get('drive'),
                'handling_category': cat, 'handling_rule': rule, 'desc': desc,
            })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print('aborted events:', len(rows), '->', OUT)
    print('by handling category:', dict(collections.Counter(r['handling_category'] for r in rows)))
    print('by play_type:', dict(collections.Counter(r['play_type'] for r in rows)))
    print('by special_teams_play:', dict(collections.Counter(r['special_teams_play'] for r in rows)))
    print('fumble flag:', dict(collections.Counter(r['fumble'] for r in rows)))
    print('rush_attempt / pass_attempt:', dict(collections.Counter((r['rush_attempt'], r['pass_attempt']) for r in rows)))
    print('touchdown:', dict(collections.Counter(r['touchdown'] for r in rows)))
    print('has rusher or passer name:', sum(1 for r in rows if r['rusher_player_name'] or r['passer_player_name']))
    print('unknown-handling samples:')
    for r in [x for x in rows if x['handling_category'] == 'unknown_handling'][:4]:
        print('  ', r['season'], r['game_id'], r['play_id'], r['desc'][:130])


if __name__ == '__main__':
    main()
