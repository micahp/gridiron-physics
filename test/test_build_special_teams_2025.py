import csv
import gzip
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURES = os.path.join(ROOT, "test", "fixtures", "special-teams")
RECOVERY_RAW = os.path.join(FIXTURES, "pbp_2025_safety_onside_recovery.csv.gz")
RECEIVING_RAW = os.path.join(FIXTURES, "pbp_2025_safety_onside_receiving.csv.gz")
BUILDER = os.path.join(ROOT, "pipeline", "build_special_teams_2025.py")
LEAGUE = os.path.join(ROOT, "data", "special_teams", "2025-league.json")

DRIVER = """
import importlib.util, os, sys, tempfile
raw, builder, out = sys.argv[1], sys.argv[2], sys.argv[3]
sys.argv = [builder, raw]
spec = importlib.util.spec_from_file_location("builder", builder)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.EXPECTED_SHA256 = mod.sha256(raw)
mod.OUT = out
mod.main()
"""


def load(raw):
    with gzip.open(raw, "rt", newline="") as src:
        reader = csv.DictReader(src)
        return reader.fieldnames, list(reader)


def rewrite(path, fields, rows):
    with gzip.open(path, "wt", newline="") as dst:
        writer = csv.DictWriter(dst, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def run_builder(raw, out):
    return subprocess.run([sys.executable, "-c", DRIVER, raw, BUILDER, out],
                          capture_output=True, text=True, cwd=ROOT)


def replace_desc(rows, game_id, play_id, old, new):
    hits = 0
    for row in rows:
        if (row["game_id"], row["play_id"]) == (game_id, play_id):
            assert old in row["desc"], row["desc"]
            row["desc"] = row["desc"].replace(old, new)
            hits += 1
    assert hits == 1, hits


def _recovery(out):
    cat = out["safety_kicks"]["categories"]["onside_kicking_recovery"]
    assert cat["n"] == 1, cat
    row = cat["rows"][0]
    assert (row["game_id"], row["play_id"]) == ("2025_08_CLE_NE", "3742"), row
    assert row["offense_spot_yardline_100"] == 67 and row["next_play_id"] == "3771", row


def _receiving(out):
    cat = out["safety_kicks"]["categories"]["onside_receiving_possession"]
    assert cat["n"] == 1, cat
    row = cat["rows"][0]
    assert (row["game_id"], row["play_id"]) == ("2025_11_DAL_LV", "3505"), row
    assert row["receiving_spot_yardline_100"] == 38, row
    assert row["next_play_id"] == "3533" and row["next_play_down"] == 1, row


def expect_refusal(make_variant, message, label):
    with open(LEAGUE, "rb") as f:
        league_before = f.read()
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "pbp_variant.csv.gz")
        fields, rows = load(make_variant[0])
        make_variant[1](rows)
        rewrite(raw, fields, rows)
        result = run_builder(raw, os.path.join(tmp, "league.json"))
    assert result.returncode != 0, f"builder accepted {label}"
    assert message in result.stderr, result.stderr
    with open(LEAGUE, "rb") as f:
        assert f.read() == league_before, "builder rewrote the league JSON after refusing"
    print(f"PASS builder rejects {label}")


def receiving_first_down_at_wrong_spot(rows):
    for row in rows:
        if (row["game_id"], row["play_id"]) == ("2025_11_DAL_LV", "3533"):
            assert row["yardline_100"] == "38", row["yardline_100"]
            row["yardline_100"] = "35"


def receiving_not_first_and_ten(rows):
    for row in rows:
        if (row["game_id"], row["play_id"]) == ("2025_11_DAL_LV", "3533"):
            assert row["down"] == "1" and row["ydstogo"] == "10"
            row["down"] = "2"


def expect_accept(raw, label, check):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "league.json")
        result = run_builder(raw, out)
        assert result.returncode == 0, f"builder refused the unmodified fixture: {result.stderr}"
        check(json.load(open(out)))
    print(f"PASS builder accepts {label}")


def main():
    expect_accept(RECOVERY_RAW, "the kicking-team onside recovery fixture", lambda out: _recovery(out))
    expect_accept(RECEIVING_RAW, "the receiving-team onside fixture", lambda out: _receiving(out))
    expect_refusal(
        (RECOVERY_RAW, lambda rows: replace_desc(rows, "2025_08_CLE_NE", "3742",
                                                 "RECOVERED by CLE-84", "RECOVERED by TEN-84")),
        "not recovered by CLE", "a kicking-team onside recovery recorded for the receiving team")
    expect_refusal((RECEIVING_RAW, receiving_first_down_at_wrong_spot),
                   "does not match its next play 3533",
                   "a receiving-team onside recovery whose next play is at a different spot")
    expect_refusal((RECEIVING_RAW, receiving_not_first_and_ten),
                   "does not match its next play 3533",
                   "a receiving-team onside recovery whose next play is not first and 10")


if __name__ == "__main__":
    main()
