"""Artifact checks for the historical 2022-2024 playbook build.

Reads the built outputs (HISTORICAL_BUILD_DIR, default /root/gridiron-playbook-builds/historical-2022-2024) and the
committed Gate 3 row fixtures. Skipped with a reason when the build directory is absent. No 2026 file is read.
"""
import collections
import csv
import gzip
import hashlib
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.environ.get("HISTORICAL_BUILD_DIR", "/root/gridiron-playbook-builds/historical-2022-2024")
FIXTURES = os.path.join(ROOT, "test", "fixtures", "historical-2022-2024")
SEASONS = (2022, 2023, 2024)
TEAMS = ("ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
         "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS")
GATE3_UNRESOLVED_SHA256 = "e0ccaba41c83ee9ad1a227dff0e4dc52044233af0dee5fda2769f14f90aac19f"
GATE3_FAILING_SHA256 = "38e6053c24e68a3c0351b20854f22170edb485d2780ad23dda25a17973eb16dc"
DOCS = os.path.join(ROOT, "docs", "research", "historical-2022-2024")
R1_FAILING_2022 = ["ATL", "BAL", "CAR", "CHI", "CLE", "GB", "JAX", "LA", "LAC", "MIA", "NYG", "NYJ", "SEA", "SF", "TB"]
RAW = os.path.join(ROOT, "data", "raw")
PBP_COLUMNS = {"game_id", "season", "season_type", "week", "play_id", "posteam", "defteam", "play_type", "shotgun",
               "two_point_attempt", "fumble", "down", "ydstogo", "yardline_100", "pass_length", "pass_location", "run_gap"}
