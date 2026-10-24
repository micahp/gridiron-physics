#!/usr/bin/env python3
"""Label the prior Gridiron snap superset against LP's canonical cohort.

This is a post-hoc key reconciliation only. It does not run or alter a
movement model. The 99 noncanonical plays are retained as a labeled stratum,
without a separate aggregate or benchmark claim.
"""

import argparse
import collections
import csv
import hashlib
import json
import re
from pathlib import Path


HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "observed-football-movement-review-v2-2026-10-24"
CANONICAL_COMMIT = "23dfa70b563fd418ac216ab806a73f982362d0b1"
CANONICAL_MANIFEST_SHA256 = "45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a"
RECONCILIATION_SHA256 = "6a42b93839412f14cd2e8e2a2f8e3b3058a5db8c135074e73e8c739b3261cd2e"
SUPERSET_MANIFEST_SHA256 = "5d4abe0b6584c4ce0be6dc23ade410e13a4a63a9ab8282de05383d8403fd5193"
PLAY_METADATA_SHA256 = "a103cbc3a1ddf7678cb6d77ea5f9919c4292b5d55c7876f7cad6cce3d62dca04"
EXPECTED_CANONICAL = 9_289
EXPECTED_SUPERSET = 9_388
EXPECTED_SUPPLEMENT = 99


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def play_key(row, game="gameId", play="playId"):
    return row[game].strip(), row[play].strip()


