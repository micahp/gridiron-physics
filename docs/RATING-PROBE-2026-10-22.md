# Rating probes: one-rating experiments on the free-play prototype (2026-10-22)

Each probe changes one rating of one player by −10, −5, +5 or +10 and holds everything else fixed: the same scenario,
the same lineups, and the same play id per seed (200 seeds). The engine is not modified. The generated tables are in
`scripts/rating_probe.mjs` output (`docs/results/rating-probe-2026-10-22.json`); the tables below are the same output
with analysis added.

## Validity of this run

- **An earlier run was discarded.** It passed the scenario pins in the wrong shape, so the builder ignored them and the
  probes ran on default players. Odunze's CTH probe, for example, changed a player who was not the target. The fixed
  probe pins each player through the builder's `{offense, defense}` override, and it fails if the probed player is not
  on the field. Each case below prints the player and slot it probed.
- **Identical seeds are paired only until the first divergent draw.** The engine seeds its random stream from the play
  id (`engine/play.js:31`). A baseline and a variant share draws until a branch consumes a different number of them.
  Where a rating changes the trajectory, the streams desynchronize. The per-seed diagnostic for THP (below) shows this.
- **Resolution.** About 20 seeds of 200 change outcome between a baseline and a ±10 variant. A difference of about 0.03
  in a rate is at the noise floor.
- **Metrics.** Throws, catches, drops, interceptions, pass breakups, sacks and pressures come from pass events; shed
  comes from `engine/world.js:199`; tackle attempts are wrapped plus broken tackles; rush yards are the change in
  position on run plays. "Outcome flip" is the share of seeds whose outcome class changed; "any change" is the share
  whose full event record changed.
- **Effective offsets.** Ratings are clipped to 25–99, so a +10 on a rating of 91 is +8 (THA) and on 93 is +6 (THP).
  The tables show the effective offset.

## Summary

| Attribute | Who (slot) | Measured effect | Matches the formula? |
|---|---|---|---|
| CTH | Rome Odunze (WR1) | Catch rate per throw 0.455 (−10), 0.515 (−5), 0.560 base, 0.585 (+5), 0.650 (+10) | Yes. The slope is about 0.0098 per point against the engine's 0.009 (`play.js:1232`). The base-to-+10 change is +0.090, which is 10 × 0.009 |
| ELU | TreVeyon Henderson (RB) | Rush yards 1.61 (−5 and −10, identical), 2.07 base, 2.73 (+5), 4.46 (+10) | Partly. Below AGI 79 the value is floored by `max(ELU, AGI)` (`play.js:496`) |
| BTK | TreVeyon Henderson (RB) | Rush yards 2.07 base, unchanged at −5 and −10, 2.38 (+5), 2.73 (+10) | Partly. Tackle odds use `max(BTK, ELU)` (`play.js:359, 368, 374`), so BTK only matters above ELU 76 |
| BSH | Austin Booker (LEDGE, run plays) | Rush yards 3.44 (−10), 3.24 (−5), 2.07 base, 1.75 (+5), 1.63 (+10) | Direction yes; magnitude is steeper below base than above |
| PBK | Morgan Moses (LT, pass plays) | Shed events 302 (−10) to 233 (+10) against 275 base; catch rate 0.630–0.665 | Direction yes (higher PBK, fewer sheds). The net catch effect is small, and outcome flips at −5 and −10 (about 25%) mostly cancel |
| THP | Drake Maye (QB) | Catch rate 0.580 (+5), 0.610 (+10), 0.650 (−5), 0.600 (−10); outcome flips 37–49% | No. Non-monotone, and the probe pairing breaks (see diagnostic) |
| THA | Drake Maye (QB) | No effect: flips 0.000 (+5, +10), 0.005 (−5, −10), i.e. one play | Not in the engine. The aim error is 2.3 cm at THA 91 and is far inside a receiver's reach |
| TAK | Devin Bush (CHI MLB) | Changed 1 play at +5, 2 at +10, 0 at −5, 1 at −10 | Not visible. A single tackler's TAK rarely decides a play here |
| PMV | Austin Booker (LEDGE, pass) | No change in sacks, pressures or catches; shed +8 at +10 only | Not measurable: no sacks or pressures occurred (see gaps) |
| CIT | Christian Gonzalez (NE LCB, placeholder 48) | No change at any offset | Not measurable: no interceptions or pass breakups occurred |

Engine-read attributes not probed here: AGI, AWR, FMV, KPW, RBK, STR.

## Findings

