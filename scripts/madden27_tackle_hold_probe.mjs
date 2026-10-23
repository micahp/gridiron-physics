import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE_PATH = path.join(ROOT, 'research/madden27-tackle-hold-probe/profiles-week6.json');
const OUT_DEFAULT = path.join(ROOT, 'research/madden27-tackle-hold-probe/results.json');
const argv = process.argv.slice(2);
const opt = (key, fallback) => {
  const index = argv.indexOf(`--${key}`);
  return index < 0 ? fallback : argv[index + 1];
};
const CONTROL_ROOT = path.resolve(opt('control-root', '../gridiron-rating-audit'));
const SEEDS = Number(opt('seeds', '200'));
const OUT = path.resolve(opt('out', OUT_DEFAULT));
if (!Number.isInteger(SEEDS) || SEEDS < 1) throw new Error(`--seeds must be a positive integer, got ${SEEDS}`);

const profiles = JSON.parse(await readFile(PROFILE_PATH, 'utf8'));
const maddenPair = profiles.pair;
const snapshotPath = path.join(ROOT, 'data/teams/matchup-2026-10-22.json');
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));

const loadModule = (root, relativePath) => import(pathToFileURL(path.join(root, relativePath)).href);
const [controlPlay, candidatePlay, lineupModule] = await Promise.all([
  loadModule(CONTROL_ROOT, 'engine/play.js'),
  loadModule(ROOT, 'engine/play.js'),
  loadModule(ROOT, 'web/prototype-model.js'),
]);
const implementations = { original: controlPlay.simulatePlay, ratingScaled: candidatePlay.simulatePlay };
const rosterFor = (team) => snapshot.teams[team].roster.map((player) => ({ ...player,
  team: player.team_id, pos: player.rating_position, group: player.rating_group }));
const basePlayers = {};
for (const team of ['NE', 'CHI']) for (const player of snapshot.teams[team].roster) {
  basePlayers[player.id] = { ...player, team: player.team_id, pos: player.rating_position, group: player.rating_group };
}
const lineups = lineupModule.buildLineups(rosterFor('NE'), rosterFor('CHI'), {
  offense: { RB: maddenPair.offense.id },
  defense: { MLB: maddenPair.defense.id },
});
assert.equal(lineups.offense.RB, maddenPair.offense.id, 'TreVeyon Henderson is pinned at RB');
assert.equal(lineups.defense.MLB, maddenPair.defense.id, 'Devin Bush is pinned at MLB');

const baselineCarrier = basePlayers[maddenPair.offense.id];
const baselineTackler = basePlayers[maddenPair.defense.id];
assert.ok(baselineCarrier && baselineTackler, 'both official profiles exist in the frozen NE–CHI roster');
const BASELINE_RATINGS = {
  carrier: { BTK: baselineCarrier.ratings.BTK, ELU: baselineCarrier.ratings.ELU },
  tackler: { TAK: baselineTackler.ratings.TAK },
};

function playersFor(ratingCase) {
  const players = structuredClone(basePlayers);
  const carrier = players[maddenPair.offense.id];
  const tackler = players[maddenPair.defense.id];
  // Keep physical mass fixed to EA's displayed weights in all conditions; only the rating source varies.
  carrier.physics = { ...carrier.physics, mass: maddenPair.offense.weightKgDisplayed };
  tackler.physics = { ...tackler.physics, mass: maddenPair.defense.weightKgDisplayed };
  if (ratingCase === 'madden27-tkl-only' || ratingCase === 'madden27-tkl-and-btk') {
    tackler.ratings = { ...tackler.ratings, TAK: maddenPair.defense.ratings.TKL };
  }
  if (ratingCase === 'madden27-btk-only' || ratingCase === 'madden27-tkl-and-btk') {
    carrier.ratings = { ...carrier.ratings, BTK: maddenPair.offense.ratings.BTK };
  }
  return players;
}

function playFor(seed) {
  return {
    id: `madden27-ne-at-chi-run|seed${seed}`,
    off: 'NE', def: 'CHI', los: 45, dir: 1, shotgun: false,
    lineup: { NE: lineups.offense, CHI: lineups.defense },
    outcome_mode: 'free', text: 'Madden 27 official rating tackle-hold probe',
    kind: 'run', kindGroup: 'run', carrier: lineups.offense.RB, loc: 'middle', gap: 'middle',
  };
}

