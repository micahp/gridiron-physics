#!/usr/bin/env python3
"""Fast schema and reserved-week guards for the E3 physical-timing artifact."""

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "research" / "build_bdb2025_physical_timing.py"
ARTIFACT = ROOT / "docs" / "research" / "gridiron-e3-physical-timing-2026-10-24.json"


class PhysicalTimingGuardTests(unittest.TestCase):
    def test_weeks_6_through_9_are_rejected_before_tracking_is_opened(self):
        for week in (6, 7, 8, 9):
            with self.subTest(week=week), tempfile.TemporaryDirectory() as temp:
                temp_path = Path(temp)
                manifest = temp_path / "cohort.csv"
                with manifest.open("w", newline="", encoding="utf-8") as stream:
                    writer = csv.DictWriter(
                        stream,
                        fieldnames=("week", "gameId", "playId", "origin_frame", "eligible_input"),
                    )
                    writer.writeheader()
                    writer.writerow({
                        "week": week,
                        "gameId": "2022090800",
                        "playId": 100,
                        "origin_frame": 100,
                        "eligible_input": "True",
                    })

                output = temp_path / "must-not-exist.json"
                result = subprocess.run(
                    [
                        sys.executable,
                        str(BUILDER),
                        "--tracking-root",
                        str(temp_path / "no-tracking-files"),
                        "--cohort-manifest",
                        str(manifest),
                        "--output",
                        str(output),
                    ],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                combined = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"reserved/out-of-scope week {week}", combined)
                self.assertNotIn("FileNotFoundError", combined)
                self.assertFalse(output.exists())

    def test_lp_join_keys_and_partial_coverage_are_explicit(self):
        data = json.loads(ARTIFACT.read_text(encoding="utf-8"))
        plays = data["plays"]
        self.assertEqual(data["schema"], "gridiron.bdb2025.snap_physical_timing.v2")
        self.assertEqual(len(plays), 9289)
        self.assertEqual(len({(p["game_id"], p["play_id"]) for p in plays}), 9289)
        joined = [p for p in plays if p["lp_join_status"] == "matched"]
        self.assertEqual(len(joined), 9066)
        self.assertTrue(all(p["lp_game_id"] and p["lp_play_id"] is not None for p in joined))
        self.assertEqual(len({(p["lp_game_id"], p["lp_play_id"]) for p in joined}), 9066)
        self.assertTrue(all(p["lp_game_id"] is None and p["lp_play_id"] is None for p in plays if p["lp_join_status"] == "unmatched"))

        resolved = [p for p in plays if p["timing_status"] == "resolved"]
        self.assertEqual(len(resolved), 9283)
        self.assertEqual(sum(p["lp_join_status"] == "matched" for p in resolved), 9060)
        self.assertEqual(sum(p["lp_join_status"] == "unmatched" for p in resolved), 223)

        candidates = [p for p in plays if p["carrier_candidates"]]
        self.assertEqual(len(candidates), 7576)
        self.assertEqual(sum(p["lp_join_status"] == "matched" for p in candidates), 7386)
        self.assertEqual(sum(p["lp_join_status"] == "unmatched" for p in candidates), 190)
        self.assertEqual(sum(p["timing_status"] != "resolved" for p in candidates), 5)
        candidate_fields = {
            "nfl_id",
            "event_marker",
            "event_frame",
            "distance_to_football_yards",
            "kinematics_at_snap",
        }
        kinematics_fields = {
            "velocity_x_yards_per_second",
            "velocity_y_yards_per_second",
            "speed_yards_per_second",
            "acceleration_x_yards_per_second_squared",
            "acceleration_y_yards_per_second_squared",
            "acceleration_magnitude_yards_per_second_squared",
            "tracking_speed_at_snap_yards_per_second",
            "tracking_acceleration_at_snap_yards_per_second_squared",
        }
        for play in candidates:
            self.assertEqual(len(play["carrier_candidates"]), 1)
            candidate = play["carrier_candidates"][0]
            self.assertEqual(set(candidate), candidate_fields)
            self.assertEqual(set(candidate["kinematics_at_snap"]), kinematics_fields)


if __name__ == "__main__":
    unittest.main(verbosity=2)