**CTH is the cleanest result.** Odunze's catch rate follows the formula. Every throw in this scenario is either caught
or dropped (catch + drop = 200 of 200 throws at every offset), because the ball always lands within the receiver's
reach. The probe therefore measures the catch odds directly, and the prediction of +0.09 for +10 points matches the
observed +0.090.

**The run-game ratings act through the max() structure, not through a smooth slope.** Henderson's BTK at −10 and
ELU at −5 and −10 are invisible to the outcome because the engine takes the larger of two ratings in each place they
appear. Above those maxima the response is steep: ELU +10 raises mean yards per carry from 2.07 to 4.46.

**BSH moves run yards in the expected direction.** A higher BSH reduces yards per carry on every offset tested.

**THP does not show a monotone effect, and I have not isolated why.** The outcome flips in 37–49% of seeds at ±5 and ±10,
while the net change in catch rate is small and changes sign. A per-seed diagnostic (40 seeds, +5 THP; script not committed, scratch copy at `scratchpad/diag_thp.mjs`) shows the
throw's flight time moves from 0.911 s to 0.884 s, and the ball speed from about 24.9 to 25.6 m/s. The first divergent
event is the catch-or-drop roll in four of the six seeds printed, and a contact or shed event just before it in the
others. The outcome class differs in 20 of the 40 seeds, in both directions. The probe's pairing
has broken, so these numbers do not measure THP's velocity term. A fixed-trajectory control is needed before any claim.

**THA has no effect in the engine.** The aim error is `0.25 × (100 − THA)/100` metres, a standard deviation of 2.3 cm
at THA 91 and 12.5 cm at THA 50 (`play.js:1198`). A receiver can reach any ball within his body radius plus 1.6 m
(`play.js:1218`). No THA value in the snapshot can change an outcome through this term.

**Interceptions and pressure never occurred.** In all 6,000 pass plays across the six pass probes (baseline and four offsets each),
there were 0 interceptions, 0 pass breakups, 0 sacks and 0 pressures. The defenders never came within reach of the ball, and no
defender touched the quarterback before the throw. The interception path (`play.js:1223`) and the sack path
(`play.js:1634`) therefore never ran. The CIT probe and the PMV pass-rush probe can detect nothing in these scenarios.
This also means the sack-odds defect at `play.js:1634` is unmeasured here.

## Realism of the baseline

These are properties of the prototype's baseline, not of the ratings.

- **Completions and drops.** Catch rate per throw is 0.665 (Maye's pass to WR1) and 0.560 (Odunze's receiving scenario).
  Every incompletion is a drop, because no pass falls outside the receiver's reach. Drops are a third (Maye) to 44%
  (Odunze) of throws in the baselines. That is well above the drop rates usually reported from public tracking data
  (a few percent of catchable targets; I have not checked that figure here), and the prototype has no ordinary
  incompletions.
- **Rushing.** Henderson averages 2.07 yards per carry in `run_ne_at_chi`. Public league totals have put the NFL average
  near 4.3 yards per carry in recent seasons (from memory; not checked here), so this baseline looks low. The rating probes measure response to change; they do not show the
  prototype reproduces real rushing.
- **Tackles.** Tackle attempts total 305 in 200 runs, and 35% of them are broken tackles (106 of 305).
- **Blocks and pressure.** Pass-block engagements are not recorded as events; `run_block_engage` only fires on run plays
  (`play.js:220–222`). Pressure is zero, so pass-block effects appear only through shed events.

## Null test

For each of the 19 attributes the engine does not read, I changed the rating by +10 on the WR1 target for 200 pass plays.
Every event and end state was identical in all 200 plays for all 19 attributes (0 of 200 changed for each). This
confirms the static check for pass plays with the WR1 target. It does not cover special teams or run plays, so
KAC and KPW need a separate kick-play check, and the static check is what establishes the rest.

## What would close the gaps

1. A fixed-trajectory control for THP: hold the throw timing and vary only the velocity term, so the catch roll sees
   the same draws. Until that is done, THP's probe is not interpretable.
2. A delayed-throw or pressure scenario in which defenders reach the quarterback before the release. That exercises
   the sack path, and with it the PBK-for-QB defect at `play.js:1634`, and the PMV pass-rush term.
3. A coverage scenario in which a defender is within reach at the catch point. That exercises the interception path,
   and with it CIT (defender side) and AWR.
4. Several scenarios per probe, not one. Each probe here uses a single formation and a single route.
5. Kick scenarios for KPW and KAC.

Mechanisms and the formulas behind each number are in `docs/RATING-AUDIT-2026-10-22.md`. The rating values and their
confidence are in the same file.

## Detail

The generated tables follow. Each row is one case; "value" is the rating used, with the effective offset in
brackets.


