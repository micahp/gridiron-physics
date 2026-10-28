import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import build_historical_playbooks as historical  # noqa: E402
import build_playbooks as bp  # noqa: E402


def observation(team="NE", side="offense", season=2025, week=3, action="run", player="r1",
                receiver="wr1", yards=5, score_diff=0, qtr=1, clock=600, down=1, togo=10, yl=75):
    attrs = {
        "week": week, "play_type": action, "rusher_player_id": player if action == "run" else None,
        "passer_player_id": "q1" if action == "pass" else None,
        "receiver_player_id": receiver if action == "pass" else None,
        "posteam_score": max(0, score_diff), "defteam_score": max(0, -score_diff),
        "qtr": qtr, "quarter_seconds_remaining": clock, "down": down,
        "ydstogo": togo, "yardline_100": yl,
    }
    return {
        "schema_version": historical.OBSERVATION_VERSION,
        "season": season, "team_id": team, "team_side": side,
        "play": {
            "season": season, "source_id": {"game_id": f"{season}_{week}_{team}", "play_id": str(yards)},
            "attributes": attrs,
            "outcome_label": {"yards_gained": yards, "complete_pass": 1 if action == "pass" else None,
                              "interception": 0},
            "event_history": {"interception": "0", "fumble_lost": "0", "sack": "0"},
        },
    }


class HistoricalBuilderBoundaries(unittest.TestCase):
    def test_allowed_seasons_and_source_pins_are_exact(self):
        self.assertEqual(historical.validate_seasons((2024, 2022)), (2022, 2024))
        self.assertEqual(set(bp.RESEARCH_SOURCE_PINS), set(bp.RESEARCH_SEASONS))
        self.assertEqual(set(bp.RESEARCH_PBP_FILES), set(bp.RESEARCH_SEASONS))
        self.assertEqual(set(bp.RESEARCH_FTN_FILES), set(bp.RESEARCH_SEASONS))
        self.assertEqual(set(bp.RESEARCH_PART_FILES), set(bp.RESEARCH_SEASONS))
        for invalid in ((2021,), (2026,), (True,), (2022, 2022)):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                historical.validate_seasons(invalid)

    def test_rejected_season_touches_no_files(self):
        with mock.patch("builtins.open", side_effect=AssertionError("file read")) as opened:
            with self.assertRaises(ValueError):
                historical.validate_seasons((2026,))
        opened.assert_not_called()

    def test_output_is_confined_outside_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            historical.validate_output_dir(ROOT)
        with self.assertRaisesRegex(ValueError, "sealed season"):
            historical.validate_output_dir("/tmp/historical-sealed-2026-output")

    def test_historical_hash_is_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "historical.csv")
            with open(path, "wb") as out:
                out.write(b"season,play_id\n2025,1\n")
            self.assertEqual(historical._sha256(path), historical._sha256(path))


