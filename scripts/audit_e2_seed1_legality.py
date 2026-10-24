#!/usr/bin/env python3
"""Independent Gridiron legality audit for one E2 seed-1 JSON payload.

Run: python3 scripts/audit_e2_seed1_legality.py /path/to/e2-game-seed1.json
The built-in negative fixtures run on every invocation before the supplied payload is audited.
"""

from __future__ import annotations

import copy
import json
import random
import sys
from pathlib import Path


class AuditFailure(Exception):
    pass


def need(condition: bool, message: str) -> None:
    if not condition:
        raise AuditFailure(message)


def get_record(payload: dict) -> dict:
    record = payload.get('record', payload)
    need(isinstance(record, dict), 'payload record must be a JSON object')
    return record


def claims_valid_game(payload: dict, record: dict) -> bool:
    return payload.get('valid_full_game') is True or record.get('valid_full_game') is True


def seed_and_ledger(payload: dict, record: dict):
    seed = payload.get('seed', record.get('seed'))
    need(seed == 1, f'expected seed 1, got {seed!r}')
    ledger = record.get('ledger')
    need(isinstance(ledger, dict), 'record.ledger is missing')
    return seed, ledger


def expected_toss(seed: int):
    rng = random.Random(seed)
    return rng.choice(('A', 'B')), rng.choice(('receive', 'defer'))


def check_toss_support(samples) -> dict:
    counts = {('A', 'receive'): 0, ('A', 'defer'): 0, ('B', 'receive'): 0, ('B', 'defer'): 0}
    for winner, choice in samples:
        need((winner, choice) in counts, f'invalid toss sample {(winner, choice)!r}')
        counts[(winner, choice)] += 1
    missing = [f'{winner}/{choice}' for (winner, choice), count in counts.items() if count == 0]
    need(not missing, f'toss sampler did not cover both winners and both choices: missing {", ".join(missing)}')
    return counts


def audit_toss(payload: dict, record: dict) -> str:
    seed, ledger = seed_and_ledger(payload, record)
    winner, choice = expected_toss(seed)
    loser = 'B' if winner == 'A' else 'A'
    need(ledger.get('winner') == winner, f'toss winner disagrees with seed {seed}: expected {winner}, got {ledger.get("winner")}')
    need(ledger.get('loser') == loser, 'toss ledger loser must be the other team')
    need(ledger.get('winner_choice') == choice, f'toss choice disagrees with seed {seed}: expected {choice}, got {ledger.get("winner_choice")}')
    first = winner if choice == 'receive' else loser
    second = loser if choice == 'receive' else winner
    need(ledger.get('first_half_chooser') == first, 'first-half chooser disagrees with toss winner and choice')
    need(ledger.get('second_half_chooser') == second, 'second-half chooser disagrees with toss winner and choice')
    need(ledger.get('winner_deferred') is (choice == 'defer'), 'winner_deferred disagrees with winner_choice')

    half = [k for k in record.get('kickoffs', []) if k.get('kind') == 'half_start']
    need(len(half) == 2, f'expected exactly two half-start kickoffs, got {len(half)}')
    by_quarter = {k.get('quarter'): k for k in half}
    need(set(by_quarter) == {1, 3}, 'half-start kickoffs must be in Q1 and Q3')
    q1, q3 = by_quarter[1], by_quarter[3]
    need((q1.get('receiving_team'), q1.get('kicking_team')) == (first, loser if first == winner else winner),
         'Q1 kickoff does not follow the toss ledger')
    need((q3.get('receiving_team'), q3.get('kicking_team')) == (second, first),
         'Q3 kickoff does not reverse the Q1 teams and follow the second-half choice')

    samples = []
    for sample_seed in range(1, 301):
        samples.append(expected_toss(sample_seed))
    counts = check_toss_support(samples)
    return ', '.join(f'{team}/{choice}={count}' for (team, choice), count in counts.items())


def audit_drive_indices(record: dict) -> str:
    drives = record.get('drives')
    need(isinstance(drives, list), 'record.drives must be an array')
    count = 0
    for drive in drives:
        game_index = drive.get('index')
        need(isinstance(game_index, int) and not isinstance(game_index, bool) and game_index > 0,
             f'drive has invalid game-level index {game_index!r}')
        plays = drive.get('plays')
        need(isinstance(plays, list), f'drive {game_index}.plays must be an array')
        for play in plays:
            before = (play.get('state_before') or {}).get('drive_index')
            after = (play.get('state_after') or {}).get('drive_index')
            need(before == after == game_index,
                 f'drive-index mismatch at play {play.get("id", play.get("sequence", "?"))}: '
                 f'before={before}, after={after}, game-level={game_index}')
            count += 1
    return f'{len(drives)} drives, {count} plays'


