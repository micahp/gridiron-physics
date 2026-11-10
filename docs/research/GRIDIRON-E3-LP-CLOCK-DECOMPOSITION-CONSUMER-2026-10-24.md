# Gridiron E3 LP clock-decomposition consumer

Date: 2026-10-24

This is an additive consumer definition for the physical-timing join contract. It consumes LP's published clock-decomposition artifact at commit `4e18cb9f9e5b29ae9e105cbed37f90dc915c83da` and preserves LP's observed, inferred, and unresolvable labels.

## Pinned source and schema

The LP artifact is `docs/evidence/e3/e3-clock-decomposition-2026-10-24.csv` (15,768 rows; SHA-256 `11f8dc2bf056d34cdbbf7ad5a5121ea6134aae9d9e932f920276db6f6417df46`). Its count summary is `docs/evidence/e3/e3-clock-decomposition-2026-10-24.json` (SHA-256 `c2fd272f1e29424b751a98202518c7e45657b7440d69eced0c9aa265a8fe6eba`). Producer provenance is `scripts/bdb/e3_clock_decomposition.py` (SHA-256 `2fcdb47dfc75fd8ded92087e7a183dac1a2ae9b96a76cb7f10d55ea3b295bbb4`) and the source report is `docs/evidence/e3/E3-CLOCK-DECOMPOSITION-2026-10-24.md` (SHA-256 `961cdc2b15a5fdfe47f6221b5be9756ae0d2f5e5cfc9e125a83f7cfa1b2b827e`). The checked-in consumer copies are hash-verified at load time; all pins are also in `docs/fixtures/e3/lp-clock-decomposition/MANIFEST.json`.

LP publishes the ordered CSV header and row-level `*_label` / `*_rule` columns, but this pinned artifact has no separate versioned machine-readable schema file or schema identifier. Gridiron therefore pins the exact ordered header from that producer commit and calls its own adapter contract `gridiron.lp-clock-decomposition-consumer.v1`. The manifest deliberately leaves `source_schema.schema_id` null; it does not invent an LP schema version.

The consumer requires all 44 columns in the exact pinned order. Clock fields are consumed as follows:

| LP field | Meaning in LP source | Consumer representation |
| --- | --- | --- |
| `in_play_s` | R3 inferred from terminal tracking time minus snap tracking time; R2u makes it unresolvable. | Numeric seconds, or null with the source label and rule. |
| `game_clock_delta_s` | R4 inferred from same-quarter PBP game-clock stamps; not physical play duration. | Numeric seconds, or null with the source label and rule. |
| `residual_s` | R5 inferred as game-clock delta minus in-play duration. | Numeric seconds, or null with the source label and rule. |
| `real_snap_to_next_snap_s` | R6 inferred from tracking snap timestamps. | Numeric seconds, or null with the source label and rule. |
| `timeouts_remaining` | R10u; no per-play remaining count in either source. | Null on all 15,768 LP rows. |
| `penalty_clock_stop` | R11u; a penalty flag does not supply clock-stop mechanics. | Null on all 15,768 LP rows. |
| `two_minute_warning_event` | R12u; the warning event is not identifiable in the PBP source. | Null on all 15,768 LP rows. |
| `stoppage_context` | R9 source classification from available flags and PBP; may itself be unresolvable when its source flag is blank. | Source string or null, with its LP label and rule. |

`quarter_clock_at_snap_s` and `late_half_snap` are kept as source observations, not used to fill any other field. Source flags `flag_out_of_bounds`, `flag_timeout`, and `flag_penalty` preserve blank as null and `0`/`1` as false/true.

## Join coverage

LP's artifact covers verified 2022 plays from weeks 1–9. Gridiron's physical cohort contains weeks 1–5 and 9,289 records. The consumer checks the complete LP artifact and joins only the physical cohort by exact `(lp_game_id, lp_play_id)` when `lp_join_status == "matched"`; it also requires the week to agree.

The pinned physical artifact has 9,066 records with LP keys and 223 without. Of those 9,066 keyed cohort rows, 9,066 have unique LP keys; six have no terminal timing in the physical cohort. The adapter reports matched, no-key, and missing-source-row counts separately and never joins by BDB IDs, row order, or a partial key. The checked-in loader validates the LP CSV and summary hashes, the exact header, unique source keys, summary label counts, and the physical cohort hash before it produces the join.

## Null and inference policy

If LP labels a value `unresolvable`, its value cell must be blank and the adapter exposes `value: null`, retaining LP's label and rule. A nonblank cell marked unresolvable is rejected. A source row with an inferred or observed label must contain a valid value. Missing join keys or source rows yield a non-matched join status and no clock object; they are not assigned defaults.

No value is inferred from neighboring fields. In particular, physical `elapsed_seconds` is never substituted for `in_play_s`, `game_clock_delta_s`, `residual_s`, or `real_snap_to_next_snap_s`. The LP artifact currently marks timeouts remaining, penalty clock stop, and the two-minute-warning event unresolvable for every row, so the consumer exposes these as null for every matched play. The UI displays those labels and counts.

The artifact's tracking-based in-play duration remains sampled at 10 Hz; it has no whistle timestamp and no stoppage attribution. Its game-clock delta and tracking duration answer different questions and remain separate throughout the join.

## Consumer verification

`node test/lp-clock-decomposition-adapter.mjs` passes 8/8 scenario groups. It verifies the source pins and label summary, joins 9,066 of 9,066 keyed physical records, preserves 223 no-key records and zero missing-source rows, rejects values attached to an `unresolvable` label, and rejects source hash drift. `node test/e2-game-viewer.mjs` confirms the DOM audit for the clock join, source labels, and null policy. `python3 test/test_e3_physical_timing_guard.py` passes both physical-cohort and weeks-6–9 reservation checks.

The real-browser test was run with Playwright 1.64.1 and cached Chromium 1248 using:

```sh
env PLAYWRIGHT_MODULE=/tmp/gridiron-e3-playwright/node_modules/playwright/index.mjs \
  CHROME_BIN=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
  node test/e2-game-viewer.browser.mjs
```

Output: `Real Chromium navigation: final 1ca payload navigated Drive 24 / Play 143; archived 5fc hard-rejected` and `Browser runtime errors: 0`. This is a real headless Chromium run, separate from the DOM audit.
