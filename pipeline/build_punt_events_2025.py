#!/usr/bin/env python3
"""Build joint, field-position-conditioned 2025 regular-season punt events.

The next series' first scrimmage snap supplies the observed final spot and
possession. nflverse PBP does not provide a structured punt landing coordinate;
gross kick distance is retained as a statistic and never treated as landing.
"""
from __future__ import annotations

import collections
import csv
import gzip
import hashlib
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "pbp_2025.csv.gz")
OUT = os.path.join(ROOT, "data", "special_teams", "2025-punt-events.json")
EXPECTED_SHA256 = "2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978"
SCRIMMAGE_TYPES = {"run", "pass", "qb_kneel", "qb_spike"}


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(value: str | None) -> float | None:
    try:
        result = float(value)  # type: ignore[arg-type]
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def outcome(row: dict[str, str]) -> str:
    if row.get("touchback") == "1":
        return "touchback"
    if row.get("punt_fair_catch") == "1":
        return "fair_catch"
    if row.get("punt_downed") == "1":
        return "downed"
    if row.get("punt_out_of_bounds") == "1":
        return "out_of_bounds"
    if row.get("punt_blocked") == "1":
        return "blocked"
    return "returned"


def next_series_snap(rows: list[dict[str, str]], index: int, punt: dict[str, str]):
    for candidate in rows[index + 1 :]:
        if candidate.get("play_type") not in SCRIMMAGE_TYPES or candidate.get("down") != "1":
            continue
        team = candidate.get("posteam")
        if team not in (punt.get("posteam"), punt.get("defteam")):
            continue
        spot = number(candidate.get("yardline_100"))
        if spot is not None and 1 <= spot <= 99:
            return candidate
    return None