CONVERSION_RESULTS = {
    'extra_point': ('extra_point_result', {'good': 1, 'failed': 0, 'blocked': 0}),
    'extra_point_attempt': ('extra_point_result', {'good': 1, 'failed': 0, 'blocked': 0}),
    'two_point': ('two_point_conv_result', {'success': 2, 'failure': 0}),
    'two_point_try': ('two_point_conv_result', {'success': 2, 'failure': 0}),
    'two_point_conversion': ('two_point_conv_result', {'success': 2, 'failure': 0}),
    'two_point_conv': ('two_point_conv_result', {'success': 2, 'failure': 0}),
}


def audit_conversion_sources(record: dict) -> str:
    checked = 0
    issues = []
    for drive in record.get('drives', []):
        scoring = drive.get('points_scored_on_drive') or {}
        attempt = scoring.get('try')
        if drive.get('terminal') == 'touchdown':
            if not isinstance(attempt, dict):
                issues.append(f'drive {drive.get("index")}: touchdown has no sourced conversion result')
        if attempt is not None:
            checked += 1
            try:
                _check_conversion(attempt, f'drive {drive.get("index")}.points_scored_on_drive.try')
                if drive.get('terminal') == 'touchdown':
                    result_field, result_points = CONVERSION_RESULTS[attempt['kind']]
                    expected_drive_points = 6 + result_points[attempt[result_field]]
                    need(scoring.get('points') == expected_drive_points,
                         f'drive {drive.get("index")}: points {scoring.get("points")} do not reconcile to '
                         f'touchdown plus {result_field}={attempt[result_field]} ({expected_drive_points})')
            except (AuditFailure, KeyError, TypeError) as error:
                issues.append(str(error))

        for play in drive.get('plays', []):
            kind = play.get('event_type')
            if kind in ('extra_point', 'extra_point_attempt', 'two_point_try', 'two_point_conversion', 'two_point_conv'):
                checked += 1
                try:
                    _check_conversion(play.get('outcome') or {}, f'play {play.get("id", play.get("sequence", "?"))}.outcome', kind)
                except AuditFailure as error:
                    issues.append(str(error))
    need(not issues, '; '.join(issues))
    return f'{checked} conversion attempts checked against publisher result fields'


def _check_conversion(attempt: dict, path: str, event_kind: str | None = None) -> None:
    kind = event_kind or attempt.get('kind')
    if kind == 'two_point_try':
        kind = 'two_point_try'
    result_field, point_map = CONVERSION_RESULTS.get(kind, (None, None))
    need(result_field is not None, f'{path}: unsupported conversion kind {kind!r}')
    result = attempt.get(result_field)
    need(result in point_map, f'{path}: missing/invalid producer {result_field}; EPA success is not a source')
    made = point_map[result] > 0
    if 'made' in attempt:
        need(attempt['made'] is made, f'{path}: made conflicts with {result_field}={result}')
    if 'points_scored' in attempt:
        need(attempt['points_scored'] == point_map[result], f'{path}: points_scored conflicts with {result_field}={result}')


