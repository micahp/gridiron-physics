# Legacy tackle hold: why full-play carrier travel rises (decomposition, 2026-10-23)

Track: legacy `world.js` / `play.js` tackle hold. Scope: research only. No production change, no merge, and no
recommendation to merge. Integrator decides, per the coordination contract.

## Frozen inputs (unchanged; hashes recorded)

| Artifact | sha256 |
|---|---|
| `results.json` (200-seed probe, frozen at `a026eca`) | `53dd5064b3ff5c121a380a46958c704759ac833cbbec84ac6d34e80d736d1d7d` |
| `REPORT.md` | `0a9e6599d65f9d4b5fef9897f0207719596e851c5275eaac4253e9ecb2c9e55e` |
| `profiles-week6.json` (frozen Henderson–Bush profiles) | `30bbac028ab5d9cc56d3633edd892f199f03c2942418cd036725c8e65c74346a` |
| `scripts/madden27_tackle_hold_probe.mjs` | `78835b0b73ac86d6f7ddd9ddca4fcb700bc7e1e2365e4c19e5ca7bf2f0d1f161` |

Code: original engine `c9d4e6f51630f911a671d1b60f23513d8e5e7e30`; rating-scaled engine
`0db20fef9a3a939581ad1a27d8cb2829428946f6`. Source snapshot: EA Madden NFL 27 Week 6 ratings, accessed 2026-10-23.

**Reproducibility:** the committed probe, rerun on the same code with `--seeds 200`, writes a `results.json` with
hash `53dd5064…` that matches the frozen file exactly.

## Mapping status (uncalibrated)

- EA `TKL` → engine `TAK`: a candidate label match, not a conversion to wrap force.
- EA `BTK` → engine `BTK`: copied directly, not a measured grip-break load.
- `ELU`: no EA field for Madden 27. Project estimate 76 is kept.
- Hold factor `clamp(0.5 + (r − 50)/100, 0.5, 1.5)`: a choice, not a fit. It is the main subject of this report.

## Result 1: selection and post-wrap motion are separate

| Condition | Tackles original / scaled | Selection flips | Paired travel diff, yd (95% bootstrap) | Paired diff, m |
|---|---|---|---|---|
| project estimates | 197 / 197 | 0 | +0.0331 (+0.0297 to +0.0364) | +0.0302 |
| Madden TKL → TAK only | 197 / 197 | 0 | +0.0324 (+0.0285 to +0.0361) | +0.0296 |
| Madden BTK only | 196 / 196 | 0 | +0.0552 (+0.0502 to +0.0600) | +0.0504 |
| Madden TKL → TAK and BTK | 196 / 196 | 0 | +0.0545 (+0.0490 to +0.0595) | +0.0498 |

The rating-scaled engine never changes the tackle decision on a seed: no flips. The tackle count drops by one in the
BTK conditions in both engines, because BTK enters the existing tackle-odds formula. That is selection, not the
hold term. Seeds that lose a tackle drop out of the paired post-wrap comparison.

## Result 2: the positive direction is a calibration offset, not a Madden effect

The original engine has no hold factor, so its implied ratio is exactly 1. The scaled engine's factor is
`grip(tackler TAK) / grip(carrier resist)` for each wrap. Here `resist` uses the carrier's `max(BTK, ELU)`.

| Condition | Mean hold ratio | Share of tackles with ratio < 1 | corr(travel diff, ratio − 1) | slope (yd per unit ratio) |
|---|---|---|---|---|
| project estimates | 0.923 | 90.4% | −0.629 | −0.396 |
| Madden TKL → TAK only | 0.925 | 90.4% | −0.680 | −0.365 |
| Madden BTK only | 0.866 | 96.9% | −0.514 | −0.496 |
| Madden TKL → TAK and BTK | 0.868 | 96.9% | −0.557 | −0.436 |

Two facts explain the sign:

1. **Most tacklers have a hold factor below 1.** The frozen NE–CHI tackles are mostly by defenders whose TAK sits
   near 68–70 (Keyshaun Elliott LB 69 made 112 of 197; Kentavius Street DE 70 made 41; Grady Jarrett DT 68 made 15).
   The carrier's resist, 0.76 to 0.81 from Henderson's BTK 72 to 81 and ELU 76, is higher than their grip. A mean
   ratio below 1 means the hold is weaker than the original engine's implicit 1, so carriers travel farther on average.
2. **Within seeds, the direction matches the two-body sweep.** Where the ratio is higher, travel falls. The
   correlation is negative in all four conditions, −0.51 to −0.68. So the full-play mean is not a contradiction of
   the monotone two-body result. It is that the mapping is not centred on the population.

The Madden pair itself contributes little. Devin Bush made 6 of the 197 tackles in the frozen project run. Changing his
TAK to the TKL-derived 89 moves the mean difference by less than 0.001 yd. Henderson's BTK changes the carrier's
resist for every play, which is why the BTK conditions show the largest offset.

## Result 3: the two-body sweep is not a population estimate

`scripts/tackle_drag_unit.mjs` (on `research/gridiron-tackle-physics-2026-10-23`) varies only grip and resist on
identical bodies. Carrier travel falls as grip rises and rises as resist rises. That establishes the coupling's
direction. It does not say what the population mean should be.

## What the integrator should weigh

- **Centring.** Re-centring the factors so that the mean ratio over the snapshot's tackle population is 1 would remove
  the offset. That is a candidate follow-up test. It has **not** been run here, and no code was changed for it.
- **Selection.** BTK moves tackle odds, which changes who tackles. That is a separate effect from the hold term and
  should be reported separately, as it is above.
- **No validation.** The probe has no held-out tracked tackle data. The result is a mechanism check, not an NFL
  ability claim. The probe's own `interpretationLimit` says the same.

## Failure ledger (kept separate; not hidden)

- `test/prototype.mjs` on the rating-scaled engine (`0db20fe`) **fails**: it requires the checked-in 200-seed
  distribution artifact to reproduce exactly, and the hold change alters outcomes. The original engine (`c9d4e6f`)
  passes this test, and `test/validate.mjs --strict` passes on both. The artifact was not regenerated, so the change
  remains visible as a failure.
- The M4c penetration limits and the Barkley–Baun case are not part of this legacy track and are not tested here.

## Shared schema

`analysis/shared-schema-summary.json` carries one row per engine and seed in the ratings-to-physics schema. Unsupported
quantities are `null` or `not_applicable`, never zero: contact opportunity count, grip, balance, controller forces,
requested grip load, contact impulse and penetration are not observed by the legacy probe. Post-contact travel is in
metres over a one-second window after the first recorded tackle, censored where no tackle occurred.

## Cross-reference to the 3D track

The 3D M4d NE–CHI pilot reports Henderson and Bush inputs on Rapier and Jolt, and it does not pass the M4c penetration
criteria: `research/m4d-ne-chi-madden27-probe` at `c423908`, file `M4D-NE-CHI-INPUT-PILOT.md`. Its absolute
distances, impulses and event rates are not comparable with this legacy track's numbers, per the coordination contract.

## Reproduce

```sh
node scripts/madden27_tackle_hold_probe.mjs --control-root /root/gridiron-rating-audit --seeds 200 --out /tmp/x.json
python3 research/madden27-tackle-hold-probe/analysis/decompose_tackle_hold.py
```
