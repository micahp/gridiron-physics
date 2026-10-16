# The physics engine

`engine/` is plain ES modules with no dependencies. The browser and Node run the same code, so `npm test` replays the whole game headless.

## World

- **Fixed step:** 120 Hz semi-implicit Euler, recorded at 30 Hz for playback.
- **Units:** SI inside the engine (m, s, kg). Play scripts arrive in yards.
- **Bodies:** 22 players as massive discs (radius from weight, 0.30–0.36 m) plus one 3D ball.
- **Determinism:** every play seeds its own PRNG from the ESPN play id, so a replay is bit-identical.

## Locomotion: force-limited, never teleported

A player's brain only outputs a *desired velocity*. What he can actually do is limited by his body:

| Limit | Model | Source of parameter |
|---|---|---|
| Propulsion along the direction of travel | `F(v) = F0 · (1 − v / v_max)` | 40 time → Samozino/Clark sprint model |
| Braking | ≤ 1.2 · a_lat | agility drills |
| Cutting (lateral) | ≤ a_lat (×0.8 above 6 m/s) | 3-cone + shuttle residual |
| Total traction | ‖a‖ ≤ μ·g, μ = 0.95 (cleats on grass) | shoe–surface friction literature |
| Backpedal | v ≤ 0.62 · v_max when moving against facing | |
| Ball in arm | v ≤ 0.97 · v_max | |
| Neuromuscular lag | 0.12 s response time to a new desired velocity | |
| Heading | turns at ≤ 9 rad/s | |

Integrating `m·dv/dt = F0(1 − v/v_max)` reproduces each player's measured 40-yard curve exactly. Nobody in the sim ever exceeds his own `v_max` (the validator checks every player on every play).

## Contact

- **Collisions:** circle–circle. Penetration is resolved by inverse-mass-weighted correction, and the normal impulse uses restitution `e = 0.12` (padded bodies are very inelastic). Momentum is conserved, so a 145 kg tackle displaces an 88 kg corner. Opponent impacts above 2.5 m/s are logged as hits with closing speed and impulse.
- **Blocks:** when a blocker reaches his man they engage. A spring–damper (k = 5200 N/m, c = 700 N·s/m) holds them chest to chest, with tangential grip. Each pushes with **leg drive** `m·g·μ·(0.55 + 0.35·STR/99)`, scaled by PBK/RBK vs PMV/FMV/BSH. The pair moves according to the net force over the combined mass. Rushers rip and swim laterally (finesse-heavy players more). **Sheds** are a hazard process: `λ = λ0 · exp((rush − block)/15)` per second.
- **Tackles:** a wrap is a perfectly inelastic collision (shared momentum; the energy absorbed is logged in kJ). Then a constraint plus the tackler's hanging weight drags the carrier down over ≈0.5 s. A contact that isn't the real tackle is a **broken tackle**: both players stumble, and the defender may lose his feet (BTK/ELU vs TAK).

For scale: NFL concussion reconstructions (Pellman et al., *Neurosurgery* 2003; Viano, Casson & Pellman, *Neurosurgery* 2007) measured helmet impact speeds of about 9.3 ± 1.9 m/s. In this game's sim, each play's hardest body-on-body contact has a median closing speed of 7.1 m/s (10th–90th percentile 4.8–9.5).

## The ball

The ball is a 3D point mass (0.415 kg) with gravity and quadratic drag `F = −½ ρ C_d A |v| v`:

| Flight | C_d | Frontal area |
|---|---|---|
| Spiral pass (nose-first) | 0.11 | π·0.085² |
| Punt (wobble) | 0.20 | smaller cross-section |
| Kickoff / FG (end over end) | 0.32 | tumbling |

Air density is **0.98 kg/m³**, the standard atmosphere at Empower Field's 1,609 m. Sea level is 1.20, so balls really do carry further at Mile High.

Every throw and kick is solved as a **boundary-value problem**: Newton iteration with a finite-difference Jacobian finds the launch velocity that puts the ball at the real catch or landing point after flight time `T`. It converges in 3–5 iterations. Release speed comes out of the solve. Across this game's passes the median is 46 mph (90th percentile 54), with screens and touch throws in the low 30s. The pass flight time is `0.15 + d / (24 + 0.2·(THP − 75))` seconds, plus 0.3 s of loft on deep balls. Loose balls bounce with low, randomised restitution and a random deflection angle, because a prolate spheroid bounces unpredictably.

## The director: physics with outcome constraints

The reconstruction must land on what really happened, so the director turns each ESPN play into intents and constraints. Motion is left to the physics.

- **Lineups:** ESPN depth charts give the base 11. Every player named in the play-by-play (tacklers, sackers, pass defenders, penalised players) is forced onto the field in a slot of his position family.
- **Runs:** the run gap and direction come from nflverse charting. OL/TE zone-assign to the nearest front defenders and drive them away from the hole. The RB meets the QB at the mesh point, takes the ball, and runs hole → end spot while dodging (ELU/AGI-weighted avoidance).
- **Passes:** catch point = LOS + real air yards, lateral from the charted pass location. The target's route is generated so he arrives exactly at catch time (a speed governor capped at his `v_max`). The QB throws at `t_catch − T`. The named pass defender or interceptor gets tight man on the target and breaks on the ball. After the catch, real YAC to the real end spot.
- **Sacks:** the named sacker's block is timed to break so he arrives as the QB is pushed back to the real sack spot.
- **Tackles** can only end the play near the real spot (±1.1 yd, ±2.6 yd for the credited tackler). A final 0.55 s forward-progress fall settles the pile on the exact yard line.
- **Out of bounds / TD:** the carrier finishes through the sideline at the real yard line, or crosses the goal line. Contact is a shove, not a tackle.
- **Kicking game:** the 2024 dynamic kickoff alignment (coverage at the receivers' 40, return team in the 35–30 set-up zone, no movement until the ball lands). Punts have gunners vs jammers, a 0.78 s long snap, real kick distance, fair catch, out of bounds and returns. FG/PAT: 0.42 s snap, hold, two-step approach, ball solved to pass the uprights (or miss wide or short as charted).

## Validation (`npm test`)

```
simulated 176 plays in ≈3 s
end-spot matches ESPN (±1 yd, ±1.5 yd at the sideline): 122/124
players over 108% of their own v_max: 0
```
