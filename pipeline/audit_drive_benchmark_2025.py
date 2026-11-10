"""Audit of the 2025 reference drives (version 2) for the drive-benchmark readiness report. Read-only research.

Reads the version 1 and version 2 outputs and the 2025 play-by-play. Writes only to a new audit directory. Version 1 and
version 2 are not changed; their SHA-256 hashes are recorded in the manifest and checked on every run.

Checks:
  1. Possession change after each drive end, with half and game boundaries excluded.
  2. touchdown_allowed: the cause in the subtype matches the scoring row's flags.
  3. Continuity exceptions: each version 2 exception is re-classified from the play text and the next play's spot.
     Version 2's own labels are kept unchanged in the audit file.
  4. Control: how often the end-spot rule holds on ordinary pairs, split by yardage check and penalty flag.
"""
import collections
import csv
import glob
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402
import canonical_drives_2025_v2 as v2  # noqa: E402

SIM_DIR = '/root/gridiron-statistical-full-game/docs/fixtures/e2'
V1_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-canonical-drives-2025'
V2_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-canonical-drives-2025-v2'
AUDIT_DIR = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-drive-benchmark-audit'
AUDIT_CSV = os.path.join(AUDIT_DIR, 'continuity_audit_2025.csv')
CHECKS_JSON = os.path.join(AUDIT_DIR, 'drive_checks_2025.json')
MANIFEST_JSON = os.path.join(AUDIT_DIR, 'manifest.json')
IMMUTABLE = [
    os.path.join(V1_DIR, 'canonical_drives_2025.csv'),
    os.path.join(V1_DIR, 'canonical_drives_2025_summary.json'),
    os.path.join(V2_DIR, 'canonical_drives_2025_v2.csv'),
    os.path.join(V2_DIR, 'canonical_drives_2025_v2_summary.json'),
    os.path.join(V2_DIR, 'continuity_exceptions_2025_v2.csv'),
    os.path.join(V2_DIR, 'end_class_disagreements_2025_v2.csv'),
    os.path.join(V2_DIR, 'sim_comparison_2025_v2.json'),
]

# Expected possession after each drive end: (next drive's team relative to this drive's team, next drive starts with a
# kickoff). After a safety the team that gave it up kicks a free kick, so the team that scored receives.
EXPECT = {
    'touchdown_scored': ('other', True),
    'field_goal_made': ('other', True),
    'safety_allowed': ('other', True),
    'touchdown_allowed': ('same', True),
    'punt': ('other', False),
    'blocked_punt': ('other', False),
    'interception': ('other', False),
    'fumble_lost': ('other', False),
    'turnover_on_downs': ('other', False),
    'field_goal_missed': ('other', False),
}
SPOT = re.compile(r'\b(?:to|at)\s+(?:([A-Z]{2,3})\s+)?(\d{1,2})(?![\d:\-\w])')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def last_spot(desc, posteam):
    """Yardline_100 of the last spot named in a play's text, from the offence's side. None if the text names none.
    A bare number ("to 50") is midfield. Clock times ("at 01:41") and player numbers ("to 4-J.Tolbert") are skipped."""
    ms = list(SPOT.finditer(desc or ''))
    if not ms:
        return None
    m = ms[-1]
    abbr, n = m.group(1), int(m.group(2))
    if abbr is None:
        return n
    return 100 - n if abbr == posteam else n


def first_down_after(y_start, spot_yl, ydstogo):
    """True when the net movement from the start spot to the end spot reaches the distance."""
    return (y_start - spot_yl) >= ydstogo


def possession_ok(end_class, same_team, starts_with_kickoff):
    rel, kick = EXPECT[end_class]
    return (('same' if same_team else 'other') == rel) and starts_with_kickoff == kick


