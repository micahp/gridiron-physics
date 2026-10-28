import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
import build_playbooks as b  # noqa: E402


class ShotgunFtnFirst(unittest.TestCase):
    def test_ftn_under_center_beats_participation_shotgun(self):
        row = {'_ftn': {'qb_location': 'U'}}
        self.assertFalse(b.value_for(row, {'offense_formation': 'SHOTGUN'}, 'shotgun_ftn_first'))

    def test_ftn_shotgun_and_pistol_count_as_shotgun(self):
        self.assertTrue(b.value_for({'_ftn': {'qb_location': 'S'}}, {'offense_formation': 'UNDER CENTER'},
                                    'shotgun_ftn_first'))
        self.assertTrue(b.value_for({'_ftn': {'qb_location': 'P'}}, None, 'shotgun_ftn_first'))

    def test_falls_back_to_participation_when_ftn_is_zero(self):
        row = {'_ftn': {'qb_location': '0'}}
        self.assertTrue(b.value_for(row, {'offense_formation': 'PISTOL'}, 'shotgun_ftn_first'))
        self.assertFalse(b.value_for(row, {'offense_formation': 'UNDER CENTER'}, 'shotgun_ftn_first'))

    def test_every_present_formation_is_decided(self):
        # The gate's rule: a present formation is shotgun or not, so no formation label comes back null.
        self.assertFalse(b.value_for({'season': '2022', '_ftn': None}, {'offense_formation': 'SINGLEBACK'},
                                     'shotgun_ftn_first'))
        self.assertFalse(b.value_for({'season': '2022', '_ftn': None}, {'offense_formation': 'I_FORM'},
                                     'shotgun_ftn_first'))
        self.assertTrue(b.value_for({'season': '2022', '_ftn': None}, {'offense_formation': 'EMPTY'},
                                    'shotgun_ftn_first'))
        self.assertTrue(b.value_for({'season': '2022', '_ftn': None}, {'offense_formation': 'WILDCAT'},
                                    'shotgun_ftn_first'))

    def test_missing_both_sources_stays_null(self):
        self.assertIsNone(b.value_for({'_ftn': None}, None, 'shotgun_ftn_first'))
        self.assertIsNone(b.value_for({'_ftn': None}, {'offense_formation': ''}, 'shotgun_ftn_first'))

    def test_pbp_flag_fills_only_in_a_charted_game(self):
        row = {'_ftn': {'qb_location': '0'}, 'shotgun': '1', 'season': '2024', '_ftn_game_charted': True}
        self.assertEqual(b.shotgun_with_source(row, None), (True, 'pbp_flag'))
        uncharted = dict(row, _ftn_game_charted=False)
        self.assertEqual(b.shotgun_with_source(uncharted, None), (None, None))

    def test_source_is_recorded_for_each_tier(self):
        self.assertEqual(b.shotgun_with_source({'_ftn': {'qb_location': 'S'}}, None), (True, 'ftn'))
        self.assertEqual(b.shotgun_with_source({'_ftn': {'qb_location': '0'}, 'season': '2024'},
                                               {'offense_formation': 'UNDER CENTER'}), (False, 'participation'))
        self.assertEqual(b.value_for({'_ftn': {'qb_location': 'U'}}, None, 'shotgun_source'), 'ftn')

    def test_pbp_flag_is_unchanged(self):
        self.assertTrue(b.value_for({'shotgun': '1'}, None, 'shotgun'))
        self.assertFalse(b.value_for({'shotgun': '0'}, None, 'shotgun'))


class EventClass(unittest.TestCase):
    def play(self, desc, **fields):
        row = {'desc': desc, 'down': '1', 'play_type': 'run', 'two_point_attempt': '0', 'aborted_play': '0'}
        row.update(fields)
        return row

    def test_ordinary_run_or_pass(self):
        self.assertEqual(b.event_class(self.play('(5:00) 6-B.Mayfield pass short right to 88-C.Otton.')),
                         ('scrimmage', None, None))

    def test_field_goal_formation_is_not_called_a_fake(self):
        # A run or pass from field-goal formation is recorded as such. Intent is unknown without source text.
        self.assertEqual(b.event_class(self.play('(Field Goal formation) 13-C.Bojorquez pass incomplete short right.',
                                                 down='4')),
                         ('special_teams_run_pass', 'field_goal', 'unknown'))

    def test_aborted_field_goal_is_a_broken_kick(self):
        self.assertEqual(b.event_class(self.play('(Field Goal formation) 16-J.Bailey Aborted. 48-B.Ferguson FUMBLES.',
                                                 down='4', aborted_play='1')),
                         ('special_teams_run_pass', 'field_goal', 'broken_kick'))

    def test_source_text_stating_a_fake_is_a_designed_fake(self):
        self.assertEqual(b.event_class(self.play('(Punt formation) fake punt, 37-T.Thomas left end for 6 yards.',
                                                 down='4')),
                         ('special_teams_run_pass', 'punt', 'designed_fake'))

    def test_punt_formation_run_or_pass_is_unknown_intent(self):
        self.assertEqual(b.event_class(self.play('(Punt formation) 37-T.Thomas left end to TB 36 for -2 yards.',
                                                 down='4')),
                         ('special_teams_run_pass', 'punt', 'unknown'))

    def test_two_point_attempt_is_its_own_class_even_with_kick_formation(self):
        self.assertEqual(b.event_class(self.play('(Kick formation) TWO-POINT CONVERSION ATTEMPT. 5-B.Anger pass complete.',
                                                 down='', two_point_attempt='1')),
                         ('two_point_conversion', None, None))

    def test_aborted_snap_is_a_snap_fumble(self):
        self.assertEqual(b.event_class(self.play('(:51) 1-T.Tagovailoa FUMBLES (Aborted) at MIA 28.', aborted_play='1')),
                         ('aborted_snap', None, None))

    def test_aborted_play_is_a_play_the_player_called_off(self):
        self.assertEqual(b.event_class(self.play('(:39) (no huddle, shotgun) 6-b.mayfield aborted. 60-p.elflein fumbles.',
                                                 aborted_play='1')),
                         ('aborted_play', None, None))

    def test_value_for_routes_the_new_fields(self):
        row = self.play('(Field Goal formation) 13-C.Bojorquez pass.', down='4')
        self.assertEqual(b.value_for(row, None, 'snap_type'), 'special_teams_run_pass')
        self.assertEqual(b.value_for(row, None, 'formation_origin'), 'field_goal')
        self.assertEqual(b.value_for(row, None, 'execution_type'), 'unknown')

    def test_a_real_punt_described_as_one_fails_loudly(self):
        with self.assertRaises(ValueError):
            b.event_class(self.play('(Punt formation) 6-J.Gillan punts 45 yards.', down='4'))


if __name__ == '__main__':
    unittest.main()
