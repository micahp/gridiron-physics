import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "docs/evidence/e3/game-level-clock-realism-gap-seed1-2022-2025-2026-10-24.json"


class GameLevelClockRealismGapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = json.loads(ARTIFACT.read_text(encoding="utf-8"))

    def test_uses_only_the_frozen_single_seed_fixture(self):
        self.assertEqual(self.result["protocol"]["same_seed_set"], [1])
        self.assertEqual(self.result["protocol"]["seed_count"], 1)
        self.assertFalse(self.result["sources"]["E2_valid_full_game"])

    def test_clock_replay_stops_when_fixed_sequence_requests_impossible_snap(self):
        diagnostics = self.result["clock_replay_diagnostics"]
        self.assertEqual(diagnostics["candidate_replayed_plays"], 27)
        self.assertEqual(diagnostics["candidate_unreplayed_fixture_plays"], 116)
        self.assertEqual(diagnostics["candidate_stopped"]["period_ended_after_play_sequence"], 27)
        self.assertEqual(diagnostics["candidate_stopped"]["next_fixed_fixture_play_sequence"], 28)
        for metric in self.result["scenario_metrics"].values():
            self.assertIsNone(metric["scenarios"]["two_regime_presnap_clock"]["seed1_value"])

    def test_reference_rows_exclude_reserved_2022_weeks(self):
        self.assertEqual(self.result["observed_coverage"]["games"], 896)
        self.assertIn("2022 weeks 6-9 excluded", self.result["sources"]["observed_scope_filter"])
        self.assertEqual(self.result["fixed_outcome_reference"]["pass_run_plays"], 128)
        self.assertEqual(self.result["fixed_outcome_reference"]["drive_count"], 24)

    def test_current_fixture_differences_have_reference_only_bounds(self):
        metric = self.result["scenario_metrics"]["pass_run_plays_per_game"]["scenarios"]["current_sampled_runoff"]
        self.assertEqual(metric["seed1_value"], 128)
        self.assertIsNotNone(metric["difference_95_ci_reference_only"])
        self.assertIn("one frozen seed", metric["generated_seed_uncertainty"])


if __name__ == "__main__":
    unittest.main()
