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


class SnapType(unittest.TestCase):
    def test_fake_punt_and_scrimmage(self):
        fake = {'desc': '(Punt formation) 37-T.Thomas left end to TB 36 for -2 yards (12-K.Hodge).'}
        plain = {'desc': '(5:00) 6-B.Mayfield pass short right to 88-C.Otton.'}
        self.assertEqual(b.value_for(fake, None, 'snap_type'), 'fake_punt')
        self.assertEqual(b.value_for(plain, None, 'snap_type'), 'scrimmage')

    def test_fails_loudly_on_a_real_punt(self):
        with self.assertRaises(ValueError):
            b.value_for({'desc': '(Punt formation) 6-J.Gillan punts 45 yards.'}, None, 'snap_type')


if __name__ == '__main__':
    unittest.main()