def main() -> None:
    digest = sha256(RAW)
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"hash mismatch for {RAW}: {digest}")

    by_game: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
    with gzip.open(RAW, "rt", newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("season_type") == "REG":
                by_game[row["game_id"]].append(row)
    for rows in by_game.values():
        rows.sort(key=lambda row: number(row.get("play_id")) or 0)

    events = []
    unresolved = []
    for game_id, rows in sorted(by_game.items()):
        for index, row in enumerate(rows):
            if row.get("play_type") != "punt" or row.get("punt_attempt") != "1" or not row.get("kick_distance"):
                continue
            start = number(row.get("yardline_100"))
            gross = number(row.get("kick_distance"))
            ret = number(row.get("return_yards"))
            touchdown = row.get("touchdown") == "1"
            scoring_team = None
            if touchdown:
                kicking_delta = (number(row.get("posteam_score_post")) or 0) - (number(row.get("posteam_score")) or 0)
                receiving_delta = (number(row.get("defteam_score_post")) or 0) - (number(row.get("defteam_score")) or 0)
                if kicking_delta > 0 and receiving_delta == 0:
                    scoring_team = "kicking_team"
                elif receiving_delta > 0 and kicking_delta == 0:
                    scoring_team = "receiving_team"
                if scoring_team is None:
                    unresolved.append({"game_id": game_id, "play_id": row.get("play_id"),
                                       "reason": "touchdown punt has no unambiguous score-source fields"})
                    continue
                snap = None
                end = None
                possession_after = "scoring_team"
                final_spot_status = "not_applicable_touchdown"
            else:
                snap = next_series_snap(rows, index, row)
                end = number(snap.get("yardline_100")) if snap else None
                next_team = snap.get("posteam") if snap else None
                if next_team == row.get("defteam"):
                    possession_after = "receiving_team"
                elif next_team == row.get("posteam"):
                    possession_after = "kicking_team"
                else:
                    possession_after = None
                final_spot_status = "observed_next_series_first_down_snap_proxy"
            if start is None or not 1 <= start <= 99 or gross is None or ret is None or (not touchdown and end is None):
                unresolved.append({"game_id": game_id, "play_id": row.get("play_id"),
                                   "reason": "missing start, recorded kick/return value, or next-series spot"})
                continue
            if possession_after is None:
                unresolved.append({"game_id": game_id, "play_id": row.get("play_id"),
                                   "reason": "next-series possession is not one of the punt teams"})
                continue
            punt_outcome = outcome(row)
            if (punt_outcome == "blocked") != (gross == 0):
                raise SystemExit(f"blocked/zero-distance source mismatch at {game_id}:{row.get('play_id')}")
            events.append({
                "source_game_id": game_id,
                "source_play_id": row["play_id"],
                "field_position_yardline_100": int(start),
                "outcome": punt_outcome,
                "gross_distance_yards": int(gross),
                "return_yards": int(ret),
                "touchdown": touchdown,
                "scoring_team": scoring_team,
                "final_spot_yardline_100": int(end) if end is not None else None,
                "final_spot_status": final_spot_status,
                "possession_after": possession_after,
                "landing_yardline_100": None,
                "landing_status": "estimated_unresolved",
                "recovery_yardline_100": None,
                "recovery_status": "estimated_unresolved",
            })

    if unresolved:
        raise SystemExit(f"{len(unresolved)} punt rows lack a complete joint event; first={unresolved[0]}")
    if len(events) != 1933:
        raise SystemExit(f"expected 1933 2025 REG punt events, found {len(events)}")

    field_bins = {}
    for width in (1, 5, 10, 20):
        counts = collections.Counter((event["field_position_yardline_100"] - 1) // width for event in events)
        field_bins[str(width)] = [
            {"lower_yardline_100": bucket * width + 1,
             "upper_yardline_100": (bucket + 1) * width,
             "n": n}
            for bucket, n in sorted(counts.items())
        ]
    output = {
        "schema_version": "gridiron.punt-event-samples.v1",
        "season": 2025,
        "season_type": "REG",
        "source": {
            "name": "nflverse play_by_play_2025.csv.gz",
            "path": os.path.basename(RAW),
            "sha256": digest,
        },
        "n": len(events),
        "field_position_binning": {
            "levels": [
                {"width_yards": 1, "minimum_events": 5},
                {"width_yards": 5, "minimum_events": 10},
                {"width_yards": 10, "minimum_events": 25},
                {"width_yards": 20, "minimum_events": 25},
            ],
            "last_fallback": "all_resolved_regular_season_punt_events",
            "bins": field_bins,
        },
        "semantics": {
            "field_position_yardline_100": "Observed punt snap yardline_100; yards from kicking team's goal line.",
            "gross_distance_yards": "Observed nflverse kick_distance statistic; not a landing coordinate.",
            "return_yards": "Observed nflverse return_yards statistic; zero when source records zero.",
            "touchdown_and_scoring_team": "Observed touchdown flag and scoring side derived from posteam/defteam score deltas on the punt row.",
            "final_spot_yardline_100": "For non-scoring punts, next-series restart-spot proxy from the observed first-down scrimmage yardline_100, relative to the team in possession; may include enforcement before that snap and is not a structured dead-ball spot. Not applicable after a punt touchdown.",
            "landing_and_recovery": "Structured landing/recovery coordinates are absent from this source; both remain estimated_unresolved.",
            "possession_after": "Observed from the next series' offense, relative to the kicking and receiving teams.",
            "sampling": "Sample complete event rows jointly after field-position bin selection; never derive final spot from gross distance.",
        },
        "events": events,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as stream:
        json.dump(output, stream, indent=1)
        stream.write("\n")
    with open(OUT, "rb") as stream:
        output_sha = hashlib.sha256(stream.read()).hexdigest()
    print(f"wrote {OUT}: n={len(events)}, unresolved={len(unresolved)}, sha256={output_sha}")
    print(f"outcomes={dict(collections.Counter(event['outcome'] for event in events))}")
    print(f"possession_after={dict(collections.Counter(event['possession_after'] for event in events))}")
    for width, bins in field_bins.items():
        counts = [item["n"] for item in bins]
        print(f"field bins {width}yd: {len(bins)} bins, min_n={min(counts)}, max_n={max(counts)}")


if __name__ == "__main__":
    main()
