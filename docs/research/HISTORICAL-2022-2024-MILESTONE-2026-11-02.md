# Historical 2022 to 2024 playbooks: milestone report, 2026-11-02

Status: historical development only. Not a final acceptance. No 2026 data was used for fitting, tuning, selection or
evaluation. No SLC default changed. Nothing was deployed. Nothing was pushed.

## Outcome

- **Rebuild (D2): done.** The v2 build passes verification in every season. The original v1 build and its
  `SHA256SUMS.txt` are unchanged.
- **R2 v2 (D1): pass for 2022, 2023 and 2024 on its own terms.** Exact agreement on the ordinary population, zero
  unexplained additions, and a complete two-way exclusion ledger.
- **Revised Gate 3: not passed.** Fifteen 2022 team-seasons still fail R1, and TB 2024 stays open on R3.
- **Retention (D3): partly done.** The build is in an immutable, root-only local archive with a tested restore. No
  off-box copy exists, because no durable target has been named.
- **C/D/E priors: ready for M3** as the simulation framing describes them (run gap, pass depth, pass location). They do
  not read the shotgun field. 2022 shotgun-dependent features are not approved.
- **Blockers:** two owner decisions on 2026 rows (below), and a durable storage target.

## 1. R2 v2 status and exclusions

Full rule and tables: `GATE-3-R2-V2-2026-11-02.md`. The original R2 is unchanged.

| Season | Gate 3 eligible | Ordinary | rev3 | Ledger rows | Unexplained |
|---|---:|---:|---:|---:|---:|
| 2022 | 33,770 | 33,519 | 33,746 | 251 | 0 |
| 2023 | 33,957 | 33,721 | 33,934 | 236 | 0 |
| 2024 | 33,470 | 33,204 | 33,450 | 266 | 0 |

Ordinary plays matched on value and source: all of them, except one named source label (2022 `2022_15_DAL_JAX` play 4021,
`participation` to `ftn`, approved under D2(a)).

## 2. Original versus rebuilt artifacts

Sources: `historical-2022-2024-v2/v1-v2-comparison.json` (machine-readable, from `pipeline/compare_historical_builds.py`) and
`historical-2022-2024-v2/classify-v1-v2.txt` (every profile change classed by meaning, from
`pipeline/classify_v1_v2_profile_changes.py`).

| Artifact | What changed | Cause | Unexplained |
|---|---|---|---:|
| Observation streams | 0 of 67,540 / 67,914 / 66,940 records | none | 0 |
| Team profiles (96) | 95 profiles: the absolute-difference field. 2 profiles (DAL 2022, JAX 2022): one shotgun source label, play 4021. LA 2022: identical | rounding (D2b); named correction (D2a) | 0 |
| Build reports | changed pp lines only: 1 (2022), 2 (2023), 6 (2024) | rounding | 0 |
| Build manifests | builder, report and output hashes; unrounded shotgun absolute difference; per-entry differences (6 in 2023, 10 in 2024). The list lengths, and so the flags, are unchanged | expected | 0 |
| C/D/E counts | identical between v1 and v2 (C 10,696 / 10,352 / 10,596; D and E 18,006 / 18,247 / 17,740) | none | 0 |

The profile classifier counted 115 field changes: 95 rounding and 20 from the named correction. Its raw field counts
(440 in 2022) are inflated by list-index shifts, so it compared by meaning, not by position.

## 3. Revised Gate 3 status

| Rule | Result |
|---|---|
| **R1** (FTN vs participation, at least 99.0%) | **Fails 15 team-seasons in 2022**: ATL, BAL, CAR, CHI, CLE, GB, JAX, LA, LAC, MIA, NYG, NYJ, SEA, SF, TB. Range 98.09% to 98.98%. No failures in 2023 or 2024. Largest change from v1: 0.099 points (2022), under 0.002 points (2023 and 2024). |
| **R2 v2** (ordinary population, exact, with ledger) | **Pass** in 2022, 2023 and 2024. |
| **R3** (every PBP-fallback or disagreement play listed) | 564 rows listed (426 / 103 / 35). Unchanged by v2: the one source change (play 4021) is not on the list. |
| **TB 2024** | R1 passes (1,018 of 1,018 ordinary plays with both values agree). R2 v2 passes. Stays open on R3: five listed plays with no found cause. |

Verdict: **revised Gate 3 is not passed.** Open items: the 15 R1 team-seasons in 2022, and TB 2024. The R1 threshold and
the rule are not changed, and no rule was rewritten to make these pass.

TB 2024 open plays (from `GATE-3-RECONCILIATION-RESULTS-2026-10-28.md`): 3477 (WAS), 3458 (DEN), 3015 (ATL) are PBP-fallback
plays; 3464 and 3990 (BAL) are PBP and participation disagreements with no FTN value.

## 4. Updated consumer test results

- SLC `test_playbook_prior_historical` (5 tests) and `test_playbook_prior_compact` (3 tests): **8 of 8 pass** against the v2
  build. The context-managed open in `playbook_prior.py` raised no ResourceWarning.
- Restored archive copy: **8 of 8 pass** (restore check, below).
- Pins: `SHA256SUMS.txt` (v2) `99513e2feab7ba8dd66573f8a0d4c07c37424eba574f689c4954a70b44ea52d5`; C/D/E artifact
  `00e3c8b22db60233db7447517409d461ea579ce13d80f3aaca2ab55243852a27`. The v1 manifest hash `0ade84bc...` is kept, and
  its unchanged state is tested.

## 5. Artifact storage and restore verification

