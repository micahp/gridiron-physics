import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load_module("build_bdb2025_presnap_features", ROOT / "scripts/research/build_bdb2025_presnap_features.py")
model = load_module("e3_presnap_clock_models", ROOT / "scripts/research/e3_presnap_clock_models.py")


class PresnapClockModelTests(unittest.TestCase):
    def test_both_builders_reject_weeks_six_through_nine(self):
        for week in (6, 7, 8, 9):
            with self.assertRaisesRegex(ValueError, "weeks 1-5 only"):
                builder.validate_weeks((week,))
            with self.assertRaisesRegex(ValueError, "weeks 1-5 only"):
                model.validate_weeks((week,))

    def test_tracking_features_use_exactly_three_strictly_pre_snap_frames(self):
        frames = {}
        for frame in (7, 8, 9):
            players = {}
            for i in range(11):
                players[f"o{i}"] = {"nfl_id": f"o{i}", "club": "OFF", "x": 10.0 + i + frame * 0.1, "y": 20.0 + i}
                players[f"d{i}"] = {"nfl_id": f"d{i}", "club": "DEF", "x": 25.0 + i + frame * 0.1, "y": 10.0 + i}
            frames[frame] = players
        record, reason = builder.summarize_play((1, 2), {
            "week": 1, "snap_frame": 10, "offense_team": "OFF", "defense_team": "DEF"
        }, frames, {})
        self.assertIsNone(reason)
        self.assertEqual(record["input_frame_range"], [7, 9])
        self.assertEqual(record["last_input_frame"], 9)
        self.assertEqual(set(record["players_at_each_input_frame"].values()), {22})
        self.assertAlmostEqual(record["tracking_features"]["offense_mean_speed_yards_per_second"], 1.0)

    def test_pbp_model_features_ignore_play_outcome_and_type(self):
        pre_snap = {
            "qtr": 2, "game_seconds_remaining": 2400, "down": 2, "ydstogo": 7,
            "yardline_100": 42, "posteam": "A", "defteam": "B",
        }
        first = model.make_pbp_features({**pre_snap, "play_type": "run", "yards_gained": 8, "touchdown": 0})
        second = model.make_pbp_features({**pre_snap, "play_type": "pass", "yards_gained": 80, "touchdown": 1})
        self.assertEqual(first, second)
        self.assertEqual(set(first), {"qtr", "clock_bin", "down", "distance", "field", "posteam", "defteam"})

    def test_machine_artifact_has_common_pre_snap_rows_and_reserves_holdout(self):
        path = ROOT / "docs/evidence/e3/presnap-clock-model-comparison-weeks1-5-2026-10-24.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(result["scope"]["weeks"], [1, 2, 3, 4, 5])
        self.assertIn("NOT HOLDOUT-VALIDATED", result["scope"]["holdout_status"])
        self.assertEqual(result["common_rows_metrics"]["B_pbp_presnap_mae"]["n"], result["common_rows_metrics"]["C_tracking_presnap_mae"]["n"])
        self.assertEqual(result["scope"]["common_scored_rows"], len(result["per_play"]))
        self.assertTrue(all(row["tracking_input_cutoff"] < row["snap_frame"] for row in result["per_play"]))
        self.assertGreater(result["common_rows_metrics"]["C_tracking_presnap_mae"]["mae_s"],
                           result["common_rows_metrics"]["B_pbp_presnap_mae"]["mae_s"])

    def test_feature_artifact_has_only_pre_snap_aggregate_records(self):
        path = ROOT / "docs/research/gridiron-e3-presnap-tracking-features-weeks1-5-2026-10-24.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(document["coverage"]["pre_snap_complete_all22_plays"], len(document["plays"]))
        self.assertEqual(document["scope"]["weeks"], [1, 2, 3, 4, 5])
        for row in document["plays"]:
            self.assertLess(row["last_input_frame"], row["snap_frame"])
            self.assertNotIn("carrier_candidates", row)
            self.assertNotIn("terminal_event", row)
            self.assertNotIn("outcome_family_tracking_only", row)


if __name__ == "__main__":
    unittest.main()
