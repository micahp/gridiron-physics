import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
import canonical_drives_2025 as v1  # noqa: E402
import canonical_drives_2025_v2 as v2  # noqa: E402


def row(**kw):
    base = {'game_id': 'G1', 'play_id': '1', 'posteam': 'A', 'defteam': 'B', 'play_type': 'run', 'qtr': '1',
            'game_seconds_remaining': '2000', 'touchdown': '0', 'td_team': '', 'safety': '0', 'interception': '0',
            'fumble_lost': '0', 'field_goal_result': '', 'punt_blocked': '0', 'drive_end_transition': '',
            'fixed_drive_result': '', 'extra_point_result': '', 'two_point_conv_result': '',
            'defensive_two_point_conv': '0', 'two_point_attempt': '0', 'penalty': '0', 'desc': '',
            'yards_gained': '0', 'yardline_100': '50', 'ydstogo': '10', 'down': '1', 'posteam_score': '0',
            'defteam_score': '0', 'posteam_score_post': '', 'first_down': '0'}
    base.update({k: str(v) for k, v in kw.items()})
    return base


class EndClass(unittest.TestCase):
    def test_safety_belongs_to_the_team_that_gave_it_up(self):
        rows = [row(play_type='pass', posteam='SF', defteam='ARI', safety='1', yardline_100='98')]
        self.assertEqual(v2.classify_end(rows, 'SF'), ('safety_allowed', 'pass'))
        self.assertEqual(v2.drive_points(rows, 'SF'), (0, 2))
        self.assertEqual(v2.drive_points(rows, 'ARI'), (2, 0))

    def test_version_one_never_labels_the_safety_drive(self):
        # Pins the version 1 defect that version 2 corrects. Version 1 is immutable, so this stays true.
        rows = [row(play_type='pass', posteam='SF', defteam='ARI', safety='1', yardline_100='98')]
        self.assertNotEqual(v1.end_reason({'rows': rows, 'team': 'SF'}, 'SF'), 'safety_against')

    def test_touchdown_scored_by_the_drive_team(self):
        rows = [row(play_type='pass', touchdown='1', td_team='A', posteam_score='0')]
        self.assertEqual(v2.classify_end(rows, 'A'), ('touchdown_scored', 'pass'))

    def test_interception_returned_for_touchdown_is_allowed_and_keeps_its_cause(self):
        rows = [row(play_type='pass', interception='1', touchdown='1', td_team='B')]
        self.assertEqual(v2.classify_end(rows, 'A'), ('touchdown_allowed', 'interception_return'))
        self.assertEqual(v2.drive_points(rows, 'A'), (0, 6))

    def test_punt_returned_for_touchdown_is_allowed_by_the_punter(self):
        rows = [row(play_type='punt', touchdown='1', td_team='B')]
        self.assertEqual(v2.classify_end(rows, 'A'), ('touchdown_allowed', 'punt_return'))

    def test_onside_kick_recovered_by_the_kicking_team_is_lost(self):
        kick = row(play_type='kickoff', posteam='CHI', defteam='CIN', drive_end_transition='TOUCHDOWN',
                   desc='2-E.McPherson kicks onside 8 yards from CIN 35 to CIN 43. RECOVERED by CIN-42-O.Burks.')
        self.assertEqual(v2.classify_end([kick], 'CHI'), ('onside_kick_lost', ''))

    def test_blocked_punt_returned_for_touchdown_keeps_its_cause(self):
        rows = [row(play_type='punt', punt_blocked='1', touchdown='1', td_team='B')]
        self.assertEqual(v2.classify_end(rows, 'A'), ('touchdown_allowed', 'blocked_punt_return'))

    def test_kickoff_segment_is_ended_by_its_transition(self):
        self.assertEqual(v2.classify_end([row(play_type='kickoff', drive_end_transition='END_HALF')], 'A'),
                         ('end_of_half', 'kickoff_return'))
        self.assertEqual(v2.classify_end([row(play_type='kickoff', drive_end_transition='FUMBLE')], 'A'),
                         ('kickoff_fumble_lost', ''))
        self.assertEqual(v2.classify_end([row(play_type='kickoff', drive_end_transition='DOWNS')], 'A'),
                         ('onside_kick_lost', ''))

    def test_field_goal_made_and_missed(self):
        self.assertEqual(v2.classify_end([row(play_type='field_goal', field_goal_result='made')], 'A'),
                         ('field_goal_made', ''))
        self.assertEqual(v2.classify_end([row(play_type='field_goal', field_goal_result='missed')], 'A'),
                         ('field_goal_missed', 'missed'))

    def test_punt_and_blocked_punt(self):
        self.assertEqual(v2.classify_end([row(play_type='punt')], 'A'), ('punt', ''))
        self.assertEqual(v2.classify_end([row(play_type='punt', punt_blocked='1')], 'A'), ('blocked_punt', ''))

    def test_turnovers_and_turnover_on_downs(self):
        self.assertEqual(v2.classify_end([row(play_type='pass', interception='1')], 'A'),
                         ('interception', 'pass'))
        self.assertEqual(v2.classify_end([row(play_type='run', fumble_lost='1')], 'A'), ('fumble_lost', 'run'))
        self.assertEqual(v2.classify_end([row(play_type='run', drive_end_transition='DOWNS')], 'A'),
                         ('turnover_on_downs', ''))

    def test_end_of_half_and_game_come_from_the_transition_field(self):
        self.assertEqual(v2.classify_end([row(play_type='run', drive_end_transition='END_HALF')], 'A'),
                         ('end_of_half', ''))
        self.assertEqual(v2.classify_end([row(play_type='qb_kneel', drive_end_transition='END_GAME')], 'A'),
                         ('end_of_game', ''))

    def test_quarter_two_alone_does_not_end_a_drive(self):
        rows = [row(play_type='run', qtr='2', game_seconds_remaining='1500')]
        self.assertEqual(v2.classify_end(rows, 'A'), ('unclassified', ''))


