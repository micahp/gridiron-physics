"""Fetch pinned public nflverse files used by the Patriots-Bears prototype.

Downloads are kept in data/raw (ignored by git). Derived playbooks and the
pregame roster/rating snapshot are committed separately with source hashes.
"""
import hashlib
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
BASE = "https://github.com/nflverse/nflverse-data/releases/download"

FILES = {
    "pbp_2025.csv.gz": (f"{BASE}/pbp/play_by_play_2025.csv.gz", "2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978"),
    "pbp_2026.csv.gz": (f"{BASE}/pbp/play_by_play_2026.csv.gz", "a6ddee607edda2d530bc65fd869c0eb2f8019ea0d962b020e039dae52c840399"),
    "pbp_participation_2025.csv": (f"{BASE}/pbp_participation/pbp_participation_2025.csv", "59069adfee7b0f464befba8a5e8be331e523633cc6a7ab403d37bcbcdfbe66ac"),
    "roster_weekly_2025.csv.gz": (f"{BASE}/weekly_rosters/roster_weekly_2025.csv.gz", "f3fbe6bb1b56a0f51c4b6d5793f8bc3b46da2d54c070572144b8771912eeaaec"),
    "roster_weekly_2026.csv.gz": (f"{BASE}/weekly_rosters/roster_weekly_2026.csv.gz", "f76451b58ef60bc2baed5b45e4ccde60feae15568149532a8b2bcaad32d350c0"),
    "stats_player_reg_2025.csv.gz": (f"{BASE}/stats_player/stats_player_reg_2025.csv.gz", "fdef6a98e9de7200aaf062d20d2a35831096d7424f43bbfad5d1881e00d3a9d8"),
    "stats_player_week_2026.csv.gz": (f"{BASE}/stats_player/stats_player_week_2026.csv.gz", "ea79685be267c986d9875bf50651aca29c939bb3d1a92b2906a4afc71b8e4849"),
    # These stable nflverse crosswalk/reference releases predate the per-asset
    # digest field. Their computed hashes are recorded in the output manifest.
    "players.csv": (f"{BASE}/players/players.csv", None),
    "combine.csv": (f"{BASE}/combine/combine.csv", None),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fetch(name, url, expected):
    path = os.path.join(RAW, name)
    if os.path.isfile(path):
        actual = sha256(path)
        if expected and actual != expected:
            raise RuntimeError(f"{name}: existing file hash mismatch: {actual}")
        print(f"verified {name} sha256={actual}")
        return
    part = path + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "gridiron-physics/0.2"})
    print(f"fetching {name} <- {url}")
    with urllib.request.urlopen(req, timeout=180) as response, open(part, "wb") as out:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            out.write(block)
    actual = sha256(part)
    if expected and actual != expected:
        os.remove(part)
        raise RuntimeError(f"{name}: expected sha256 {expected}, got {actual}")
    os.replace(part, path)
    print(f"saved {name} sha256={actual}")


def main():
    os.makedirs(RAW, exist_ok=True)
    for name, (url, expected) in FILES.items():
        fetch(name, url, expected)


if __name__ == "__main__":
    main()
