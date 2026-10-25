import csv
import gzip
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "test", "fixtures", "special-teams", "pbp_2025_safety_onside_recovery.csv.gz")
BUILDER = os.path.join(ROOT, "pipeline", "build_special_teams_2025.py")
LEAGUE = os.path.join(ROOT, "data", "special_teams", "2025-league.json")
TARGET = ("2025_08_CLE_NE", "3742")


def write_variant(path, old, new):
    with gzip.open(RAW, "rt", newline="") as src:
        reader = csv.DictReader(src)
        fields = reader.fieldnames
        rows = list(reader)
    hits = 0
    for row in rows:
        if (row["game_id"], row["play_id"]) == TARGET:
            assert old in row["desc"], row["desc"]
            row["desc"] = row["desc"].replace(old, new)
            hits += 1
    assert hits == 1, hits
    with gzip.open(path, "wt", newline="") as dst:
        writer = csv.DictWriter(dst, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


DRIVER = """
import importlib.util, sys
raw, builder = sys.argv[1], sys.argv[2]
sys.argv = [builder, raw]
spec = importlib.util.spec_from_file_location("builder", builder)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.EXPECTED_SHA256 = mod.sha256(raw)
mod.main()
"""


def run_builder(raw):
    return subprocess.run([sys.executable, "-c", DRIVER, raw, BUILDER],
                          capture_output=True, text=True, cwd=ROOT)


def main():
    with open(LEAGUE, "rb") as f:
        league_before = f.read()
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "pbp_variant.csv.gz")
        write_variant(raw, "RECOVERED by CLE-84", "RECOVERED by TEN-84")
        result = run_builder(raw)
    assert result.returncode != 0, "builder accepted a receiving-team recovery"
    assert "not recovered by CLE" in result.stderr, result.stderr
    with open(LEAGUE, "rb") as f:
        assert f.read() == league_before, "builder rewrote the league JSON after refusing"
    print("PASS builder rejects a kicking-team onside recovery recorded for the receiving team")


if __name__ == "__main__":
    main()