function measure(result) {
  const tackle = result.events.find((event) => event.type === 'tackle');
  if (!tackle) return { tackled: false, dragYd: null, speedAfter: null, closingMps: null, energyJ: null };
  const count = result.roster.length;
  assert.equal(result.stride, count * 6 + 6, 'frame layout matches the player roster');
  const index = result.roster.findIndex((player) => player.id === tackle.on);
  assert.ok(index >= 0, `tackled carrier ${tackle.on} exists in the roster`);
  const start = Math.round((tackle.t - result.t0) * result.hz);
  const end = Math.min(result.frames.length - 1, start + Math.round(result.hz));
  const offset = index * 6;
  const before = result.frames[start], after = result.frames[end];
  return {
    tackled: true,
    tacklerId: tackle.by,
    carrierId: tackle.on,
    tackleTimeSeconds: tackle.t,
    dragYd: Math.hypot(after[offset] - before[offset], after[offset + 1] - before[offset + 1]),
    speedAfter: after[offset + 3],
    closingMps: tackle.closing,
    energyJ: tackle.energy,
  };
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
function summarize(rows) {
  const tackled = rows.filter((row) => row.tackled);
  return {
    plays: rows.length,
    tackles: tackled.length,
    tackleRate: tackled.length / rows.length,
    meanCarrierTravelFirstSecondAfterTackleYd: mean(tackled.map((row) => row.dragYd)),
    medianCarrierTravelFirstSecondAfterTackleYd: median(tackled.map((row) => row.dragYd)),
    meanCarrierSpeedAfterOneSecondMps: mean(tackled.map((row) => row.speedAfter)),
    meanClosingSpeedMps: mean(tackled.map((row) => row.closingMps)),
    meanTackleEnergyJ: mean(tackled.map((row) => row.energyJ)),
    perSeed: rows,
  };
}

const ratingCases = [
  'project-estimated-contact-ratings',
  'madden27-tkl-only',
  'madden27-btk-only',
  'madden27-tkl-and-btk',
];
const results = {};
for (const ratingCase of ratingCases) {
  results[ratingCase] = {};
  const players = playersFor(ratingCase);
  for (const [version, simulatePlay] of Object.entries(implementations)) {
    const rows = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(measure(simulatePlay({ players: structuredClone(players) }, playFor(seed))));
    }
    results[ratingCase][version] = summarize(rows);
  }
  const original = results[ratingCase].original.perSeed;
  const candidate = results[ratingCase].ratingScaled.perSeed;
  results[ratingCase].pairedModelDifference = {
    seedOutcomeFlips: original.filter((row, index) => row.tackled !== candidate[index].tackled).length,
    jointlyTackledSeeds: original.filter((row, index) => row.tackled && candidate[index].tackled).length,
    meanDragDifferenceYdOnJointTackles: mean(original.flatMap((row, index) =>
      row.tackled && candidate[index].tackled ? [candidate[index].dragYd - row.dragYd] : [])),
  };
}

const output = {
  schemaVersion: 1,
  experiment: 'Madden 27 ratings in the TAK/BTK tackle-hold model',
  sourceSnapshot: profiles,
  codeVersions: {
    originalEngineCommit: 'c9d4e6f51630f911a671d1b60f23513d8e5e7e30',
    ratingScaledEngineCommit: '0db20fef9a3a939581ad1a27d8cb2829428946f6',
  },
  matchup: {
    scenario: 'NE at CHI, run up the middle, frozen Week 7 roster snapshot',
    runnerId: maddenPair.offense.id,
    tacklerId: maddenPair.defense.id,
    baselineProjectRatings: BASELINE_RATINGS,
    maddenEffectiveInputs: {
      tacklerTAKFromOfficialTKL: maddenPair.defense.ratings.TKL,
      carrierBTK: maddenPair.offense.ratings.BTK,
      retainedProjectELU: baselineCarrier.ratings.ELU,
      effectiveCarrierResistanceRating: Math.max(maddenPair.offense.ratings.BTK, baselineCarrier.ratings.ELU),
      physicalMassKg: { carrier: maddenPair.offense.weightKgDisplayed, tackler: maddenPair.defense.weightKgDisplayed },
    },
    note: 'Madden 27 has no ELU field. Project ELU is retained; official BTK=81 exceeds estimated ELU=76 and therefore controls max(BTK, ELU).',
  },
  seeds: SEEDS,
  results,
  interpretationLimit: 'Matched seeds share the same play IDs, but changed trajectories can consume random draws differently. This is a mechanism probe, not validation against tracked tackle outcomes.',
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
const shortResults = Object.fromEntries(Object.entries(results).map(([ratingCase, versions]) => [ratingCase, {
  original: Object.fromEntries(['tackles', 'tackleRate', 'meanCarrierTravelFirstSecondAfterTackleYd']
    .map((key) => [key, versions.original[key]])),
  ratingScaled: Object.fromEntries(['tackles', 'tackleRate', 'meanCarrierTravelFirstSecondAfterTackleYd']
    .map((key) => [key, versions.ratingScaled[key]])),
  pairedModelDifference: versions.pairedModelDifference,
}]));
console.log(JSON.stringify({ outputPath: OUT, results: shortResults }, null, 2));