def audit_missed_field_goals(record: dict) -> str:
    drives = record.get('drives', [])
    checked = 0
    for i, drive in enumerate(drives):
        if drive.get('terminal') != 'field_goal_attempt':
            continue
        made = drive.get('field_goal_made')
        need(isinstance(made, bool), f'drive {drive.get("index")}: field_goal_made is not producer-supplied boolean')
        if made:
            continue
        plays = drive.get('plays') or []
        need(bool(plays), f'drive {drive.get("index")}: missed field goal has no attempt play')
        attempt = plays[-1]
        snap_spot = (attempt.get('state_before') or {}).get('yardline_100')
        need(isinstance(snap_spot, (int, float)) and not isinstance(snap_spot, bool),
             f'drive {drive.get("index")}: missed field goal has no numeric snap yardline')
        if drive.get('snap_yardline_100') is not None:
            need(drive['snap_yardline_100'] == snap_spot,
                 f'drive {drive.get("index")}: producer snap_yardline_100 disagrees with state_before')

        kick_spot = drive.get('kick_spot_yardline_100')
        if kick_spot is None:
            kick_spot = (attempt.get('outcome') or {}).get('kick_spot_yardline_100')
        need(isinstance(kick_spot, (int, float)) and not isinstance(kick_spot, bool),
             f'drive {drive.get("index")}: separate kick_spot_yardline_100 is required; snap yardline is not a fallback')
        need(0 <= kick_spot <= 100, f'drive {drive.get("index")}: kick spot outside field [0,100]')
        # Successor producer labels the holder's placement as an authored 7-yard offset, capped at 99.
        expected_kick_spot = min(99, snap_spot + 7)
        need(kick_spot == expected_kick_spot,
             f'drive {drive.get("index")}: kick spot {kick_spot} != authored snap+7 spot {expected_kick_spot}')

        if i + 1 >= len(drives):
            continue  # a miss can be the final timed play; no subsequent possession to compare
        next_drive = drives[i + 1]
        receiver = (attempt.get('state_before') or {}).get('defense_team')
        need(next_drive.get('offense_team') == receiver,
             f'drive {drive.get("index")}: next possession {next_drive.get("offense_team")} != receiver {receiver}')
        next_plays = next_drive.get('plays') or []
        need(bool(next_plays), f'drive {next_drive.get("index")}: next drive has no opening play')
        actual = (next_plays[0].get('state_before') or {}).get('yardline_100')
        expected = 100 - max(20, kick_spot)
        need(actual == expected,
             f'drive {drive.get("index")}: missed-kick restart is {actual}, expected {expected} from kick spot {kick_spot}')
        checked += 1
    return f'{checked} missed field-goal restarts checked at separate kick spot (inside-20 floor applied)'


