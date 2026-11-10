# Gate 1: legacy 2025 reproduction (NE, CHI), 2026-10-28

Status: reproduced for the 2025 content. The 2026 pre-game block is not reproduced, by design, to keep the 2026 holdout
sealed. Historical development only; not a final acceptance.

## What was run

`pipeline/reproduce_legacy_2025.py` rebuilds NE and CHI with `build_2025` only. It reads the 2025 play-by-play and the
2025 participation file. It serialises each result the way the legacy `main()` does (`json.dump`, indent 1, sorted keys,
trailing newline). It then compares the rebuilt file with the committed `data/playbooks/{NE,CHI}-2025.json`, after
removing two 2026 keys from both sides.

The legacy `main()` is **not** called. It also writes `pregame_2026_comparison` and `source.pbp_2026_pre_game`, which come
from `build_pregame_2026`, and that reads the 2026 play-by-play. Running it would read 2026 data, which the seal forbids.

## Inputs (2025 only)

| input | path | SHA-256 |
|---|---|---|
| play-by-play 2025 | `data/raw/pbp_2025.csv.gz` | `2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978` |
| participation 2025 | `data/raw/pbp_participation_2025.csv` | `59069adfee7b0f464befba8a5e8be331e523633cc6a7ab403d37bcbcdfbe66ac` |

## Result

| team | committed file, raw SHA-256 | compared bytes (2026 keys removed) | rebuilt vs committed |
|---|---|---:|---|
| NE | `8a95fe75a4b0c9d3fce5b92649115387d9fcbe5d218a6dad828d96b28f206c19` | 6,654,008 | identical |
| CHI | `d4e589b0bf45ad319ece0d4b5b0a85eea78dc0edd25328cbaa23e6b911e81039` | 7,143,594 | identical |

Compared SHA-256 (committed minus 2026 keys, and rebuilt minus 2026 keys, equal for both teams):

- NE: `908084b4f46b502b52b573fab8ad1a9e753d70c9b0b2abc4a7bb509e7b48857c`
- CHI: `5209dd85c8bddafb3b187080b2a3cf5c8602130b26b4441ebbf5c67599bdbebf`

The raw committed files differ from the rebuilt files only by the two excluded 2026 keys. The raw hashes are not expected
to match the rebuild, because the committed files contain the 2026 blocks.

## Limits

- The 2026 keys (`pregame_2026_comparison`, `source.pbp_2026_pre_game`) are not recomputed, so they are not reproduced.
  They come from the committed file, unchanged.
- Gate 1 covers the legacy 2025 path for NE and CHI only, which is what the plan asked for.
- The rebuilt files are working copies under `data/playbooks/research-2026-10-28-gate1-reproduction/`. They are not
  committed, because they duplicate the committed files. The report JSON is committed.

## Files

- `pipeline/reproduce_legacy_2025.py`
- `data/playbooks/research-2026-10-28-gate1-reproduction/gate1_report.json`
