import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "docs/evidence/e3/possession-duration-tail-decomposition-weeks1-5-2026-10-24.json"


class PossessionDurationTailAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = json.loads(ARTIFACT.read_text(encoding="utf-8"))

    def test_scope_is_development_only_and_does_not_include_reserved_weeks(self):
        scope = self.document["scope"]
        self.assertEqual(scope["training_weeks"], [1, 2, 3, 4])
        self.assertEqual(scope["target_week"], 5)
        self.assertIn("NOT HOLDOUT-VALIDATED", scope["holdout_status"])

    def test_tail_is_reported_at_drive_and_play_level(self):
        duration = self.document["duration_seconds"]["paired_start_expected_absolute_error"]["per_drive_p50_p90_p95_max_s"]
        self.assertEqual(duration["n"], 61)
        self.assertEqual(duration["median_s"], 77.5)
        self.assertEqual(duration["p95_s"], 271.0)
        play = self.document["clock_runoff_per_play_diagnostics"]
        self.assertEqual(play["observed_PBP_row_runoffs_s"]["n"], 477)
        self.assertEqual(play["E1_generated_scrimmage_runoffs_s"]["n"], 1160)
        self.assertGreater(play["observed_PBP_rows_with_non_scrimmage_type_inside_scored_interval"], 0)

    def test_generation_survivor_denominator_is_explicit(self):
        coverage = self.document["coverage"]
        self.assertEqual(coverage["E1_simulation_attempted_draws"], 330)
        self.assertEqual(coverage["E1_generated_drive_draws"], 198)
        self.assertEqual(coverage["E1_simulation_incomplete_draws"] +
                         coverage["E1_simulation_period_crossing_or_clock_clamp_draws"], 132)
        self.assertEqual(len(self.document["tail_drives_largest_expected_absolute_error"]), 10)


if __name__ == "__main__":
    unittest.main()
