import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
import audit_drive_benchmark_2025 as audit  # noqa: E402


def row(**kw):
    base = {'play_type': 'run', 'posteam': 'MIN', 'defteam': 'DET', 'interception': '0', 'fumble_lost': '0',
            'punt_blocked': '0', 'field_goal_result': '', 'desc': ''}
    base.update({k: str(v) for k, v in kw.items()})
    return base


class LastSpot(unittest.TestCase):
    def test_opponent_side_spot_is_the_yardline(self):
        self.assertEqual(audit.last_spot('9-J.McCarthy to DET 46 for no gain', 'MIN'), 46)

    def test_own_side_spot_is_one_hundred_minus_the_yardline(self):
        self.assertEqual(audit.last_spot('pass to 17-X to MIN 15 for 6 yards', 'MIN'), 85)

    def test_last_spot_wins_when_a_fumble_is_followed_by_a_run(self):
        desc = ('(10:11) 9-J.McCarthy FUMBLES (Aborted) at DET 45, and recovers at DET 46. '
                '9-J.McCarthy to DET 40 for 6 yards (91-T.Williams).')
        self.assertEqual(audit.last_spot(desc, 'MIN'), 40)

    def test_bare_number_is_midfield(self):
        self.assertEqual(audit.last_spot('FUMBLES (Aborted) at CAR 39, and recovers at 50.', 'NYJ'), 50)

    def test_clock_time_and_player_number_are_not_spots(self):
        self.assertIsNone(audit.last_spot('Timeout #2 by TB at 01:41.', 'TB'))
        self.assertIsNone(audit.last_spot('pass to 4-J.Tolbert for 3 yards', 'TB'))

    def test_recovered_by_team_spot(self):
        desc = ('(7:33) FUMBLES (41-D.Ezeiruaku), touched at DAL 41, recovered by CAR-17-X.Legette at DAL 45.')
        self.assertEqual(audit.last_spot(desc, 'CAR'), 45)


class EndRules(unittest.TestCase):
    def test_net_gain_decides_first_down_not_yards_gained(self):
        # Pass for 11 yards reaches the first-down marker, then a fumble moves the ball back to a net gain of 6.
        self.assertFalse(audit.first_down_after(85, 79, 10))
        self.assertTrue(audit.first_down_after(83, 67, 10))

    def test_possession_after_safety_goes_to_the_scoring_team(self):
        self.assertTrue(audit.possession_ok('safety_allowed', same_team=False, starts_with_kickoff=True))
        self.assertFalse(audit.possession_ok('safety_allowed', same_team=True, starts_with_kickoff=True))

    def test_possession_after_defensive_touchdown_comes_back_by_kickoff(self):
        self.assertTrue(audit.possession_ok('touchdown_allowed', same_team=True, starts_with_kickoff=True))

    def test_possession_after_punt_passes_to_the_other_team(self):
        self.assertTrue(audit.possession_ok('punt', same_team=False, starts_with_kickoff=False))

    def test_touchdown_cause_needs_the_matching_flag(self):
        self.assertTrue(audit.touchdown_cause_ok('interception_return', row(interception='1')))
        self.assertFalse(audit.touchdown_cause_ok('interception_return', row(interception='0')))
        self.assertTrue(audit.touchdown_cause_ok('blocked_punt_return',
                                                 row(play_type='punt', punt_blocked='1')))

    def test_clock_rise_is_overtime_only_from_zero_to_600(self):
        self.assertEqual(audit.clock_jump(0, 600, boundary_at_zero=True), 'overtime_period_start')
        self.assertEqual(audit.clock_jump(91, 101, boundary_at_zero=False), 'unexplained_rise')
        self.assertIsNone(audit.clock_jump(101, 91, boundary_at_zero=True))

    def test_kickoff_runoff_comes_off_the_clock_before_the_receiving_drive(self):
        self.assertEqual(audit.kickoff_restart_clock(1234, 5), 1229)
        self.assertEqual(audit.kickoff_restart_clock(900, 0), 900)
        self.assertIsNone(audit.kickoff_restart_clock(4, 6))

    def test_field_exception_explained_only_with_fumble_text_and_spot_match(self):
        a = row(desc='FUMBLES (Aborted) at DET 45, and recovers at DET 46.', yardline_100='44', yards_gained='0')
        c = row(yardline_100='46')
        status, mechanism = audit.classify_exception({'kind': 'field_position'}, a, c, 44, 46, 46)
        self.assertEqual((status, mechanism), ('explained', 'fumble_end_spot'))
        status, _ = audit.classify_exception({'kind': 'field_position'}, row(desc='pass to DET 40'), c, 44, 46, 40)
        self.assertEqual(status, 'unresolved')


if __name__ == '__main__':
    unittest.main()
