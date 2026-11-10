"""Fetch and verify the pinned inputs for the team-season playbook build."""
import argparse
import hashlib
import json
import os
import tempfile
from urllib.request import Request, urlopen


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
PINNED_INPUTS = os.path.join(ROOT, "data", "playbooks", "research-2026-10-27", "inputs")
DEFAULT_MANIFEST = os.path.join(
    ROOT, "data", "playbooks", "research-2026-10-27", "build_manifest.json",
)
LOCAL_FILES = {
    "pbp": {
        2022: "pbp_2022.csv.gz", 2023: "pbp_2023.csv.gz", 2024: "pbp_2024.csv.gz",
        2025: "pbp_2025.csv.gz", 2026: "pbp_2026_week7.csv.gz",
    },
    "participation": {year: f"pbp_participation_{year}.csv" for year in range(2022, 2026)},
    "ftn_charting": {year: f"ftn_charting_{year}.csv" for year in range(2022, 2027)},
}


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url, target, expected_hash):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".playbook-source-", dir=os.path.dirname(target))
    digest = hashlib.sha256()
    try:
        request = Request(url, headers={"User-Agent": "Gridiron-Physics-research-source-fetch/1.0"})
        with os.fdopen(fd, "wb") as destination, urlopen(request, timeout=60) as response:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                destination.write(block)
                digest.update(block)
        actual_hash = digest.hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(
                f"download hash mismatch for {url}: expected {expected_hash}, got {actual_hash}; "
                "the published asset may have changed"
            )
        os.replace(temporary, target)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--check-only", action="store_true", help="verify cached files without downloading")
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as source:
        manifest = json.load(source)
    source_hashes = manifest.get("source_hashes") or {}
    expected_seasons = {str(year) for year in range(2022, 2027)}
    if set(source_hashes) != expected_seasons:
        raise ValueError(f"manifest must pin all seasons 2022-2026: {args.manifest}")

    checked = 0
    for season in range(2022, 2027):
        season_sources = source_hashes[str(season)]
        for kind in ("pbp", "participation", "ftn_charting"):
            if kind == "participation" and season == 2026:
                continue
            asset = season_sources.get(kind)
            if not asset or not asset.get("url") or not asset.get("sha256"):
                raise ValueError(f"manifest missing {season} {kind} URL or SHA-256")
            target_root = PINNED_INPUTS if season == 2026 else RAW
            target = os.path.join(target_root, LOCAL_FILES[kind][season])
            expected_hash = asset["sha256"]
            if os.path.isfile(target):
                actual_hash = file_sha256(target)
                if actual_hash != expected_hash:
                    raise ValueError(
                        f"cached input hash mismatch at {target}: expected {expected_hash}, got {actual_hash}; "
                        "move the mismatched cache file aside before fetching the pinned input"
                    )
                print(f"verified {season} {kind}: {actual_hash}")
            elif args.check_only:
                raise FileNotFoundError(f"pinned input is not cached: {target}")
            else:
                download(asset["url"], target, expected_hash)
                print(f"downloaded and verified {season} {kind}: {expected_hash}")
            checked += 1
    print(f"verified {checked} pinned inputs")


if __name__ == "__main__":
    main()
