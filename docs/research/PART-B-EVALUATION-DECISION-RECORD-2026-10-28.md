# Part B evaluation decision record, 2026-10-28

Status: decisions adopted from the review of the historical Part B results through commit `321396c`. Historical development
only. No physics controller is promoted. No final movement acceptance is claimed. No simulator default changes. No 2026 data
is used for any purpose in this record.

## 1. Evaluation status

| cohort | status | reason |
|---|---|---|
| 2022 tracking, Weeks 1 to 5 | development | Used for calibration and development checks. Each protocol divides these weeks differently (section 2). |
| 2022 tracking, Weeks 6 to 9 | **reserved, not opened, not scored** | Reserved for a future model-level held-out test. No frozen candidate exists yet. |
| 2023 train split, Weeks 1 to 7 | **development and exploratory** (reclassified) | Scored before the later protocol freeze. See the reason below. |
| 2025 or 2026 movement | **unavailable** | No frame-level tracking on disk for these seasons. Final movement acceptance is pending. |

Why 2023 is reclassified. Hermes2 scored 2023 train Weeks 1 to 7 under its own protocol (`PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md`,
file timestamp 02:14). Its results followed at about 02:31. The protocol in this repository, `PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md`,
was frozen at commit `f58952a` (02:39). Because the cohort had already been inspected, it cannot be treated as an untouched
validation set again. The 2023 results are kept. They are not discarded, they are not presented as untouched confirmation,
and no candidate may be tuned against them and then called independent.

## 2. Two protocols, both preserved

| item | this repository (`f58952a`) | hermes2 (`PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md`, in `321396c`) |
|---|---|---|
| 2022 calibration | Weeks 1 to 3 fit one scalar; Weeks 4 to 5 check | Weeks 1 to 5 development and calibration |
| validation unit | target track, from the origin | one `(game, play, nfl_id)` with `player_to_predict = True` |
| time origin, 2023 | last input frame of the play | last input frame of the play |
| constant velocity | velocity from the one-frame difference at the origin | OLS linear fit over the last six input positions |
| constant acceleration | second difference of the last three positions, unbounded | OLS quadratic fit over the last six input positions, unbounded |
| damped constant acceleration | one scalar `k` fitted on 2022 Weeks 1 to 3, then frozen | not present |
| horizons | origin + 5 and + 10 frames; 2.0 s where available | output frames 5 and 10, aligned by output order |
| frame alignment, 2023 | assumed output frame = origin + 1 (see section 5, amendment 2) | output frame IDs are file-local; align by output order |
| metrics | mean and median by role; paired against CA | endpoint and ADE; RMSE; role, position and role-by-position; paired CA minus CV |
| bootstrap | game-clustered, 2,000 replicates, seed `20261028` | game-clustered, 2,000 replicates, seed `20261028` |
| separation and pursuit | not scored | scored for origin-selected receiver and coverage pairs |

The two constant-acceleration estimators are different, so their numbers are not comparable. Hermes2's 2022 and 2023
figures use its OLS estimators. Mine use finite differences. Both sets stay in the record, labelled by protocol.

## 3. Evaluation-integrity record for 2026 exposure

The purpose of this section is to record exposure precisely. It does not assert that the 2026 holdout is untouched, and it
does not assert that it is compromised. Both claims would need evidence that is not available here.

### 3a. This agent (command history from this session)

