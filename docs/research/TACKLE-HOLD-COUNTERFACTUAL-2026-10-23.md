# Tackle hold: ratings reach the body after contact (research branch, 2026-10-23)

Branch `research/gridiron-tackle-physics-2026-10-23`, from `research/rating-audit-2026-10-22`. Research only; the
shared checkout and its branch are untouched. The change is not shipped.

## What changed

- `engine/world.js`: `wrap()` takes two factors, `grip` (the tackler's hold) and `resist` (the carrier's resistance).
  `wrapForces()` scales the hold drag by `grip / resist`. Both default to 1, which reproduces the old drag.
- `engine/play.js`: the tackle call site passes `grip = gripFactor(TAK)` and
  `resist = gripFactor(max(BTK, ELU))`, where `gripFactor(r) = clamp(0.5 + (r - 50) / 100, 0.5, 1.5)`.

Tackle outcome odds (`tackleOdds`, `freeTackleOdds`) are unchanged. Only the body after contact changes.

## Two-body test (`scripts/tackle_drag_unit.mjs`)

Identical bodies, inert brains, one wrap, 1.0 s of physics at dt = 1/120 s. Carrier travel after the wrap, in yards:

| resist \ grip | 0.7 | 1.0 | 1.3 |
|---|---|---|---|
| 0.7 | 1.264 | 1.160 | 1.073 |
| 1 | 1.347 | 1.264 | 1.190 |
| 1.3 | 1.396 | 1.326 | 1.264 |

Carrier travel rises as resist rises and falls as grip rises. Each cell is one run of the same two bodies.

## Full plays (`scripts/tackle_physics_probe.mjs`, 200 seeds, NE at CHI snapshot)

Mean carrier travel in the second after the tackle, in yards. Same seeds in every condition.

| Condition | Run: original → modified | Pass: original → modified |
|---|---|---|
| baseline | 1.611 → 1.646 | 2.325 → 2.307 |
| defenders' TAK +10 | 1.591 (modified) | 2.210 (modified) |
| offensive skill players' BTK +10 | 1.608 → 1.671 | 2.325 → 2.307 |

Tackle rate and energy are unchanged in every condition, as expected: the odds did not change. Full-play effects are
small, because the same plays also change which tackles happen and when.

## What did not pass

`test/prototype.mjs` fails on the modified engine: it requires the checked-in 200-seed distribution artifact to
reproduce exactly. That is the expected consequence of changing outcomes. The original engine passes both
`test/validate.mjs --strict` and `test/prototype.mjs`. The artifact was not regenerated here, so the change is visible
as a failure rather than hidden.

## What this does not show

- It does not show that the hold factors are calibrated to real tackles. The 0.5 to 1.5 mapping is a choice, not a fit.
- The two-body test uses equal-mass bodies at a fixed closing speed. It isolates the coupling, not the game.
- It does not use any Madden-derived value. The factors come from the engine's own estimated TAK, BTK and ELU.

## Coordination

A message to the peer session `root-49` about the files this branch touches could not be delivered (`Failed to send`).
The change is confined to a separate worktree and branch, so it cannot overwrite the shared checkout.
