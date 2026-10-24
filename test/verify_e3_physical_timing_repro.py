#!/usr/bin/env python3
"""Rebuild the E3 JSON from a clean clone and verify its SHA-256 manifest."""

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BRANCH = "research/gridiron-e3-physical-timing-2026-10-24"
ARTIFACT_REL = Path("docs/research/gridiron-e3-physical-timing-2026-10-24.json")
REPORT_REL = Path("docs/research/GRIDIRON-E3-PHYSICAL-TIMING-2026-10-24.md")


def run(args: list[str], *, cwd: Path, capture: bool = True) -> str:
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=capture, check=False)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(args)}\n{result.stderr or result.stdout}")
    return result.stdout or ""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git_value(repo: Path, *args: str) -> str:
    return run(["git", *args], cwd=repo).strip()


def main() -> None:
    if git_value(ROOT, "branch", "--show-current") != BRANCH:
        raise RuntimeError(f"run from {BRANCH}")
    if git_value(ROOT, "status", "--porcelain", "--untracked-files=all"):
        raise RuntimeError("source checkout must be clean before cloning")
    expected_commit = git_value(ROOT, "rev-parse", "HEAD")
    common_dir = Path(git_value(ROOT, "rev-parse", "--git-common-dir"))
    if not common_dir.is_absolute():
        common_dir = (ROOT / common_dir).resolve()
    source_repo = common_dir.parent

    with tempfile.TemporaryDirectory(prefix="gridiron-e3-repro-") as temporary:
        temp = Path(temporary)
        clone = temp / "clean-clone"
        run([
            "git", "clone", "--quiet", "--no-hardlinks", "--single-branch",
            "--branch", BRANCH, str(source_repo), str(clone),
        ], cwd=temp)
        if git_value(clone, "rev-parse", "HEAD") != expected_commit:
            raise RuntimeError("clean clone does not match source commit")
        if git_value(clone, "status", "--porcelain", "--untracked-files=all"):
            raise RuntimeError("new clone is not clean")

        artifact_path = clone / ARTIFACT_REL
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        manifest = artifact["input_manifest"]
        if manifest["tracking_source"]["included_weeks_only"] != [1, 2, 3, 4, 5]:
            raise RuntimeError("input manifest includes reserved weeks")
        tracking_root = Path(manifest["tracking_source"]["files"][0]["path"]).parent
        cohort_path = Path(manifest["canonical_cohort_manifest"]["path"])
        audit_path = Path(manifest["lp_clock_audit_crosswalk_and_crosscheck"]["path"])
        rebuilt = temp / "rederived-physical-timing.json"

        builder = clone / "scripts/research/build_bdb2025_physical_timing.py"
        command = [
            "python3", str(builder),
            "--tracking-root", str(tracking_root),
            "--cohort-manifest", str(cohort_path),
            "--clock-audit-csv", str(audit_path),
            "--output", str(rebuilt),
        ]
        process = subprocess.Popen(command, cwd=clone, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
        stderr = process.stderr.read() if process.stderr else ""
        if process.wait() != 0:
            raise RuntimeError(f"clean-clone builder failed:\n{stderr}")

        rebuilt_data = json.loads(rebuilt.read_text(encoding="utf-8"))
        if rebuilt_data["input_manifest"] != manifest:
            raise RuntimeError("clean-clone input SHA-256 manifest differs")
        expected_sha = sha256_file(artifact_path)
        rebuilt_sha = sha256_file(rebuilt)
        if rebuilt_sha != expected_sha:
            raise RuntimeError(f"rebuilt JSON SHA mismatch: {rebuilt_sha} != {expected_sha}")

        report = (clone / REPORT_REL).read_text(encoding="utf-8")
        reported_sha = re.search(r"Output SHA-256: `([0-9a-f]{64})`", report)
        if not reported_sha or reported_sha.group(1) != expected_sha:
            raise RuntimeError("research report output SHA does not match JSON")
        if git_value(clone, "status", "--porcelain", "--untracked-files=all"):
            raise RuntimeError("clean clone became dirty during reproduction")
        print(f"clean-clone reproducibility PASS: commit={expected_commit}")
        print(f"input SHA-256 manifest rederived; JSON SHA-256={rebuilt_sha}")


if __name__ == "__main__":
    main()