1. **A 2026 simulator game file was read.** `web/data/game.json` in the simulator repository, a reconstruction of a 2026
   regular-season game (event 401872995, dated 2026-10-16). Correction to my earlier report: I said I had read only its
   header. The same output also showed team scores and records (including DEN's score), the drive-result counts for that
   game (25 drives), and the text of its first play. Those values were not used in any comparison. The game was excluded.
2. **Searches read 2026 files.** These searches read file contents and printed only file names:
   - over the simulator repository for `S0`, for `"drives"`, and for `"date": "2025`, which matched `web/data/game.json` and
     files under `docs/fixtures/pregame/`;
   - over the playbook repository for numeric gate patterns, which matched `data/raw/stats_player_week_2026.csv`
     and `data/raw/ftn_charting_2023.csv`;
   - over the physics repository for reserved and locked terms, which scanned fixture files.
3. **Gate 1 loaded 2026 blocks.** `pipeline/reproduce_legacy_2025.py` loaded the committed `NE-2025.json` and `CHI-2025.json`
   in full. Those files contain `pregame_2026_comparison` and `source.pbp_2026_pre_game`. The script removed both keys before
   hashing, and no 2026 values were printed.
4. **Mixed-season build files were read.** `data/playbooks/research-2026-10-27-rev3/BUILD-REPORT.md` and `build_manifest.json`
   contain 2026 rows. I printed only 2022 to 2024 table rows and key names. The tools read the full files.
5. **2026 listings.** File and folder names under `data/raw`, `bdb2026-prediction` and the 2026 research directories.

Influence on decisions: none found in the command history. No 2026 outcome value was used in any scoring, selection, fitting
or tuning. Gate 1, Gate 3 and the movement baselines use 2022 to 2025 data and 2023 train data only.

### 3b. Hermes2 (its own report, not yet itemised)

Hermes2 reports that a mixed-season build report was opened before it recognised 2026 aggregates in it, and that a broad
search surfaced unrelated overtime excerpts. It says it cannot certify that the holdout stayed sealed for the whole session.
It also says the excluded values were not repeated. The exact list of files, fields and times is pending (section 6).

### 3c. Status

- The 2026 holdout is **not certified untouched**.
- No evidence found so far shows that any 2026 value informed a decision.
- The one-time 2026 holdout test in the plan (step 5) is **not available** until the user decides how to treat this exposure.
- No further 2026 reads are needed for Part B. None should be made.

## 4. Worktree and write rules

- Each agent works in its own worktree. Two agents must not write to the same research artifacts at the same time.
- Commits name the agent they came from. An agent does not commit another agent's uncommitted files.
- Current state: commit `321396c` was pushed under the `micahp` identity. It contains hermes2's historical reports and some
  of this agent's Part B files. That includes `pipeline/partb/movement_experiment_1.py`, which has never been run. The file
  stays on origin, but it is not a validation run and must not be executed as one. Its alignment check assumes output frame
  IDs continue from the input, which contradicts hermes2's finding. It must be corrected before any use.

## 5. Amendments to the frozen protocol

Recorded in the amendment log of `PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md`:

1. The 2023 train Weeks 1 to 7 cohort is reclassified to development and exploratory (section 1). Step 3 of that protocol is
   no longer a validation step.
2. The frame-alignment assumption for 2023 is corrected to match the 2023 field definitions: output frame IDs are file-local,
   and output frames are aligned by output order.

## 6. Handoff to hermes2

Hermes2 is asked to take the next Part B items as implementation planning only:

- Time-stamped QB observation and memory, separate from `World` ground truth.
- Player movement calibrated by role, with speed, acceleration and turning limits.
- Defensive recognition and pursuit driven by observable cues.
- Blocking and route assignments linked to live player actions.
- Deterministic tests for perception leakage, reaction delay and physical outcomes.

Deliverable: a narrow implementation proposal against the existing `gridiron-statistical-full-game` code. It should say which
changes can be tested independently on 2022 Weeks 1 to 5 and synthetic fixtures. Constraints:

- no 2026 data of any kind, and no 2022 Weeks 6 to 9;
- no 2023 evaluation, unless the user re-approves it as development data;
- no simulator default changes and no full-game runs;
- no commits to another agent's files, and a separate worktree;
- report the exact 2026 files, fields and times exposed in hermes2's own sessions (section 3b).

Code anchors in the physics repository, from the audit (`PART-B-EXISTING-MOVEMENT-AND-DECISION-CODE-AUDIT-2026-10-28.md`):

- `engine/autonomous/passing.js`: `readOptions` (line 370) and `qbDecision` (line 430) read live defender and rusher positions;
  `defenseBrain` (line 766) and `pursuerBrain` (line 631) pursue the live carrier; `offenseBrain` (line 648) blocks from live
  positions; `visible` (line 296) is defined and never called.
- `engine/world.js`: `locomote` (line 63) holds the force-limited locomotion model.
- `engine/autonomous-run.js`: `runReadDelay` (line 505) and the cue path (lines 673 to 680) are the only cue-based delay.
- `engine/tracking-eval.js`: the constant-velocity baseline uses origin velocity only.

## 7. Open items

- **Closed here:** the reclassification of 2023; the worktree rule; the written record of the 2026 exposures from this agent;
  the amendment to the protocol. The Gate 1 result (2025 content only, pass) also stands.
- **Open:** the exposure list from hermes2; the status of `movement_experiment_1.py` (not run, not to be run as written);
  Gate 3 (15 failing 2022 team-seasons under R1, 138 PBP-fallback plays, and 5 unresolved TB 2024 plays); the 2026 holdout
  status; final movement acceptance (not available).
- **Not to be claimed:** that the kinematic baselines transfer to the physics controller, or that any controller improves
  football behaviour. The 2022 cornerback 0.5 s regression under constant acceleration stays in the record.

## 8. Round 2 decisions (2026-10-28, after the review of 321396c and the handoff)

1. **Part B is secondary.** Hermes2 continues its historical movement and autonomous-player research independently. It must
   not delay the event simulator's team splits, playbook integration, or statistical QB and player decision models.
2. **The 2026 holdout is exposure-uncertain.** It is not certified untouched. Any agent that touched 2026 data must record the
   exact file, fields, timestamps and values accessed in this section. Exposed information may not be used for model
   selection, tuning, or any decision. All further 2026 access is prohibited for these research tasks.
3. **Gate 3 stays open.** The 15 failing 2022 team-seasons and the unresolved 2024 Tampa Bay plays are not waived, and no
   unrelated work waits on them. Disputed labels keep their provenance (PBP, FTN, participation, and which of them agree).
   Disputed plays are excluded from any analysis that requires verified formation agreement.
4. **Inventory and extraction code may be committed** if it reads only permitted historical data, has reproducibility tests,
   and contains no 2026 holdout values. Each agent commits only its own files, from its own worktree.

Note on item 2: the question to answer is what was exposed and whether it influenced a decision. It is not whether the
holdout is finally compromised. Those are separate questions, and the record answers the first.

### 8a. Exposure record: this agent

Exact timestamps are not recoverable from the tool history. The entries below are in session order, with the earliest first.

| # | file (path as read) | what was shown | values shown | used in a decision? |
|---|---|---|---|---|
| 1 | `web/data/game.json` in the simulator repository (2026 regular-season game, event 401872995, dated 2026-10-16) | header, team names, score and record, drive-result counts, first play text | event, date, venue, team identifiers, DEN score 17 and record 4-2, 25 drives with counts (13 punts, 3 field goals, 3 touchdowns, 2 end-of-half, 2 interceptions, 1 fumble, 1 missed field goal), 203 plays, first play "W.Lutz kicks 63 yards from DEN 35 to SEA 2", first drive "8 plays, 20 yards, 5:01" ending in a punt | No. The game was excluded from every comparison. |
| 2 | the same file, in an earlier check | a final-score line recorded in a prior-context summary | "final SEA 17 to DEN 14" | No. **Resolved 2026-10-28:** the user confirmed the final was SEA 14, DEN 17 in overtime. The prior-context entry was wrong. The DEN 17 shown in row 1 agrees with the confirmed final. Source of resolution: the user's statement, not a further read of the file. |
| 3 | simulator repository, names only (grep -l) | none printed | file names including `docs/fixtures/pregame/game-kc-sea-seed8-blocked.json`, `web/data/game.json` | No. Contents were read by grep. |
| 4 | `data/raw/stats_player_week_2026.csv` and `data/raw/ftn_charting_2023.csv`, names only (grep -l) | none printed | none | No. Contents were read by grep. |
| 5 | `data/playbooks/research-2026-10-27-rev3/BUILD-REPORT.md` and `build_manifest.json` | key names, the 2022 to 2024 shotgun table and its header, the non-reconciling 2022 to 2024 list | 2022 to 2024 rows only. The files contain 2026 rows that were not printed. | No. The file contents were read by the tools. |
| 6 | `data/playbooks/research-2026-10-28-gate1-reproduction` inputs: committed `NE-2025.json` and `CHI-2025.json` | nothing printed beyond hashes and the names of the removed keys | none printed. The files contain `pregame_2026_comparison` and `source.pbp_2026_pre_game`, which were loaded and then removed before hashing. | No. Gate 1 uses 2025 content only. |
| 7 | file and folder listings: `data/raw`, `bdb2026-prediction`, 2026 research directories | names only | none | No. |

Nothing in rows 1 to 7 was used for scoring, selection, fitting, tuning, or a stated conclusion. Row 2 is the open one, and
the record keeps it open.

### 8b. Hermes2

Hermes2 has not yet itemised its exposures. Its own report describes a mixed-season build report opened before 2026
aggregates were recognised, and a broad search that surfaced overtime excerpts. Its exact list is still required. Its
report says the excluded values were not repeated. Until the list arrives, its exposure is recorded as uncharacterised.

### 8c. Status

- Exposure record for this agent: complete to the extent the tool history allows. The row 2 conflict is resolved by the user's confirmation (SEA 14, DEN 17, overtime). The final score is now known from that statement, and it is not to be used for selection.
- Exposure record for hermes2: pending.
- 2026 holdout: exposure-uncertain. Not certified untouched.
- No 2026 access is authorised for any research task. No exposed value is used for selection.
