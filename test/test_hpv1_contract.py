import math
import os
import sys
import unittest

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
import hpv1_contract as hc  # noqa: E402
import hpv1_build  # noqa: E402

NAN = float('nan')


class PersonnelByVocabulary(unittest.TestCase):
    def test_2023_full_position_string_gives_package_11(self):
        p = hc.parse_personnel('1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR', 2023)
        self.assertEqual((p['status'], p['reason'], p['package']), ('parsed', 'ok', '11'))
        self.assertEqual((p['rb'], p['te'], p['wr']), (1, 1, 3))
        self.assertEqual(p['players_listed'], 11)
        self.assertTrue(p['complete_11'])
        self.assertEqual(p['vocabulary'], 'full')

    def test_2022_skill_only_string_gives_package_11_and_is_not_a_full_listing(self):
        p = hc.parse_personnel('1 RB, 1 TE, 3 WR', 2022)
        self.assertEqual((p['package'], p['vocabulary']), ('11', 'skill_only'))
        self.assertEqual(p['players_listed'], 5)
        self.assertFalse(p['complete_11'])

    def test_2022_ol_group_string_lists_no_quarterback(self):
        p = hc.parse_personnel('6 OL, 2 RB, 0 TE, 2 WR', 2022)
        self.assertEqual((p['vocabulary'], p['package']), ('ol_group', '20'))
        self.assertEqual(p['players_listed'], 10)
        self.assertFalse(p['complete_11'])

    def test_2022_fullback_is_not_observable_and_rb_may_include_it(self):
        p = hc.parse_personnel('1 RB, 1 TE, 3 WR', 2022)
        self.assertIsNone(p['fb'])
        self.assertTrue(p['fb_inseparable'])

    def test_2023_fullback_is_separate_from_running_back(self):
        p = hc.parse_personnel('1 C, 2 G, 1 QB, 1 FB, 1 RB, 2 T, 1 TE, 2 WR', 2023)
        self.assertEqual((p['rb'], p['fb'], p['package']), (1, 1, '11'))
        self.assertFalse(p['fb_inseparable'])

    def test_comparable_code_counts_a_fullback_with_the_running_backs(self):
        p = hc.parse_personnel('1 C, 2 G, 1 QB, 1 FB, 1 RB, 2 T, 1 TE, 2 WR', 2023)
        self.assertEqual((p['package'], p['package_comparable']), ('11', '21'))
        self.assertEqual(hc.parse_personnel('1 RB, 1 TE, 3 WR', 2022)['package_comparable'], '11')

    def test_2023_ol_group_token_is_unexpected_and_unknown(self):
        p = hc.parse_personnel('5 OL, 1 RB, 1 TE, 3 WR', 2023)
        self.assertEqual((p['reason'], p['package']), ('unexpected_vocabulary', 'UNKNOWN'))


class CrossSideAndSpecialTeams(unittest.TestCase):
    def test_defensive_label_on_offense_gives_unknown_package(self):
        p = hc.parse_personnel('1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 2 WR, 1 OLB', 2023)
        self.assertEqual((p['reason'], p['package']), ('cross_side_label', 'UNKNOWN'))
        self.assertEqual((p['rb'], p['te']), (1, 1))

    def test_kicking_token_gives_unknown_package(self):
        p = hc.parse_personnel('1 K, 10 OL', 2022)
        self.assertEqual((p['reason'], p['package']), ('special_teams_token', 'UNKNOWN'))


class NullAndUnparseable(unittest.TestCase):
    def test_null_and_empty_are_unknown_not_zero(self):
        for text in (None, NAN, ''):
            p = hc.parse_personnel(text, 2024)
            self.assertEqual((p['status'], p['package']), ('null', 'UNKNOWN'))
            self.assertIsNone(p['rb'])

    def test_unparseable_text_is_recorded_not_raised(self):
        p = hc.parse_personnel('one RB, 1 TE', 2023)
        self.assertEqual((p['status'], p['reason'], p['package']), ('unparseable', 'unparseable', 'UNKNOWN'))

    def test_seasons_outside_the_contract_are_refused(self):
        with self.assertRaises(ValueError):
            hc.parse_personnel('1 RB', 2026)


class PlayClass(unittest.TestCase):
    def test_two_point_is_its_own_class_even_when_labelled_run(self):
        self.assertEqual(hc.classify_play('run', 1, 'TWO-POINT CONVERSION ATTEMPT', 'ok'), 'two_point')

    def test_kick_formation_on_a_run_or_pass_is_a_fake_kick(self):
        self.assertEqual(hc.classify_play('run', 0, '(Punt formation) fake punt, run', 'ok'), 'fake_kick')

    def test_kicking_token_on_a_run_or_pass_is_a_fake_kick(self):
        self.assertEqual(hc.classify_play('pass', 0, 'Pass complete', 'special_teams_token'), 'fake_kick')

    def test_missing_play_type_is_a_non_play(self):
        self.assertEqual(hc.classify_play(None, 0, 'END QUARTER 1', 'null'), 'non_play')

    def test_defensive_label_on_an_ordinary_run_is_a_cross_side_class(self):
        self.assertEqual(hc.classify_play('run', 0, 'Smith left end for 4 yards', 'cross_side_label'),
                         'cross_side_label')

    def test_ordinary_run_or_pass_is_scrimmage(self):
        self.assertEqual(hc.classify_play('pass', 0, 'Pass complete', 'ok'), 'scrimmage')

    def test_other_play_types_keep_their_name(self):
        self.assertEqual(hc.classify_play('kickoff', 0, 'Kickoff', 'ok'), 'other:kickoff')