FTN_QB_LOCATION = {2022: {"", " S", "P", "S", "U"}, 2023: {"0", "P", "S", "U"}, 2024: {"0", "P", "S", "U"}}
PARTICIPATION_FORMATIONS = {
    2022: {"", "EMPTY", "I_FORM", "JUMBO", "PISTOL", "SHOTGUN", "SINGLEBACK", "WILDCAT"},
    2023: {"", "PISTOL", "SHOTGUN", "UNDER CENTER"},
    2024: {"", "PISTOL", "SHOTGUN", "UNDER CENTER"},
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def expected_shotgun(ftn, participation, pbp):
    """The builder's hierarchy from committed Gate 3 columns: FTN, then participation, then the PBP flag."""
    if ftn in ("True", "False"):
        return ftn == "True", "ftn"
    if participation in ("True", "False"):
        return participation == "True", "participation"
    return pbp == "True", "pbp_flag"


@unittest.skipUnless(os.path.isdir(BUILD_DIR), f"historical build directory not found: {BUILD_DIR}")
class HistoricalArtifacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profiles = {}
        for season in SEASONS:
            for team in TEAMS:
                path = os.path.join(BUILD_DIR, f"{team}-{season}.json")
                with open(path, encoding="utf-8") as stream:
                    cls.profiles[(season, team)] = json.load(stream)

    def test_inventory_has_96_team_seasons_and_no_other_seasons(self):
        names = os.listdir(BUILD_DIR)
        team_files = [n for n in names if n.endswith(".json") and n[:-5].rsplit("-", 1)[-1].isdigit()
                      and not n.startswith(("build", "shotgun"))]
        self.assertEqual(len(team_files), 96)
        self.assertFalse([n for n in names if "2026" in n or "2025" in n])
        for season in SEASONS:
            for name in (f"observations-{season}.jsonl", f"BUILD-REPORT-{season}.md",
                         f"build-manifest.{season}.json", f"shotgun-provenance-{season}.jsonl"):
                self.assertIn(name, names)

    def test_sha256_manifest_matches_every_file(self):
        manifest = os.path.join(BUILD_DIR, "SHA256SUMS.txt")
        self.assertTrue(os.path.isfile(manifest), "SHA256SUMS.txt must be written after the sidecars")
        listed = {}
        with open(manifest, encoding="utf-8") as stream:
            for line in stream:
                digest, name = line.rstrip("\n").split("  ", 1)
                listed[name] = digest
        on_disk = {n for n in os.listdir(BUILD_DIR) if n not in ("SHA256SUMS.txt",) and not n.endswith(".log")}
        self.assertEqual(set(listed), on_disk)
        for name, digest in listed.items():
            self.assertEqual(sha256(os.path.join(BUILD_DIR, name)), digest, name)

    def test_profile_identity_and_version(self):
        for (season, team), profile in self.profiles.items():
            self.assertEqual(profile["season"], season)
            self.assertEqual(profile["team_id"], team)
            self.assertEqual(profile["historical_profile_version"], "gridiron.historical-team-season.v1")

    def test_observation_records_match_profile_play_counts(self):
        for season in SEASONS:
            expected = sum(len(p["offense"]["observed_plays"]) + len(p["defense"]["observed_plays"])
                           for (s, _), p in self.profiles.items() if s == season)
            with open(os.path.join(BUILD_DIR, f"observations-{season}.jsonl"), encoding="utf-8") as stream:
                self.assertEqual(sum(1 for _ in stream), expected, season)

    def test_shotgun_sidecar_matches_profile_populations(self):
        for season in SEASONS:
            rows = {}
            with open(os.path.join(BUILD_DIR, f"shotgun-provenance-{season}.jsonl"), encoding="utf-8") as stream:
                for line in stream:
                    row = json.loads(line)
                    rows[(row["team"], row["game_id"], row["play_id"])] = row
            total = 0
            per_team = collections.Counter((r["team"], r["shotgun_source"]) for r in rows.values())
            for team in TEAMS:
                profile = self.profiles[(season, team)]["offense"]["profile"]
                total += profile["eligible_scrimmage_plays"]
                for cat in ("ftn", "participation", "pbp_flag"):
                    expected = profile["shotgun_source"]["categories"].get(cat, {}).get("count", 0)
                    self.assertEqual(per_team[(team, cat)], expected, (season, team, cat))
            self.assertEqual(len(rows), total)
            with open(os.path.join(BUILD_DIR, "shotgun-provenance-summary.json"), encoding="utf-8") as stream:
                summary = json.load(stream)[str(season)]
            self.assertEqual(summary["plays"], total)
            self.assertEqual(summary["pbp_flag_disagrees"],
                             sum(1 for r in rows.values() if r["shotgun_pbp_flag_disagrees"]))

    def test_gate3_committed_rows_agree_with_profiles(self):
        self.assertEqual(sha256(os.path.join(FIXTURES, "gate3_unresolved_plays.csv")), GATE3_UNRESOLVED_SHA256)
        self.assertEqual(sha256(os.path.join(FIXTURES, "gate3_failing_disputed_source_values.csv")),
                         GATE3_FAILING_SHA256)
        sidecar = {}
        for season in SEASONS:
            with open(os.path.join(BUILD_DIR, f"shotgun-provenance-{season}.jsonl"), encoding="utf-8") as stream:
                for line in stream:
                    row = json.loads(line)
                    sidecar[(row["season"], row["team"], row["game_id"], row["play_id"])] = row
        cases = {
            "gate3_unresolved_plays.csv": ("ftn_shotgun", "participation_shotgun", "pbp_shotgun"),
            "gate3_failing_disputed_source_values.csv": ("ftn_shotgun", "participation_shotgun", "pbp_shotgun"),
        }
        for name, (ftn_col, part_col, pbp_col) in cases.items():
            matched = outside = 0
            with open(os.path.join(FIXTURES, name), newline="", encoding="utf-8") as stream:
                for r in csv.DictReader(stream):
                    key = (int(r["season"]), r["team"], r["game_id"], str(int(r["play_id"])))
                    if key not in sidecar:
                        outside += 1
                        continue
                    value, source = expected_shotgun(r[ftn_col], r[part_col], r[pbp_col])
                    got = sidecar[key]
                    self.assertEqual((got["shotgun_hierarchy"], got["shotgun_source"]), (value, source), key)
                    matched += 1
            self.assertGreater(matched, 0, name)
            if name.startswith("gate3_unresolved"):
                self.assertEqual((matched, outside), (415, 149))
            else:
                self.assertEqual((matched, outside), (181, 91))

    def test_repo_copies_match_the_build_directory(self):
        for name in ("SHA256SUMS.txt", "shotgun-provenance-summary.json", *(f"BUILD-REPORT-{s}.md" for s in SEASONS),
                     *(f"build-manifest.{s}.json" for s in SEASONS)):
            self.assertEqual(sha256(os.path.join(DOCS, name)), sha256(os.path.join(BUILD_DIR, name)), name)

    def test_committed_verification_matches_gate3_and_the_rev3_comparison(self):
        for season in SEASONS:
            with open(os.path.join(DOCS, f"verification-{season}.json"), encoding="utf-8") as stream:
                result = json.load(stream)
            stats = result["stats"]
            self.assertEqual((stats["hierarchy_mismatch"], stats["population_rows_not_found"]), (0, 0), season)
            self.assertEqual(stats["matched"], stats["population_rows"], season)
            self.assertEqual(result["r1_below_new_population"], result["r1_below_gate3"], season)
            self.assertTrue(result["r1_denominators_no_larger_than_gate3"], season)
            rev3 = stats["rev3"]
            self.assertEqual((rev3["value_mismatch"], rev3["source_mismatch"]), (0, 0), season)
            self.assertEqual(rev3["population_not_in_rev3"], 0, season)
            self.assertEqual(rev3["rev3_not_in_population_unclassified"], 0, season)
            self.assertEqual(rev3["shared"], stats["population_rows"], season)
        with open(os.path.join(DOCS, "verification-2022.json"), encoding="utf-8") as stream:
            self.assertEqual(json.load(stream)["r1_below_new_population"], R1_FAILING_2022)
        for season in (2023, 2024):
            with open(os.path.join(DOCS, f"verification-{season}.json"), encoding="utf-8") as stream:
                self.assertEqual(json.load(stream)["r1_below_new_population"], [], season)


@unittest.skipUnless(os.path.isdir(RAW), f"pinned source directory not found: {RAW}")
class HistoricalSourceSchema(unittest.TestCase):
    def test_required_columns_exist_in_each_season(self):
        for season in SEASONS:
            with gzip.open(os.path.join(RAW, f"pbp_{season}.csv.gz"), "rt", encoding="utf-8-sig", newline="") as stream:
                self.assertLessEqual(PBP_COLUMNS, set(next(csv.reader(stream))), season)
            with open(os.path.join(RAW, f"ftn_charting_{season}.csv"), encoding="utf-8-sig", newline="") as stream:
                self.assertLessEqual({"nflverse_game_id", "nflverse_play_id", "season", "week", "qb_location"},
                                     set(next(csv.reader(stream))), season)
            with open(os.path.join(RAW, f"pbp_participation_{season}.csv"), encoding="utf-8-sig", newline="") as stream:
                self.assertLessEqual({"old_game_id", "play_id", "offense_formation"}, set(next(csv.reader(stream))), season)

    def test_value_vocabularies_match_each_season(self):
        for season in SEASONS:
            with open(os.path.join(RAW, f"ftn_charting_{season}.csv"), encoding="utf-8-sig", newline="") as stream:
                self.assertEqual({row["qb_location"] for row in csv.DictReader(stream)}, FTN_QB_LOCATION[season], season)
            with open(os.path.join(RAW, f"pbp_participation_{season}.csv"), encoding="utf-8-sig", newline="") as stream:
                formations = {(row["offense_formation"] or "").strip() for row in csv.DictReader(stream)}
                self.assertEqual(formations, PARTICIPATION_FORMATIONS[season], season)


if __name__ == "__main__":
    unittest.main()
