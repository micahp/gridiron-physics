import { DEMOS as M1B_FIXTURES, runTackleScenario as runM1BTackle } from './m1b/simulation.mjs';
import { instantiateScenario } from './scenarios.mjs';
import { runScenario as runM4BScenario } from './simulation.mjs';
import { instantiateM4CScenario } from './m4c-scenarios.mjs';

const m1bById = new Map(M1B_FIXTURES.map((fixture) => [fixture.id, fixture]));

// Both milestone fixture sets now execute through the M4b Rapier/Jolt adapter.
// M1b's archived branch remains available as the source of its original reports.
export async function runResearchFixture({ milestone, engine, fixtureId, seed, options = {} }) {
  if (milestone === 'm1b') {
    const fixture = m1bById.get(fixtureId);
    if (!fixture || fixture.kind !== 'tackle') throw new Error(`Unknown M1b tackle fixture: ${fixtureId}`);
    return runM1BTackle(engine, structuredClone(fixture), options);
  }
  if (milestone === 'm4b') {
    return runM4BScenario(engine, instantiateScenario(fixtureId, seed), options);
  }
  if (milestone === 'm4c') {
    return runM4BScenario(engine, instantiateM4CScenario(fixtureId, seed), { ...options, behaviorVersion: 'm4c' });
  }
  throw new Error(`Unknown research milestone: ${milestone}`);
}

export const RESEARCH_FIXTURES = Object.freeze({
  m1b: Object.freeze(M1B_FIXTURES.filter((fixture) => fixture.kind === 'tackle').map(({ id }) => id)),
  m4b: Object.freeze(['gang-two-opposite-open', 'sack-simultaneous-two', 'tush-push-eight']),
  m4c: Object.freeze(['gang-two-opposite-open', 'sack-simultaneous-two', 'possession-retained',
    'possession-force-fumble', 'recovery-failed', 'recovery-secure', 'recovery-contested', 'tush-push-eight']),
});