### Null test: unread attributes (+10 on the WR1 target, one play per seed)

| attribute | plays with any change |
|---|---|
| ACC | 0 / 200 |
| BCV | 0 / 200 |
| CAR | 0 / 200 |
| IBL | 0 / 200 |
| INJ | 0 / 200 |
| JMP | 0 / 200 |
| KAC | 0 / 200 |
| MCV | 0 / 200 |
| POW | 0 / 200 |
| PRC | 0 / 200 |
| PRS | 0 / 200 |
| PUR | 0 / 200 |
| RET | 0 / 200 |
| RTE | 0 / 200 |
| SPC | 0 / 200 |
| SPD | 0 / 200 |
| STA | 0 / 200 |
| TRK | 0 / 200 |
| ZCV | 0 / 200 |

### Drake Maye, throwing accuracy (THA)

Scenario pass_ne_at_chi; Drake Maye (00-0039851) in offense slot QB; attribute THA.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 91 | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | n/a | n/a |
| +5 | 96 (effective +5) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | 0.000 | 0.000 |
| +10 | 99 (effective +8) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | 0.000 | 0.000 |
| -10 | 81 (effective -10) | 200 | 132 | 68 | 0 | 0 | 0 | 0 | 273 | 207 | 131 | 76 | 0.660 | 0.633 | n/a | 0.005 | 0.005 |
| -5 | 86 (effective -5) | 200 | 132 | 68 | 0 | 0 | 0 | 0 | 273 | 207 | 131 | 76 | 0.660 | 0.633 | n/a | 0.005 | 0.005 |

### Drake Maye, throwing power (THP)

Scenario pass_ne_at_chi; Drake Maye (00-0039851) in offense slot QB; attribute THP.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 93 | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | n/a | n/a |
| +5 | 98 (effective +5) | 200 | 116 | 84 | 0 | 0 | 0 | 0 | 245 | 170 | 116 | 54 | 0.580 | 0.682 | n/a | 0.485 | 0.680 |
| +10 | 99 (effective +6) | 200 | 122 | 78 | 0 | 0 | 0 | 0 | 251 | 176 | 122 | 54 | 0.610 | 0.693 | n/a | 0.425 | 0.625 |
| -10 | 83 (effective -10) | 200 | 120 | 80 | 0 | 0 | 0 | 0 | 258 | 207 | 120 | 87 | 0.600 | 0.580 | n/a | 0.425 | 0.680 |
| -5 | 88 (effective -5) | 200 | 130 | 70 | 0 | 0 | 0 | 0 | 261 | 220 | 130 | 90 | 0.650 | 0.591 | n/a | 0.365 | 0.645 |

### Rome Odunze, catching (CTH)

Scenario catch_chi_at_ne; Rome Odunze (00-0039919) in offense slot WR1; attribute CTH.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 67 | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | n/a | n/a |
| +5 | 72 (effective +5) | 200 | 117 | 83 | 0 | 0 | 0 | 0 | 281 | 192 | 117 | 75 | 0.585 | 0.609 | n/a | 0.025 | 0.025 |
| +10 | 77 (effective +10) | 200 | 130 | 70 | 0 | 0 | 0 | 0 | 298 | 211 | 130 | 81 | 0.650 | 0.616 | n/a | 0.090 | 0.090 |
| -10 | 57 (effective -10) | 200 | 91 | 109 | 0 | 0 | 0 | 0 | 245 | 149 | 91 | 58 | 0.455 | 0.611 | n/a | 0.105 | 0.105 |
| -5 | 62 (effective -5) | 200 | 103 | 97 | 0 | 0 | 0 | 0 | 257 | 171 | 103 | 68 | 0.515 | 0.602 | n/a | 0.045 | 0.045 |

### NE left cornerback, interception odds (CIT, defender side)

Scenario catch_chi_at_ne; Christian Gonzalez (00-0039147) in defense slot LCB; attribute CIT.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 48 | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | n/a | n/a |
| +5 | 53 (effective +5) | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | 0.000 | 0.000 |
| +10 | 58 (effective +10) | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | 0.000 | 0.000 |
| -10 | 38 (effective -10) | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | 0.000 | 0.000 |
| -5 | 43 (effective -5) | 200 | 112 | 88 | 0 | 0 | 0 | 0 | 275 | 186 | 112 | 74 | 0.560 | 0.602 | n/a | 0.000 | 0.000 |

### TreVeyon Henderson, break tackle (BTK)