def touchdown_cause_ok(sub, td):
    """Whether the scoring row's flags support the cause named in the subtype."""
    checks = {
        'interception_return': b.clean_int(td.get('interception')) == 1,
        'fumble_return': b.clean_int(td.get('fumble_lost')) == 1 and b.clean_int(td.get('interception')) != 1,
        'punt_return': td.get('play_type') == 'punt' and b.clean_int(td.get('punt_blocked')) != 1,
        'blocked_punt_return': td.get('play_type') == 'punt' and b.clean_int(td.get('punt_blocked')) == 1,
        'field_goal_return': td.get('field_goal_result') in ('missed', 'blocked'),
        'kickoff_return': td.get('play_type') == 'kickoff',
    }
    return checks.get(sub, False)


def kickoff_restart_clock(clock_before, runoff_seconds):
    """The clock the receiving drive starts on, or None when the kickoff runoff expires the quarter."""
    if runoff_seconds >= clock_before:
        return None
    return clock_before - runoff_seconds


def sim_clock_convention():
    """Read-only check of the simulator's clock fields on every distinct simulated game record in the e2 fixtures.
    A drive starts on its first play's clock and ends on its last play's post-play clock. A kickoff's runoff is taken
    before the receiving drive starts."""
    seen = {}
    for path in sorted(glob.glob(os.path.join(SIM_DIR, '*.json')) +
                       glob.glob(os.path.join(SIM_DIR, 'reconciliation', '*.json'))):
        try:
            doc = json.load(open(path))
        except (OSError, ValueError):
            continue
        rec = doc.get('record', doc)
        if not isinstance(rec, dict) or not rec.get('drives') or 'terminal' not in rec['drives'][0]:
            continue
        seen.setdefault(rec.get('simulation_id') or path, rec)
    counts = collections.Counter({'simulations': len(seen)})
    for rec in seen.values():
        by_index = {d['index']: d for d in rec['drives']}
        for d in rec['drives']:
            counts['drives'] += 1
            plays = d.get('plays') or []
            if not plays:
                counts['drives_without_plays'] += 1
                continue
            counts['start_equals_first_play'] += plays[0]['state_before']['clock_seconds'] == d['clock_start']
            counts['end_equals_last_play'] += plays[-1]['state_after']['clock_seconds'] == d['end_clock']
        for k in rec.get('kickoffs', []):
            after = k.get('after_drive')
            nxt = by_index.get(after + 1) if after is not None else None
            if nxt is None or k.get('clock_before') is None or k.get('runoff_seconds') is None:
                continue
            expected = kickoff_restart_clock(k['clock_before'], k['runoff_seconds'])
            if expected is None:
                counts['kickoff_expired_quarter'] += 1
                continue
            counts['kickoff_checked'] += 1
            counts['kickoff_restart_equals_next_drive'] += nxt['clock_start'] == expected
    return dict(counts)


def clock_jump(g_before, g_after, boundary_at_zero):
    """A game clock that rises between two rows. Overtime starts at 600 after a regulation end at 0, which is an expected
    rise; anything else is recorded as a source clock inconsistency."""
    if g_before is None or g_after is None or g_after <= g_before:
        return None
    if boundary_at_zero and g_before == 0 and g_after == 600:
        return 'overtime_period_start'
    return 'unexplained_rise'


def classify_exception(x, a, c, y_a, y_c, spot):
    """Re-classify one version 2 exception from the play text. Returns (status, mechanism)."""
    if x['kind'] == 'field_position':
        fumble = 'FUMBLE' in (a.get('desc') or '')
        if spot is not None and abs(y_c - spot) < 0.5 and fumble:
            return 'explained', 'fumble_end_spot'
        return 'unresolved', 'no_spot_rule_match'
    if x['kind'] == 'down_progression':
        ydstogo = v2.num(a.get('ydstogo'))
        if spot is None or ydstogo is None or y_a is None:
            return 'unresolved', 'no_spot_for_net_gain'
        exp_down = 1 if first_down_after(y_a, spot, ydstogo) else int(float(a['down'])) + 1
        if int(float(c['down'])) == exp_down:
            return 'explained', 'fumble_end_spot_net_gain'
        return 'unresolved', 'net_gain_mismatch'
    return 'unresolved', 'source_clock_order'


