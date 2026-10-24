import unittest
import csv
import hashlib
import tempfile
from pathlib import Path

from scripts.research.e3_tracking_presnap_clock_holdout import (
    EVAL_WEEKS,
    normalize_team,
    scan_tracking_week,
    stop_bucket_flags,
    summarize_pre_snap_frames,
    validate_eval_weeks,
    _model_summaries,
)


def sample_frames():
    frames = {}
    for frame in (97, 98, 99):
        players = {}
        for player in range(22):
            club = "LA" if player < 11 else "WAS"
            players[str(player)] = {
                "nfl_id": str(player),
                "club": "LAR" if club == "LA" else "WSH",
                "x": 10.0 + player + (frame - 97) * 0.1,
                "y": 10.0 + player,
            }
        frames[frame] = players
    return frames


class TrackingPresnapClockHoldoutTests(unittest.TestCase):
    def test_frozen_evaluation_is_exactly_weeks_6_to_9(self):
        self.assertEqual(validate_eval_weeks(EVAL_WEEKS), (6, 7, 8, 9))
        with self.assertRaisesRegex(ValueError, "exactly weeks 6-9"):
            validate_eval_weeks((1, 2, 3, 4, 5))
        with self.assertRaisesRegex(ValueError, "exactly weeks 6-9"):
            validate_eval_weeks((6, 7, 8))

    def test_pre_snap_feature_reads_only_snap_minus_three_through_minus_one(self):
        frames = sample_frames()
        base, reason = summarize_pre_snap_frames(frames, 100, "LA", "WAS")
        self.assertIsNone(reason)
        self.assertAlmostEqual(base["offense_mean_speed_yards_per_second"], 1.0)
        self.assertAlmostEqual(base["defense_mean_speed_yards_per_second"], 1.0)
        self.assertAlmostEqual(base["offense_mean_acceleration_magnitude_yards_per_second_squared"], 0.0)

        # A deliberately extreme snap/future location cannot change a feature.
        frames[100] = {"1": {"nfl_id": "1", "club": "LAR", "x": 1e9, "y": -1e9}}
        frames[101] = {"1": {"nfl_id": "1", "club": "LAR", "x": -1e9, "y": 1e9}}
        after_future_mutation, reason = summarize_pre_snap_frames(frames, 100, "LA", "WAS")
        self.assertIsNone(reason)
        self.assertEqual(base, after_future_mutation)

    def test_requires_the_same_all_22_players_and_11_per_side(self):
        frames = sample_frames()
        frames[98].pop("0")
        feature, reason = summarize_pre_snap_frames(frames, 100, "LA", "WAS")
        self.assertIsNone(feature)
        self.assertEqual(reason, "pre_snap_player_history_not_same_22")

        frames = sample_frames()
        frames[99]["0"]["club"] = "WSH"
        feature, reason = summarize_pre_snap_frames(frames, 100, "LA", "WAS")
        self.assertIsNone(feature)
        self.assertEqual(reason, "pre_snap_team_counts_not_11v11")

    def test_team_aliases_and_observed_stoppage_buckets_are_explicit(self):
        self.assertEqual(normalize_team("LA"), "LAR")
        self.assertEqual(normalize_team("WAS"), "WSH")
        flags = stop_bucket_flags(
            {"play_type": "pass", "complete_pass": 0, "penalty": 1, "qtr": 4, "game_seconds_remaining": 60, "touchdown": 0},
            0.0,
        )
        self.assertEqual(set(flags), {
            "zero_displayed_clock_delta", "incomplete_pass_source_flag", "penalty_flag", "late_half_pre_snap_context"
        })

    def test_streaming_tracker_stops_using_coordinates_at_snap(self):
        header = ["gameId", "playId", "nflId", "frameId", "frameType", "club", "x", "y", "event"]
        rows = []
        for frame in (97, 98, 99):
            for player in range(22):
                rows.append(["1234567890", "1", str(player), str(frame), "BEFORE_SNAP",
                             "LA" if player < 11 else "WAS", str(10 + player + (frame - 97) * .1), str(10 + player), "MUST_NOT_BE_USED"])
        for frame, frame_type in ((100, "SNAP"), (101, "AFTER_SNAP")):
            for player in range(22):
                rows.append(["1234567890", "1", str(player), str(frame), frame_type,
                             "LA" if player < 11 else "WAS", "999999999", "-999999999", "future_event"])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracking_week_6.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.writer(stream)
                writer.writerow(header)
                writer.writerows(rows)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            selected = {("1234567890", 1): {
                "lp_key": ("2022_06_TEST_TEST", 1), "week": 6,
                "offense_team": "LAR", "defense_team": "WSH",
            }}
            features, summary = scan_tracking_week(path, 6, selected, digest)
        record = features[("2022_06_TEST_TEST", 1)]
        self.assertEqual(record["last_input_frame"], 99)
        self.assertEqual(record["input_frame_range"], [97, 99])
        self.assertAlmostEqual(record["tracking_features"]["offense_mean_speed_yards_per_second"], 1.0)
        self.assertEqual(summary["complete_features"], 1)

    def test_game_level_gap_uses_the_same_common_play_rows(self):
        rows = []
        for game_id, target, pred_a, pred_b, pred_c in (("g1", 5.0, 4.0, 8.0, 5.0), ("g1", 3.0, 4.0, 4.0, 5.0), ("g2", 2.0, 1.0, 5.0, 3.0)):
            rows.append({
                "pbp": {"game_id": game_id, "drive": 1},
                "target_s": target,
                "predictions": {
                    "A_sampled_runoff": {"point_s": pred_a},
                    "B_pbp_presnap": {"point_s": pred_b},
                    "C_tracking_presnap": {"point_s": pred_c},
                },
            })
        per_play, per_game, _ = _model_summaries(rows)
        self.assertEqual(per_play["A_sampled_runoff"]["plays"], 3)
        self.assertAlmostEqual(per_game["A_sampled_runoff"]["mean_signed_cumulative_gap_s_per_game"], -0.5)
        self.assertAlmostEqual(per_game["B_pbp_presnap"]["mae_cumulative_gap_s_per_game"], 3.5)


if __name__ == "__main__":
    unittest.main()