Scenario run_ne_at_chi; TreVeyon Henderson (00-0040734) in offense slot RB; attribute BTK.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 72 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | n/a | n/a |
| +5 | 77 (effective +5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 361 | 307 | 198 | 109 | n/a | 0.645 | 2.38 | 0.005 | 0.015 |
| +10 | 82 (effective +10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 368 | 312 | 198 | 114 | n/a | 0.635 | 2.73 | 0.005 | 0.055 |
| -10 | 62 (effective -10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | 0.000 | 0.000 |
| -5 | 67 (effective -5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | 0.000 | 0.000 |

### TreVeyon Henderson, elusiveness (ELU)

Scenario run_ne_at_chi; TreVeyon Henderson (00-0040734) in offense slot RB; attribute ELU.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 76 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | n/a | n/a |
| +5 | 81 (effective +5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 359 | 302 | 198 | 104 | n/a | 0.656 | 2.73 | 0.015 | 1.000 |
| +10 | 86 (effective +10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 430 | 344 | 194 | 150 | n/a | 0.564 | 4.46 | 0.025 | 1.000 |
| -10 | 66 (effective -10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 339 | 293 | 200 | 93 | n/a | 0.683 | 1.61 | 0.005 | 0.050 |
| -5 | 71 (effective -5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 339 | 293 | 200 | 93 | n/a | 0.683 | 1.61 | 0.005 | 0.050 |

### CHI MLB, tackling (TAK)

Scenario run_ne_at_chi; Devin Bush (00-0035525) in defense slot MLB; attribute TAK.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 83 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | n/a | n/a |
| +5 | 88 (effective +5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 342 | 303 | 200 | 103 | n/a | 0.660 | 1.75 | 0.005 | 0.005 |
| +10 | 93 (effective +10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 338 | 300 | 200 | 100 | n/a | 0.667 | 1.63 | 0.005 | 0.010 |
| -10 | 73 (effective -10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 350 | 306 | 199 | 107 | n/a | 0.650 | 2.06 | 0.000 | 0.005 |
| -5 | 78 (effective -5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | 0.000 | 0.000 |

### NE left tackle, pass blocking (PBK)

Scenario pass_ne_at_chi; Morgan Moses (00-0031330) in offense slot LT; attribute PBK.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 79 | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | n/a | n/a |
| +5 | 84 (effective +5) | 200 | 130 | 70 | 0 | 0 | 0 | 0 | 248 | 208 | 130 | 78 | 0.650 | 0.625 | n/a | 0.045 | 0.215 |
| +10 | 89 (effective +10) | 200 | 130 | 70 | 0 | 0 | 0 | 0 | 233 | 207 | 129 | 78 | 0.650 | 0.623 | n/a | 0.055 | 0.285 |
| -10 | 69 (effective -10) | 200 | 126 | 74 | 0 | 0 | 0 | 0 | 302 | 186 | 126 | 60 | 0.630 | 0.677 | n/a | 0.235 | 0.495 |
| -5 | 74 (effective -5) | 200 | 127 | 73 | 0 | 0 | 0 | 0 | 274 | 189 | 127 | 62 | 0.635 | 0.672 | n/a | 0.250 | 0.445 |

### CHI left edge, pass rush (PMV)

Scenario pass_ne_at_chi; Austin Booker (00-0039840) in defense slot LEDGE; attribute PMV.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 88 | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | n/a | n/a |
| +5 | 93 (effective +5) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | 0.000 | 0.000 |
| +10 | 98 (effective +10) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 283 | 204 | 132 | 72 | 0.665 | 0.647 | n/a | 0.020 | 0.125 |
| -10 | 78 (effective -10) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | 0.000 | 0.000 |
| -5 | 83 (effective -5) | 200 | 133 | 67 | 0 | 0 | 0 | 0 | 275 | 208 | 132 | 76 | 0.665 | 0.635 | n/a | 0.000 | 0.000 |

### CHI left edge, block-shedding (BSH) on run plays

Scenario run_ne_at_chi; Austin Booker (00-0039840) in defense slot LEDGE; attribute BSH.

| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 349 | 305 | 199 | 106 | n/a | 0.652 | 2.07 | n/a | n/a |
| +5 | 82 (effective +5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 364 | 291 | 199 | 92 | n/a | 0.684 | 1.75 | 0.010 | 0.990 |
| +10 | 87 (effective +10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 370 | 304 | 199 | 105 | n/a | 0.655 | 1.63 | 0.010 | 0.990 |
| -10 | 67 (effective -10) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 366 | 327 | 194 | 133 | n/a | 0.593 | 3.44 | 0.025 | 0.995 |
| -5 | 72 (effective -5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 367 | 312 | 196 | 116 | n/a | 0.628 | 3.24 | 0.015 | 0.995 |