class CutoffAndPriorTests(unittest.TestCase):
    def setUp(self):
        self.cutoff = {"season": 2025, "week": 6}
        self.rows = ([observation(season=2024, week=18, action="run", yards=i % 8) for i in range(20)]
                     + [observation(season=2024, week=18, action="pass", yards=i % 12) for i in range(10)]
                     + [observation(week=week, action="run", yards=i % 8)
                        for week in range(1, 6) for i in range(5)]
                     + [observation(week=week, action="pass", yards=i % 12)
                        for week in range(1, 6) for i in range(2)])

    def test_cutoff_excludes_target_and_later_weeks(self):
        records = self.rows + [observation(week=6, action="pass") for _ in range(3)] \
            + [observation(week=7, action="pass") for _ in range(2)]
        audit = historical.cutoff_audit(records, self.cutoff)
        self.assertEqual(audit["same_or_later_target_week_included"], 0)
        self.assertEqual(audit["counts"]["same_or_later_target_week"], 5)
        self.assertEqual(audit["latest_included_season_week"], [2025, 5])

    def test_future_games_cannot_change_an_earlier_prior(self):
        context = {"score_diff": -7, "quarter": 4, "clock_seconds": 90,
                   "yardline_100": 35, "down": 3, "yards_to_go": 8,
                   "timeouts_remaining": None}
        before = historical.historical_action_prior(self.rows, "NE", context, self.cutoff)
        later = self.rows + [observation(week=6, action="pass") for _ in range(100)]
        after = historical.historical_action_prior(later, "NE", context, self.cutoff)
        self.assertEqual(before["action_counts"], after["action_counts"])
        self.assertEqual(before["action_probabilities"], after["action_probabilities"])
        self.assertEqual(before["action_denominator"], sum(before["action_counts"].values()))

    def test_cached_cutoff_audit_must_match_prior_cutoff(self):
        audit = historical.cutoff_audit(self.rows, self.cutoff)
        with self.assertRaisesRegex(ValueError, "does not match"):
            historical.historical_action_prior(
                self.rows, "NE", {"score_diff": 0, "quarter": 1, "clock_seconds": 600,
                                  "yardline_100": 75, "down": 1, "yards_to_go": 10},
                {"season": 2025, "week": 7}, cutoff_audit_result=audit)

    def test_only_run_and_pass_are_in_action_denominator(self):
        records = self.rows + [observation(action="punt"), observation(side="defense")]
        result = historical.historical_action_prior(
            records, "NE", {"score_diff": 0, "quarter": 1, "clock_seconds": 600,
                            "yardline_100": 75, "down": 1, "yards_to_go": 10}, self.cutoff)
        self.assertEqual(result["action_denominator"], sum(result["action_counts"].values()))
        self.assertNotIn("punt", result["action_counts"])
        self.assertEqual(set(result["context_effects"]), set(historical.CONTEXT_FIELDS))
        self.assertTrue(result["parameter_smoothing"]["context_effects_are_additive_main_effects"])
        self.assertIsNotNone(result["source_run_wilson_95"])

    def test_roster_snapshot_must_precede_cutoff_and_event_is_not_yet_sampled(self):
        prior = {
            "schema_version": "gridiron.cutoff-action-prior.v1",
            "action_probabilities": {"run": 1.0, "pass": 0.0},
            "action_counts": {"run": 20, "pass": 0}, "action_denominator": 20,
            "parameter_smoothing": {"alpha": 30.0}, "context_effects": {},
            "cutoff": {"season": 2025, "week": 6},
        }
        rows_with_r2 = self.rows + [observation(season=2025, week=5, action="run", player="r2")]
        roster = {"as_of": {"season": 2025, "week": 5},
                  "rusher_ids": ["r2"], "passer_ids": ["q1"], "receiver_ids": ["wr1"]}
        with mock.patch.object(historical, "historical_action_prior", return_value=prior):
            request = historical.prepare_pre_event_request(
                rows_with_r2, team_id="NE", opponent_id="BUF",
                context={"score_diff": -7, "quarter": 4, "clock_seconds": 90,
                         "yardline_100": 35, "down": 3, "yards_to_go": 8,
                         "timeouts_remaining": None},
                cutoff=self.cutoff, available_roster=roster, rng=__import__("random").Random(3))
        self.assertEqual(request["play_call"]["action"], "run")
        self.assertEqual(request["participants"], {"rusher": "r2"})
        self.assertIsNone(request["outcome"])
        self.assertEqual(request["game_state"]["timeouts_status"], "unavailable")
        bad_roster = dict(roster, as_of={"season": 2025, "week": 6})
        with mock.patch.object(historical, "historical_action_prior", return_value=prior):
            with self.assertRaisesRegex(ValueError, "strictly before"):
                historical.prepare_pre_event_request(
                    self.rows, team_id="NE", opponent_id="BUF", context={}, cutoff=self.cutoff,
                    available_roster=bad_roster, rng=__import__("random").Random(3))

    def test_selected_player_outcomes_are_sampled_only_after_selection(self):
        rows = [observation(action="run", player="r2", yards=4),
                observation(action="run", player="r2", yards=7)]
        request = {"cutoff": self.cutoff, "team_id": "NE",
                   "play_call": {"action": "run"}, "participants": {"rusher": "r2"}}
        outcome = historical.sample_pre_event_outcome(rows, request, __import__("random").Random(4))
        self.assertEqual(outcome["event_type"], "run")
        self.assertIn(outcome["yards_gained"], (4, 7))
        self.assertTrue(outcome["player_selection_preceded_outcome"])
        self.assertEqual(outcome["outcome_evidence_tier"], "team_selected_actor")

    def test_lp_sampling_policy_selects_actor_before_historical_row(self):
        records = ([observation(action="run", player="r1", yards=i % 8) for i in range(30)]
                   + [observation(action="pass", player=None, receiver="wr1", yards=i % 12)
                      for i in range(20)])
        entries = []
        for i in range(45):
            row = {"posteam": "NE", "defteam": "BUF", "play_type": "run", "rusher_player_id": "r1",
                   "passer_player_id": None, "receiver_player_id": None, "yards_gained": i % 8,
                   "posteam_score": 0, "defteam_score": 0, "qtr": 1,
                   "quarter_seconds_remaining": 600, "yardline_100": 75}
            entries.append(("run", row, 20, None))
        for i in range(5):
            row = {"posteam": "NE", "defteam": "BUF", "play_type": "pass", "rusher_player_id": None,
                   "passer_player_id": "q1", "receiver_player_id": "wr1", "yards_gained": i % 12,
                   "posteam_score": 0, "defteam_score": 0, "qtr": 1,
                   "quarter_seconds_remaining": 600, "yardline_100": 75}
            entries.append(("pass_complete", row, 20, None))
        pool = {(1, 10, 75): entries}
        roster = {"as_of": {"season": 2025, "week": 5}, "rusher_ids": ["r1"],
                  "passer_ids": ["q1"], "receiver_ids": ["wr1"]}
        policy = historical.LPHistoricalSamplingPolicy(
            pool, records=records, team_id="NE", opponent_id="BUF",
            context={"score_diff": 0, "quarter": 1, "clock_seconds": 600,
                     "yardline_100": 75, "down": 1, "yards_to_go": 10,
                     "timeouts_remaining": None}, cutoff=self.cutoff,
            available_roster=roster, condition_team=True, condition_script=True)
        selected_event, _row, _runoff, _spot = policy.sample(
            __import__("random").Random(2), entries, offense="NE", defense="BUF")
        selection = policy.selections[0]
        self.assertIn(selected_event, ("run", "pass_complete"))
        self.assertEqual(selection["action"], "pass")
        self.assertLess(selection["action_prior"]["action_probabilities"]["run"], 0.956)
        self.assertTrue(selection["participant_selected_before_result"])
        self.assertIn(selection["participants"].get("rusher", selection["participants"].get("passer")),
                      ("r1", "q1"))
        emitted = [{"outcome": {"rusher_id": None, "passer_id": None, "receiver_id": None},
                    "sampling": {}}]
        historical.attach_preselected_participants(emitted, policy.selections)
        self.assertIn(emitted[0]["outcome"]["rusher_id"] or emitted[0]["outcome"]["passer_id"], ("r1", "q1"))

    def test_participation_and_ngs_missingness_are_explicit(self):
        pbp = {"game_id": "2025_01_NE_BUF", "old_game_id": "2025090700", "play_id": "1",
               "season": "2025", "season_type": "REG", "posteam": "NE", "defteam": "BUF",
               "play_type": "run", "down": "1", "ydstogo": "10", "yardline_100": "75",
               "desc": "run", "yards_gained": "3"}
        record = bp.compact_research_play(pbp, None, 2025, "observed_2025")
        self.assertEqual(record["participation"]["availability"], "missing")
        self.assertEqual(record["pregame_availability"]["status"], "not_observed_in_play_by_play")
        self.assertIsNone(record["advanced_tracking"]["ngs_separation"]["value"])
        self.assertEqual(record["advanced_tracking"]["ngs_separation"]["availability"],
                         "no_verified_play_level_join")


if __name__ == "__main__":
    unittest.main()