def control_table(by_game):
    """Yardage check and end-spot rule on ordinary checked pairs, split by penalty flag and fumble text."""
    grp = collections.Counter()
    for gid, ds in by_game.items():
        for d in ds:
            rows = [r for r in d['rows'] if (r.get('play_type') or '') != '']
            scrim = [i for i, r in enumerate(rows) if r.get('play_type') in ('run', 'pass')]
            for i, j in zip(scrim, scrim[1:]):
                a, c = rows[i], rows[j]
                between = rows[i + 1:j]
                if b.clean_int(a.get('touchdown')) == 1 or any(
                        b.clean_int(x.get('two_point_attempt')) == 1 for x in [a, c] + between):
                    continue
                if any(x.get('play_type') != 'no_play' for x in between):
                    continue
                turn = any(b.clean_int(x.get(k)) == 1 for x in [a] + between for k in ('interception', 'fumble_lost'))
                if a.get('posteam') != c.get('posteam') or turn:
                    continue
                y_a, y_c = v2.num(a.get('yardline_100')), v2.num(c.get('yardline_100'))
                ga = v2.num(a.get('yards_gained'))
                if y_a is None or y_c is None or ga is None:
                    continue
                yards_ok = abs(y_c - (y_a - ga)) <= 0.5
                spot = last_spot(a.get('desc'), a.get('posteam'))
                pen = any(b.clean_int(x.get('penalty')) == 1 for x in [a] + between + [c])
                status = 'no_spot' if spot is None else ('hit' if abs(y_c - spot) < 0.5 else 'miss')
                grp[('fumble' if 'FUMBLE' in (a.get('desc') or '') else 'ordinary',
                     'yardage_ok' if yards_ok else 'yardage_fails',
                     'penalty_flag' if pen else 'no_penalty_flag', status)] += 1
    return {'|'.join(k): v for k, v in sorted(grp.items())}


