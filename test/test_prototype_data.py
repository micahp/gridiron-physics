import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import build_playbooks


class PlaybookDataTests(unittest.TestCase):
    def test_legacy_game_id_participation_join(self):
        pbp = {"game_id": "2025_01_DAL_PHI", "old_game_id": "2025090400", "play_id": "40",
               "season": "2025", "season_type": "REG"}
        participation = {"old_game_id": "2025090400", "nflverse_game_id": "2025_01_DAL_PHI", "play_id": "40"}
        pidx = build_playbooks.participation_index([participation])
        bidx = build_playbooks.index_pbp([pbp], 2025)
        key = next(iter(bidx))
        self.assertEqual(key, ("2025090400", "40"))
        self.assertIs(pidx.get(key), participation)

    def test_unmatched_join_is_detectable_and_duplicate_keys_fail(self):
        pidx = build_playbooks.participation_index([])
        self.assertIsNone(pidx.get(("2025090400", "41")))
        duplicate = {"old_game_id": "2025090400", "play_id": "40"}
        with self.assertRaisesRegex(ValueError, "duplicate participation source key"):
            build_playbooks.participation_index([duplicate, dict(duplicate)])

    def test_personnel_classifiers_preserve_unknowns(self):
        self.assertEqual(build_playbooks.personnel_group("1 RB, 1 TE, 3 WR"), "113")
        self.assertIsNone(build_playbooks.personnel_group("1 RB, 2 TE, 1 WR"))
        self.assertEqual(build_playbooks.defensive_personnel_code(
            "2 CB, 2 DE, 2 DT, 1 FS, 1 MLB, 1 OLB, 2 SS"), "4-2-5")
        self.assertIsNone(build_playbooks.defensive_personnel_code("incomplete personnel label"))

    def test_committed_profiles_reconcile_counts_and_keep_missingness(self):
        for team in ("NE", "CHI"):
            path = os.path.join(ROOT, "data", "playbooks", f"{team}-2025.json")
            with open(path, encoding="utf-8") as f:
                book = json.load(f)
            self.assertEqual(book["phase"], "REG")
            self.assertFalse(book["claims"]["literal_playbook_reconstruction"])
            self.assertEqual(book["coverage"]["eligible_offense_scrimmage_plays"], len(book["offense"]["observed_plays"]))
            for side in ("offense", "defense"):
                for dist in book[side]["profile"].values():
                    if not isinstance(dist, dict) or "denominator" not in dist:
                        continue
                    self.assertEqual(dist["observed"] + dist["missing"], dist["denominator"])
                    self.assertEqual(sum(x["count"] for x in dist["categories"].values()), dist["observed"])
            for kind in ("run", "pass"):
                catalog = book["offense"]["play_candidates"][kind]
                self.assertEqual(catalog["classified_plays"] + catalog["missing_or_unclassified"],
                                 catalog["eligible_action_plays"])
                self.assertEqual(sum(x["count"] for x in catalog["candidates"]), catalog["classified_plays"])
                self.assertEqual(len({x["candidate_id"] for x in catalog["candidates"]}), len(catalog["candidates"]))
                for candidate in catalog["candidates"]:
                    self.assertEqual(candidate["provenance"], "observed_2025")
                    self.assertEqual(candidate["action"], kind)
                    self.assertEqual(len(candidate["source_ids"]), candidate["count"])
                    self.assertEqual(candidate["denominator"], catalog["eligible_action_plays"])
                    self.assertIn("formation", candidate["attributes"])
                    self.assertIsInstance(candidate["attributes"]["shotgun"], bool)
                    self.assertNotIn("yards_gained", candidate)
                    self.assertNotIn("outcome_label", candidate)
            self.assertEqual(book["offense"]["profile"]["play_action"]["observed"], 0)
            self.assertEqual(book["offense"]["profile"]["motion"]["observed"], 0)
            self.assertEqual(book["coverage"]["offense_participation_joined"] + book["coverage"]["offense_participation_missing"],
                             book["coverage"]["eligible_offense_scrimmage_plays"])
            self.assertEqual(book["coverage"]["defense_participation_joined"] + book["coverage"]["defense_participation_missing"],
                             book["coverage"]["eligible_defense_scrimmage_plays"])
            self.assertTrue(book["source"]["pbp"]["sha256"])
            self.assertTrue(book["source"]["participation"]["sha256"])
            self.assertTrue(book["source"]["pbp_2026_pre_game"]["sha256"])
            self.assertTrue(all(int(p["game_id"].split("_")[1]) <= 6
                                for p in book["pregame_2026_comparison"]["source_ids"]))


if __name__ == "__main__":
    unittest.main()
