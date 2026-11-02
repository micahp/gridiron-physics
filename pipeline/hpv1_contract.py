"""HPV1 data contract: personnel package codes, play classes and observed joint records for 2022 to 2025.

Research only. Reads no 2026 input. Unknown values stay UNKNOWN and are counted, never guessed. The contract and its
measurements are in docs/research/HPV1-DATA-CONTRACT-2026-11-02.md.
"""
import math
import re

import pandas as pd

SEASONS = (2022, 2023, 2024, 2025)
FULL_VOCABULARY_FROM = 2023
UNKNOWN = 'UNKNOWN'
RUN_PASS = ('run', 'pass')
DISTANCE_BUCKETS = ((1, 2, 'd1_2'), (3, 4, 'd3_4'), (5, 6, 'd5_6'), (7, 9, 'd7_9'), (10, 14, 'd10_14'), (15, 99, 'd15p'))
DEF_POSITIONS = frozenset({'DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB'})
ST_POSITIONS = frozenset({'K', 'P', 'LS'})
KICK_DESCRIPTION = re.compile(r'Kick formation|Punt formation|Field Goal|Extra Point', re.IGNORECASE)
PARTICIPATION_IDENTITY = ('offense_players', 'offense_names', 'offense_positions', 'offense_numbers')
GUN_FORMATIONS = ('SHOTGUN', 'PISTOL')
YEAR_IN_NAME = re.compile(r'(?<!\d)(20\d\d)(?!\d)')


def _is_null(value):
    return value is None or (isinstance(value, float) and math.isnan(value))


def _check_season(season):
    if season not in (2022, 2023, 2024, 2025):
        raise ValueError(f'season {season} is outside the HPV1 contract (2022 to 2025)')


def parse_personnel(text, season):
    """Parse one offense_personnel string into counts and a package code.

    The package code is the RB and TE counts, as in formation_layer.personnel_code, for example '11'. It is UNKNOWN for
    a null, unparseable, cross-side or special-teams string. Vocabulary is season specific: 2022 lists skill positions,
    sometimes with an OL group count and no QB; 2023 onward lists every position on the field.
    """
    _check_season(season)
    base = {'season': season, 'status': None, 'reason': None, 'package': UNKNOWN, 'package_comparable': UNKNOWN,
            'vocabulary': None,
            'rb': None, 'te': None, 'wr': None, 'fb': None, 'qb': None, 'players_listed': None,
            'complete_11': False, 'fb_inseparable': season < FULL_VOCABULARY_FROM}
    if _is_null(text) or not str(text).strip():
        return {**base, 'status': 'null', 'reason': 'null'}
    counts = {}
    for part in str(text).split(','):
        number, _, position = part.strip().partition(' ')
        if not number.isdigit() or not position:
            return {**base, 'status': 'unparseable', 'reason': 'unparseable'}
        counts[position] = counts.get(position, 0) + int(number)
    total = sum(counts.values())
    if any(position in ST_POSITIONS for position in counts):
        reason = 'special_teams_token'
    elif any(position in DEF_POSITIONS for position in counts):
        reason = 'cross_side_label'
    elif season >= FULL_VOCABULARY_FROM and 'OL' in counts:
        reason = 'unexpected_vocabulary'
    else:
        reason = 'ok'
    if season < FULL_VOCABULARY_FROM:
        vocabulary = 'ol_group' if 'OL' in counts else 'skill_only'
    else:
        vocabulary = 'full'
    parsed = {**base, 'status': 'parsed', 'reason': reason, 'vocabulary': vocabulary,
              'rb': counts.get('RB', 0), 'te': counts.get('TE', 0), 'wr': counts.get('WR', 0),
              'fb': counts.get('FB', 0) if season >= FULL_VOCABULARY_FROM else None,
              'qb': counts.get('QB', 0) if season >= FULL_VOCABULARY_FROM else None,
              'players_listed': total, 'complete_11': season >= FULL_VOCABULARY_FROM and total == 11}
    if reason == 'ok':
        parsed['package'] = f"{parsed['rb']}{parsed['te']}"
        parsed['package_comparable'] = f"{parsed['rb'] + (parsed['fb'] or 0)}{parsed['te']}"
    return parsed


def classify_play(play_type, two_point, description, personnel_reason):
    """One class per participation row. Two-point, fake-kick and cross-side rows are never ordinary scrimmage."""
    if _is_null(play_type):
        return 'non_play'
    if two_point == 1:
        return 'two_point'
    if play_type in RUN_PASS:
        if KICK_DESCRIPTION.search(description or '') or personnel_reason == 'special_teams_token':
            return 'fake_kick'
        if personnel_reason == 'cross_side_label':
            return 'cross_side_label'
        return 'scrimmage'
    return f'other:{play_type}'


def distance_bucket(ydstogo):
    if _is_null(ydstogo):
        return UNKNOWN
    yards = int(ydstogo)
    for low, high, label in DISTANCE_BUCKETS:
        if low <= yards <= high:
            return label
    raise ValueError(f'distance {ydstogo} is outside the buckets')


def red_zone(yardline_100):
    if _is_null(yardline_100):
        return UNKNOWN
    return int(float(yardline_100) <= 20)


def formation_label(formation, season):
    """The published offense_formation, kept season specific. 2022 non-gun sets are not mapped to 2023 labels."""
    if _is_null(formation) or not str(formation).strip():
        return UNKNOWN
    if season >= FULL_VOCABULARY_FROM:
        return formation
    if formation in GUN_FORMATIONS:
        return formation
    return f'2022_{formation}'


def joint_counts(rows):
    """Observed joint counts only. A combination absent from the rows is absent from the table."""
    keys = ['season', 'play_family', 'formation', 'package', 'down', 'distance', 'red_zone']
    return rows.groupby(keys, dropna=False).size()


def join_participation(part, pbp):
    """Outer join on (game id, play id). Duplicate keys on either side are refused."""
    for name, frame, key in (('participation', part, ['nflverse_game_id', 'play_id']),
                             ('pbp', pbp, ['game_id', 'play_id'])):
        dupes = int(frame.duplicated(key).sum())
        if dupes:
            raise ValueError(f'{name} has {dupes} duplicate (game, play) keys')
    merged = part.merge(pbp, left_on=['nflverse_game_id', 'play_id'], right_on=['game_id', 'play_id'],
                        how='outer', indicator=True)
    counts = merged['_merge'].value_counts()
    coverage = {
        'participation_rows': int(len(part)),
        'pbp_rows': int(len(pbp)),
        'matched': int(counts.get('both', 0)),
        'participation_unmatched': int(counts.get('left_only', 0)),
        'pbp_unmatched': int(counts.get('right_only', 0)),
    }
    return merged, coverage


def check_input_paths(paths):
    for path in paths:
        for year in YEAR_IN_NAME.findall(str(path).rsplit('/', 1)[-1]):
            if int(year) not in SEASONS:
                raise ValueError(f'input {path} names season {year}, outside 2022 to 2025')


def assert_pregame_source(columns, as_of):
    """A pregame eligibility input must not be participation identity (held-out evidence) and must have an as-of time."""
    held_out = [c for c in columns if c in PARTICIPATION_IDENTITY]
    if held_out:
        raise ValueError(f'participation identity {held_out} is held-out evidence, not a pregame input')
    if not as_of:
        raise ValueError('a pregame roster source needs a publication as-of time before kickoff')