def write_csv(path, rows, fieldnames):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-manifest", type=Path, required=True)
    parser.add_argument("--reconciliation-doc", type=Path, required=True)
    parser.add_argument("--superset-manifest", type=Path, required=True)
    parser.add_argument("--play-metadata", type=Path, required=True)
    args = parser.parse_args()

    if sha256(args.canonical_manifest) != CANONICAL_MANIFEST_SHA256:
        raise RuntimeError("LP canonical manifest hash changed; review before reconciliation")
    if sha256(args.reconciliation_doc) != RECONCILIATION_SHA256:
        raise RuntimeError("LP reconciliation document hash changed; review before reconciliation")
    if sha256(args.superset_manifest) != SUPERSET_MANIFEST_SHA256:
        raise RuntimeError("Gridiron superset manifest hash changed; review before reconciliation")
    if sha256(args.play_metadata) != PLAY_METADATA_SHA256:
        raise RuntimeError("Staged play metadata hash changed; review before classification")
    canonical_rows = read_csv(args.canonical_manifest)
    canonical = {
        play_key(row)
        for row in canonical_rows
        if row["eligible_input"] == "True"
        and row["scoring_0_5"] == "True"
        and row["scoring_1_0"] == "True"
    }
    if len(canonical) != EXPECTED_CANONICAL:
        raise RuntimeError(f"Expected {EXPECTED_CANONICAL} canonical plays, found {len(canonical)}")

    superset_rows = read_csv(args.superset_manifest)
    superset = {play_key(row, "game_id", "play_id"): row for row in superset_rows}
    if len(superset) != EXPECTED_SUPERSET:
        raise RuntimeError(f"Expected {EXPECTED_SUPERSET} superset plays, found {len(superset)}")
    if not canonical <= set(superset):
        raise RuntimeError("LP canonical keys are missing from the Gridiron superset")
    supplement_keys = set(superset) - canonical
    if len(supplement_keys) != EXPECTED_SUPPLEMENT:
        raise RuntimeError(f"Expected {EXPECTED_SUPPLEMENT} supplement plays, found {len(supplement_keys)}")
    for key in supplement_keys:
        formation = superset[key]["offenseFormation"].strip().upper()
        if formation not in ("", "NA"):
            raise RuntimeError(f"Supplement play {key} is not blank-formation: {formation!r}")

    play_rows = read_csv(args.play_metadata)
    play_meta = {}
    for row in play_rows:
        key = play_key(row)
        if key in supplement_keys:
            if key in play_meta:
                raise RuntimeError(f"Duplicate staged play metadata for supplement {key}")
            play_meta[key] = row
    if set(play_meta) != supplement_keys:
        raise RuntimeError("Staged play metadata does not cover every supplement key exactly once")

    supplement_classes = {}
    for key, row in play_meta.items():
        if row.get("qbKneel") == "1":
            supplement_classes[key] = "qb_kneel"
        elif re.search(r"\bspiked the ball\b", row.get("playDescription", ""), flags=re.IGNORECASE):
            supplement_classes[key] = "qb_spike"
        else:
            raise RuntimeError(f"Unclassified blank-formation supplement {key}: {row.get('playDescription')!r}")
    class_counts = collections.Counter(supplement_classes.values())
    if class_counts != {"qb_kneel": 92, "qb_spike": 7}:
        raise RuntimeError(f"Unexpected supplement play classes: {dict(class_counts)}")

    per_play_path = OUT / "snap-anchored-per-play.csv"
    original_per_play_sha256 = sha256(per_play_path)
    scored_rows = read_csv(per_play_path)
    if not scored_rows or "cohortStratum" in scored_rows[0]:
        raise RuntimeError("Per-play metrics are missing or were already cohort-labeled")
    row_keys = {play_key(row) for row in scored_rows}
    if row_keys != set(superset):
        raise RuntimeError("Per-play metric keys do not exactly match the Gridiron superset")
    by_play_horizon = collections.Counter((play_key(row), row["horizonSeconds"]) for row in scored_rows)
    if len(scored_rows) != EXPECTED_SUPERSET * 2 or any(n != 1 for n in by_play_horizon.values()):
        raise RuntimeError("Expected one row per superset play at each of the two horizons")

    for row in scored_rows:
        key = play_key(row)
        row["cohortStratum"] = (
            "lp_canonical_movement" if key in canonical
            else "blank_formation_qb_kneel_spike_supplement"
        )
    write_csv(per_play_path, scored_rows, list(scored_rows[0]))

    supplement_rows = []
    for key in sorted(supplement_keys):
        row = superset[key]
        supplement_rows.append({
            "week": row["week"],
            "gameId": key[0],
            "playId": key[1],
            "offenseFormation": row["offenseFormation"],
            "supplementClass": supplement_classes[key],
            "movementBenchmarkEligible": "false",
        })
    write_csv(
        OUT / "snap-anchored-supplement-stratum.csv",
        supplement_rows,
        ["week", "gameId", "playId", "offenseFormation", "supplementClass", "movementBenchmarkEligible"],
    )

    reconciliation = {
        "status": "superset_metrics_not_canonical_movement_benchmark",
        "canonicalBranch": "research/nfl-snap-anchored-benchmark-2026-10-24",
        "canonicalCommit": CANONICAL_COMMIT,
        "canonicalManifestSha256": sha256(args.canonical_manifest),
        "reconciliationDocumentSha256": RECONCILIATION_SHA256,
        "supersetManifestSha256": sha256(args.superset_manifest),
        "originalPerPlayMetricsSha256": original_per_play_sha256,
        "canonicalPlayCount": len(canonical),
        "supersetPlayCount": len(superset),
        "supplementPlayCount": len(supplement_keys),
        "supplementClassCounts": dict(sorted(class_counts.items())),
        "supplementUse": "labeled only; no separate movement aggregate or benchmark",
        "aggregateMetricsInThisSummary": "historical aggregate over all 9388 superset plays; not canonical",
        "playMetadataSha256": sha256(args.play_metadata),
        "reconciliationScriptSha256": sha256(Path(__file__)),
    }

    summary_path = OUT / "snap-anchored-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if "cohortReconciliation" in summary:
        raise RuntimeError("Summary already has cohort reconciliation metadata")
    summary["cohortReconciliation"] = reconciliation
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    provenance_path = OUT / "provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["cohortReconciliation"] = reconciliation
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    report_path = OUT / "report.md"
    report = report_path.read_text(encoding="utf-8")
    start = "## B. Snap-anchored all-player cohort"
    end = "## Outcome boundary and decision"
    if report.count(start) != 1 or report.count(end) != 1:
        raise RuntimeError("Report section boundaries differ from the reviewed v2 report")
    archive_path = OUT / "snap-anchored-superset-report-unreconciled.md"
    if archive_path.exists():
        raise RuntimeError(f"Refusing to overwrite {archive_path}")
    archive_path.write_text(
        "> Archived before per-play cohort reconciliation. This 9,388-play report is not the canonical movement benchmark. "
        "See `report.md` and the LP canonical report pinned there.\n\n" + report,
        encoding="utf-8",
    )
    i, j = report.index(start), report.index(end)
    canonical_report_url = (
        "https://github.com/micahp/gridiron-physics/blob/"
        "200ee6a6430d4f66700ad22a5a7d167733ece2f7/"
        "research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/"
        "results/snap-anchored-movement-2026-10-24/report.md"
    )
    section = [
        "## B. LP canonical movement cohort and Gridiron superset labels",
        "",
        "Per-play reconciliation against LP's preregistered manifest finds 9,289 canonical movement plays in the Gridiron 9,388-play superset, with no LP-eligible key missing. The 99 extras have blank formation: 92 are flagged as QB kneels and 7 descriptions identify a QB spike. They are not kick or special-teams plays.",
        "",
        "LP's 9,289-play cohort is the sole canonical movement benchmark. The prior 9,388-play aggregate and report are retained as historical evidence but are not a second benchmark and must not be used for a movement-model decision. Each row in `snap-anchored-per-play.csv` now has a `cohortStratum` label; the 99-play supplement is listed without an aggregate in `snap-anchored-supplement-stratum.csv`.",
        "",
        f"Use the canonical result at [the Gridiron 9,289-play report pinned at {CANONICAL_COMMIT[:8]}]({canonical_report_url}). The earlier superset report is preserved in `snap-anchored-superset-report-unreconciled.md` with a noncanonical warning. Weeks 6–9 remain reserved.",
        "",
        "The cohort decision uses snap-available metadata only. Supplement class labels are post-hoc audit labels and were not model inputs.",
        "",
    ]
    report = report[:i] + "\n".join(section) + report[j:]
    report = report.replace(
        "- `snap-anchored-per-play.csv`: per-play, per-model metrics at 0.5 and 1.0 s.",
        "- `snap-anchored-per-play.csv`: retained per-play metrics for the original superset, with canonical/supplement stratum labels.",
    ).replace(
        "- `snap-anchored-summary.json`: aggregate metrics and paired comparisons against constant velocity.",
        "- `snap-anchored-summary.json`: original superset aggregate, explicitly marked noncanonical after reconciliation.\n- `snap-anchored-supplement-stratum.csv`: the 99 blank-formation supplement keys and audit classes.",
    )
    report_path.write_text(report, encoding="utf-8")

    print(json.dumps({
        "canonicalPlays": len(canonical),
        "supersetPlays": len(superset),
        "supplementPlays": len(supplement_keys),
        "supplementClassCounts": dict(sorted(class_counts.items())),
        "perPlayRows": len(scored_rows),
        "status": reconciliation["status"],
    }, indent=2))


if __name__ == "__main__":
    main()
