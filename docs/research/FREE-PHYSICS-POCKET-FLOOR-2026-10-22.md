# Free Physics Pocket-Floor Diagnosis — 2026-10-22

This is an instrumented, seeded smoke diagnostic of the free-execution Patriots–Bears prototype. It measures simulator geometry, engagement state, emitted shed events, and contact callbacks. It is not a calibrated NFL pressure, protection, or sack model.

## Population and method

The probe executes 200 pass dropbacks per offense using seeds `pressure-0..199`, with NE playing CHI and CHI playing NE. It uses the same first charted pass formation, line of scrimmage at the 45-yard line, direction `+1`, free outcome mode, frozen roster snapshot, and fresh roster/playbook parsing per snap as the preceding pressure probe. No historical sack, thrower-contact, or outcome anchor is supplied.

Each eligible front rusher (`LEDGE`, `LDT`, `RDT`, `REDGE`, plus `NB` when the pass setup's heavy rule applies) has a horizontal rusher-to-QB distance recorded on every 30 Hz playback frame through the first throw, sack, or whistle. The JSON artifact includes the per-play gap series, each rusher's per-play minimum, and the min/p10/median/p90 distributions by slot and player ID. Temporary wrappers around `World.step`, `World.engage`, `World.disengage`, and `World.collide` capture physical-step state and callbacks; they are restored after the probe. No engine source is modified.

Engagement at the closest front-rusher sample is read directly from the live `Player.engaged` reference at that same recorded frame. The blocker triangle uses horizontal center distances and the angle at the rusher between the blocker and QB vectors. Contact opportunities are measured immediately before each 120 Hz collision solve, using radii from the frozen roster: `rusher.radius + QB.radius + 0.3 m` for the engagement-reach threshold, and the sum of radii alone for actual body overlap. The latter is checked against the actual `onTouch` callback.

## Rusher gap over the live window

The complete median gap time series is in the JSON artifact. These selected bins show each slot's median gap across 200 dropbacks (200 rusher observations per slot and time bin):

| Offense | Seconds | LDT (m) | RDT (m) | LEDGE (m) | REDGE (m) |
|---|---:|---:|---:|---:|---:|
| NE | 0.00 | 3.567 | 2.823 | 5.803 | 6.026 |
| NE | 0.20 | 3.331 | 2.175 | 5.762 | 5.921 |
| NE | 0.40 | 3.438 | 2.234 | 6.184 | 5.843 |
| NE | 0.60 | 3.531 | 2.285 | 6.294 | 5.555 |
| NE | 0.80 | 3.217 | 2.040 | 6.030 | 4.915 |
| CHI | 0.00 | 3.442 | 2.862 | 5.867 | 6.150 |
| CHI | 0.20 | 3.243 | 2.316 | 5.739 | 6.043 |
| CHI | 0.40 | 3.448 | 2.402 | 6.189 | 5.983 |
| CHI | 0.60 | 3.560 | 2.467 | 6.313 | 5.730 |
| CHI | 0.80 | 3.285 | 2.172 | 6.042 | 5.129 |

| Slot | NE min / p10 / median (m) | CHI min / p10 / median (m) |
|---|---:|---:|
| LDT | 2.045 / 3.110 / 3.126 | 0.658 / 2.888 / 3.181 |
| RDT | 1.912 / 1.918 / 1.965 | 1.935 / 1.939 / 2.090 |
| LEDGE | 2.400 / 4.399 / 5.693 | 2.851 / 5.739 / 5.739 |
| REDGE | 2.329 / 2.620 / 4.783 | 2.501 / 2.990 / 5.004 |

Each slot/player minimum distribution has n=200. The opposing RDT is the median closest front rusher against both offenses. The single sub-meter minimum is the NE LDT against CHI on `pressure-12`. The unengaged closest-rusher case is `pressure-186`, the NE RDT against CHI, at 2.179 m; it does not show an unengaged rusher reaching the same near-1.9 m band.

## What sits between the closest rusher and the QB

The table selects the closest eligible front rusher for each dropback and reads its engagement state at that minimum-gap sample. In this sample, that player is also the closest defender overall in all 400 dropbacks. Triangle values summarize engaged cases; blocker-to-QB distance is the middle segment, and the angle is at the rusher.

| Offense | Closest rusher engaged | Blocker slots at that frame | Rusher–blocker gap, median (p10–p90) | Blocker–QB gap, median (p10–p90) | Rusher–QB gap, median (p10–p90) | Angle, median (p10–p90) |
|---|---:|---|---:|---:|---:|---:|
| NE | 200/200 | LG 199, LT 1 | 0.418 (0.299–0.595) m | 1.815 (1.690–1.838) m | 1.965 (1.918–2.150) m | 44.0° (16.1–71.1°) |
| CHI | 199/200 | LG 197, RT 1, LT 1 | 0.584 (0.435–0.628) m | 1.626 (1.514–1.851) m | 2.090 (1.939–2.302) m | 30.7° (4.8–39.3°) |

The CHI unengaged case is the RDT at 2.179 m. In the 199 engaged CHI cases, the blocker is typically between the rusher and QB: median blocker-to-QB distance is 1.626 m while rusher-to-blocker distance is 0.584 m. In NE, that pattern is even more consistent: the closest rusher is engaged in every play, most often with the LG, with a 0.418 m median rusher-to-blocker gap.

On `pressure-12`, the NE LDT (`00-0036916`) is engaged with the CHI LT (`00-0038932`) at the 30 Hz closest-approach frame at 1.1 s. The triangle is 0.718 m rusher-to-blocker, 1.175 m blocker-to-QB, 0.658 m rusher-to-QB, and 117.1° at the rusher. The following 120 Hz collision solve records a QB-rusher contact at 0.657 m with 2.219 m/s closing speed; that is the lone sack. It is a contact/sack while the rusher is still marked engaged at the preceding recorded frame, not a logged shed. The dominant near-QB configuration remains an engaged rusher with the blocker close to the path.

## Shed and disengagement accounting

| Offense | Dropbacks with a shed | Shed events | Median first shed time | Dropbacks with any disengagement | Model expected sheds (SD) | Observed minus expected (SD units) |
|---|---:|---:|---:|---:|---:|---:|
| NE | 16/200 (8.0%) | 17 | 0.346 s | 16 | 20.15 (4.25) | −0.98 |
| CHI | 21/200 (10.5%) | 22 | 0.258 s | 22 | 29.48 (5.00) | −1.70 |

The per-play artifact records each engaged rusher/blocker pair's rating-derived `λ`, the measured number of actual `maybeShed` calls, integrated exposure, and `P(no shed) = exp(−Σ λ·DT)`. Averaged over all dropbacks, predicted any-shed probabilities are 10.07% for NE and 14.74% for CHI. Observed counts are below those expectations, by about 1.0 and 1.7 Poisson-binomial standard deviations respectively (assuming independent play outcomes with those per-play probabilities). This is not a large shortfall suggesting the shed path is absent; the expected rate is somewhat higher than observed, and this comparison is an engine-rate diagnostic, not NFL calibration.

The pass-play call path is `case 'rush'` → `maybeShed(p)` in [`engine/play.js`](../../engine/play.js#L685). `maybeShed` uses `λ = 0.1 × exp((max(PMV, FMV) − blocker.PBK) / 15)` and tests `rand() < λ × DT` ([`engine/play.js`](../../engine/play.js#L853)). The forced `shedAt` override is assigned only inside the scripted `kind === 'sack'` setup ([`engine/play.js`](../../engine/play.js#L1159)); this free play selector sends `kind === 'pass'`, so that branch is not used. The pass engine does not emit `run_block_release`; that event is added by the free-run tracking wrapper only. This probe uses actual pass `shed` events and observes all tracked `engage`/`disengage` transitions.

## QB contact opportunities and sack draw

| Offense | Physics steps within radii + 0.3 m | Plays with a reach step | Physics steps inside body radii | Plays with body overlap | QB/front-rusher `onTouch` callbacks | Sack/pressure draws |
|---|---:|---:|---:|---:|---:|---:|
| NE | 0 | 0/200 | 0 | 0/200 | 0 | 0 |
| CHI | 19 | 1/200 | 1 | 1/200 | 1 | 1 |

The `+0.3 m` term is the engine's engagement-reach allowance, not its collision radius. Actual `World.collide` player contact requires center distance below the two `Player.r` radii summed; it invokes `onTouch` after detecting that overlap. Thus for all 200 NE dropbacks and 199 CHI dropbacks with no QB/front-rusher contact, the chain is direct: **no contact frame → `onTouch` sack draw never runs → `sackOdds` is never evaluated**. The one CHI contact callback is `pressure-12`; it evaluates the free-pass sack branch and emits the sack. The expression is `clamp(0.5 + (PMV − QB.PBK) × 0.006, 0.25, 0.78)` at [`engine/play.js`](../../engine/play.js#L1630). This probe does not re-derive or change placeholder-rating behavior; see the separate rating audit, branch `research/rating-audit-2026-10-22`, commit `c9d4e6f`.

## Counterfactual and limits

The forced-shed counterfactual was skipped. `simulatePlay(game, S, ctx)` only reads `ctx.ballY`; there is no supported per-player AI hook to set `ai.shedAt` for a free `kind === 'pass'` play. Adding one would require an engine edit, which is outside this diagnostic.

These results explain the sampled pocket floor in the current prototype: most closest rushers are still engaged with blockers at the closest recorded frame, other rush slots remain farther away, and actual QB-rusher collider contact is absent in 399/400 dropbacks. The run has only about 0.86 s median live-window duration for normal throws. The evidence points to the protection/assignment and pursuit geometry keeping the rush out of collider range in this setup, rather than a shed random draw that never executes. It does not establish realistic blocking, sack frequency, or predictive accuracy.

## Reproduction

From the repository root:

```sh
node scripts/probe_pocket_floor.mjs
node test/prototype.mjs
node test/validate.mjs --strict
```

The full per-play data and aggregate series are in [`results/pocket_floor_probe.json`](../../results/pocket_floor_probe.json). The probe leaves both existing pressure and free-execution outcome artifacts unchanged.