def active(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in ('', '0', 'false', 'no', 'none', 'null', 'no penalty')
    if isinstance(value, (list, dict)):
        return bool(value)
    return value is not None


def transition_marker(play: dict):
    penalty_keys = {'penalty', 'penalty_flag', 'penalty_called', 'penalty_applied', 'penalty_yards'}
    timeout_keys = {'timeout', 'timeout_applied', 'timeout_team', 'timeout_transition'}
    warning_keys = {'two_minute_warning', 'two_minute_warning_flag', 'two_minute_warning_transition'}
    clock_keys = {'clock_transition', 'clock_clamped_to_zero', 'clock_only_terminal', 'clock_stopped', 'clock_started'}
    stack = [play]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        event_type = str(node.get('event_type', '')).lower().replace('-', '_').replace(' ', '_')
        if event_type in ('penalty', 'penalty_transition', 'penalty_enforced'):
            return 'penalty transition'
        if event_type in ('timeout', 'timeout_transition'):
            return 'timeout transition'
        if event_type in ('two_minute_warning', 'two_minute_warning_transition'):
            return 'two-minute-warning transition'
        if event_type in ('clock_transition', 'clock_status_change', 'clock_clamped_to_zero', 'clock_only_terminal'):
            return 'unmodelled clock transition'
        for key, value in node.items():
            name = key.lower().replace('-', '_').replace(' ', '_')
            if name in penalty_keys and active(value):
                return 'penalty transition'
            if name in timeout_keys and active(value):
                return 'timeout transition'
            if name in warning_keys and active(value):
                return 'two-minute-warning transition'
            if name in clock_keys and active(value):
                return 'unmodelled clock transition'
            if isinstance(value, (dict, list)):
                stack.append(value)
    return None


def audit_complete_claim_transitions(payload: dict, record: dict) -> str:
    if not claims_valid_game(payload, record):
        return 'not claimed legal-complete; unmodelled transitions remain scoped'
    for drive in record.get('drives', []):
        for play in drive.get('plays', []):
            marker = transition_marker(play)
            need(marker is None,
                 f'valid_full_game cannot be true: play {play.get("id", play.get("sequence", "?"))} carries {marker}')
    unsupported = set(payload.get('unsupported_rules', [])) | set(record.get('unsupported_rules', []))
    for rule in ('timeouts', 'two_minute_warning', 'penalties'):
        need(rule not in unsupported, f'valid_full_game cannot be true while {rule} remains unsupported')
    clock = payload.get('event_clock') or record.get('event_clock')
    need(isinstance(clock, dict) and clock.get('clock_contract_version') == 'gridiron.event-driven-clock.v1',
         'valid_full_game requires the versioned event_clock v1 stream')
    need(isinstance(clock.get('model_version'), str) and clock['model_version'].strip(),
         'event_clock model_version must be producer-supplied')
    need(isinstance(clock.get('rules_version'), str) and clock['rules_version'].strip(),
         'event_clock rules_version must be producer-supplied')
    need(isinstance(clock.get('events'), list) and clock['events'], 'event_clock events are required')
    return 'no unmodelled clock, timeout, warning, or penalty transition'


def audit_overtime_scope(payload: dict, record: dict) -> str:
    markers = []
    overtime_play_ids = set()
    for drive in record.get('drives', []):
        if any(isinstance(drive.get(field), (int, float)) and drive[field] > 4 for field in ('quarter_start', 'end_quarter')):
            markers.append(f'drive {drive.get("index")}')
        for play in drive.get('plays', []):
            if any(isinstance((play.get(state) or {}).get('quarter'), (int, float)) and (play.get(state) or {})['quarter'] > 4
                   for state in ('state_before', 'state_after')):
                overtime_play_ids.add(play.get('id', play.get('sequence', '?')))
                markers.append(f'play {play.get("id", play.get("sequence", "?"))}')
    for boundary in record.get('boundaries', []):
        if any(isinstance(boundary.get(field), (int, float)) and boundary[field] > 4 for field in ('from_quarter', 'to_quarter')):
            markers.append('period boundary')
    if isinstance(record.get('final_quarter'), (int, float)) and record['final_quarter'] > 4:
        markers.append('final quarter')
    if not markers:
        return 'no overtime rows'

    scope = payload.get('pool_scope') or (payload.get('sources') or {}).get('pool_scope') or record.get('pool_scope')
    need(isinstance(scope, dict) and scope.get('regulation_only') is True,
         f'overtime rows require pool_scope.regulation_only=true; found {markers[0]}')
    need(not claims_valid_game(payload, record),
         'regulation-only pool overtime rows cannot be declared a legal complete overtime game')
    return f'{len(overtime_play_ids)} overtime play row(s) explicitly scoped regulation-only, not modeled overtime'


def audit_payload(payload: dict):
    record = get_record(payload)
    findings = []
    results = []
    checks = (
        ('seed', lambda: f'seed {seed_and_ledger(payload, record)[0]}'),
        ('drive_index', lambda: audit_drive_indices(record)),
        ('conversion_sources', lambda: audit_conversion_sources(record)),
        ('missed_field_goal_spot', lambda: audit_missed_field_goals(record)),
        ('coin_toss', lambda: audit_toss(payload, record)),
        ('clock_timeout_warning_penalty', lambda: audit_complete_claim_transitions(payload, record)),
        ('overtime_scope', lambda: audit_overtime_scope(payload, record)),
    )
    for name, check in checks:
        try:
            results.append((name, 'PASS', check()))
        except (AuditFailure, TypeError, KeyError, ValueError) as error:
            findings.append((name, str(error)))
            results.append((name, 'FAIL', str(error)))
    return record, results, findings


def base_fixture():
    winner, choice = expected_toss(1)
    loser = 'B' if winner == 'A' else 'A'
    first = winner if choice == 'receive' else loser
    second = loser if choice == 'receive' else winner
    return {
        'seed': 1,
        'valid_full_game': True,
        'unsupported_rules': [],
        'pool_scope': {'regulation_only': True},
        'event_clock': {
            'clock_contract_version': 'gridiron.event-driven-clock.v1',
            'model_version': 'fixture-model-v1',
            'rules_version': 'fixture-rules-v1',
            'events': [{'sequence': 0, 'event_type': 'period_start'}],
        },
        'record': {
            'seed': 1,
            'valid_full_game': True,
            'unsupported_rules': [],
            'ledger': {
                'winner': winner, 'loser': loser, 'winner_choice': choice,
                'winner_deferred': choice == 'defer', 'first_half_chooser': first,
                'second_half_chooser': second, 'policy_mode': 'normal_nfl_game',
            },
            'kickoffs': [
                {'kind': 'half_start', 'quarter': 1, 'kicking_team': loser if first == winner else winner, 'receiving_team': first},
                {'kind': 'half_start', 'quarter': 3, 'kicking_team': first, 'receiving_team': second},
            ],
            'drives': [{
                'index': 1, 'offense_team': first, 'quarter_start': 1, 'end_quarter': 1,
                'terminal': 'turnover_on_downs', 'plays': [{
                    'id': 'fixture:1', 'sequence': 1, 'event_type': 'run',
                    'state_before': {'drive_index': 1, 'quarter': 1, 'offense_team': first, 'defense_team': second, 'yardline_100': 75},
                    'state_after': {'drive_index': 1, 'quarter': 1, 'offense_team': first, 'defense_team': second, 'yardline_100': 74},
                    'outcome': {'yards_gained': 1, 'clock_runoff_seconds': 5},
                }],
                'points_scored_on_drive': None,
            }],
        },
    }


def check_negative_fixtures() -> int:
    failures = []
    passed = []

    def expect(name, fn, payload, expected_text):
        try:
            fn(payload)
        except AuditFailure as error:
            if expected_text not in str(error):
                failures.append(f'{name}: wrong rejection: {error}')
            else:
                passed.append(name)
                print(f'  PASS negative fixture: {name}')
        else:
            failures.append(f'{name}: invalid fixture was accepted')

    def record_fn(check):
        return lambda payload: check(payload['record'])

    bad = copy.deepcopy(base_fixture())
    bad['record']['drives'][0]['plays'][0]['state_after']['drive_index'] = 2
    expect('before/after drive_index mismatch', record_fn(audit_drive_indices), bad, 'drive-index mismatch')

    bad = copy.deepcopy(base_fixture())
    bad['record']['drives'][0]['plays'][0]['state_before']['drive_index'] = 2
    bad['record']['drives'][0]['plays'][0]['state_after']['drive_index'] = 2
    expect('state drive_index differs from game-level index', record_fn(audit_drive_indices), bad, 'drive-index mismatch')

    for kind, field, expected in (
        ('extra_point', 'extra_point_result', 'extra_point_result'),
        ('two_point', 'two_point_conv_result', 'two_point_conv_result'),
    ):
        bad = copy.deepcopy(base_fixture())
        bad['record']['drives'][0]['terminal'] = 'touchdown'
        bad['record']['drives'][0]['points_scored_on_drive'] = {'points': 7, 'try': {'kind': kind, 'made': True, 'success': 1.0}}
        expect(f'{kind} EPA success without publisher result', record_fn(audit_conversion_sources), bad, f'missing/invalid producer {field}')

    bad = copy.deepcopy(base_fixture())
    missed = copy.deepcopy(base_fixture()['record']['drives'][0])
    missed.update(index=1, terminal='field_goal_attempt', field_goal_made=False, snap_yardline_100=19, kick_spot_yardline_100=26)
    missed['plays'][-1]['state_before']['yardline_100'] = 19
    missed['plays'][-1]['state_before']['defense_team'] = 'B'
    next_drive = copy.deepcopy(base_fixture()['record']['drives'][0])
    next_drive.update(index=2, offense_team='B')
    next_drive['plays'][0]['state_before'].update(drive_index=2, offense_team='B', defense_team='A', yardline_100=80)
    next_drive['plays'][0]['state_after'].update(drive_index=2, offense_team='B', defense_team='A', yardline_100=80)
    bad['record']['drives'] = [missed, next_drive]
    expect('snap-at-19 cannot trigger 20 when kick spot is 26', record_fn(audit_missed_field_goals), bad, 'expected 74 from kick spot 26')

    bad = copy.deepcopy(base_fixture())
    missed = copy.deepcopy(base_fixture()['record']['drives'][0])
    missed.update(terminal='field_goal_attempt', field_goal_made=False)
    missed['plays'][-1]['state_before']['yardline_100'] = 15
    bad['record']['drives'][0] = missed
    expect('missed field goal cannot fall back to snap spot', record_fn(audit_missed_field_goals), bad, 'separate kick_spot_yardline_100 is required')

    good = copy.deepcopy(base_fixture())
    missed = copy.deepcopy(base_fixture()['record']['drives'][0])
    missed.update(terminal='field_goal_attempt', field_goal_made=False, snap_yardline_100=3, kick_spot_yardline_100=10)
    missed['plays'][-1]['state_before']['yardline_100'] = 3
    missed['plays'][-1]['state_before']['defense_team'] = 'B'
    next_drive = copy.deepcopy(base_fixture()['record']['drives'][0])
    next_drive.update(index=2, offense_team='B')
    next_drive['plays'][0]['state_before'].update(drive_index=2, offense_team='B', defense_team='A', yardline_100=80)
    next_drive['plays'][0]['state_after'].update(drive_index=2, offense_team='B', defense_team='A', yardline_100=80)
    good['record']['drives'] = [missed, next_drive]
    audit_missed_field_goals(good['record'])
    print('  PASS positive fixture: receiving-team 20 exception uses kick spot')

    bad = copy.deepcopy(base_fixture())
    bad['record']['ledger']['winner'] = 'B' if bad['record']['ledger']['winner'] == 'A' else 'A'
    expect('toss ledger must match sampled seed', lambda p: audit_toss(p, p['record']), bad, 'toss winner disagrees')

    try:
        check_toss_support([('A', 'receive')] * 300)
        failures.append('fixed toss sampler: accepted a one-way sample')
    except AuditFailure as error:
        if 'did not cover both winners and both choices' not in str(error):
            failures.append(f'fixed toss sampler: wrong rejection: {error}')
        else:
            passed.append('toss fixed to team A/receive')
            print('  PASS negative fixture: toss fixed to team A/receive')

    transition_fixtures = (
        ('unmodelled clock clamp', {'outcome': {'clock_clamped_to_zero': True}}, 'unmodelled clock transition'),
        ('timeout transition', {'event_type': 'timeout'}, 'timeout transition'),
        ('two-minute-warning transition', {'event_type': 'two_minute_warning'}, 'two-minute-warning transition'),
        ('penalty transition', {'event_type': 'penalty'}, 'penalty transition'),
    )
    for name, changes, expected_text in transition_fixtures:
        bad = copy.deepcopy(base_fixture())
        bad['record']['drives'][0]['plays'][0].update(changes)
        expect(name, lambda p: audit_complete_claim_transitions(p, p['record']), bad, expected_text)

    bad = copy.deepcopy(base_fixture())
    bad['record']['drives'][0]['plays'][0]['state_before']['quarter'] = 5
    bad['record']['drives'][0]['plays'][0]['state_after']['quarter'] = 5
    bad['record']['drives'][0]['quarter_start'] = bad['record']['drives'][0]['end_quarter'] = 5
    bad.pop('pool_scope')
    expect('overtime rows without regulation-only label', lambda p: audit_overtime_scope(p, p['record']), bad,
           'pool_scope.regulation_only=true')

    bad = copy.deepcopy(base_fixture())
    bad['record']['drives'][0]['plays'][0]['state_before']['quarter'] = 5
    bad['record']['drives'][0]['plays'][0]['state_after']['quarter'] = 5
    bad['record']['drives'][0]['quarter_start'] = bad['record']['drives'][0]['end_quarter'] = 5
    expect('regulation-only pool cannot claim complete overtime', lambda p: audit_overtime_scope(p, p['record']), bad,
           'cannot be declared a legal complete overtime game')

    if failures:
        raise AuditFailure('; '.join(failures))
    return len(passed)


def main(argv) -> int:
    if len(argv) != 2 or argv[1] in ('-h', '--help'):
        print('Usage: python3 scripts/audit_e2_seed1_legality.py /path/to/seed-1-game.json')
        return 0 if len(argv) == 2 else 2

    print('Negative fixture suite:')
    try:
        fixture_count = check_negative_fixtures()
    except AuditFailure as error:
        print(f'FAIL negative fixtures: {error}')
        return 1
    print(f'PASS negative fixtures: {fixture_count}/{fixture_count} rejected')

    path = Path(argv[1]).expanduser()
    try:
        payload = json.loads(path.read_text())
        need(isinstance(payload, dict), 'payload root must be a JSON object')
    except (OSError, json.JSONDecodeError, AuditFailure) as error:
        print(f'FAIL payload load: {error}')
        return 1

    record, results, findings = audit_payload(payload)
    print(f'Payload: {path} (seed={payload.get("seed", record.get("seed"))})')
    for name, status, detail in results:
        print(f'{status} {name}: {detail}')
    if not claims_valid_game(payload, record):
        unsupported = payload.get('unsupported_rules', record.get('unsupported_rules', []))
        print(f'SCOPE: valid_full_game=false; unsupported rules={unsupported}')
    if findings:
        print(f'RESULT: FAIL ({len(findings)} guard(s) rejected the payload)')
        return 1
    print('RESULT: PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
