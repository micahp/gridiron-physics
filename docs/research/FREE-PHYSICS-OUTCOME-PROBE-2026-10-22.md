# Free Physics Outcome Probe — 2026-10-22

This note records deterministic integration probes of the Patriots–Bears prototype after prospective run/pass execution stopped using historical outcome anchors. These are simulator outputs, not predictions or claims about the October 22 game.

## Representative outcomes

All five plays started at the 45-yard line, traveled toward increasing field coordinates (`dir: 1`), and used the frozen pregame roster snapshot. The mock selector sampled an `observed_2025` catalog entry within the listed formation; it supplied no result, catch, or tackler anchor.

| Offense | Action and seed | Selected observed entry | Simulated result |
|---|---|---|---|
| New England | Run, `run-seed-A` | `observed-2025-run-under-center-false-end-left-b8aee5186c` | TreVeyon Henderson tackled by Tyrique Stevenson at the 50.07 (+5.07 yards) |
| New England | Run, `causal-probe-run-0` | `observed-2025-run-under-center-false-tackle-left-cdaa6f9278` | TreVeyon Henderson tackled by Grady Jarrett at the 42.68 (−2.32 yards) |
| Chicago | Run, `run-seed-A` | `observed-2025-run-under-center-false-tackle-right-281e15a606` | D’Andre Swift tackled by Christian Barmore at the 42.58 (−2.42 yards) |
| New England | Pass, `causal-probe-pass-4` | `observed-2025-pass-shotgun-true-short-right-91ba863086` | Drake Maye completed to DeMario Douglas; Douglas broke one tackle and was tackled by Dillon Thieneman at the 55.28 (+10.28 yards) |
| Chicago | Pass, `causal-probe-pass-0` | `observed-2025-pass-shotgun-true-short-middle-cf53ab55f2` | Caleb Williams completed to Rome Odunze, tackled by Kindle Vildor at the 45.58 (+0.58 yards) |

The pass outcomes include a simulated throw, catch, carrier run, and defensive tackle. An incomplete pass’s final ball coordinate is not a rushing or receiving gain and must not be reported as one.

## Seeded pass smoke sample

For 60 deterministic seeds per offense (`causal-probe-pass-0` through `causal-probe-pass-59`), with the same line of scrimmage and the first charted pass formation, the recorded outcomes were:

| Offense | Catch, followed by tackle or boundary | Pass breakup | Drop | Other incomplete |
|---|---:|---:|---:|---:|
| New England | 14 | 13 | 13 | 20 |
| Chicago | 11 | 18 | 11 | 20 |

These are counts from this mock selector and physics configuration only. They are not calibrated rates. No interception or sack appeared in these 60-seed samples.

## Free-execution distribution sample: before and after

The committed [200-seed smoke distribution](../../results/free_execution_outcome_sample.json) uses the first charted formation per action, `createDemoScenario` without `candidateId`, seeds `dist-{run|pass}-{i}`, and the same 45-yard line for both offenses. It is explicitly labeled `unvalidated_smoke_distribution_not_calibration_or_prediction`. The before values below were reproduced from the parent commit (`5252a90`) with the same seed scheme and Type-7 quantiles; after values come from the committed artifact.

| Offense | Run median yards, before → after | Runs gaining ≤0, before → after | Tackle ≤0.9 s after handoff, before → after | Pass catches, before → after |
|---|---:|---:|---:|---:|
| New England | −2.31 → +1.11 | 65.5% → 33.0% | 50.5% → 25.0% | 46/200 (23.0%) → 83/200 (41.5%) |
| Chicago | −1.04 → +1.26 | 63.5% → 36.0% | 31.5% → 26.0% | 51/200 (25.5%) → 88/200 (44.0%) |

The free-run fix gives each tackle and guard a front assignment, fits the defensive line at the line before the handoff, and requires close, aligned, closing contact for a tackle attempt. The catch window now accepts ball heights from 0.15–3.0 m and a receiver reach of radius +1.6 m; catch odds start at 0.67 before rating and distance adjustments. The smoke target is 40–55% completion for this one-target route/coverage prototype: it raises the prior ~24% rate while preserving visible drops, breakups, interceptions, and sacks. This target is not a calibration to league passing rates.

The artifact also records mean, median, p10, and p90 gains; the complete pass outcome split; early unblocked defensive-front crossings; and its seeded setup. Pass gain counts a catch spot or sack spot relative to the line of scrimmage; incompletions and interceptions contribute zero. The sample and assertions are reproducible with `node scripts/sample_free_execution_outcomes.mjs`; these frequencies remain a smoke test, not a prediction or evidence of full football realism.

## Defender sensitivity probe

The same play and seed were rerun with the 22 lineup slots retained while the defense’s ratings and physical inputs were changed to intentionally extreme values. For New England run seed `causal-probe-run-0`, the normal defense produced a tackle at 42.68; nearly stationary defenders (`TAK`, `CIT`, `AWR`, `PMV`, `FMV`, and `BSH` set to 0; `vmax`, `f0`, and `drive` set to 0.01) let the runner score at 100.24; boosted defensive values (those six ratings set to 99 and those three physics values multiplied by 1.3) produced a tackle at 39.08.

For New England pass seed `causal-probe-pass-2`, the normal defense produced a pass breakup by Malik Muhammad. The same two extreme-defense interventions instead produced a drop and a pass breakup, respectively. The engine therefore responds to defensive pursuit, contact, and proximity to the thrown ball. These extreme interventions demonstrate code-path influence, not plausible player comparisons.

## What this establishes—and what it does not

- The free run path can end on either side of the line of scrimmage, and a back can be tackled after a positive gain.
- The free pass path can produce a catch followed by yards after catch and a tackle.
- Defensive players can change pursuit, tackle, and pass-contest outcomes in the simulation.
- Run lanes, route assignments, coverage, and catch/tackle probabilities remain simplified hand-authored mechanics. The probe does not validate football realism, player-rating calibration, or predictive accuracy.

## Reproduction

From the repository root, run this snippet to reproduce the representative play spots and events. Leaving `candidateId` unset lets the seeded mock selector choose the observed entry within the first charted formation for that action.

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { createDemoScenario } from './web/prototype-model.js';
import { simulatePlay } from './engine/play.js';
const teams = JSON.parse(readFileSync('./data/teams/matchup-2026-10-22.json', 'utf8')).teams;
const playbooks = Object.fromEntries(['NE', 'CHI'].map(id => [id,
  JSON.parse(readFileSync(`./data/playbooks/${id}-2025.json`, 'utf8'))]));
for (const [offenseId, kind, seed] of [
  ['NE', 'run', 'run-seed-A'], ['NE', 'run', 'causal-probe-run-0'],
  ['CHI', 'run', 'run-seed-A'], ['NE', 'pass', 'causal-probe-pass-4'],
  ['CHI', 'pass', 'causal-probe-pass-0'],
]) {
  const defenseId = offenseId === 'NE' ? 'CHI' : 'NE';
  const formation = playbooks[offenseId].offense.play_candidates[kind].candidates[0].attributes.formation;
  const scenario = createDemoScenario({ offenseId, defenseId, teams, playbooks, kind, formation, seed, los: 45, dir: 1 });
  const result = simulatePlay({ players: scenario.players }, scenario.play);
  console.log({ offenseId, kind, seed, entry: scenario.selection.playbook_entry.candidate_id,
    reason: result.end.reason, spot: result.end.x, events: result.events });
}
NODE
```

`node test/prototype.mjs` runs the broader deterministic free-execution smoke tests.
