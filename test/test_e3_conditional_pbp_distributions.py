import unittest

from scripts.research.e3_conditional_pbp_distributions import DB_DEFAULT, SCOPE_SQL, build, clock_band


class ConditionalPbpDistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = build(DB_DEFAULT)

    def test_scope_excludes_reserved_weeks_and_is_pbp_only(self):
        source = self.report["sources"]
        self.assertIn("p.week BETWEEN 1 AND 5", SCOPE_SQL)
        self.assertNotIn("p.week BETWEEN 6", SCOPE_SQL)
        self.assertFalse(source["weeks_6_9_queried"])
        self.assertEqual(source["scheduled_games"], 896)
        self.assertEqual(source["pbp_rows"], 155124)
        self.assertEqual(source["eligible_pass_run_plays"], 109932)
        self.assertTrue(any("score differential" in item for item in self.report["definitions"]["conditioning_state_excludes"]))
        self.assertIn("weeks 6-9", " ".join(self.report["limitations"]))

    def test_pass_run_tables_reconcile_denominators(self):
        expected = self.report["sources"]["eligible_pass_run_plays"]
        for table_name in ("pass_run_by_down_distance", "pass_run_by_field_zone"):
            table = self.report["conditionals"][table_name]
            self.assertEqual(sum(row["eligible_pass_run_plays"] for row in table), expected)
            for row in table:
                self.assertEqual(row["pass_count"] + row["run_count"], row["eligible_pass_run_plays"])
                self.assertAlmostEqual(row["pass_share"] + row["run_share"], 1.0)

    def test_game_clock_is_converted_to_quarter_clock_before_binning(self):
        self.assertEqual(clock_band({"qtr": 1, "game_seconds_remaining": 3600}), "601-900")
        self.assertEqual(clock_band({"qtr": 1, "game_seconds_remaining": 2820}), "0-120")
        self.assertEqual(clock_band({"qtr": 2, "game_seconds_remaining": 1920}), "0-120")
        self.assertEqual(clock_band({"qtr": 4, "game_seconds_remaining": 900}), "601-900")
        self.assertEqual(clock_band({"qtr": 5, "game_seconds_remaining": 300}), "unknown")

    def test_terminal_tables_use_resolved_source_denominators(self):
        conditionals = self.report["conditionals"]
        for row in conditionals["third_fourth_down_series_outcomes"]:
            self.assertEqual(sum(row["terminal_results"].values()), row["resolved_series_terminals"])
            self.assertEqual(
                row["first_down_or_touchdown"],
                row["terminal_results"].get("First down", 0) + row["terminal_results"].get("Touchdown", 0),
            )
            self.assertAlmostEqual(
                row["first_down_or_touchdown_share"], row["first_down_or_touchdown"] / row["resolved_series_terminals"]
            )
        self.assertGreater(sum(row["resolved_drive_count"] for row in conditionals["drive_terminal_by_starting_field_zone"]), 0)
        self.assertEqual(self.report["coverage"]["drive_groups_with_missing_terminal_result"], 0)


if __name__ == "__main__":
    unittest.main()
