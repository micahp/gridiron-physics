#!/usr/bin/env python3
"""Validate an immutable LP E2 seed-1 artifact, then optionally pin it in Gridiron."""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CONTRACT_SHA256 = "ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7"
EXPECTED_CONTRACT_NAME = "gridiron.lp-full-game-payload"
EXPECTED_CONTRACT_VERSION = "1.0.0"
EXPECTED_GRIDIRON_BRANCH_PREFIX = "research/gridiron-e2-game-viewer-"
SURVEY_CSV_PATH = "docs/fixtures/e2/survey-per-seed-300.csv"
SURVEY_SUMMARY_PATH = "docs/fixtures/e2/survey-300-summary.txt"
LP_FIRST_PIECE_PATH = "docs/SEQUENCE-E2-FIRST-PIECE-2026-10-24.md"


class RepinError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_contract_hash(contract_bytes: bytes) -> str:
    actual = sha256(contract_bytes)
    if actual != EXPECTED_CONTRACT_SHA256:
        raise RepinError(f"CONTRACT DRIFT expected={EXPECTED_CONTRACT_SHA256} actual={actual}")
    return actual


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def git(repo: Path, *args: str) -> bytes:
    try:
        return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace").strip()
        raise RepinError(f"git {' '.join(args)} failed: {detail}") from exc


def resolve_lp_repo(artifact: Path, configured: str | None) -> Path:
    if configured:
        repo = Path(configured).expanduser().resolve()
    else:
        repo = Path(git(artifact.parent, "rev-parse", "--show-toplevel").decode().strip())
    if not (repo / ".git").exists() and not (repo / ".git").is_file():
        raise RepinError(f"LP repository is not a Git checkout: {repo}")
    return repo


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RepinError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RepinError(f"expected a JSON object at {path}")
    return value


def configure_browser(env: dict[str, str]) -> None:
    if not env.get("PLAYWRIGHT_MODULE"):
        candidates = sorted(Path.home().glob(".npm/_npx/*/node_modules/playwright/index.mjs"))
        if candidates:
            env["PLAYWRIGHT_MODULE"] = str(candidates[-1])
    if not env.get("CHROME_BIN"):
        for name in ("chromium", "chromium-browser", "google-chrome", "chrome"):
            found = shutil.which(name)
            if found:
                env["CHROME_BIN"] = found
                break
        if not env.get("CHROME_BIN"):
            candidates = sorted(Path.home().glob(".cache/ms-playwright/chromium-*/chrome-linux64/chrome"))
            if candidates:
                env["CHROME_BIN"] = str(candidates[-1])


def commit_blob(repo: Path, commit: str, path: str) -> bytes:
    return git(repo, "show", f"{commit}:{path}")


