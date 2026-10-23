#!/usr/bin/env python3
"""Append the frozen JC measurements to a new immutable viewer archive."""

import argparse
import gzip
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_DIR = ROOT / "research/hockey-movement-v0.1/archive"
BASE_GPH_COMMIT = "896e71e533259b39df6223183ed2b052b9ab7487"
BASE_ARCHIVE_SHA256 = "a036d9edd981905646f5efce0b0c340b3fcd7bacaef8037b18e9350395fcacce"
RESULT_SHA256 = "0bec6b2ad5430ee080b357b745c9c4f811bb80005aadfd52911e05d601b3624c"
PREREG_SHA256 = "5ec697c63d80a1afe3ee2cb95b2c7a30ea633c0a9fb7ff9483983e2bd1501773"
LP_PREREG_COMMIT = "748e0090d18ee4a6cac09aa57429d347f9d5efae"
GPH_PREREG_COMMIT = "7e55ba30f40f83c8c251abf450512d740c89a1fd"
LP_EVALUATION_COMMIT = "f147e67fa42b3f878674db6b9f018150934a37ed"
ARCHIVE_ID = "jc-2026-10-23-v1"
ARCHIVE_NAME = f"scenario_archive-{ARCHIVE_ID}.json.gz"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_base_manifest() -> dict:
    raw = subprocess.run(
        ["git", "show", f"{BASE_GPH_COMMIT}:research/hockey-movement-v0.1/archive/manifest.json"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    return json.loads(raw)


def deterministic_gzip(payload: dict) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with tempfile.SpooledTemporaryFile() as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as stream:
            stream.write(raw)
        output.seek(0)
        return output.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation-json", type=Path, required=True)
    parser.add_argument("--evaluation-commit", required=True)
    args = parser.parse_args()

    if args.evaluation_commit != LP_EVALUATION_COMMIT:
        raise SystemExit(f"Expected committed LP evaluation {LP_EVALUATION_COMMIT}, got {args.evaluation_commit}")
    result_bytes = args.evaluation_json.read_bytes()
    if sha256(result_bytes) != RESULT_SHA256:
        raise SystemExit("Frozen JC result JSON hash mismatch")
    result = json.loads(result_bytes)
    if result.get("source_hashes", {}).get("preregistration") != PREREG_SHA256:
        raise SystemExit("JC result does not reference the frozen preregistration hash")
    if result.get("preregistration", {}).get("legendarypicks_commit") != LP_PREREG_COMMIT:
        raise SystemExit("JC result LP preregistration commit mismatch")
    if result.get("preregistration", {}).get("gridiron_commit") != GPH_PREREG_COMMIT:
        raise SystemExit("JC result Gridiron preregistration commit mismatch")

    prereg_path = ROOT / "research/hockey-movement-v0.1/JOINT-COHERENCE-PREREG-2026-10-23.md"
    if sha256(prereg_path.read_bytes()) != PREREG_SHA256:
        raise SystemExit("Committed Gridiron preregistration hash mismatch")

    manifest_path = ARCHIVE_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base_manifest = read_base_manifest()
    if manifest.get("archives") != base_manifest.get("archives"):
        raise SystemExit("Archive registry differs from the frozen base; refusing to alter prior entries")
    if manifest.get("schema_version") != base_manifest.get("schema_version"):
        raise SystemExit("Archive registry schema changed from frozen base")

    source_entry = next(
        (entry for entry in manifest["archives"] if entry["archive_sha256"] == BASE_ARCHIVE_SHA256),
        None,
    )
    if source_entry is None:
        raise SystemExit("Frozen bc91 scenario archive is not registered")
    source_path = ARCHIVE_DIR / source_entry["archive_file"]
    source_bytes = source_path.read_bytes()
    if sha256(source_bytes) != BASE_ARCHIVE_SHA256:
        raise SystemExit("Frozen source archive hash mismatch")
    source = json.loads(gzip.decompress(source_bytes))
    if source.get("legendarypicks_git_commit") != "bc91d1610de5c99a0bdf396738e9d2f493c3d215":
        raise SystemExit("Frozen prediction-generating LP commit mismatch")
    if source.get("gridiron_physics_git_commit") != "252ed6d95fbb6a9ac8db5a65aed920139777432a":
        raise SystemExit("Frozen movement-controller commit mismatch")

    measurements = result.get("scenario_measurements")
    if not isinstance(measurements, list) or len(measurements) != 9000:
        raise SystemExit(f"Expected 9,000 scenario-step measurement rows, got {len(measurements or [])}")
    by_scenario = {}
    for row in measurements:
        sid = row["scenario_id"]
        step = row["horizon_ordinal_increment"]
        if sid not in source["scenarios"]:
            raise SystemExit(f"JC scenario is absent from frozen archive: {sid}")
        steps = by_scenario.setdefault(sid, {})
        if step in steps:
            raise SystemExit(f"Duplicate JC measurement for {sid} at +{step}")
        steps[step] = row
    if len(by_scenario) != 200 or any(sorted(steps) != list(range(1, 46)) for steps in by_scenario.values()):
        raise SystemExit("JC start coverage is not exactly 200 scenarios with +1…+45 records")

    payload = json.loads(json.dumps(source))
    payload["joint_coherence"] = {
        "archive_id": ARCHIVE_ID,
        "milestone": "JC",
        "evaluation_commit": LP_EVALUATION_COMMIT,
        "results_sha256": RESULT_SHA256,
        "preregistration_sha256": PREREG_SHA256,
        "preregistration_commits": {
            "legendarypicks": LP_PREREG_COMMIT,
            "gridiron_physics": GPH_PREREG_COMMIT,
        },
        "scenario_ids": sorted(by_scenario),
        "horizon_semantics": "Image Id ordinal increments, not seconds",
        "group_eligibility": "at least two common labeled skaters on each team; missing future labels are not imputed",
    }
    ineligible = 0
    for sid, steps in by_scenario.items():
        scenario = payload["scenarios"][sid]
        frames = {frame["step"]: frame for frame in scenario["frames"]}
        if sorted(frames) != list(range(46)):
            raise SystemExit(f"Unexpected recorded frame steps in {sid}")
        for step, row in steps.items():
            frame = frames[step]
            if "joint_coherence" in frame:
                raise SystemExit(f"Source frame already contains JC data: {sid} +{step}")
            frame["joint_coherence"] = {
                "horizon_ordinal_increment_not_seconds": step,
                "eligible": row["eligible"],
                "exclusion_reason": row["exclusion_reason"],
                "counts": row["counts"],
                "models": row["models"],
            }
            ineligible += not row["eligible"]

    # Validate the new payload as an additive layer over the frozen source.
    for sid, old_scenario in source["scenarios"].items():
        new_scenario = payload["scenarios"][sid]
        if sid not in by_scenario:
            if new_scenario != old_scenario:
                raise SystemExit(f"Unscored scenario changed: {sid}")
            continue
        old_frames = {f["step"]: f for f in old_scenario["frames"]}
        for new_frame in new_scenario["frames"]:
            frame_without_jc = {k: v for k, v in new_frame.items() if k != "joint_coherence"}
            if frame_without_jc != old_frames[new_frame["step"]]:
                raise SystemExit(f"Frozen trajectory changed: {sid} step {new_frame['step']}")
    if ineligible != 682:
        raise SystemExit(f"Expected 682 explicitly ineligible state/horizon rows, got {ineligible}")

    archive_bytes = deterministic_gzip(payload)
    archive_hash = sha256(archive_bytes)
    archive_path = ARCHIVE_DIR / ARCHIVE_NAME
    if archive_path.exists():
        raise SystemExit(f"Immutable archive already exists: {archive_path}")

    entry = dict(source_entry)
    entry.update({
        "archive_id": ARCHIVE_ID,
        "archive_file": ARCHIVE_NAME,
        "archive_sha256": archive_hash,
        "archive_bytes": len(archive_bytes),
        "joint_coherence_evaluation_commit": LP_EVALUATION_COMMIT,
        "joint_coherence_results_sha256": RESULT_SHA256,
        "joint_coherence_preregistration_sha256": PREREG_SHA256,
        "joint_coherence_preregistration_commits": {
            "legendarypicks": LP_PREREG_COMMIT,
            "gridiron_physics": GPH_PREREG_COMMIT,
        },
        "joint_coherence_scenario_count": len(by_scenario),
        "joint_coherence_step_rows": len(measurements),
        "joint_coherence_ineligible_state_horizons": ineligible,
    })
    updated_manifest = dict(manifest)
    updated_manifest["archives"] = list(manifest["archives"]) + [entry]
    manifest_bytes = (json.dumps(updated_manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    temporary_paths = []
    try:
        for destination, data in ((archive_path, archive_bytes), (manifest_path, manifest_bytes)):
            fd, name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
            temporary = Path(name)
            temporary_paths.append(temporary)
            with os.fdopen(fd, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
        os.replace(temporary_paths[0], archive_path)
        os.replace(temporary_paths[1], manifest_path)
    except Exception:
        if archive_path.exists() and not manifest_path.read_bytes() == manifest_bytes:
            archive_path.unlink()
        raise
    finally:
        for temporary in temporary_paths:
            temporary.unlink(missing_ok=True)

    stored = archive_path.read_bytes()
    if sha256(stored) != archive_hash:
        raise SystemExit("Written JC archive failed its SHA-256 check")
    reparsed_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if reparsed_manifest["archives"][:-1] != base_manifest["archives"]:
        raise SystemExit("Prior registry entries changed while appending JC archive")
    roundtrip = json.loads(gzip.decompress(stored))
    if roundtrip["joint_coherence"]["scenario_ids"] != sorted(by_scenario):
        raise SystemExit("Registered archive round-trip lost JC scenario coverage")
    print(json.dumps({
        "archive_id": ARCHIVE_ID,
        "archive_file": ARCHIVE_NAME,
        "archive_sha256": archive_hash,
        "archive_bytes": len(archive_bytes),
        "scenarios": len(by_scenario),
        "step_rows": len(measurements),
        "ineligible_state_horizons": ineligible,
        "old_registry_entries_preserved": len(base_manifest["archives"]),
    }, indent=2))


if __name__ == "__main__":
    main()