def main():
    os.makedirs(AUDIT_DIR, exist_ok=True)
    games = v2.build_games()
    by_game = v2.build_drives(games)
    drives = [d for ds in by_game.values() for d in ds]
    checks = {}

    # 1. Possession change, half and game boundaries excluded
    pc = collections.Counter()
    pc_bad = []
    for gid, ds in by_game.items():
        for i, d in enumerate(ds[:-1]):
            nxt = ds[i + 1]
            if nxt['half'] != d['half'] or d['end_time_basis'] in ('half_end_row', 'game_end_row'):
                continue
            if d['end_class'] not in EXPECT:
                continue
            first = next((r for r in nxt['rows'] if (r.get('play_type') or '')), {})
            ok = possession_ok(d['end_class'], nxt['team'] == d['team'], first.get('play_type') == 'kickoff')
            pc[(d['end_class'], 'ok' if ok else 'exception')] += 1
            if not ok:
                pc_bad.append([gid, d['drive_index'], d['end_class'], d['team'], nxt['drive_index'], nxt['team']])
    checks['possession_change'] = {
        'transitions_checked': sum(pc.values()),
        'exceptions': len(pc_bad),
        'by_end_class': {f"{k[0]} {k[1]}": v for k, v in sorted(pc.items())},
        'exception_rows': pc_bad,
    }

    # 2. touchdown_allowed: cause flags on the scoring row
    td_ok = td_bad = 0
    td_points = collections.Counter()
    for d in drives:
        if d['end_class'] != 'touchdown_allowed':
            continue
        td = next(r for r in d['rows'] if b.clean_int(r.get('touchdown')) == 1 and r.get('td_team')
                  and r.get('td_team') != d['team'])
        if touchdown_cause_ok(d['end_subtype'], td):
            td_ok += 1
        else:
            td_bad += 1
        td_points[d['points_against']] += 1
        if d['points_for'] != 0:
            td_bad += 1
    checks['touchdown_allowed'] = {
        'drives': td_ok + td_bad,
        'cause_consistent': td_ok,
        'inconsistent': td_bad,
        'points_against_distribution': dict(sorted(td_points.items())),
    }

    # 3. Continuity exceptions: re-classified from the text, v2 labels kept
    exc = list(csv.DictReader(open(os.path.join(V2_DIR, 'continuity_exceptions_2025_v2.csv'))))
    index = {}
    for gid, rows in games.items():
        for i, r in enumerate(rows):
            index[(gid, str(r.get('play_id')))] = (i, r)
    audit_rows = []
    status_count = collections.Counter()
    for x in exc:
        ia, a = index[(x['game_id'], x['play_id_a'])]
        ic, c = index[(x['game_id'], x['play_id_c'])]
        y_a, y_c = v2.num(a.get('yardline_100')), v2.num(c.get('yardline_100'))
        spot = last_spot(a.get('desc'), a.get('posteam'))
        if x['kind'] == 'clock':
            between = [index[(x['game_id'], p)][1] for p in x['between_play_ids'].split(';') if p]
            clock = {'play_a': v2.gsr(a), 'between': [v2.gsr(r) for r in between], 'play_c': v2.gsr(c)}
            rise = clock_jump(v2.gsr(a), v2.gsr(c), boundary_at_zero=False)
            status, mechanism = 'unresolved', 'source_clock_' + str(rise)
            detail = json.dumps(clock)
        else:
            status, mechanism = classify_exception(x, a, c, y_a, y_c, spot)
            detail = x['detail']
        status_count[(x['kind'], status, mechanism)] += 1
        audit_rows.append({
            'kind': x['kind'], 'game_id': x['game_id'], 'team': x['team'], 'play_id_a': x['play_id_a'],
            'between_play_ids': x['between_play_ids'], 'play_id_c': x['play_id_c'],
            'v2_evidence': x['evidence'], 'audit_status': status, 'audit_mechanism': mechanism,
            'end_spot_yardline_100': '' if spot is None else spot, 'next_play_yardline_100': '' if y_c is None else y_c,
            'v2_detail': x['detail'], 'audit_detail': detail,
            'desc_a': (a.get('desc') or '')[:400],
        })
    with open(AUDIT_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(audit_rows[0].keys()))
        w.writeheader()
        w.writerows(audit_rows)
    checks['continuity_audit'] = {f"{k[0]} | {k[1]} | {k[2]}": v for k, v in sorted(status_count.items())}

    # Every game-clock rise in file order, not only the checked pairs. Overtime starts are expected.
    rises = collections.Counter()
    for gid, rows in games.items():
        gs = [(i, v2.gsr(r)) for i, r in enumerate(rows) if v2.gsr(r) is not None]
        for (_, g1), (_, g2) in zip(gs, gs[1:]):
            if g2 > g1:
                rises[clock_jump(g1, g2, boundary_at_zero=True)] += 1
    checks['clock_rises_file_order'] = dict(rises)

    # 4. Control, and the simulator's clock convention (read-only)
    checks['control_end_spot_rule'] = control_table(by_game)
    checks['simulator_clock_convention'] = sim_clock_convention()
    checks['drive_count'] = {'kept': len(drives), 'offensive': sum(1 for d in drives if d['offensive'])}

    with open(CHECKS_JSON, 'w') as f:
        json.dump(checks, f, indent=1, sort_keys=True, default=str)

    manifest = {'immutable_files': {os.path.relpath(p, '/root/gridiron-playbooks-research'): sha256(p)
                                    for p in IMMUTABLE}}
    if os.path.exists(MANIFEST_JSON):
        old = json.load(open(MANIFEST_JSON))
        changed = [k for k, v in old['immutable_files'].items()
                   if manifest['immutable_files'].get(k) != v]
        manifest['previous_check'] = {'files_changed_since_last_run': changed}
    with open(MANIFEST_JSON, 'w') as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    print(json.dumps({k: checks[k] for k in ('possession_change', 'touchdown_allowed', 'continuity_audit')},
                     indent=1, sort_keys=True, default=str)[:4000])


if __name__ == '__main__':
    main()
