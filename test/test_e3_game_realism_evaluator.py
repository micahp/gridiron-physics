import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/research/e3_game_realism_evaluator.py"
FIXTURE = ROOT / "docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json"
SPEC = importlib.util.spec_from_file_location("e3_game_realism_evaluator", SCRIPT)
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)


class E3GameRealismEvaluatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = EVALUATOR.evaluate([FIXTURE], bootstrap_replicates=100, lp_evidence_sha="a442dcd7")

    def test_current_accepted_e2_record_is_scored_as_smoke_only(self):
        scope = self.result["scope"]
        self.assertEqual(scope["generated_game_count"], 1)
        self.assertFalse(scope["all_generated_valid_full_game"])
        self.assertEqual(scope["evaluation_status"], "EXPLORATORY_SMOKE_ONLY")
        self.assertIn("NOT_HELD_OUT", scope["held_out_status"])
        self.assertEqual(self.result["sources"]["lp_evidence_commit"], "a442dcd7")
        self.assertEqual(self.result["sources"]["generated_payloads"][0]["sha256"], "0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821")

    def test_gate_e3_metrics_are_present_and_unavailable_references_fail_closed(self):
        comparisons = self.result["comparisons"]
        required = {
            "pass_run_mix", "pass_run_by_game_state", "yards_by_play_type",
            "yards_by_down_distance", "first_down_by_down_distance",
            "sacks_per_dropback", "turnovers_per_scrimmage_play",
            "plays_per_drive", "possession_duration", "drive_endings",
            "third_fourth_conversion", "red_zone_conversion", "total_points",
            "score_margin_abs",
        }
        self.assertTrue(required.issubset(comparisons))
        for name in ("pass_run_by_game_state", "yards_by_down_distance", "first_down_by_down_distance", "third_fourth_conversion", "red_zone_conversion"):
            self.assertEqual(comparisons[name]["status"], "reference_unavailable")
            self.assertIsNone(comparisons[name]["tvd"])
        self.assertGreaterEqual(len(self.result["conditional_generated_only"]), 100)

    def test_available_marginals_include_bootstrap_uncertainty_and_provenance(self):
        for name in ("pass_run_mix", "yards_by_play_type", "sacks_per_dropback", "turnovers_per_scrimmage_play", "plays_per_drive", "pass_run_plays_per_drive", "possession_duration", "drive_endings", "total_points", "score_margin_abs"):
            metric = self.result["comparisons"][name]
            self.assertEqual(metric["status"], "compared_exploratory")
            self.assertEqual(metric["bootstrap_replicates"], 100)
            self.assertEqual(len(metric["bootstrap_95_ci"]), 2)
        self.assertEqual(self.result["score_distribution_summary"]["generated_total_points"] if "generated_total_points" in self.result["score_distribution_summary"] else self.result["score_distribution_summary"]["generated_mean_total_points"], 24.0)
        self.assertFalse(self.result["score_distribution_summary"]["generated_variance_and_tails_estimable"])

    def test_rejects_non_record_json(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = Path(directory) / "bad.json"
            bad.write_text(json.dumps({"schema": "unrelated", "record": {}}))
            with self.assertRaisesRegex(ValueError, "expected an LP E2 game JSON envelope"):
                EVALUATOR.evaluate([bad], bootstrap_replicates=100)


if __name__ == "__main__":
    unittest.main()
