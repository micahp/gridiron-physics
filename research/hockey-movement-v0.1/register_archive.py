#!/usr/bin/env python3
"""Validate and register one immutable compact NHL movement scenario archive."""
import argparse
import gzip
import hashlib
import json
import shutil
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", type=Path, required=True)
    ap.add_argument("--source-manifest", type=Path, required=True)
    ap.add_argument("--source-release-manifest", type=Path,
                    default=Path("/root/lp-research-data/stathletes-big-data-cup-2026/download-manifest.json"))
    ap.add_argument("--data-dir", type=Path, default=Path("/root/lp-research-data/stathletes-big-data-cup-2026"))
    ap.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "archive")
    args = ap.parse_args()
    with gzip.open(args.archive, "rt", encoding="utf-8") as f:
        payload = json.load(f)
    lp_commit = payload.get("legendarypicks_git_commit", "")
    gph_commit = payload.get("gridiron_physics_git_commit", "")
    if len(lp_commit) != 40 or len(gph_commit) != 40:
        raise RuntimeError("scenario archive must record both 40-character code commits")
    scenarios = payload.get("scenarios")
    if not scenarios:
        raise RuntimeError("scenario archive is empty")
    required_models = {"M0", "M1", "M2"}
    for key, scenario in scenarios.items():
        if len(scenario.get("frames", [])) != 46:
            raise RuntimeError(f"{key}: expected cutoff plus 45 generated/observed steps")
        if not scenario.get("initial_state", {}).get("players"):
            raise RuntimeError(f"{key}: initial multi-player state is missing")
        if set(scenario["frames"][0].get("models", {})) != required_models:
            raise RuntimeError(f"{key}: M0/M1/M2 frame outputs are incomplete")
        for model in required_models:
            if scenario["frames"][1].get("models", {}).get(model) is None:
                raise RuntimeError(f"{key}: generated {model} frames are missing")
    source = json.loads(args.source_manifest.read_text(encoding="utf-8"))
    release = json.loads(args.source_release_manifest.read_text(encoding="utf-8"))
    release_manifest_sha = sha256(args.source_release_manifest)
    if release_manifest_sha != source["source_release"]["manifest_sha256"]:
        raise RuntimeError("download manifest hash differs from the extraction record")
    if len(release.get("files", [])) != release.get("asset_count"):
        raise RuntimeError("download manifest asset count is inconsistent")
    for asset in release["files"]:
        path = args.data_dir / asset["name"]
        if not path.is_file() or path.stat().st_size != int(asset["bytes"]) or sha256(path) != asset["sha256"]:
            raise RuntimeError(f"raw release asset failed independent hash verification: {asset['name']}")
    expected = source.get("artifacts", {})
    if not expected or not payload.get("source_hashes"):
        raise RuntimeError("source artifact digests are required")
    for name, metadata in expected.items():
        path = Path(metadata["path"])
        if not path.is_file() or path.stat().st_size != metadata["bytes"] or sha256(path) != metadata["sha256"]:
            raise RuntimeError(f"source artifact failed hash verification: {name}")
    if payload["source_hashes"] != expected:
        raise RuntimeError("archive source hashes differ from the verified extraction manifest")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    archive_name = f"scenario_archive-{lp_commit[:12]}.json.gz"
    destination = args.output_dir / archive_name
    manifest_path = args.output_dir / "manifest.json"
    if destination.exists():
        raise FileExistsError(f"versioned scenario archive already exists: {destination}")
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"schema_version": 1, "archives": []}
    if any(row.get("archive_file") == archive_name for row in manifest["archives"]):
        raise RuntimeError("archive version already appears in the registry")
    shutil.copyfile(args.archive, destination)
    entry = {
        "archive_file": archive_name,
        "archive_sha256": sha256(destination),
        "archive_bytes": destination.stat().st_size,
        "legendarypicks_git_commit": lp_commit,
        "gridiron_movement_engine_commit": gph_commit,
        "source_manifest_sha256": source["source_release"]["manifest_sha256"],
        "source_release_asset_hashes": {item["name"]: item["sha256"] for item in release["files"]},
        "source_artifact_hashes": expected,
        "model_version": next(iter(scenarios.values()))["model_version"],
        "random_seeds": sorted({row["random_seed"] for row in scenarios.values()}),
        "scenario_ids": {key: row["scenario_id"] for key, row in scenarios.items()},
        "scenario_count": len(scenarios),
        "timebase_validated": False,
        "identity_conflicts_quarantined": True,
    }
    manifest["archives"].append(entry)
    temp = manifest_path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(manifest_path)
    print(json.dumps(entry, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