def prepare_candidate(lp_repo: Path, commit: str, artifact_path: str,
                      raw_bytes: bytes, raw: dict, manifest: dict, current_envelope: dict,
                      gridiron_head: str) -> tuple[dict, bytes, bytes]:
    if current_envelope.get("contract") != {
        "name": EXPECTED_CONTRACT_NAME,
        "version": EXPECTED_CONTRACT_VERSION,
    }:
        raise RepinError("current Gridiron envelope does not use the pinned E2 transport contract")
    source_spec = manifest["lp_source"]
    prior_source = current_envelope["source"]
    producer_hashes = {}
    for path in source_spec["producer_file_sha256"]:
        producer_hashes[path] = sha256(commit_blob(lp_repo, commit, path))

    conversion_path = source_spec["conversion_source_script_file"]
    conversion_hash = sha256(commit_blob(lp_repo, commit, conversion_path))
    payload_hash = sha256(raw_bytes)
    source = copy.deepcopy(prior_source)
    source.update({
        "base_commit": commit,
        "branch": source_spec["branch"],
        "producer_worktree_dirty": False,
        "producer_file_sha256": producer_hashes,
        "payload_path": artifact_path,
        "payload_sha256": payload_hash,
    })
    envelope = copy.deepcopy(current_envelope)
    envelope["source"] = source
    envelope["record"] = raw["record"]
    envelope_bytes = (json.dumps(envelope, indent=2, ensure_ascii=False) + "\n").encode()

    candidate = copy.deepcopy(manifest)
    entry = candidate["fixtures"][0]
    short_sha = commit[:8]
    envelope_name = f"game-seed1-{short_sha}.json"
    raw_name = f"lp-e2-game-seed1-{short_sha}.json"
    entry.update({
        "file": envelope_name,
        "sha256": sha256(envelope_bytes),
        "upstream_source_file": raw_name,
        "upstream_source_sha256": payload_hash,
        "seed": raw["record"]["seed"],
        "drives": len(raw["record"]["drives"]),
        "plays": sum(len(drive.get("plays", [])) for drive in raw["record"]["drives"]),
        "points": raw["record"]["points"],
        "status": raw["record"]["status"],
        "valid_full_game": raw["record"]["valid_full_game"],
    })
    if isinstance(raw.get("rules_matrix_summary"), dict):
        entry["rules_matrix_summary"] = raw["rules_matrix_summary"]
    candidate_source = candidate["lp_source"]
    candidate_source.update({
        "base_commit": commit,
        "envelope_commit": gridiron_head,
        "envelope_file": f"docs/fixtures/e2/{envelope_name}",
        "envelope_sha256": sha256(envelope_bytes),
        "payload_file": artifact_path,
        "payload_sha256": payload_hash,
        "producer_file_sha256": producer_hashes,
        "conversion_source_script_commit": commit,
        "conversion_source_script_sha256": conversion_hash,
    })
    if canonical_json(current_envelope["record"]) != canonical_json(raw["record"]):
        entry.pop("v1_document_file", None)
        entry.pop("v1_document_sha256", None)
        candidate_source.pop("v1_document_file", None)
        candidate_source.pop("v1_document_sha256", None)
    return candidate, envelope_bytes, json.dumps(candidate, indent=2, ensure_ascii=False).encode() + b"\n"


def lp_survey_evidence(lp_repo: Path, commit: str, seed: int) -> tuple[list[str], list[str]]:
    """Return commit-pinned per-seed/aggregate survey lines and the LP blocker ledger."""
    survey_lines: list[str] = []
    try:
        csv_bytes = commit_blob(lp_repo, commit, SURVEY_CSV_PATH)
        summary_bytes = commit_blob(lp_repo, commit, SURVEY_SUMMARY_PATH)
        rows = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))))
        row = next((item for item in rows if item.get("seed") == str(seed)), None)
        if row is None:
            raise RepinError(f"per-seed survey has no seed={seed} row")
        seed_fields = ("seed", "status", "blocker", "complete_game", "valid_full_game", "scope_out", "matrix_fail", "v1_violations")
        seed_status = ",".join(f"{field}={row.get(field, '')}" for field in seed_fields)
        survey_lines.append(
            f"SURVEY per-seed: {SURVEY_CSV_PATH} sha256={sha256(csv_bytes)} rows={len(rows)}; {seed_status}"
        )
        summary_text = summary_bytes.decode("utf-8")
        selected = [line.strip() for line in summary_text.splitlines()
                    if line.startswith(("games=", "status {", "blocker {", "matrix FAIL rows"))]
        survey_lines.append(
            f"SURVEY aggregate: {SURVEY_SUMMARY_PATH} sha256={sha256(summary_bytes)}; "
            + "; ".join(selected)
        )
    except RepinError as exc:
        survey_lines.append(f"SURVEY evidence unavailable at LP commit {commit}: {exc}")

    blocker_lines: list[str] = []
    try:
        first_piece = commit_blob(lp_repo, commit, LP_FIRST_PIECE_PATH).decode("utf-8")
        in_table = False
        for line in first_piece.splitlines():
            if line.startswith("| # | Blocker | Status |"):
                in_table = True
                continue
            if in_table:
                if not line.startswith("|"):
                    if blocker_lines:
                        break
                    continue
                cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
                if cells and cells[0].isdigit():
                    blocker_lines.append(
                        f"LP BLOCKER {cells[0]}: {cells[1]} — {cells[2]} — commit {cells[3]} — {cells[4]}"
                    )
    except RepinError as exc:
        blocker_lines.append(f"LP blocker ledger unavailable at evidence commit: {exc}")
    return survey_lines, blocker_lines


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_bytes(data)
    os.replace(temp, path)