class Situation(unittest.TestCase):
    def test_distance_buckets_match_the_slc_boundaries(self):
        self.assertEqual(hc.distance_bucket(1), 'd1_2')
        self.assertEqual(hc.distance_bucket(4), 'd3_4')
        self.assertEqual(hc.distance_bucket(15), 'd15p')

    def test_missing_distance_is_unknown_and_out_of_range_fails(self):
        self.assertEqual(hc.distance_bucket(NAN), 'UNKNOWN')
        with self.assertRaises(ValueError):
            hc.distance_bucket(0)

    def test_red_zone_is_inside_the_twenty(self):
        self.assertEqual(hc.red_zone(20), 1)
        self.assertEqual(hc.red_zone(21), 0)
        self.assertEqual(hc.red_zone(NAN), 'UNKNOWN')

    def test_formation_labels_are_season_specific_for_2022_non_gun_sets(self):
        self.assertEqual(hc.formation_label('SHOTGUN', 2022), 'SHOTGUN')
        self.assertEqual(hc.formation_label('UNDER CENTER', 2023), 'UNDER CENTER')
        self.assertEqual(hc.formation_label('SINGLEBACK', 2022), '2022_SINGLEBACK')
        self.assertEqual(hc.formation_label(NAN, 2023), 'UNKNOWN')


class ObservedJointRecords(unittest.TestCase):
    def test_only_observed_joint_combinations_are_counted(self):
        rows = pd.DataFrame([
            dict(season=2023, play_family='run', formation='SHOTGUN', package='11', down=1, distance='d1_2', red_zone=0),
            dict(season=2023, play_family='pass', formation='UNDER CENTER', package='12', down=2, distance='d7_9', red_zone=1),
        ])
        joint = hc.joint_counts(rows)
        self.assertEqual(len(joint), 2)
        self.assertEqual(int(joint.sum()), 2)

    def test_marginal_values_do_not_create_unobserved_combinations(self):
        rows = pd.DataFrame([
            dict(season=2023, play_family='run', formation='SHOTGUN', package='11', down=1, distance='d1_2', red_zone=0),
            dict(season=2023, play_family='pass', formation='UNDER CENTER', package='12', down=2, distance='d7_9', red_zone=1),
        ])
        joint = hc.joint_counts(rows)
        self.assertNotIn((2023, 'run', 'UNDER CENTER', '11', 1, 'd1_2', 0), joint.index)
        self.assertNotIn((2023, 'run', 'SHOTGUN', '12', 1, 'd1_2', 0), joint.index)


class JoinRequirements(unittest.TestCase):
    def test_duplicate_keys_are_refused(self):
        part = pd.DataFrame({'nflverse_game_id': ['g1', 'g1'], 'play_id': [1, 1], 'offense_personnel': ['1 RB', '1 RB']})
        pbp = pd.DataFrame({'game_id': ['g1'], 'play_id': [1], 'play_type': ['run']})
        with self.assertRaises(ValueError):
            hc.join_participation(part, pbp)

    def test_unmatched_rows_are_counted_on_both_sides(self):
        part = pd.DataFrame({'nflverse_game_id': ['g1', 'g2'], 'play_id': [1, 1], 'offense_personnel': ['1 RB', '1 RB']})
        pbp = pd.DataFrame({'game_id': ['g1', 'g3'], 'play_id': [1, 2], 'play_type': ['run', 'pass']})
        merged, cov = hc.join_participation(part, pbp)
        self.assertEqual((cov['matched'], cov['participation_unmatched'], cov['pbp_unmatched']), (1, 1, 1))
        self.assertEqual(len(merged), 3)


class PathsAndEligibility(unittest.TestCase):
    def test_2026_inputs_are_refused_by_name(self):
        for name in ('pbp_2026.csv.gz', 'pbp_2026_week7.csv.gz', 'pbp_participation_2026.csv',
                     'roster_weekly_2026.csv.gz', 'ftn_charting_2026.csv'):
            with self.assertRaises(ValueError, msg=name):
                hc.check_input_paths([os.path.join('/x', name)])

    def test_2022_to_2025_inputs_are_allowed(self):
        hc.check_input_paths([os.path.join('/x', n) for n in ('pbp_2025.csv.gz', 'pbp_participation_2022.csv',
                                                                  'roster_weekly_2025.csv.gz', 'players.csv')])

    def test_build_reads_only_2022_to_2025(self):
        for path in hpv1_build.INPUT_PATHS:
            self.assertNotIn('2026', os.path.basename(path))

    def test_participation_identity_cannot_be_a_pregame_input(self):
        for col in ('offense_players', 'offense_names', 'offense_positions', 'offense_numbers'):
            with self.assertRaises(ValueError, msg=col):
                hc.assert_pregame_source([col], as_of='2025-09-04T16:00:00Z')

    def test_roster_source_needs_an_as_of_time(self):
        with self.assertRaises(ValueError):
            hc.assert_pregame_source(['gsis_id'], as_of=None)
        hc.assert_pregame_source(['gsis_id'], as_of='2025-09-04T16:00:00Z')


if __name__ == '__main__':
    unittest.main()
