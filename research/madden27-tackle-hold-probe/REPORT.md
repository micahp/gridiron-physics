# Madden 27 ratings in the TAK/BTK tackle-hold model

- **Candidate code:** `research/gridiron-tackle-physics-2026-10-23` at `0db20fef9a3a939581ad1a27d8cb2829428946f6`
- **Control code:** parent `research/rating-audit-2026-10-22` at `c9d4e6f51630f911a671d1b60f23513d8e5e7e30`
- **Snapshot:** EA Madden NFL 27 Week 6 ratings, accessed 2026-10-23.

This probe compares the original and rating-scaled implementations on the same free-run setup: TreVeyon Henderson at RB for New England and Devin Bush at MLB for Chicago, both pinned into the frozen NE–CHI roster. EA lists Henderson at 92 kg, BTK 81; Bush at 106 kg, TKL 89. Sources: [Henderson](https://www.ea.com/games/madden-nfl/ratings/player-ratings/tre-veyon-henderson/14810), [Bush](https://www.ea.com/games/madden-nfl/ratings/player-ratings/devin-bush/20583). The captured values and field mapping are in [profiles-week6.json](profiles-week6.json).

EA's TKL is mapped to the engine's TAK. BTK is copied directly. The original project estimates were Henderson BTK 72 / ELU 76 and Bush TAK 83. Madden 27 has no ELU attribute, so the project ELU value remains 76; Madden BTK 81 then controls `max(BTK, ELU)`. EA-listed body masses are applied in every condition, keeping the old/new implementation comparisons matched. Other player data and ratings stay at the frozen project snapshot.

## Results

Each row has 200 runs with matching play IDs and seeds. “Carrier travel” is the Euclidean distance traveled during the first second after the first recorded tackle, as measured in the existing probe. The exact per-seed data is in [results.json](results.json).

| Contact ratings | Original tackles | Rating-scaled tackles | Original travel | Rating-scaled travel | Difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Project estimates | 197/200 | 197/200 | 1.760 yd | 1.793 yd | +0.033 yd |
| Madden TKL → TAK only | 197/200 | 197/200 | 1.760 yd | 1.792 yd | +0.032 yd |
| Madden BTK only | 196/200 | 196/200 | 1.790 yd | 1.845 yd | +0.055 yd |
| Madden TKL → TAK and BTK | 196/200 | 196/200 | 1.790 yd | 1.844 yd | +0.054 yd |

The old and new implementations had zero seed-level tackle/no-tackle flips in every rating condition. Their mean closing speed and tackle energy were identical within each condition, consistent with this change affecting the carrier after the wrap. Changing estimated ratings to official BTK lowered the tackle count by one in 200 plays in both implementations; this is the existing tackle-odds formula reacting to BTK, not the new hold-drag term.

The full-play carrier-travel change is positive, despite the isolated two-body sweep showing that more grip reduces travel. That mismatch shows the result depends on the full 22-player scenario and its trajectories. It does not validate the rating-to-drag formula. No held-out real tackle tracking was used.

## Reproduction

From this worktree, with the parent checkout available at `/root/gridiron-rating-audit`:

```sh
node scripts/madden27_tackle_hold_probe.mjs --control-root /root/gridiron-rating-audit --seeds 200
```

The probe only adds files under `scripts/` and `research/madden27-tackle-hold-probe/`; it does not modify `engine/world.js` or `engine/play.js`.