def run_logged(label: str, command: list[str], env: dict[str, str], log: list[str]) -> int:
    printable = "$ " + " ".join(command)
    print(printable, flush=True)
    log.extend([printable])
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = result.stdout.rstrip()
    if output:
        print(output, flush=True)
        log.extend(output.splitlines())
    if result.returncode:
        line = f"FAIL {label}: exit={result.returncode}"
        print(line, flush=True)
        log.append(line)
    return result.returncode


def write_proof(root: Path, commit: str, artifact_path: str, payload_hash: str, contract_hash: str,
                gridiron_head: str, envelope_hash: str, survey_status: str, outputs: list[str],
                blocker_lines: list[str], current_pin: str, verify_only: bool,
                verification_passed: bool, apply_succeeded: bool) -> Path:
    short = commit[:8]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    proof_path = root / "docs/research" / f"GRIDIRON-E2-REPINS-{short}-{stamp}.md"
    status_line = f"Seed 1 integration status: viewer {'PASS' if verification_passed else 'FAIL'}; per-seed LP survey row is pinned below."
    v1_line = next((line for line in outputs if line.startswith((
        "OPEN shared-v1/pregame gate:", "FAIL shared full-game v1 conformance:", "PASS shared full-game v1 conformance:",
    ))), "Shared full-game v1/pregame gate: OPEN; not reported")
    unsupported_line = next((line for line in outputs if line.startswith("LP valid_full_game=")),
                            "LP validity and unsupported rules: not reported")
    lines = [
        f"# E2 repin verification — LP {short}",
        "",
        f"Date: {datetime.now(timezone.utc).date().isoformat()}",
        "",
        "## Immutable inputs and pins",
        "",
        f"- LP evidence commit: `{commit}`.",
        f"- LP artifact path: `{artifact_path}`.",
        f"- Raw artifact SHA-256: `{payload_hash}`.",
        f"- Shared full-game v1 contract SHA-256: `{contract_hash}` (pinned value; no drift).",
        f"- Gridiron source head before this run: `{gridiron_head}`.",
        f"- Candidate envelope SHA-256: `{envelope_hash}`.",
        f"- Existing LP manifest pin before run: `{current_pin}`.",
        f"- Pin disposition: {'verification only; existing manifest and immutable fixtures unchanged' if verify_only else ('candidate pin applied after passing gates' if apply_succeeded else 'candidate pin not applied because a gate failed')}.",
        "- The adapter, viewer, and field projection operate on parsed copies; raw LP artifact bytes and outcomes remain unchanged.",
        "- Field-end mapping uses the local `team-period-field-end-v1` test fixture explicitly labelled `authored_demo_orientation_test_only`; it validates coordinate conversion and does not claim observed historical field orientation.",
        "",
        "## Results",
        "",
        f"- {status_line}",
        "- Contract drift: none. The enforced full SHA-256 is `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`.",
        "- `b915b767…` is the earlier proof document SHA prefix, not the shared contract SHA.",
        "",
        "## Exact command output",
        "",
        "```text",
        *outputs,
        "```",
        "",
        "## Outstanding LP-side blockers",
        "",
        "The scoped E2 viewer checks can pass while the shared-v1/pregame gate remains OPEN; Gridiron does not fill LP's missing fields.",
        "",
        f"- Raw-record v1 gate: `{v1_line}`. Each open field is listed in the command output above.",
        f"- {unsupported_line}",
        *[f"- {line}" for line in blocker_lines],
        *[f"- {line}" for line in survey_status.splitlines()],
        "",
        "LP's blocker ledger records the scoped fixes and their evidence. The survey still marks timeouts, the two-minute warning, penalties, onside kicks, overtime and lineups as unsupported in all 300 games; its zero matrix-fail count does not promote any record to a legal `valid_full_game`. The seed-1 v1 gaps remain the explicit failures above.",
        "These are LP-reported source statuses pinned at the evidence commit. Gridiron independently checks the immutable seed-1 payload and does not change LP event results.",
        "",
    ]
    atomic_write(proof_path, ("\n".join(lines)).encode())
    return proof_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lp-evidence-sha", required=True, help="LP evidence commit SHA (full or unambiguous prefix)")
    parser.add_argument("--artifact", required=True, help="Path to the committed LP seed-1 JSON artifact")
    parser.add_argument("--lp-repo", help="LP Git checkout; defaults to the artifact's containing checkout")
    parser.add_argument("--verify-only", action="store_true", help="Run all checks and write proof, but do not repin manifest or fixtures")
    args = parser.parse_args()

    root = ROOT
    gridiron_branch = git(root, "branch", "--show-current").decode().strip()
    if not gridiron_branch.startswith(EXPECTED_GRIDIRON_BRANCH_PREFIX):
        print(f"FAIL unsafe Gridiron branch {gridiron_branch!r}; expected {EXPECTED_GRIDIRON_BRANCH_PREFIX}*", flush=True)
        return 2
    invocation = shlex.join(["python3", "scripts/repin_e2.py", *sys.argv[1:]])
    print(f"COMMAND {invocation}", flush=True)
    branch_line = f"PASS isolated Gridiron branch={gridiron_branch}"
    print(branch_line, flush=True)
    preflight_outputs: list[str] = [f"COMMAND {invocation}", branch_line]
    try:
        contract_hash = verify_contract_hash((root / "docs/GRIDIRON-CONTRACT-v1.md").read_bytes())
    except RepinError as exc:
        print(f"FAIL {exc}", flush=True)
        return 2
    contract_line = f"PASS shared full-game v1 contract SHA-256={contract_hash}"
    print(contract_line, flush=True)
    preflight_outputs.append(contract_line)
    if contract_hash.startswith("b915b767"):
        line = "PASS requested contract prefix b915b767 matches"
    else:
        line = "NOTE b915b767 is the prior proof-document SHA prefix; contract pin is ae7b8a30…31bc21b7"
    print(line, flush=True)
    preflight_outputs.append(line)

    artifact = Path(args.artifact).expanduser().resolve()
    if not artifact.is_file():
        print(f"FAIL artifact path does not exist: {artifact}", flush=True)
        return 2
    lp_repo = resolve_lp_repo(artifact, args.lp_repo)
    resolved_commit = git(lp_repo, "rev-parse", "--verify", f"{args.lp_evidence_sha}^{{commit}}").decode().strip()
    artifact_rel = artifact.relative_to(lp_repo).as_posix()
    raw_bytes = commit_blob(lp_repo, resolved_commit, artifact_rel)
    if artifact.read_bytes() != raw_bytes:
        print(f"FAIL artifact working copy differs from immutable Git blob {resolved_commit}:{artifact_rel}", flush=True)
        return 2
    try:
        raw = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        print(f"FAIL artifact is not valid JSON: {exc}", flush=True)
        return 2
    if not isinstance(raw, dict) or not isinstance(raw.get("record"), dict) or raw["record"].get("seed") != 1:
        print("FAIL artifact is not an LP E2 seed-1 game record", flush=True)
        return 2
    payload_hash = sha256(raw_bytes)
    artifact_line = f"PASS immutable LP artifact: commit={resolved_commit} path={artifact_rel} sha256={payload_hash}"
    print(artifact_line, flush=True)
    preflight_outputs.append(artifact_line)
    survey_lines, blocker_lines = lp_survey_evidence(lp_repo, resolved_commit, raw["record"]["seed"])
    survey_status = "\n".join(survey_lines)
    for line in [*survey_lines, *blocker_lines]:
        print(line, flush=True)
    preflight_outputs.extend(survey_lines)
    preflight_outputs.extend(blocker_lines)

    manifest_path = root / "docs/fixtures/e2/MANIFEST.json"
    manifest = read_json(manifest_path)
    current_entry = manifest["fixtures"][0]
    current_envelope = read_json(root / "docs/fixtures/e2" / current_entry["file"])
    current_pin = manifest["lp_source"]["base_commit"]
    gridiron_head = git(root, "rev-parse", "HEAD").decode().strip()
    try:
        candidate_manifest, envelope_bytes, candidate_manifest_bytes = prepare_candidate(
            lp_repo, resolved_commit, artifact_rel, raw_bytes, raw, manifest, current_envelope, gridiron_head,
        )
    except (KeyError, RepinError) as exc:
        print(f"FAIL candidate provenance: {exc}", flush=True)
        return 2
    envelope_hash = sha256(envelope_bytes)

    outputs = preflight_outputs
    env = os.environ.copy()
    configure_browser(env)
    if not env.get("PLAYWRIGHT_MODULE") or not env.get("CHROME_BIN"):
        print("FAIL browser prerequisites: set PLAYWRIGHT_MODULE and CHROME_BIN", flush=True)
        return 2
    browser_line = f"PASS browser runtime: Playwright={env['PLAYWRIGHT_MODULE']} Chrome={env['CHROME_BIN']}"
    print(browser_line, flush=True)
    outputs.append(browser_line)
    env.update({
        "LP_E2_REPO": str(lp_repo),
        "LP_E2_COMMIT": resolved_commit,
        "LP_E2_PAYLOAD_PATH": artifact_rel,
    })
    failed = False
    with tempfile.TemporaryDirectory(prefix="gridiron-e2-repin-") as tmp:
        candidate_dir = Path(tmp)
        (candidate_dir / "manifest.json").write_bytes(candidate_manifest_bytes)
        (candidate_dir / "envelope.json").write_bytes(envelope_bytes)
        (candidate_dir / "raw.json").write_bytes(raw_bytes)
        env["E2_REPIN_CANDIDATE_DIR"] = str(candidate_dir)

        contract_test_code = run_logged("contract drift guard", ["python3", "test/repin_e2_contract.py"], env, outputs)
        field_code = run_logged("field-end fixtures", ["node", "test/field-end-assignment.mjs"], env, outputs)
        viewer_code = run_logged("candidate E2 viewer", ["node", "test/e2-game-viewer-repin.mjs"], env, outputs)
        failed = contract_test_code != 0 or field_code != 0 or viewer_code != 0

    apply_succeeded = False
    if not failed and not args.verify_only:
        short = resolved_commit[:8]
        fixture_dir = root / "docs/fixtures/e2"
        envelope_name = f"game-seed1-{short}.json"
        raw_name = f"lp-e2-game-seed1-{short}.json"
        envelope_target = fixture_dir / envelope_name
        raw_target = fixture_dir / raw_name
        for path, data in ((envelope_target, envelope_bytes), (raw_target, raw_bytes)):
            if path.exists() and path.read_bytes() != data:
                print(f"FAIL immutable output path already exists with different bytes: {path}", flush=True)
                failed = True
                break
        if not failed:
            atomic_write(envelope_target, envelope_bytes)
            atomic_write(raw_target, raw_bytes)
            candidate_manifest["fixtures"][0]["file"] = envelope_name
            candidate_manifest["fixtures"][0]["upstream_source_file"] = raw_name
            candidate_manifest["lp_source"]["envelope_file"] = f"docs/fixtures/e2/{envelope_name}"
            atomic_write(manifest_path, json.dumps(candidate_manifest, indent=2, ensure_ascii=False).encode() + b"\n")
            apply_succeeded = True
            print(f"PASS repin applied: manifest now targets LP {resolved_commit}; old fixture files were preserved", flush=True)
            outputs.append(f"PASS repin applied: manifest now targets LP {resolved_commit}; old fixture files were preserved")
    elif not failed:
        line = f"PASS verification-only: existing manifest pin remains {current_pin}; no fixture or manifest was changed"
        print(line, flush=True)
        outputs.append(line)

    survey_line = f"SURVEY integration: seed=1 viewer={'PASS' if not failed else 'FAIL'}; per-seed CSV and aggregate status were read from LP commit {resolved_commit}."
    print(survey_line, flush=True)
    outputs.append(survey_line)

    proof_path = write_proof(root, resolved_commit, artifact_rel, payload_hash, contract_hash,
                             gridiron_head, envelope_hash, survey_status, outputs,
                             blocker_lines, current_pin, args.verify_only, not failed, apply_succeeded)
    print(f"PASS proof written: {proof_path.relative_to(root)}", flush=True)
    if failed:
        print("FAIL repin refused: one or more required adapter/viewer tests failed; pins were not applied", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
