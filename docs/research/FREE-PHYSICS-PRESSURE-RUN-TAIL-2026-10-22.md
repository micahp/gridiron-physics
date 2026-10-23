# Free Physics Pressure and Run-Tail Probe — 2026-10-22

This is a seeded smoke diagnostic of the free-execution Patriots–Bears prototype. It measures simulator traces and emitted events; it is not an NFL pressure, sack, tackle, or run-gain calibration.

## Method

The probe runs 200 pass dropbacks and 200 runs per offense, using seeds `pressure-0..199` and `tail-run-0..199`. NE plays CHI and CHI plays NE. For each snap it reparses the frozen team roster and both playbook JSON files before building the scenario. As in the existing sampler, each play uses the first charted formation for that offense and action; `createDemoScenario` samples an observed entry by its recorded count without a fixed candidate ID. All plays use a free outcome mode, the 45-yard line, and direction +1.

For pass pressure, distances are horizontal x/y distances converted from yards to meters. The live window ends at the first throw, sack event, or whistle. A dropback is labeled “pressured” if any defender is within 2.0 m of the QB in a recorded frame during that window. Frames are sampled at 30 Hz, so this is a proximity proxy, not a continuous contact test. Minimum distance uses the same window. Time to pressure is measured from snap to the first recorded frame at or inside 2.0 m; unpressured dropbacks are censored and omitted from time quantiles. A `shed` counts only if emitted for a configured pass-rush slot before the first 2 m frame; when the QB is never within 2 m, the record separately counts sheds before the live window ends.

For runs, a long run means a simulated gain of at least 10 yards. A tackle attempt is counted when the run emits `wrapped` or `broken_tackle`, after the engine’s close/alignment/closing-contact gates. The “longest uninterrupted stretch” is the longest elapsed-time interval between handoff, these tackle-attempt events, and terminal play time. Defender proximity is measured at that interval’s endpoint using the latest recorded frame at or before it. “Never closed” means no defender came within 3.0 m in any recorded live frame between handoff and terminal time. The final-wrap time is the last `wrapped` event minus handoff time, or null if no wrap was recorded.

The complete per-dropback and per-long-run records, definitions, seeds, and aggregate tables are in [`results/pressure_run_tail_probe.json`](../../results/pressure_run_tail_probe.json).

## Pass rush and pressure

### Proximity and time-to-pressure

| Offense | Within 2 m | No 2 m approach | Time to 2 m, p10 / median / p90 (s) | Minimum defender–QB distance, p10 / median / p90 (m) | Sheds before pressure / sheds in unpressured live window | Explicit `pressure` events | Sack events |
|---|---:|---:|---:|---:|---:|---:|---:|
| NE | 142/200 (71%) | 58/200 | 0.800 / 0.800 / 0.833 | 1.918 / 1.965 / 2.150 | 0/142; 16/58 | 0 | 0 |
| CHI | 28/200 (14%) | 172/200 | 0.833 / 0.833 / 0.833 | 1.939 / 2.090 / 2.302 | 0/28; 20/172 | 0 | 1 |

“Within 2 m” is only the stated distance threshold. It does not mean the defenders touched the QB or generated the engine’s separate `pressure` event. NE had many late-window 2 m approaches but no explicit `pressure` or sack event in this sample. The CHI cell had one sack and no non-sack `pressure` event.

### Terminal outcome by 2 m proximity

Counts are shown as `outcome / group denominator`; group denominators are 142/58 for NE and 28/172 for CHI.

| Terminal outcome | NE within 2 m | NE no 2 m approach | CHI within 2 m | CHI no 2 m approach |
|---|---:|---:|---:|---:|
| Catch | 74/142 | 8/58 | 16/28 | 74/172 |
| Drop | 35/142 | 2/58 | 3/28 | 27/172 |
| Breakup | 12/142 | 15/58 | 2/28 | 24/172 |
| Other incomplete | 21/142 | 32/58 | 5/28 | 45/172 |
| Sack | 0/142 | 0/58 | 1/28 | 0/172 |
| Interception | 0/142 | 1/58 | 1/28 | 2/172 |

The sack branch is reachable: this pressure probe recorded one CHI sack, and the prior committed 200-seed outcome artifact recorded five CHI sacks. NE’s 0/200 is not evidence of a structurally unreachable branch or a zero underlying rate. For zero sacks in 200 trials, the one-sided exact 95% binomial upper bound is **1.487%**. A zero count in **99** trials is the minimum sample size whose one-sided exact 95% upper bound falls below 3% (98 trials gives 3.011%; 99 gives 2.981%). If the true rate were 3%, the probability of seeing zero in 200 is 0.226%.

An independent rating audit on branch `research/rating-audit-2026-10-22`, commit `c9d4e6f`, is a cross-check supplied with this probe, not a reproduction here. That audit reported zero sacks, pressures, interceptions, and pass breakups in its 6,000 pass plays across six probes; it also found that the sack odds read the QB’s own placeholder PBK value (48 at confidence 0.15 for all seven QBs), not the blocker’s PBK, and that interception odds read the off-position CIT placeholder (48 for the 64 CB/S/LB/EDGE players). These are reported as findings from that branch only; this probe does not alter or independently re-derive them.

## Long-run tail

| Offense | Runs ≥10 yd | With tackle-attempt event | With ≥1 `broken_tackle` (events total) | Never within 3 m | Touchdowns | No final wrap | Handoff to final wrap, n / p10 / median / p90 (s) |
|---|---:|---:|---:|---:|---:|---:|---|
| NE | 16/200 | 16/16 | 16/16 (41) | 0/16 | 4 | 3 | 13 / 3.342 / 3.917 / 6.552 |
| CHI | 12/200 | 12/12 | 12/12 (32) | 0/12 | 4 | 4 | 8 / 3.910 / 4.842 / 5.492 |

Every ≥10-yard run in these samples generated at least one `broken_tackle` event, and none was a run where defenders never came within 3 m. At the endpoint of the longest uninterrupted interval, the number of defenders within 3 m had median 1.5 (p90 4) for NE and median 1 (p90 2) for CHI; zero defenders were near at that point in 2/16 NE and 4/12 CHI runs. Longest-interval duration had median/p90 2.308/6.771 s for NE and 3.029/7.898 s for CHI.

This points to generated broken-tackle sequences as a consistent simulator event path behind the sampled tail, rather than runs where defenders never initially close. It does not establish that the break-tackle events or pursuit aftermath are physically plausible. In this engine, a broken tackle puts the defender on a 1.6 s miss window (`engine/play.js`, `tryTackle`); that cooldown may contribute to long pursuit intervals and needs a separate model review. Some long touchdowns still had defenders within 3 m at other points, and endpoint counts alone cannot identify the causal contribution of edge geometry, repeated attempts, or the pursuit cooldown.

## Reproduction and scope

From the repository root:

```sh
node scripts/probe_pressure_and_run_tail.mjs
node test/prototype.mjs
node test/validate.mjs --strict
```

This probe leaves the existing `results/free_execution_outcome_sample.json` unchanged. It does not change the play engine, world/contact solver, or outcome odds. Its 2 m/3 m proximity thresholds, first-formation mock selector, 30 Hz sampled traces, frozen pregame roster, and 200 seeds per cell are diagnostic choices, not calibrated football measures.