class Timing(unittest.TestCase):
    def test_kickoff_to_end_and_possession_are_separate(self):
        rows = [row(play_type='kickoff', posteam='A', game_seconds_remaining='3000'),
                row(play_type='run', game_seconds_remaining='2990'),
                row(play_type='run', game_seconds_remaining='2950')]
        kick_to_end, possession = v2.timing(rows, 2940)
        self.assertEqual((kick_to_end, possession), (60, 50))

    def test_next_drive_first_row_is_the_end(self):
        segs = [{'rows': [row(play_type='run', game_seconds_remaining='2950')], 'team': 'A', 'half': 1},
                {'rows': [row(play_type='kickoff', posteam='B', game_seconds_remaining='2940')], 'team': 'B',
                 'half': 1}]
        self.assertEqual(v2.end_time(segs, 0), (2940, 'next_drive_first_row'))

    def test_half_end_row_is_the_end_of_the_first_half(self):
        segs = [{'rows': [row(play_type='run', game_seconds_remaining='1805'),
                          row(play_type='', desc='END QUARTER 2', qtr='2', game_seconds_remaining='1800')],
                 'team': 'A', 'half': 1}]
        self.assertEqual(v2.end_time(segs, 0), (1800, 'half_end_row'))

    def test_end_quarter_one_is_not_a_boundary(self):
        segs = [{'rows': [row(play_type='run', game_seconds_remaining='2710'),
                          row(play_type='', desc='END QUARTER 1', qtr='1', game_seconds_remaining='2700')],
                 'team': 'A', 'half': 1},
                {'rows': [row(play_type='run', posteam='A', game_seconds_remaining='2695')], 'team': 'A',
                 'half': 1}]
        self.assertEqual(v2.end_time(segs, 0), (2695, 'next_drive_first_row'))


