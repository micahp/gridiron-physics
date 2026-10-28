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

    def test_missing_both_sources_stays_null(self):
        self.assertIsNone(b.value_for({'_ftn': None}, None, 'shotgun_ftn_first'))
        self.assertIsNone(b.value_for({}, {'offense_formation': 'EMPTY'}, 'shotgun_ftn_first'))

    def test_pbp_flag_is_unchanged(self):
        self.assertTrue(b.value_for({'shotgun': '1'}, None, 'shotgun'))
        self.assertFalse(b.value_for({'shotgun': '0'}, None, 'shotgun'))


if __name__ == '__main__':
    unittest.main()
