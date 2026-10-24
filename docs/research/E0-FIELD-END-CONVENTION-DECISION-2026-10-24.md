# E0 field-end decision — 2026-10-24

**Decision:** **Accept the numeric coordinates in LP seed 1042 as a clearly authored single-play display convention; reject the general formula "all offenses attack x=100 in Q1–Q2 and x=0 in Q3–Q4" as an NFL rule or E1/E2 default.** Keep the E0a validator and demo viewer accepted for retrospective record display. The **actual game-direction model must be team-specific and period-specific**, with a separate explicitly chosen field-end orientation for each half. This is a game-rules correction, **not a reason to delay E1 work**.

**Official rule:** NFL Rule 4, Section 2, Article 3 (**Change of Goals**) requires teams to change goals at the end of the **first and third periods** while preserving possession, down, relative ball position and line to gain. Second-half end choice is made separately per NFL Rule 4, Section 2, Article 2 (coin-toss privileges and the second-half choice); do not infer it from home/away or from the first-half side. See the [2026 official NFL rulebook](https://operations.nfl.com/rules-officiating/2026-nfl-rulebook) (Rule 4) and [2025 official rules text](https://operations.nfl.com/the-rules/nfl-rulebook/). The current E0 authored direction is a *presentation assumption*, not an observed historical fact.

## Verified research branch handoff

- LP [`feat/nfl-sequence-e0-2026-10-24` at `693e1767cecc36ad6e222da628cf9b4dd296740f`](https://github.com/micahp/legendarypicks/blob/693e1767cecc36ad6e222da628cf9b4dd296740f/docs/fixtures/nfl-seq-e0-play-record-seed1042.json) is pushed. It adds the `field` block with version `e0-field-end-v1` and source `authored_demo_convention`. The Q2 seed's offense is IND, `yardline_100=88`, `dir=+1`, `los=12`. Those **coordinates are arithmetically correct** for the explicitly authored direction. This particular Q2 orientation **could** occur in a real NFL game, but is not verified to have occurred in this historical fixture.
- Gridiron [`research/gridiron-e0-adapter-viewer-2026-10-24` at `15b0b34c6412b0b14a5cdf6b81720d82d5656b0a`](https://github.com/micahp/gridiron-physics/commit/15b0b34c6412b0b14a5cdf6b81720d82d5656b0a) is pushed. The adapter validates that `los` matches `dir` and `yardline_100`, preserves immutable input, and the duplicate-ID test now exercises the intended rejection. The *current implementation additionally enforces `dir=+1` for Q1–Q2 and `dir=-1` for Q3–Q4*: that must be **restricted to the current authored demo convention** and removed as a general NFL validator before E1/E2.
- **Cross-repo fixture match:** LP `693e1767` and Gridiron `15b0b34` expose the **exact same JSON file**, Git blob SHA `f46b85c7146825949c071d2f75cf1cfcb78f6870`. The Gridiron test pins SHA-256 `37478127345c80d44664c30481ea9adbf372450223d1c89822b4b27b450808f6`. Agent reports both clean byte-identical reruns and passing focused E0a check; the coordinator inspected source and hashes, **not server-executed test output**. Original LP E0 remains a **retrospective, outcome-sampled research demonstration** with no verified roster/participants or player-specific 3D replay.

## Correct direction contract for E1/E2

The conversion formulas stay exactly as agreed:

```text
+1 means offense attacks x=100:  los = 100 - yardline_100
-1 means offense attacks x=0:    los = yardline_100
```

**Source the attacking direction from the possessing team's explicit field-end assignment for that period**, never from the quarter number alone or home/away. Each team's direction is opposite the other's for a given period.

For each game, persist a **versioned, game-level field-end policy** (the actual implementation may choose equivalent names and shapes) including `source` (`authored_demo` versus actual/observed/eligible choice), period, each team's attacking direction, and the half-specific initial choice. For first-half start, **choose explicitly** (no assumption based on home/away). At the Q1→Q2 boundary **flip both directions** and mirror the physical field coordinate as necessary while preserving the offense-relative ball spot, down and distance. At halftime **re-establish directions from an explicitly provided second-half choice**; do not blindly carry or flip first-half values. At Q3→Q4 flip both directions again. Possession switches to the opponent's period assignment and flips offense-relative yardline coordinates at the **same absolute physical spot** when appropriate; it is **not** a universal `dir=quarter<=2` rule. For a play ending a drive, null/absent `field.after` may remain correct when no next ball spot exists; never guess a next play.

**Example, authored for development only (not observed):** For a seeded Q2 play, we can explicitly assign IND attack `+1` and LV `-1` in Q2. Then, if the same first-half field assignment spans Q1, IND would have attacked `-1` and LV `+1` in Q1. Both are valid examples; neither is a fact about the 2025 game. Q3 and Q4 directions require their own second-half configuration (Q4 opposite Q3).

## Specific adapter bug exposed by current source

At Gridiron `15b0b34`, `web/lp-play-record-adapter.js:validateFieldEndpoint` requires **every** Q1/Q2 endpoint to have `dir=+1` and every Q3/Q4 endpoint to have `dir=-1`. LP's `e0_single_play.py` instead flips `field.after.dir` on a **turnover on downs**, because the ball changes to the opposing offense. Consequently, a Q2 turnover-on-downs candidate emitted by LP with a valid `field.after.dir=-1` would be incorrectly rejected by Gridiron's own validation. The seed-1042 zero-yard run passes only because it keeps possession. **This is an observed cross-repository schema contradiction in code, not a demonstrated runtime test failure**, as the scenario hasn't been run on the remote checkout.

**Required focused cross-repo contract test:** Build a synthetic Q2 fourth-down failure at fixed absolute `los`, verify `before.offense_team=IND`, `before.dir=+1`, then `after.offense_team=LV`, `after.dir=-1`, and `after.yardline_100=100-before_resting_yardline_100` while physical `los` remains unchanged. Ensure the adapter accepts the record, rejects an incorrect team/period assignment or mismatched `los`, and never mutates LP's original record. Likewise add Q1→Q2 and Q3→Q4 tests where the **same** offense changes physical direction without changing offense-relative position. **No additional synthetic physics experiments.**

## Required tests and ownership

**LP sequence/game-state owner (E1 now):** Confirm this decision in the research handoff; implement a versioned **team-and-quarter** mapping in the next drive prototype. Verify the 2025 Q2 seed's authored display value remains `+1 / 12`. Add focused tests of Q1→Q2 and Q3→Q4 transitions, second-half choice, a possession change (same absolute ball spot, opposite attacking team, flipped offense-relative yardline), touchdown/drive-end null behavior, scoring clock/quarter transitions and unknown assignment failure. The Q2 seed alone does not exercise touchdown or turnover branches. **Do not pretend a 125,309-row reducer legality check tested these orientation branches.**

**Gridiron adapter/viewer owner:** Make the adapter validate `dir` from the **explicit versioned per-team/per-period assignment**, rather than encoding a universal quarter-to-`dir` convention. Confirm `los` from the provided `dir` and `yardline_100`. Continue showing `AUTHORED DEMO CONVENTION · NOT OBSERVED` on this fixture; do not transform retrospective display to as-of, infer real rosters, or claim a physical replay. Retain strict source immutability, duplicate-ID/schema/event rejection and null policy; keep v1 contract unchanged.

**Integrator:** E0a read-only display and handoff now accepted. The LP owner supplied the field block, and Gridiron's current branch has repinned and tested that fixture. **Release E1 to start on the LP research branch without waiting for E0b 3D playback**; require the team/period-specific direction change before approving E1 drive realism/legality or any E2 full-game direction claim. Keep E0b eligible participants/roster and actual 3D replay separately open. No live/prod changes, merges or new physics sweeps.

**Priority:** Deliver one legal generated drive, then a complete game. No further standalone locomotion/3D contact calibration is justified by these direction concerns.
