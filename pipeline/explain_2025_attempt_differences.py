"""Explain the 2025 rushing and passing attempt differences between play-by-play and official team stats. Read-only.

Rushing: PBP rush_attempt = 1, split by event kind, against official `carries`.
Passing: PBP pass_attempt = 1 and sack != 1, split by event kind, against official `attempts`.

For each side, every subset of event kinds is tested. A subset explains the difference if, for every team, the
subset's PBP count equals the official count. Subsets are reported with the number of teams they match.
"""
import collections
import itertools
import json
import os
import sys

import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

SEASON = 2025
OUT = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-attempt-differences-2025/attempt_differences_2025.json'


def kind(r):
    pt = r.get('play_type') or ''
    if r.get('aborted_play') and b.clean_int(r.get('aborted_play')) == 1:
        return 'aborted_play_row'
    if b.clean_int(r.get('two_point_attempt')) == 1:
        return 'two_point_attempt'
    if pt in ('run', 'pass'):
        if b.clean_int(r.get('qb_scramble')) == 1:
            return 'run_pass_qb_scramble'
        return f'{pt}_play'
    return pt or 'blank'


def main():
    rows = [r for r in b.open_rows(os.path.join(b.RAW, b.RESEARCH_PBP_FILES[SEASON]))
            if b.clean_int(r.get('season')) == SEASON and r.get('season_type') == 'REG' and r.get('posteam')]
    rush_kinds = collections.defaultdict(collections.Counter)
    pass_kinds = collections.defaultdict(collections.Counter)
    for r in rows:
        k = kind(r)
        if b.clean_int(r.get('rush_attempt')) == 1:
            rush_kinds[r['posteam']][k] += 1
        if b.clean_int(r.get('pass_attempt')) == 1 and b.clean_int(r.get('sack')) != 1:
            pass_kinds[r['posteam']][k] += 1

    st = pq.read_table('/root/lp-snapshots/nfl-backfill-2026-10-27/raw/stats_team/stats_team_week_2025.parquet',
                       columns=['team', 'season_type', 'carries', 'attempts']).to_pylist()
    carries = collections.Counter()
    attempts = collections.Counter()
    for r in st:
        if r['season_type'] == 'REG':
            carries[r['team']] += r['carries'] or 0
            attempts[r['team']] += r['attempts'] or 0

    result = {}
    for name, per_team, official in (('rushing', rush_kinds, carries), ('passing', pass_kinds, attempts)):
        teams = sorted(set(per_team) | set(official))
        all_kinds = sorted({k for t in teams for k in per_team.get(t, {})})
        base = {t: sum(per_team.get(t, {}).values()) - official.get(t, 0) for t in teams}
        result[name] = {
            'teams': len(teams),
            'kinds': all_kinds,
            'total_pbp_minus_official': sum(base.values()),
            'per_team_difference': {t: base[t] for t in teams if base[t]},
            'kind_totals': {k: sum(per_team[t][k] for t in teams if k in per_team.get(t, {})) for k in all_kinds},
            'best_subsets': [],
        }
        scored = []
        for n in range(1, len(all_kinds) + 1):
            for subset in itertools.combinations(all_kinds, n):
                matches = sum(1 for t in teams
                              if sum(per_team.get(t, {}).get(k, 0) for k in subset) == official.get(t, 0))
                scored.append((matches, subset))
        scored.sort(key=lambda x: (-x[0], len(x[1])))
        result[name]['best_subsets'] = [{'teams_matched': m, 'kinds_counted': list(s)} for m, s in scored[:5]]
        result[name]['teams_matched_by_removing_nothing'] = sum(1 for t in teams if base[t] == 0)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(result, f, indent=1, sort_keys=True)
    print(json.dumps(result, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
