"""Descriptive comparison of Gridiron Physics simulated drives with the 2025 canonical drives (version 2). Read-only.

Simulator records are read from the gridiron-statistical-full-game repository (docs/fixtures/e2). Each distinct
simulation (by simulation_id) is counted once. The simulator marks its own records valid_full_game False, and most
are incomplete, so this comparison describes the two samples. It is not a calibration target.
"""
import csv
import glob
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

SIM_DIR = '/root/gridiron-statistical-full-game/docs/fixtures/e2'
OUT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-canonical-drives-2025-v2'
DRIVE_CSV = os.path.join(OUT_DIR, 'canonical_drives_2025_v2.csv')
OUT_JSON = os.path.join(OUT_DIR, 'sim_comparison_2025_v2.json')

SIM_GROUP = {'touchdown': 'touchdown', 'punt': 'punt', 'turnover': 'turnover', 'turnover_on_downs': 'turnover_on_downs',
             'end_of_regulation': 'end_of_half_or_game', 'halftime': 'end_of_half_or_game', 'safety': 'safety'}
OBS_GROUP = {'touchdown_scored': 'touchdown', 'punt': 'punt', 'blocked_punt': 'punt', 'interception': 'turnover',
             'fumble_lost': 'turnover', 'turnover_on_downs': 'turnover_on_downs', 'end_of_half': 'end_of_half_or_game',
             'end_of_game': 'end_of_half_or_game', 'safety_allowed': 'safety', 'touchdown_allowed': 'touchdown_allowed',
             'field_goal_made': 'field_goal', 'field_goal_missed': 'field_goal'}


def gsr(quarter, clock):
    """Game seconds remaining for a regulation quarter and the clock inside it."""
    return max(0, 4 - int(quarter)) * 900 + int(clock)


def sim_drives():
    seen = {}
    for path in sorted(glob.glob(os.path.join(SIM_DIR, '*.json')) + glob.glob(os.path.join(SIM_DIR, 'reconciliation',
                                                                                             '*.json'))):
        try:
            doc = json.load(open(path))
        except (OSError, ValueError):
            continue
        rec = doc.get('record', doc)
        if not isinstance(rec, dict) or not rec.get('drives') or 'terminal' not in rec['drives'][0]:
            continue
        sid = rec.get('simulation_id') or path
        seen.setdefault(sid, {'path': os.path.relpath(path, SIM_DIR), 'seed': rec.get('seed'),
                              'complete_game': rec.get('complete_game'),
                              'valid_full_game': rec.get('valid_full_game'), 'drives': rec['drives']})
    return seen


def share(counter, total):
    return {k: {'n': v, 'share': round(v / total, 4)} for k, v in sorted(counter.items())}


def main():
    sims = sim_drives()
    rows = []
    with open(DRIVE_CSV, newline='') as f:
        for r in csv.DictReader(f):
            if r['offensive'] == 'True':
                rows.append(r)

    sim_counts, sim_plays, sim_poss = {}, [], []
    games = []
    for sid, info in sims.items():
        games.append({'simulation_id': sid, 'file': info['path'], 'seed': info['seed'],
                      'complete_game': info['complete_game'], 'valid_full_game': info['valid_full_game'],
                      'drives': len(info['drives'])})
        for d in info['drives']:
            if d.get('terminal') is None:
                continue
            group = 'field_goal' if d['terminal'] == 'field_goal_attempt' else SIM_GROUP.get(d['terminal'], 'other')
            sim_counts[group] = sim_counts.get(group, 0) + 1
            sim_plays.append(len(d.get('plays') or []))
            if d.get('end_quarter') is not None and d.get('end_clock') is not None:
                sim_poss.append(gsr(d['quarter_start'], d['clock_start']) - gsr(d['end_quarter'], d['end_clock']))

    obs_counts = {}
    for r in rows:
        group = OBS_GROUP.get(r['end_class'], 'other')
        obs_counts[group] = obs_counts.get(group, 0) + 1
    obs_plays = [int(r['offense_plays']) for r in rows]
    obs_poss = [int(float(r['possession_seconds'])) for r in rows if r['possession_seconds'] not in ('', 'None')]

    summary = {
        'simulations': games,
        'sim_drives_with_terminal': sum(sim_counts.values()),
        'sim_end_share': share(sim_counts, sum(sim_counts.values())),
        'sim_plays_per_drive': {'n': len(sim_plays), 'mean': round(statistics.mean(sim_plays), 3)},
        'sim_possession_seconds': {'n': len(sim_poss), 'mean': round(statistics.mean(sim_poss), 1),
                                   'median': statistics.median(sim_poss)},
        'observed_offensive_drives': len(rows),
        'observed_end_share': share(obs_counts, len(rows)),
        'observed_plays_per_drive': {'n': len(obs_plays), 'mean': round(statistics.mean(obs_plays), 3)},
        'observed_possession_seconds': {'n': len(obs_poss), 'mean': round(statistics.mean(obs_poss), 1),
                                        'median': statistics.median(obs_poss)},
        'caveat': 'Descriptive only. The simulator draws drives from an E1 pool built on 2022-2025 data, and its '
                  'records are marked valid_full_game False. Sample sizes are in each entry.',
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    print(json.dumps(summary, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