- **Archive:** `/root/gridiron-playbook-archives/historical-2022-2024-v2-9e979e62b0206e2f5ef71cf9d023d6d0c94d828cbeb954b4718e44151243705e.tar.gz`,
  70,419,160 bytes, 114 files. Version ID is the archive's SHA-256. Directory mode 0700 (root), file mode 0400, `chattr +i`.
- **Manifest:** `ARCHIVE-MANIFEST.json` (copy in this folder). Records builder commit `b907da4`, C/D/E builder commit
  `8d57a5d`, consumer pin commit `6559cd23`, source pins for 2022 to 2024, and the storage settings.
- **Restore:** `RESTORE.md` and `pipeline/restore_check_historical.sh`. Last run: pass (114 files, every checksum, 8 consumer
  tests).
- **Not done:** an off-box copy. The owner must name a durable, access-controlled target before this counts as retention.
- **Ratio:** the 1.8 GB build directory compresses to 70 MB. Only the archive is kept; the build directory stays on disk because
  the consumer pins read it directly.

## 6. Are the 2022 to 2024 C/D/E priors ready for M3?

Yes, for run gap, pass depth and pass location, as the simulation framing describes them. Basis:

- The labels use `play_type`, `run_gap`, `pass_length` and `pass_location`. The cells use down, distance and red zone. None
  reads the shotgun field, so the R1 failures do not touch these priors.
- The observation streams are unchanged between v1 and v2, so the C/D/E counts are identical.
- The compact artifact (counts only, no play or source IDs) reproduces the full loader's table for cutoffs 2023, 2024 and 2025.

Not approved: any 2022 shotgun-dependent feature. HPV1 is not ready (section 7).

## 7. Missing mappings and tests before HPV1

Measured facts first, then what is missing.

- **Personnel vocabulary changes by season.** 2022 offense personnel strings use the skill-position form (89 distinct
  strings, for example `1 RB, 1 TE, 3 WR`). 2023 and 2024 list every position on the field (281 and 274 distinct strings,
  for example `1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR`). A season-specific mapping to groupings (such as 11 or 12 personnel) is
  missing, and each season needs its own test.
- **Cross-side tokens.** Offense personnel contains defensive tokens in 63 / 78 / 83 plays (2022 / 2023 / 2024). Defense
  personnel contains offensive tokens in 30 / 27 / 156 plays. Special-teams tokens (K, P, LS) appear in offense personnel in all
  three seasons. A rule (drop, flag or recode) is needed before mapping. None is written.
- **Participation join coverage.** The build reports show zero missing joins for all three seasons (67,540 / 67,914 / 66,940).
  Any new population needs its own coverage test.
- **Special-teams classifier.** Plays still classed `unknown` (punt: 22 / 20 / 19; field goal: 3 / 1 / 1 in 2022 to 2024). HPV1
  must keep these out of ordinary frequencies until they are classified.
- **Eligible players and identity.** Passer, receiver and rusher IDs are on each play, and defender IDs are semicolon lists in
  participation. No per-play eligible-player set is built, and no identity crosswalk test exists.
- **Game-plan and coaching taxonomy.** No profile field carries coach or game-plan data (0 matches). A taxonomy with an explicit
  UNKNOWN value is needed before any use.
- **Joint-distribution spec.** Not written. It must separate marginals from joint play distributions.
- **No-invented-joint-play tests.** Not written. A joint play must be an observed play, never a recombination of marginals.
- **Cutoff and fold tests.** The C/D/E loader already has a cutoff test. Personnel and joint features need the same test, plus
  season-held-out folds.

## 8. Decisions and blockers for the owner

1. **Holdout record row 17 (2026 rows on `origin/main`).** The rev3 CSV, `data/playbooks/research-2026-10-27-rev3/shotgun_null_plays.csv`
   (128 rows labelled 2026), is tracked on `origin/main` through commit `1c35f83`. Removing it from `main` needs your approval.
   The same commit is also reachable from the research branch, so that branch still carries the file.
2. **Holdout record row 16 (quarantined copies).** Keep or delete `/root/gridiron-playbook-builds/quarantine/` (directory 0700,
   files 0400): the rev2 CSV (139 rows labelled 2026) and the pre-rewrite bundle that contains it.
3. **Durable storage target (D3).** Name it. Until then the archive is a single local copy.
4. **Push authorization.** Local commits are listed below and are not pushed. The history rewrite of
   `research/nfl-team-season-playbooks-2026-10-27` already happened under your earlier instruction. Any further rewrite needs
   new authorization.
5. **Gate 3.** The 15 R1 team-seasons and TB 2024 remain open. Any new R1 rule must be a new versioned document, and none has
   been written.

## 9. Commits (local; not pushed)

Research branch `research/nfl-team-season-playbooks-2026-10-27`:

- `b907da4` Strip FTN qb_location whitespace and keep the shotgun absolute difference unrounded (builder, D2a and D2b)
- `afaed28` Verify the v2 shotgun hierarchy against rev3 with one named source correction
- `4a2135e` Add the R2 v2 exclusion ledger for the ordinary offense population
- `57fd192` Add a machine-readable v1 to v2 comparison of the historical builds
- `8d57a5d` Add the compact C/D/E prior builder for the historical 2022-2024 profiles
- Docs, restore check and archive manifest: committed with this report (hash in the final reply)

SLC repo `slc-v1`:

- `adbb5b22` Open playbook files in the prior loader with a context manager
- `6559cd23` Pin the historical prior tests to the v2 build and add the compact prior check
- `4c1aad05` Log the 2026-11-02 research playbook publication and inspection in the holdout record

## Scope check

- 2026 data: not read for fitting, tuning, selection or evaluation. The holdout record logs counts and key paths only.
- No SLC default changed. No deployment. No push. No force-push in this step.
