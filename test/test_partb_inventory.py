"""Reproducibility tests for the Part B inventory and extraction code. Synthetic fixtures only; no tracking data is read.

They check the permitted-data guards, the per-play summary on a synthetic play, the 2023 train parser on a synthetic
file pair, and the LP-eligibility join used by the extraction. None of them touches a 2026 file or a reserved 2022 week.
"""
import csv
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pipeline', 'partb'))
import extract_2022_windows as ext  # noqa: E402
import inventory_tracking as inv  # noqa: E402
import movement_experiment_1 as exp1  # noqa: E402


class PermittedDataGuards(unittest.TestCase):
    def test_extraction_refuses_reserved_2022_weeks(self):
        for week in (6, 7, 8, 9):
            with self.assertRaises(AssertionError):
                ext.extract(week)

    def test_inventory_refuses_reserved_2022_weeks(self):
        with self.assertRaises(AssertionError):
            inv.stream_week_22(6)

    def test_experiment_guard_refuses_2026_and_reserved_weeks(self):
        self.assertEqual(exp1.guard(os.path.join(exp1.BDB23, 'input_2023_w01.csv')),
                         os.path.join(exp1.BDB23, 'input_2023_w01.csv'))
        with self.assertRaises(RuntimeError):
            exp1.guard(os.path.join(exp1.BDB22, 'tracking_week_6.csv'))
        with self.assertRaises(RuntimeError):
            exp1.guard('/root/data/pbp_2026_week7.csv.gz')


class PerPlaySummary(unittest.TestCase):
    def synthetic_play(self, n_players=22):
        players = {str(100 + i): {'club': 'A' if i < 11 else 'B', 'frames': 5} for i in range(n_players)}
        return {'frames': set(range(1, 6)), 'frame_types': {}, 'players': players, 'ball_rows': 5,
                'events': {'ball_snap': 1, 'line_set': 1}, 'snap_frame': 3, 'line_set_frame': 2,
                'motion_frame': None, 'before_frames': {1, 2}, 'snap_players': set(players),
                'min_frame': 1, 'max_frame': 5}

    def test_snap_and_line_set_markers_and_snap_coverage(self):
        res = {'rows': 110, 'plays': {('G1', '7'): self.synthetic_play()}}
        out = inv.summarise_week_22(1, res)
        self.assertEqual(out['week'], 1)
        play = out['plays'][0]
        self.assertTrue(play['has_snap_marker'])
        self.assertTrue(play['has_line_set'])
        self.assertFalse(play['has_motion_marker'])
        self.assertEqual(play['players_at_snap_frame'], 22)
        self.assertEqual(play['players_tracked'], 22)
        self.assertEqual(play['ball_rows'], 5)

    def test_short_play_is_flagged_by_player_count(self):
        res = {'rows': 50, 'plays': {('G1', '8'): self.synthetic_play(n_players=12)}}
        play = inv.summarise_week_22(1, res)['plays'][0]
        self.assertLess(play['players_at_snap_frame'], 22)


class Train2023Parser(unittest.TestCase):
    INPUT_HEADER = ['game_id', 'play_id', 'player_to_predict', 'nfl_id', 'frame_id', 'play_direction',
                    'absolute_yardline_number', 'player_name', 'player_height', 'player_weight', 'player_birth_date',
                    'player_position', 'player_side', 'player_role', 'x', 'y', 's', 'a', 'dir', 'o',
                    'num_frames_output', 'ball_land_x', 'ball_land_y']
    OUTPUT_HEADER = ['game_id', 'play_id', 'nfl_id', 'frame_id', 'x', 'y']

    def test_train_parser_on_a_synthetic_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            inp = os.path.join(tmp, 'input_2023_w01.csv')
            outp = os.path.join(tmp, 'output_2023_w01.csv')
            rows = []
            # play 1: target 7 with three pre-pass frames and three output frames
            for f in (1, 2, 3):
                rows.append(['G1', '1', 'True', '7', str(f), 'right', '40', 'T', '6-1', '200', '2000-01-01', 'WR',
                             'Offense', 'Targeted Receiver', '10', '20', '5', '1', '0', '0', '3', '30', '20'])
                rows.append(['G1', '1', 'False', '8', str(f), 'right', '40', 'D', '6-1', '200', '2000-01-01', 'CB',
                             'Defense', 'Defensive Coverage', '12', '22', '4', '1', '0', '0', '3', '30', '20'])
            # play 2: no target flagged
            for f in (1, 2):
                rows.append(['G1', '2', 'False', '9', str(f), 'left', '40', 'Q', '6-1', '200', '2000-01-01', 'QB',
                             'Offense', 'Passer', '5', '5', '0', '0', '0', '0', '2', '', ''])
            with open(inp, 'w', newline='') as f:
                w = csv.writer(f)
                w.writerow(self.INPUT_HEADER)
                w.writerows(rows)
            with open(outp, 'w', newline='') as f:
                w = csv.writer(f)
                w.writerow(self.OUTPUT_HEADER)
                for fr in (4, 5, 6):
                    w.writerow(['G1', '1', '7', str(fr), '11', '21'])
            old = inv.BDB23
            inv.BDB23 = tmp
            try:
                out = inv.inventory_23(weeks=(1,))
            finally:
                inv.BDB23 = old
        week = out[1]
        self.assertEqual(week['input_plays'], 2)
        self.assertEqual(week['has_target'], 1)
        self.assertEqual(week['has_output'], 1)
        self.assertEqual(week['output_plays'], 1)
        self.assertEqual(week['output_target_matches_input'], 1)
        self.assertEqual(week['output_frames_match_num_frames_output'], 1)
        self.assertIn('Targeted Receiver', week['roles_seen'])


class EligibilityJoin(unittest.TestCase):
    def test_only_lp_eligible_plays_with_a_snap_frame_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            cohort_dir = os.path.join(tmp, 'cohort')
            os.makedirs(cohort_dir)
            with open(os.path.join(cohort_dir, 'cohort_week_1.csv'), 'w', newline='') as f:
                w = csv.writer(f)
                w.writerow(['week', 'gameId', 'playId', 'origin_frame', 'eligible_input'])
                w.writerow(['1', 'G1', '10', '5', 'True'])
                w.writerow(['1', 'G1', '11', '5', 'False'])
                w.writerow(['1', 'G1', '12', '5', 'True'])
            inv_path = os.path.join(tmp, 'per_play.csv')
            with open(inv_path, 'w', newline='') as f:
                w = csv.writer(f)
                w.writerow(['week', 'gameId', 'playId', 'snap_frame'])
                w.writerow(['1', 'G1', '10', '5'])
                w.writerow(['1', 'G1', '11', '5'])
                w.writerow(['1', 'G1', '12', ''])
            old = (ext.COHORT, ext.INVENTORY)
            ext.COHORT, ext.INVENTORY = cohort_dir, inv_path
            try:
                origins = ext.eligible_origins(1)
            finally:
                ext.COHORT, ext.INVENTORY = old
        self.assertEqual(origins, {('G1', '10'): 5})


if __name__ == '__main__':
    unittest.main()
