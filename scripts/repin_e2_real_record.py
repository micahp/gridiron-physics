#!/usr/bin/env python3
"""Byte-pin LP's current seed-1 JSON for the static Gridiron record viewer."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LP_REPO = Path(os.environ.get("LP_SEQUENCE_REPO", "/root/lp-nfl-sequence-e2"))
DEFAULT_SNAPSHOT = Path("docs/fixtures/e2/lp-current-seed1.json")
DEFAULT_PIN = Path("docs/fixtures/e2/real-record-pin.json")


class RepinError(RuntimeError):
    pass


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], text=False,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise RepinError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout.decode("utf-8").strip()


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(raw)
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lp-repo", type=Path, default=DEFAULT_LP_REPO)
    parser.add_argument("--lp-commit", required=True, help="LP commit that contains the desired artifact")
    parser.add_argument("--artifact-path", required=True, help="repository-relative path to the raw LP JSON")
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--pin", type=Path, default=DEFAULT_PIN)
    args = parser.parse_args()

    repo = args.lp_repo.expanduser().resolve()
    if not (repo / ".git").exists() and not (repo / ".git").is_file():
        raise RepinError(f"LP repository is not a Git checkout: {repo}")
    artifact_path = args.artifact_path.replace("\\", "/")
    if artifact_path.startswith("/") or ".." in artifact_path.split("/") or not artifact_path:
        raise RepinError("artifact path must stay inside the LP repository")
    commit = git(repo, "rev-parse", "--verify", f"{args.lp_commit}^{{commit}}")
    raw = subprocess.run(
        ["git", "-C", str(repo), "show", f"{commit}:{artifact_path}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if raw.returncode:
        raise RepinError(
            f"artifact not found at LP {commit}:{artifact_path}: "
            f"{raw.stderr.decode('utf-8', 'replace').strip()}"
        )
    try:
        payload = json.loads(raw.stdout)
    except json.JSONDecodeError as exc:
        raise RepinError(f"LP artifact is not valid JSON: {exc}") from exc
    record = payload.get("record") if isinstance(payload, dict) else None
    if not isinstance(record, dict):
        raise RepinError("LP artifact must contain a game record object")
    if record.get("seed") != 1:
        raise RepinError(f"expected LP seed 1, got {record.get('seed')!r}")
    if record.get("valid_full_game") is not False or payload.get("valid_full_game") is not False:
        raise RepinError("refusing to change the LP record's valid_full_game=false status")
    drives = record.get("drives")
    if not isinstance(drives, list) or not drives:
        raise RepinError("LP record has no drive list")
    plays = sum(len(drive.get("plays", [])) for drive in drives)
    origin = git(repo, "remote", "get-url", "origin")
    pin = {
        "schema": "gridiron.lp-e2-real-record-pin.v1",
        "lp_repository": origin,
        "lp_commit": commit,
        "lp_artifact_path": artifact_path,
        "lp_artifact_sha256": sha256(raw.stdout),
        "local_snapshot_path": args.snapshot.as_posix(),
        "mode": record.get("mode", payload.get("mode")),
        "seed": record["seed"],
        "drive_count": len(drives),
        "play_count": plays,
        "points": record.get("points"),
        "valid_full_game": False,
    }
    pin_bytes = (json.dumps(pin, indent=2, sort_keys=True) + "\n").encode("utf-8")
    snapshot = args.snapshot if args.snapshot.is_absolute() else ROOT / args.snapshot
    pin_path = args.pin if args.pin.is_absolute() else ROOT / args.pin
    atomic_write(snapshot, raw.stdout)
    atomic_write(pin_path, pin_bytes)
    print(f"PASS: pinned LP artifact {commit}:{artifact_path}")
    print(f"Artifact SHA-256: {pin['lp_artifact_sha256']}")
    print(f"Snapshot: {snapshot.relative_to(ROOT)} ({len(raw.stdout)} bytes)")
    print(f"Record: seed={pin['seed']} drives={pin['drive_count']} plays={pin['play_count']} valid_full_game=false")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RepinError as exc:
        raise SystemExit(f"REJECT: {exc}")
