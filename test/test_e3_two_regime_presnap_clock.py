import importlib.util
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "e3_two_regime_presnap_clock", ROOT / "scripts/research/e3_two_regime_presnap_clock.py"
)
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class TwoRegimePresnapClockTests(unittest.TestCase):
    def test_holdout_protocol_digest_matches_committed_sidecar(self):
        path = ROOT / "docs/research/E3-PRESNAP-CLOCK-HOLDOUT-PROTOCOL-2026-10-24.json"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        expected = (ROOT / "docs/research/E3-PRESNAP-CLOCK-HOLDOUT-PROTOCOL-2026-10-24.json.sha256").read_text().split()[0]
        self.assertEqual(digest, expected)
        protocol = json.loads(path.read_text())
        self.assertEqual(protocol["data_scope"]["reserved_evaluation_weeks"], [6, 7, 8, 9])
        self.assertEqual(protocol["acceptance_thresholds"]["minimum_regime_n"], 200)

    def test_weeks_six_to_nine_are_rejected_without_data_access(self):
        for week in (6, 7, 8, 9):
            with self.assertRaisesRegex(ValueError, "weeks 1-5 only"):
                model.validate_weeks((week,))

    def test_regime_split_uses_only_quarter_and_clock(self):
        late = model.make_state_features({
            "quarter": 2, "quarter_seconds_remaining": 120, "score_diff": -7,
            "down": 3, "distance": 8, "play_type": "run", "outcome": "touchdown",
        })
        changed_outcome = model.make_state_features({
            "quarter": 2, "quarter_seconds_remaining": 120, "score_diff": -7,
            "down": 3, "distance": 8, "play_type": "pass", "outcome": "incomplete",
        })
        self.assertEqual(late["regime"], "stoppage_drill")
        self.assertEqual(late, changed_outcome)
        self.assertEqual(model.make_state_features({
            "quarter": 3, "quarter_seconds_remaining": 30, "score_diff": 0,
            "down": 1, "distance": 10,
        })["regime"], "regulation")

    def test_timeouts_stay_unresolvable_and_are_not_a_predictor(self):
        features = model.make_state_features({
            "quarter": 4, "quarter_seconds_remaining": 90, "score_diff": 3,
            "down": 2, "distance": 5, "timeouts_remaining": 3,
        })
        self.assertIsNone(features["timeouts_remaining"])
        self.assertEqual(set(features), {
            "regime", "quarter", "clock_band", "score_band", "down_band", "distance_band", "timeouts_remaining"
        })

    def test_quantile_uses_type_7_linear_interpolation(self):
        self.assertEqual(model.quantile([0, 10, 20, 30, 40], 0.5), 20)
        self.assertAlmostEqual(model.quantile([0, 10, 20, 30, 40], 0.9), 36)

    def test_regime_model_backoff_is_confined_to_same_regime(self):
        features = model.make_state_features({
            "quarter": 2, "quarter_seconds_remaining": 60, "score_diff": 0, "down": 1, "distance": 5,
        })
        stats = {
            ("regulation", "regime_global", ()): {"median_s": 999, "n": 100},
            ("stoppage_drill", "regime_global", ()): {"median_s": 8, "n": 100},
        }
        self.assertEqual(model.predict_regime(stats, features)["median_s"], 8)


if __name__ == "__main__":
    unittest.main()
