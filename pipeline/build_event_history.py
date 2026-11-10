"""Chronological event history for regular seasons 2022 to 2026: every play-by-play row, one event type each.

Read-only with respect to the profiles. Writes a CSV (too large for git) outside the repository and a JSON summary
with the reconciliation. Every row gets exactly one event type. An unknown play type fails loudly.
"""
import collections
import csv
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

OUT_DIR = '/root/lp-snapshots/nfl-event-history-2026-10-27'
CSV_OUT = os.path.join(OUT_DIR, 'event_history.csv')
JSON_OUT = os.path.join(OUT_DIR, 'event_history_summary.json')
COLUMNS = ['season', 'game_id', 'play_id', 'drive', 'qtr', 'time', 'posteam', 'defteam', 'event_type',
           'event_subtype', 'play_type', 'down', 'ydstogo', 'yardline_100', 'rush_attempt', 'pass_attempt', 'sack',
           'qb_scramble', 'fumble', 'fumble_lost', 'interception', 'touchdown', 'safety', 'penalty', 'aborted_play',
           'two_point_attempt', 'desc']
KNOWN_PLAY_TYPES = {'run', 'pass', 'qb_kneel', 'qb_spike', 'kickoff', 'punt', 'field_goal', 'extra_point', 'no_play'}


def classify(r):
    pt = (r.get('play_type') or '').strip()
    desc = (r.get('desc') or '').lower()
    if pt in ('run', 'pass'):
        snap_type, _origin, _execution = b.event_class(r)
        return 'run_pass', snap_type
    if pt in ('qb_kneel', 'qb_spike', 'kickoff', 'punt', 'field_goal', 'extra_point'):
        return pt, pt
    if 'timeout' in desc:
        return 'administrative', 'timeout'
    if pt == 'no_play':
        if 'fumbles (aborted)' in desc:
            return 'no_play', 'no_play_fumbled_snap'
        if 'penalty' in desc or 'no play' in desc:
            return 'no_play', 'penalty_or_no_play'
        return 'no_play', 'no_play_other'
    if pt == '':
        if 'end quarter' in desc:
            return 'administrative', 'period_end'
        if 'game has' in desc or 'suspended' in desc or 'delay' in desc:
            return 'administrative', 'game_delay'
        if desc.strip() in ('game', 'end game'):
            return 'administrative', 'game_marker'
        if 'play did not occur' in desc:
            return 'administrative', 'play_did_not_occur'
        if 'game clock' in desc or 'replay' in desc:
            return 'administrative', 'replay_or_clock_note'
        if 'two-minute' in desc or 'warning' in desc:
            return 'administrative', 'period_or_warning'
        if 'penalty' in desc:
            return 'administrative', 'penalty_text'
        return 'unclassified', 'blank_play_type_text'
    raise ValueError(f'unknown play_type {pt!r} at {r.get("game_id")} {r.get("play_id")}')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    counts = collections.Counter()
    per_season = collections.Counter()
    seen = set()
    rows_written = 0
    with open(CSV_OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for season in range(2022, 2027):
            path = os.path.join(b.PINNED_INPUTS if season == 2026 else b.RAW, b.RESEARCH_PBP_FILES[season])
            for r in b.open_rows(path):
                if b.clean_int(r.get('season')) != season or r.get('season_type') != 'REG':
                    continue
                key = (r.get('game_id'), b.play_id(r.get('play_id')))
                if key in seen:
                    raise ValueError(f'duplicate event {key}')
                seen.add(key)
                event_type, subtype = classify(r)
                counts[(event_type, subtype)] += 1
                per_season[season] += 1
                w.writerow({
                    'season': season, 'game_id': r.get('game_id'), 'play_id': b.play_id(r.get('play_id')),
                    'drive': r.get('drive') or '', 'qtr': r.get('qtr') or '', 'time': r.get('time') or '',
                    'posteam': r.get('posteam') or '', 'defteam': r.get('defteam') or '',
                    'event_type': event_type, 'event_subtype': subtype, 'play_type': r.get('play_type') or '',
                    'down': r.get('down') or '', 'ydstogo': r.get('ydstogo') or '',
                    'yardline_100': r.get('yardline_100') or '', 'rush_attempt': r.get('rush_attempt') or '',
                    'pass_attempt': r.get('pass_attempt') or '', 'sack': r.get('sack') or '',
                    'qb_scramble': r.get('qb_scramble') or '', 'fumble': r.get('fumble') or '',
                    'fumble_lost': r.get('fumble_lost') or '', 'interception': r.get('interception') or '',
                    'touchdown': r.get('touchdown') or '', 'safety': r.get('safety') or '',
                    'penalty': r.get('penalty') or '', 'aborted_play': r.get('aborted_play') or '',
                    'two_point_attempt': r.get('two_point_attempt') or '', 'desc': r.get('desc') or '',
                })
                rows_written += 1
    by_type = collections.Counter()
    for (et, _st), n in counts.items():
        by_type[et] += n
    summary = {
        'rows_written': rows_written,
        'rows_by_season': dict(per_season),
        'rows_by_event_type': dict(by_type),
        'rows_by_event_type_and_subtype': {f'{et}|{st}': n for (et, st), n in sorted(counts.items())},
        'reconciles': sum(by_type.values()) == rows_written == len(seen),
    }
    with open(JSON_OUT, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    print('rows written:', rows_written, '-> ', CSV_OUT)
    print('by event type:', dict(by_type))
    print('reconciles (event types sum to rows, no duplicates):', summary['reconciles'])


if __name__ == '__main__':
    main()
