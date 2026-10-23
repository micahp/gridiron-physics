# Re-centring the tackle-hold factors: test and result (2026-10-23)

Track: legacy `world.js` / `play.js` tackle hold. Scope: research only. No merge, no recommendation to merge, and no
production change. The frozen probe (`results.json`, `REPORT.md`, `profiles-week6.json`, the probe script) is
unchanged. Its sha256 values are in `recentred-attempts/SHA256SUMS.txt` and in `DECOMPOSITION.md`.

## Question

The frozen probe's full-play carrier travel rises by about +0.03 to +0.06 yd. `DECOMPOSITION.md` attributes this to a
calibration offset: the original engine's implied hold ratio is 1, while the scaled factors average 0.87 to 0.93 over the
frozen tackles. Does re-centring the factors remove the offset, while keeping the within-seed direction?

## Engine variants

| Variant | Centres | Commit | Status |
|---|---|---|---|
| Frozen hold-scaled | neutral at rating 50 | `0db20fe` | frozen; the probe's candidate code |
| Attempt 1 | all 166 NE–CHI engine ratings: TAK 56.608, max(BTK, ELU) 53.554 | not committed | failed: offset grew |
| Attempt 2 | role populations: defenders TAK 68.818 (n=77), ball carriers max(BTK, ELU) 70.577 (n=52) | `ec18dee` | strict validation fails (see below) |

Factors are `clamp(r / centre, 0.5, 1.5)`, with missing ratings giving 1. All centres come from the NE–CHI snapshot.
That makes the test in-sample. No held-out engine rating population exists in the repo.

## Results: paired carrier travel, 200 seeds, first second after the first tackle (yd)

| Condition | Frozen 50-neutral | Attempt 1 (all players) | Attempt 2 (role) |
|---|---|---|---|
| project estimates | +0.033 | +0.054 | **+0.023** |
| Madden TKL → TAK only | +0.032 | +0.054 | **+0.022** |
| Madden BTK only | +0.055 | +0.072 | **+0.046** |
| Madden TKL → TAK and BTK | +0.054 | +0.071 | **+0.045** |

Tackle counts are unchanged in every row apart from the BTK conditions. Those lose one tackle in both engines, which is
the tackle-odds formula reacting to BTK and not the hold term. There are zero seed-level tackle flips.

Mean hold ratio over the frozen tackles, from `decomposition` in role mode: 0.923 → 0.947 (project), and 0.866 → 0.888
(BTK). The share of tackles with ratio below 1 stays at 0.904 and 0.969. Within seeds, the correlation between the
travel difference and (ratio − 1) stays negative: −0.68 (project), −0.73 (TKL-only), −0.56 (BTK), −0.60 (TKL+BTK).

## Interpretation

1. **Attempt 1 is a failed centring.** Centring on all players moves the typical defender and carrier below the
   centres, and the offset grows. The tackles in this probe are made by defenders and carried by runners, not by
   the population of all players.
2. **Attempt 2 reduces the offset by about 30%, but not to zero.** The residual is structural to the frozen pair. Every
   frozen tackle carries Henderson, with resist 76 (ELU) or 81 (BTK). That is above the carrier population mean of
   70.6. A population centre cannot remove an offset that belongs to one carrier. Removing it would require centring on
   Henderson, which is circular for this test.
3. **The direction holds within seeds.** The per-seed relation matches the two-body sweep. The full-play mean
   difference is positive because of the carrier-specific hold ratio, not because the mechanism is reversed.

## Failure ledger (kept; not hidden)

- **Attempt 2 fails `test/validate.mjs --strict` (exit 1).** The check flags players above 108% of their own top speed.
  Play 18 (E. Wilson run, DEN) has Brandon Jones at 18.45 m/s against vmax 9.53, and Emanuel Wilson at 11.15 m/s
  against 9.46. The original engine and the frozen hold-scaled commit `0db20fe` both pass. The end-spot count, 122 of
  124, is unchanged. The cause is not diagnosed here; it is likely a collision or positional correction triggered by
  the changed carrier trajectory. It must be diagnosed before any adoption.
- **`test/prototype.mjs` fails on attempt 2 and on the frozen `0db20fe`.** It requires the checked-in 200-seed
  distribution artifact to reproduce exactly. Not regenerated, so the failure stays visible.
- **Attempt 1 was not run through `validate.mjs`.**

## Reproduction

- Engine (attempt 2): `ec18dee` on `research/gridiron-tackle-physics-2026-10-23`. To rerun, check out that commit's
  `engine/` in a worktree alongside this folder's `scripts/madden27_tackle_hold_probe.mjs` and
  `profiles-week6.json`, then:

  ```sh
  node scripts/madden27_tackle_hold_probe.mjs --control-root /root/gridiron-rating-audit --seeds 200 --out /tmp/a2.json
  ```

- Decomposition: `python3 research/madden27-tackle-hold-probe/analysis/decompose_tackle_hold.py --results <file> --out-dir <dir> --factor-mode role`
  (`original50` is the default and reproduces the frozen decomposition).

## Not done, and why

- A held-out centring check needs a held-out engine rating population, which the repo lacks. The Madden archive is on
  a different scale, so it is not a substitute without a validated mapping.
- The Henderson-centred version is circular, so it was not run as a pass.
- No merge, no regenerated artifact, and no recommendation to merge.
