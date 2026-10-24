# Diagnosis: play 18 speed spike in the role-centred engine (2026-10-23)

Scope: diagnosis only. Nothing is committed to the engine, and the frozen probe is unchanged. The engine commit under
test is `ec18dee`, the role-centred hold on `research/gridiron-tackle-physics-2026-10-23`. Comparison engines are
the original `c9d4e6f` and the frozen hold-scaled `0db20fe`.

## Symptom

`validate.mjs --strict` (exit 1) on `ec18dee`: play 18 (E. Wilson run, DEN) has Brandon Jones at 18.45 m/s against
vmax 9.53, and Emanuel Wilson at 11.15 m/s against 9.46. `c9d4e6f` and `0db20fe` pass with zero violations.

## Root cause

**The forced tackle path starts a wrap at up to 3 m separation.** `engine/play.js`, in the time-budget fallback
(`st.carrier` still running after `budget`):

```js
const near = W.players.filter(...).sort(...)[0];
if (near && d2(near.p, c.p) < 3) startTackle(near, c);
else if (near) near.mode = "tackle_to";
```

The threshold is 3 m. A body contact needs about 0.6 m (sum of radii). The fallback starts the wrap at any gap under 3 m.

**The wrap spring is linear and unbounded.** `world.js`, `wrapForces`:

```js
const f = 7000 * (d - rest);   // rest = 0.75 * (t.r + c.r) ~ 0.46 m
t.ext += f * dx / d;  c.ext -= f * dx / d;
```

At `d = 2.96 m` the spring force is about 17.5 kN. On the 86.6 kg tackler that is about 200 m/s² per step. Brandon Jones
goes from 13.6 to 17.2 m/s in 33 ms, then a `hit` at 29.5 m/s closing. The trace is in `trace18-role-centred-play18.txt`.

## Why only the role-centred engine

Play 18 is the first play with a forced wrap at 2.96 m in `ec18dee`. In `c9d4e6f` and `0db20fe` it wraps at 1.12 m and
0.67 m. The engines differ only in the hold factors, and those apply only inside `wrap()`. Play 18 has a single wrap in
every engine, so the difference must come from play 17. Play 17's wrap is at 0.62 m in all three engines, but the role
drag changes the carrier's end position, and `simulateGame` carries that state into play 18.

So the role-centred change does not cause the spike. It shifts the carrier's position at the start of play 18, which
moves the forced wrap from 1.1 m to 3.0 m. The spring then produces the spike.

Far wraps are not unique to this engine. Plays 12 and 198 wrap at 1.2 to 1.6 m in all three engines, and play 199 does
too in the original and frozen engines.

## Attribution tests (scratch copies, not committed)

| Test | Play 18 | Strict validation | End-spots |
|---|---|---|---|
| `ec18dee` as committed | 2 violators | exit 1 | 122/124 |
| `tryTackle` contact gate only (`attribution-tryTackle-gate.patch`) | unchanged | exit 1 | 122/124 |
| forced-tackle threshold 3 m → 1 m only (`attribution-budget-threshold.patch`) | 0 violators | **exit 0** | 122/124 |

The `tryTackle` gate was not the trigger. In play 18, that path is not where the wrap starts.

## What this does and does not show

- It identifies a specific physics-plausibility failure: a contact impulse produced by a wrap spring at a 3 m gap.
- It shows that the 3 m threshold and the unbounded linear spring together make a small trajectory change into a
  large impulse. It does not prove the same failure is common. Across the whole game, the three engines differ only in
  whether play 18 hits the 3 m case.
- The 1 m test removes the violation on this game. It has **not** been run across seeds or other games, and it changes
  every forced tackle with a carrier 1 to 3 m away. The end-spot count is unchanged, but this is one game. Behaviour
  outside this game is unknown.
- The original engine has the same 3 m path and the same spring. It does not violate on this game only because its
  wrap starts at 1.12 m.

## Options for the integrator (no option is applied)

1. Change the forced-tackle threshold from 3 m to about 1 m. The validation passes on this game. It needs the 200-seed
   probes and a full validation sweep, because it changes all forced tackles.
2. Bound the wrap spring: saturate `f` at a maximum, or apply it only inside a band around `rest`. This fixes the
   impulse regardless of how the wrap started, and it applies to the original engine too. It changes every wrap.
3. Keep the engine as it is and mark this game as failing the physics-plausibility gate.

Option 2 is the more general fix. Option 1 is narrower but depends on the 1 m choice. Either needs a decision, and both
change legacy results.

## Reproduce

```sh
node research/madden27-tackle-hold-probe/diagnosis-play18/farplays.mjs <engine-root>
node research/madden27-tackle-hold-probe/diagnosis-play18/diagnose18.mjs <engine-root>
```

Engine roots are extracted with `git archive <commit> engine web test` into a scratch folder. The instrumented copies and
the patch files are listed above.