class Continuity(unittest.TestCase):
    def pair(self, c_yardline='40', c_extra=None, between=None):
        a = row(play_id='1', play_type='run', down='1', ydstogo='10', yards_gained='5', yardline_100='50')
        c = row(play_id='3', play_type='run', down='2', ydstogo='5', yards_gained='0', yardline_100=c_yardline,
                **(c_extra or {}))
        rows = [a] + (between or []) + [c]
        return [{'rows': rows, 'team': 'A'}]

    def test_unexplained_field_position_is_traced(self):
        counts, exc = v2.continuity(self.pair(c_yardline='40'))
        self.assertEqual(counts['field_position_unexplained'], 1)
        self.assertEqual(exc[0]['kind'], 'field_position')
        self.assertEqual(exc[0]['evidence'], 'unknown')

    def test_penalty_flag_explains_it(self):
        counts, exc = v2.continuity(self.pair(c_yardline='40', c_extra={'penalty': '1'}))
        self.assertEqual(counts['field_position_explained'], 1)
        self.assertEqual(exc, [])

    def test_penalty_text_without_flag_is_named_as_evidence(self):
        between = [row(play_id='2', play_type='no_play', desc='PENALTY on A-7 for holding')]
        counts, exc = v2.continuity(self.pair(c_yardline='40', between=between))
        self.assertEqual(exc[0]['evidence'], 'penalty_text_not_flagged')
        self.assertEqual(exc[0]['between_play_ids'], '2')

    def test_own_fumble_recovery_is_named_as_evidence(self):
        a = row(play_id='1', play_type='run', down='1', ydstogo='10', yards_gained='1', yardline_100='50',
                desc='run left to A 49 for 1 yard. FUMBLES (3-X.Y), recovered by A-7-B.Robinson at A 45.')
        c = row(play_id='2', play_type='run', down='2', ydstogo='9', yards_gained='0', yardline_100='40')
        counts, exc = v2.continuity([{'rows': [a, c], 'team': 'A'}])
        self.assertEqual(counts['field_position_unexplained'], 1)
        self.assertEqual(exc[0]['evidence'], 'fumble_kept_by_offense')

    def test_fumble_recovered_by_the_player_is_named_as_evidence(self):
        a = row(play_id='1', play_type='run', down='1', ydstogo='10', yards_gained='0', yardline_100='50',
                desc='(7:46) 4-D.Prescott FUMBLES (Aborted) at A 42, and recovers at A 42.')
        c = row(play_id='2', play_type='run', down='2', ydstogo='10', yards_gained='0', yardline_100='41')
        counts, exc = v2.continuity([{'rows': [a, c], 'team': 'A'}])
        self.assertEqual(exc[0]['evidence'], 'fumble_kept_by_offense')

    def test_a_defensive_recovery_changes_possession_and_is_not_checked(self):
        a = row(play_id='1', play_type='run', down='1', ydstogo='10', yards_gained='1', yardline_100='50',
                desc='run left, FUMBLES, recovered by B-7-C.Dee at A 45.', fumble_lost='1')
        c = row(play_id='2', play_type='run', posteam='B', down='1', ydstogo='10', yards_gained='0', yardline_100='60')
        counts, exc = v2.continuity([{'rows': [a, c], 'team': 'A'}])
        self.assertEqual(exc, [])
        self.assertEqual(counts['field_position_unexplained'], 0)

    def test_down_progression_mismatch_is_traced(self):
        a = row(play_id='1', play_type='run', down='1', ydstogo='10', yards_gained='12', yardline_100='50')
        c = row(play_id='2', play_type='run', down='3', ydstogo='5', yards_gained='0', yardline_100='38')
        counts, exc = v2.continuity([{'rows': [a, c], 'team': 'A'}])
        self.assertEqual(counts['down_progression_unexplained'], 1)
        self.assertEqual(exc[0]['kind'], 'down_progression')


class Points(unittest.TestCase):
    def test_defensive_two_point_credits_the_defence(self):
        r = row(two_point_attempt='1', defensive_two_point_conv='1', two_point_conv_result='failure', defteam='B')
        self.assertEqual(v2.points_events(r), [('B', 2)])

    def test_drive_points_tie_out_to_official_scores(self):
        a_drive = {'game_id': 'G1', 'team': 'A', 'points_for': 7, 'points_against': 0}
        b_drive = {'game_id': 'G1', 'team': 'B', 'points_for': 0, 'points_against': 0}
        official = {'G1': {'home_team': 'A', 'away_team': 'B', 'home_score': 7, 'away_score': 0}}
        result = v2.tie_out({'G1': [a_drive, b_drive]}, official)
        self.assertEqual((result['match'], result['mismatch']), (2, 0))

    def test_safety_points_tie_out_to_the_scorer(self):
        sf_drive = {'game_id': 'G1', 'team': 'SF', 'points_for': 0, 'points_against': 2}
        ari_drive = {'game_id': 'G1', 'team': 'ARI', 'points_for': 0, 'points_against': 0}
        official = {'G1': {'home_team': 'SF', 'away_team': 'ARI', 'home_score': 0, 'away_score': 2}}
        result = v2.tie_out({'G1': [sf_drive, ari_drive]}, official)
        self.assertEqual((result['match'], result['mismatch']), (2, 0))


if __name__ == '__main__':
    unittest.main()
