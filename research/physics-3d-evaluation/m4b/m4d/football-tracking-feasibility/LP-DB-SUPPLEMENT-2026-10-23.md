# LP NFL database cross-check for observed-tracking feasibility

**Date:** 2026-10-23
**Owner:** 3D M4d physical-interaction agent
**Purpose:** Supplemental result for the canonical Phase 0 note at `/root/lp-nfl-tracking/docs/research/NFL-TRACKING-FEASIBILITY-2026-10-23.md`.

This supplement records my LP database checks so the tracking owner can fold them into the canonical note. It does not repeat the Kaggle API or filename search. Kaggle listing and download status belong to the canonical note.

## Finding

The local LP development database has useful play-level outcomes and context, but the three NFL tables inspected here do not contain frame-level player trajectories or tackler identities. These tables cannot ground a physical tackle replay on their own.

| Table | Rows | Columns relevant to play/player context | Tracking fields |
| --- | ---: | --- | --- |
| `nfl_pbp` | 753,668 | game/play, season/week, teams, down/distance, yardline, play type, yards gained, drive/series and outcome fields, `rusher_player_id`, `receiver_player_id` | No x/y coordinates, frame/time, speed, acceleration, orientation, direction, or tackler ID |
| `nfl_hist_participation` | 478,989 | game/play, season, offense/defense personnel and counts, formation, pressure, coverage, time to throw | None |
| `nfl_hist_ftn_charting` | 185,215 | game/play, season/week, play/charting flags, blitz/pass-rush counts | None |

These are the three tables I independently queried. The canonical Phase 0 note records a broader NFL-table scan and local filename search; this supplement does not extend or replace those checks.

## Reproduction

Run from `/root/legendarypicks`:

```sh
python3 - <<'PY'
import sqlite3

path = "backend/data/picks.dev.db"
db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
for table in ("nfl_pbp", "nfl_hist_participation", "nfl_hist_ftn_charting"):
    count = db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
    columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
    print(table, count, columns)
db.close()
PY
sha256sum backend/data/picks.dev.db
```

The query is read-only. It printed the row counts and complete column lists used for the table above.

## Provenance and limits

- Database path: `/root/legendarypicks/backend/data/picks.dev.db`
- Database size at inspection: 3,227,590,656 bytes
- SHA-256 at inspection: `54998d153e9d67a17821f8a5adfbf69b73adc7a9f138d7f1bb49b3ef5e288aa9`
- LP repository commit at inspection: `cdc32344c32dacc68525d5f83998b940d6dec13a`; that worktree had unrelated uncommitted files.
- This report is based on database schema and row-count inspection only. It does not claim that NFL tracking was downloaded, that a tracking source is accessible, or that an observed tackle has been replayed.
- In my earlier source review, the NFL Big Data Bowl 2025 Kaggle page was a candidate source listing weekly tracking files. The current token-specific listing and rules-acceptance blocker are documented by the tracking owner in the canonical Phase 0 note; no files were downloaded in this work.
- The M4d research checkout was at commit `74db8705a61a52cf0888b2674ab46277180ada5d` when this supplement was prepared. No simulator or production code was changed.
