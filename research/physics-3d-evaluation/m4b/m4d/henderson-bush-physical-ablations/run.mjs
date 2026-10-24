import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { runScenario } from '../../simulation.mjs';
import { instantiateM4CScenario } from '../../m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M4B = path.resolve(HERE, '../..');
const REPO_ROOT = path.resolve(M4B, '../../..');
const RESULTS = path.join(HERE, 'results');
const TRACES = path.join(RESULTS, 'traces');
const PROFILE_PATH = path.join(HERE, '../henderson-bush-week6-source.json');
const PROFILE = JSON.parse(await readFile(PROFILE_PATH, 'utf8'));
const REUSE_TRACES = process.argv.includes('--reuse-traces');
const RUN_BRANCH = process.argv.find((argument) => argument.startsWith('--branch='))?.slice('--branch='.length);
const CODE_COMMIT = process.argv.find((argument) => argument.startsWith('--code-commit='))?.slice('--code-commit='.length);
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const SEEDS = [41027, 41028];
const DT_SECONDS = 1 / 120;
const LIMITS = { maximumM: 0.15, p95M: 0.05, durationWeightedMeanM: 0.025 };
const TKL_HYPOTHESIS = { neutralRating: 50, slopePerPoint: 0.005, minimumScale: 0.5, maximumScale: 1.5 };
const BTK_HYPOTHESIS = { neutralRating: 50, newtonsPerPoint: 10, minimumN: 0, maximumN: 500 };
const CAPACITY_FACTORS = [0.5, 0.75, 1, 1.25, 1.5];
const BALANCE_SCALES = [0, 0.2, 0.4, 0.8, 1.2];
const BTK_RATINGS = [50, 60, 70, 79, 80, 81, 82, 90, 99];
const STR_CONTINUITY_VALUES = [79, 79.5, 79.75, ...Array.from({ length: 11 }, (_, index) => Number((80 + index / 10).toFixed(1))), 81.25, 81.5, 82];
const SCENARIOS = ['possession-retained', 'grip-escape-one-held', 'gang-staggered-three'];
const ROLES = {
  'possession-retained': { carrierId: 'runner', tacklerId: 'impact-defender', focusPair: ['runner', 'impact-defender'],
    secondHolderId: null, outcomeGate: 'possession-retained' },
  'grip-escape-one-held': { carrierId: 'carrier', tacklerId: 'defender-left', focusPair: ['carrier', 'defender-left'],
    secondHolderId: 'defender-right', outcomeGate: 'weak-grip-releases-strong-grip-remains' },
  'gang-staggered-three': { carrierId: 'carrier', tacklerId: 'first-hit', focusPair: ['carrier', 'first-hit'],
    secondHolderId: null, outcomeGate: 'physical-takedown' },
};
const HENDERSON = PROFILE.players.find((player) => player.name === 'TreVeyon Henderson');
const BUSH = PROFILE.players.find((player) => player.name === 'Devin Bush');
const PRIOR_PROFILE_BYTES = await readFile(path.join(M4B, 'm4d/madden27-week6-profiles.json'));
const PRIOR_BARKLEY_BAUN = JSON.parse(PRIOR_PROFILE_BYTES.toString('utf8'));
const PRIOR_PROFILE_HASH = createHash('sha256').update(PRIOR_PROFILE_BYTES).digest('hex');
const BARKLEY = PRIOR_BARKLEY_BAUN.profiles.find((player) => player.id === 'saquon-barkley');
const BAUN = PRIOR_BARKLEY_BAUN.profiles.find((player) => player.id === 'zack-baun');
const FROZEN_PROTOCOL_COMMIT = '053093a1ef0da912b19fc3a7566fdac68385e8b5';
const FROZEN_PROTOCOL_HASH = '204ebd336c5c6d772831921692637f75e52f8b8949cf206cbd1eb04e0edffcde';
const MAIN_PROTOCOL_COMMIT = 'b3ccd729707f2ccc697f750cdad774c71fe5f674';
const MAIN_PROTOCOL_HASH = '9e1dc4f55a29f69daebbe4203f3fd547dd880dce7919f57402b5e07ba731659d';
const LEGACY = {
  branch: 'research/gridiron-tackle-physics-2026-10-23',
  commit: 'ec18dee259572f4beabda68a70d0d7f58601900f',
  reportPath: 'docs/research/TACKLE-HOLD-COUNTERFACTUAL-2026-10-23.md',
  reportSha256: '83cb85a7a83029ee4daf282e8f61d0acb143f152c8403ff658d0a7271df6ace1',
  worldJsSha256: '85d1e24a6b2d4af43030da07bbc74e3b7a9c3f2e7b968c91bd141be48211412b',
  playJsSha256: '628e96d8af068b41adba4d40c3d151e2f6d487f4bed04148e3c16f679634f640',
};
const LEGACY_DIAGNOSIS = {
  branch: 'research/madden27-tackle-physics-probe',
  commit: '51b9d0f85a147dfc3fcc866fb1c18b5186d3a106',
  reportPath: 'research/madden27-tackle-hold-probe/diagnosis-play18/DIAGNOSIS.md',
  reportSha256: '1f7e28d656ade0cfff76ae40ca02f825e447a8de3f8fbb441b66afeabda8f1d2',
};
const LEGACY_DIAGNOSIS_URL = 'https://github.com/micahp/gridiron-physics/blob/'
  + LEGACY_DIAGNOSIS.commit + '/' + LEGACY_DIAGNOSIS.reportPath;
const LEGACY_REPORT_URL = `https://github.com/micahp/gridiron-physics/blob/${LEGACY.commit}/${LEGACY.reportPath}`;
const REPLAY_CONFIGS = {
  'possession-retained': new Set(['m4c-neutral', 'madden-pair-combined', 'wrap-capacity-1.00x', 'tkl-capacity-hypothesis',
    'tkl-capacity-rating-50-control',
    'btk-drive-rating-81', 'balance-scale-0.80', 'str-continuity-henderson-80.00', 'str-continuity-henderson-80.50',
    'str-continuity-henderson-81.00', 'str-continuity-bush-80.00', 'str-continuity-bush-80.50',
    'str-continuity-bush-81.00', 'old-barkley-baun-lost-contact']),
  'grip-escape-one-held': new Set(['m4c-neutral', 'madden-pair-combined', 'wrap-capacity-0.50x', 'wrap-capacity-1.00x',
    'tkl-capacity-hypothesis']),
  'gang-staggered-three': new Set(['m4c-neutral', 'madden-pair-combined', 'wrap-capacity-0.50x', 'wrap-capacity-1.00x',
    'tkl-capacity-hypothesis']),
};

if (!HENDERSON || !BUSH) throw new Error('Frozen Henderson–Bush snapshot is incomplete');
if (!RUN_BRANCH || !CODE_COMMIT) throw new Error('Pass frozen --branch=<name> and --code-commit=<full SHA> metadata');
await mkdir(TRACES, { recursive: true });
const startedAt = performance.now();
const reportRows = [];
const replayIndex = { schemaVersion: 1, description: 'Matched-timestep M4c Rapier/Jolt replays; frame traces are step-synchronous.', scenarios: {} };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hashFile = async (file) => sha256(await readFile(file));
const slug = (value) => String(value).replace(/\+/g, 'plus').replace(/[^a-zA-Z0-9.-]+/g, '-');
function configurationsForScenario(scenarioId) {
const profileConfigs = [
    { id: 'm4c-neutral', phase: 'neutral-baseline', massMode: 'fixture', strengthMode: 'neutral' },
    { id: 'mass-henderson-only', phase: 'mass-only', massMode: 'henderson', strengthMode: 'neutral' },
    { id: 'mass-bush-only', phase: 'mass-only', massMode: 'bush', strengthMode: 'neutral' },
    { id: 'mass-both-after-individual', phase: 'mass-only-after-one-factor', massMode: 'both', strengthMode: 'neutral' },
    { id: 'str-henderson-only', phase: 'strength-only', massMode: 'fixture', strengthMode: 'henderson' },
    { id: 'str-bush-only', phase: 'strength-only', massMode: 'fixture', strengthMode: 'bush' },
    { id: 'str-both-after-individual', phase: 'strength-only-after-one-factor', massMode: 'fixture', strengthMode: 'both' },
    { id: 'madden-pair-combined', phase: 'combined-after-isolated-factors', massMode: 'both', strengthMode: 'both' },
  ];
  const capacityConfigs = CAPACITY_FACTORS.map((factor) => ({
    id: `wrap-capacity-${factor.toFixed(2)}x`, phase: 'physical-wrap-capacity', massMode: 'both', strengthMode: 'both', capacityFactor: factor,
  }));
  const tklScale = Math.min(TKL_HYPOTHESIS.maximumScale, Math.max(TKL_HYPOTHESIS.minimumScale,
    1 + TKL_HYPOTHESIS.slopePerPoint * (BUSH.ratings.TKL - TKL_HYPOTHESIS.neutralRating)));
  const special = [{ id: 'tkl-capacity-rating-50-control', phase: 'uncalibrated-tkl-capacity-hypothesis', massMode: 'both',
    strengthMode: 'both', capacityFactor: 1, tklRating: TKL_HYPOTHESIS.neutralRating, tklNeutral: TKL_HYPOTHESIS.neutralRating,
    hypothesis: { ...TKL_HYPOTHESIS, capacityScale: 1 } },
  { id: 'tkl-capacity-hypothesis', phase: 'uncalibrated-tkl-capacity-hypothesis', massMode: 'both',
    strengthMode: 'both', capacityFactor: tklScale, tklRating: BUSH.ratings.TKL, tklNeutral: TKL_HYPOTHESIS.neutralRating,
    hypothesis: { ...TKL_HYPOTHESIS, capacityScale: tklScale } }];
  if (scenarioId === 'possession-retained') {
    special.push(...BALANCE_SCALES.map((balanceScale) => ({ id: `balance-scale-${balanceScale.toFixed(2)}`,
      phase: 'physical-balance-authority', massMode: 'both', strengthMode: 'both', carrierBalanceScale: balanceScale })));
    special.push(...BTK_RATINGS.map((rating) => {
      const extraForceN = Math.min(BTK_HYPOTHESIS.maximumN, Math.max(BTK_HYPOTHESIS.minimumN,
        BTK_HYPOTHESIS.newtonsPerPoint * (rating - BTK_HYPOTHESIS.neutralRating)));
      return { id: `btk-drive-rating-${rating}`, phase: 'uncalibrated-btk-breakaway-force-hypothesis', massMode: 'both',
        strengthMode: 'both', btkRating: rating, extraDriveN: extraForceN,
        driveWindow: { startSeconds: 0.2, endSeconds: 1.0, baselineForceN: 1200 } };
    }));
    for (const actor of [{ id: ROLES[scenarioId].carrierId, label: 'henderson' },
      { id: ROLES[scenarioId].tacklerId, label: 'bush' }]) {
      special.push(...STR_CONTINUITY_VALUES.map((rating) => ({ id: `str-continuity-${actor.label}-${rating.toFixed(2)}`,
        phase: 'str-continuity-after-profile', massMode: 'both', strengthMode: 'both',
        strengthOverridePlayerId: actor.id, strengthOverride: rating })));
    }
  }
  return [...profileConfigs, ...capacityConfigs, ...special];
}

function buildScenario(scenarioId, seed, config) {
  const scenario = instantiateM4CScenario(scenarioId, seed);
  const roles = ROLES[scenarioId];
  const byId = new Map(scenario.players.map((player) => [player.id, player]));
  for (const player of scenario.players) player.strength = 80;
  const carrier = byId.get(roles.carrierId), tackler = byId.get(roles.tacklerId);
  if (!carrier || !tackler?.wrap) throw new Error(`${scenarioId} lacks the configured carrier or tackler wrap`);

  if (config.massMode === 'henderson' || config.massMode === 'both') carrier.mass = HENDERSON.mass_kg;
  if (config.massMode === 'bush' || config.massMode === 'both') tackler.mass = BUSH.mass_kg;
  if (config.strengthMode === 'henderson' || config.strengthMode === 'both') carrier.strength = HENDERSON.ratings.STR;
  if (config.strengthMode === 'bush' || config.strengthMode === 'both') tackler.strength = BUSH.ratings.STR;
  if (config.strengthOverridePlayerId) byId.get(config.strengthOverridePlayerId).strength = config.strengthOverride;
  if (config.capacityFactor !== undefined) tackler.wrap.capacityN *= config.capacityFactor;
  if (config.carrierBalanceScale !== undefined) carrier.balanceScale = config.carrierBalanceScale;
  if (config.driveWindow) {
    carrier.drive = { forceN: [config.driveWindow.baselineForceN + config.extraDriveN, 0, 0],
      startSeconds: config.driveWindow.startSeconds, endSeconds: config.driveWindow.endSeconds };
  }

  const rolesForReplay = { ...roles, carrier, tackler };
  return { scenario, rolesForReplay };
}

function buildProfileScenario(scenarioId, seed, config) {
  if (config.id !== 'old-barkley-baun-lost-contact') return buildScenario(scenarioId, seed, config);
  const scenario = instantiateM4CScenario(scenarioId, seed);
  const roles = ROLES[scenarioId];
  const carrier = scenario.players.find((row) => row.id === roles.carrierId);
  const tackler = scenario.players.find((row) => row.id === roles.tacklerId);
  for (const player of scenario.players) player.strength = 80;
  carrier.mass = BARKLEY.weightKgDisplayed;
  carrier.strength = BARKLEY.ratings.STR;
  tackler.mass = BAUN.weightKgDisplayed;
  tackler.strength = BAUN.ratings.STR;
  return { scenario, rolesForReplay: { ...roles, carrier, tackler } };
}

function maxNormByPlayer(frames, field) {
  const maxima = {};
  for (const frame of frames) for (const [id, vector] of Object.entries(frame[field] ?? {})) {
    const value = Math.hypot(...vector);
    maxima[id] = Math.max(maxima[id] ?? 0, value);
  }
  return maxima;
}

function maxDriveForceByPlayer(frames) {
  const maxima = {};
  for (const frame of frames) for (const [id, inputs] of Object.entries(frame.forcesNByPlayer ?? {})) {
    for (const input of inputs) if (input.source === 'configured player drive force') {
      maxima[id] = Math.max(maxima[id] ?? 0, Math.hypot(...input.forceN));
    }
  }
  return maxima;
}

function computeContactStats(result, focusPair) {
  const pairId = [...focusPair].sort().join('::');
  const samples = result.frames.map((frame) => ({ time: frame.timeSeconds,
    pair: frame.pairSurfaceGaps?.find((row) => row.pairId === pairId) }));
  const opportunities = samples.filter((row) => row.pair?.contactOpportunity);
  const contacts = samples.filter((row) => row.pair?.physicalContact);
  const contactEvents = (result.events ?? []).filter((event) => event.type === 'player_contact_started'
    && [...event.pair].sort().join('::') === pairId);
  return { pairId, opportunityCount: opportunities.length, actualContactCount: contacts.length,
    actualContactEventCount: contactEvents.length,
    firstContactSeconds: contacts[0]?.time ?? null, firstOpportunitySeconds: opportunities[0]?.time ?? null,
    minimumSurfaceGapM: Math.min(...samples.map((row) => row.pair?.minimumSurfaceGapM ?? Infinity)) };
}

function postContactTravel(result, carrierId, firstContactSeconds) {
  if (firstContactSeconds == null) return { distanceM: null, window: { contactOccurred: false,
    requestedSeconds: 1, observedSeconds: 0, censored: true, measurement: 'signed carrier-origin x displacement after first physical contact' } };
  const start = result.frames.find((frame) => frame.timeSeconds >= firstContactSeconds);
  const targetTime = firstContactSeconds + 1;
  const end = result.frames.find((frame) => frame.timeSeconds >= targetTime) ?? result.frames.at(-1);
  const observed = Math.max(0, end.timeSeconds - firstContactSeconds);
  return { distanceM: end.players[carrierId].positionM[0] - start.players[carrierId].positionM[0],
    window: { contactOccurred: true, startSeconds: start.timeSeconds, endSeconds: end.timeSeconds,
      requestedSeconds: 1, observedSeconds: observed, censored: observed + 1e-9 < 1,
      measurement: 'signed carrier-origin x displacement from first physical-contact sample to +1.0 s; right-censored at fixture end' } };
}

function mapOutcome(result, scenarioId, roles, contactStats) {
  const outcome = result.outcome;
  const football = outcome.football ?? null;
  const wraps = outcome.wrapResults ?? [];
  const targetWrap = wraps.find((row) => row.holderId === roles.tacklerId) ?? null;
  const carrierTerminal = outcome.playerTerminalStates?.find((row) => row.id === roles.carrierId) ?? null;
  const fallTime = carrierTerminal?.fellAtSeconds ?? null;
  const physicalTakedown = scenarioId === 'gang-staggered-three' ? fallTime !== null : null;
  const ballControlled = football ? football.controlledBy === roles.carrierId : null;
  const fumble = football ? football.status === 'loose_live' || football.releaseReason != null : null;
  const gripEstablished = targetWrap ? targetWrap.maximumRequestedLoadN > 0 : false;
  const gripReleased = targetWrap && gripEstablished ? Boolean(targetWrap.released) : null;
  const requestedGripLoad = {
    wrapByHolderN: Object.fromEntries(wraps.map((row) => [row.holderId, row.maximumRequestedLoadN])),
    possessionCradleByHolderN: Object.fromEntries((football?.possessionGrips ?? []).map((row) => [row.playerId, row.maximumRequestedLoadN])),
  };
  let outcomePass = null, outcomeReason = null;
  if (scenarioId === 'possession-retained') {
    const secure = (football?.possessionGrips ?? []).some((row) => row.playerId === roles.carrierId && row.active && row.secureEventRecorded);
    outcomePass = contactStats.actualContactCount > 0 && ballControlled === true && secure;
    if (!outcomePass) outcomeReason = 'registered retained-possession outcome requires physical contact and maintained controlled cradle';
  } else if (scenarioId === 'grip-escape-one-held') {
    const second = wraps.find((row) => row.holderId === roles.secondHolderId);
    outcomePass = Boolean(targetWrap?.released && second && !second.released);
    if (!outcomePass) outcomeReason = 'registered grip outcome requires weak-holder release while the second grip remains active';
  } else if (scenarioId === 'gang-staggered-three') {
    outcomePass = physicalTakedown === true;
    if (!outcomePass) outcomeReason = 'registered tackle outcome requires the carrier to meet M4c sustained-fall criterion';
  }
  return { physicalTakedown, carrierFallSeconds: fallTime, gripEstablished, gripReleased,
    ballControlled, fumble, requestedGripLoad, outcomePass, outcomeReason, targetWrap,
    physicalContactPairCount: contactStats.actualContactCount };
}

function runFailures(result, outcome) {
  const penetration = result.penetration;
  const numerical = [];
  if (penetration.maximumDepthM > LIMITS.maximumM) numerical.push(`maximum penetration ${penetration.maximumDepthM} m > ${LIMITS.maximumM} m`);
  if (penetration.p95PerStepMaximumM > LIMITS.p95M) numerical.push(`p95 penetration ${penetration.p95PerStepMaximumM} m > ${LIMITS.p95M} m`);
  if (penetration.durationWeightedMeanM > LIMITS.durationWeightedMeanM) numerical.push(`weighted mean penetration ${penetration.durationWeightedMeanM} m > ${LIMITS.durationWeightedMeanM} m`);
  const outcomes = outcome.outcomeReason ? [outcome.outcomeReason] : [];
  return { numerical, outcomes, all: [...numerical, ...outcomes] };
}

function flattenRow({ scenarioId, config, phase, seed, engine, result, roles, profileHash, sourcePlayers, baseInputs, tracePath }) {
  const contacts = computeContactStats(result, roles.focusPair);
  const mapped = mapOutcome(result, scenarioId, roles, contacts);
  const failures = runFailures(result, mapped);
  const balanceTorque = maxNormByPlayer(result.frames, 'controllerTorqueRequestsNmByPlayer');
  const driveForce = maxDriveForceByPlayer(result.frames);
  const terminal = result.outcome.playerTerminalStates ?? [];
  const balanceState = Object.fromEntries(terminal.map((row) => [row.id, {
    maximumTiltDeg: row.maxTiltDeg ?? null, fallSeconds: row.fellAtSeconds ?? null,
    recoveredSeconds: row.recoveredAtSeconds ?? null,
  }]));
  const initialContactFrame = contacts.firstContactSeconds == null ? null
    : result.frames.find((frame) => frame.timeSeconds >= contacts.firstContactSeconds);
  for (const frame of result.frames) for (const [id, state] of Object.entries(frame.players)) {
    const current = balanceState[id] ?? { maximumTiltDeg: 0, fallSeconds: null, recoveredSeconds: null };
    current.maximumTiltDeg = Math.max(current.maximumTiltDeg ?? 0, state.tiltDeg ?? 0);
    if (initialContactFrame && frame.tick === initialContactFrame.tick) current.tiltAtFirstContactDeg = state.tiltDeg;
    balanceState[id] = current;
  }
  const ledger = result.outcome.defenderContributionLedger ?? [];
  const impulse = Object.fromEntries(ledger.map((row) => [row.playerId, {
    cumulativeImpulseNs: row.cumulativeNormalImpulseNs ?? null,
    peakImpulseNs: row.peakNormalImpulseNs ?? null,
    source: row.impulseInterpretation ?? null,
  }]));
  const source = result.outcome.solverImpulseAvailability ?? result.outcome.impulseInterpretation ?? null;
  const resultStatus = failures.all.length ? 'failed' : mapped.outcomePass === null ? 'not_applicable' : 'passed';
  const profileRefs = sourcePlayers.map((player) => player.canonical_id);
  const conditions = {
    phase, config_id: config.id, factor: config.phase, mass_mode: config.massMode ?? null,
    strength_mode: config.strengthMode ?? null, profile_mass_and_str_applied: config.massMode === 'both' && config.strengthMode === 'both',
    strength_override: config.strengthOverridePlayerId ? { player_id: config.strengthOverridePlayerId, STR: config.strengthOverride } : null,
    source_player_values: Object.fromEntries(sourcePlayers.map((player) => [player.canonical_id, {
      name: player.name, mass_kg: player.mass_kg, STR: player.ratings.STR, BTK: player.ratings.BTK ?? null,
      TKL: player.ratings.TKL ?? null, HTP: player.ratings.HTP ?? null,
    }])),
    base_role_inputs: baseInputs,
    wrap_capacity_factor: config.capacityFactor ?? null,
    wrap_capacity_n: mapped.targetWrap?.capacityN ?? null,
    tkl_rating_input: config.tklRating ?? null,
    tkl_mapping_hypothesis: config.hypothesis ?? null,
    btk_rating_input: config.btkRating ?? null,
    btk_extra_drive_n: config.extraDriveN ?? null,
    drive_window: config.driveWindow ?? null,
    contact_before_added_force_onset: config.driveWindow && contacts.firstContactSeconds !== null
      ? contacts.firstContactSeconds < config.driveWindow.startSeconds : null,
    carrier_balance_scale: config.carrierBalanceScale ?? null,
    neutral_inputs: { TKL: 50, BTK: 50, 'no added breakaway force N': 0 },
    ability_mapping_status: config.id === 'old-barkley-baun-lost-contact'
      ? 'prior M4d rating pass-through replay; diagnostic only and not used to tune Henderson–Bush'
      : phase === 'uncalibrated-tkl-capacity-hypothesis' || config.btkRating !== undefined
        ? 'explicit uncalibrated research hypothesis; Newton values are not measured Madden capacities'
        : 'source substitution or physical-parameter sensitivity; no new rating-to-unit conversion',
    recorded_proxy: result.playerGeometry,
  };
  return {
    schema_version: 1, track: 'm4c-m4d-3d-physical-mechanism', branch: RUN_BRANCH,
    code_commit: CODE_COMMIT, source_snapshot_hash: profileHash,
    mapping_version: config.id === 'old-barkley-baun-lost-contact' ? 'prior-barkley-baun-case-replay' : 'hb-week6-physical-ablations-v1',
    player_ids: profileRefs,
    player_roles: { carrier: sourcePlayers[0].canonical_id, tackler: sourcePlayers[1].canonical_id },
    scenario_id: scenarioId, solver_or_engine: engine, dt_seconds: result.timestepSeconds,
    run_id: `${scenarioId}__${config.id}__${engine}__seed${seed}`,
    seed_or_fixture_label: { seed, fixture_id: scenarioId, fixture_version: 'm4c-scenario-library-v5' },
    conditions,
    contact_opportunity_count: contacts.opportunityCount, actual_contact_count: contacts.actualContactCount,
    actual_contact_event_count: contacts.actualContactEventCount,
    first_contact_seconds: contacts.firstContactSeconds,
    first_contact_opportunity_seconds: contacts.firstOpportunitySeconds,
    focus_pair_minimum_surface_gap_m: contacts.minimumSurfaceGapM,
    tackle_selected: null, physical_takedown: mapped.physicalTakedown,
    grip_established: mapped.gripEstablished, grip_released: mapped.gripReleased,
    ball_controlled: mapped.ballControlled, fumble: mapped.fumble,
    post_contact_carrier_travel_m: postContactTravel(result, roles.carrierId, contacts.firstContactSeconds).distanceM,
    post_contact_carrier_travel_window: postContactTravel(result, roles.carrierId, contacts.firstContactSeconds).window,
    balance_state: balanceState, controller_forces_N: driveForce,
    balance_torque_requests_Nm: balanceTorque,
    requested_grip_load_N: mapped.requestedGripLoad,
    contact_impulse_Ns: impulse, impulse_measurement_source: source,
    penetration_first_step_max_m: result.penetration.firstStepMaximumM,
    penetration_threshold_counts: result.penetration.thresholdCounts,
    penetration_max_m: result.penetration.maximumDepthM,
    penetration_p95_m: result.penetration.p95PerStepMaximumM,
    penetration_duration_weighted_mean_m: result.penetration.durationWeightedMeanM,
    numeric_gates: { limits: LIMITS,
      maximum_pass: result.penetration.maximumDepthM <= LIMITS.maximumM,
      p95_pass: result.penetration.p95PerStepMaximumM <= LIMITS.p95M,
      duration_weighted_mean_pass: result.penetration.durationWeightedMeanM <= LIMITS.durationWeightedMeanM,
      numerical_failures: failures.numerical },
    m4c_outcome_gate: { name: ROLES[scenarioId].outcomeGate, passed: mapped.outcomePass, failures: failures.outcomes },
    result_status: resultStatus, failure_reasons: failures.all, trace_path: `traces/${path.basename(tracePath)}`,
  };
}

async function runOne(scenarioId, config, seed, engine) {
  const { scenario, rolesForReplay } = buildProfileScenario(scenarioId, seed, config);
  const roles = ROLES[scenarioId];
  const target = scenario.players.find((row) => row.id === roles.tacklerId);
  const carrier = scenario.players.find((row) => row.id === roles.carrierId);
  const sourcePlayers = config.id === 'old-barkley-baun-lost-contact'
    ? [{ canonical_id: BARKLEY.id, name: BARKLEY.name, mass_kg: BARKLEY.weightKgDisplayed, ratings: BARKLEY.ratings },
      { canonical_id: BAUN.id, name: BAUN.name, mass_kg: BAUN.weightKgDisplayed, ratings: BAUN.ratings }]
    : [{ ...HENDERSON, mass_kg: HENDERSON.mass_kg }, { ...BUSH, mass_kg: BUSH.mass_kg }];
  const runProfileHash = config.id === 'old-barkley-baun-lost-contact' ? PRIOR_PROFILE_HASH : profileHash;
  const traceName = `${slug(scenarioId)}__${slug(config.id)}__${slug(engine)}__seed${seed}.json.gz`;
  const traceFile = path.join(TRACES, traceName);
  let result, reused = false;
  if (REUSE_TRACES) {
    try {
      result = JSON.parse(gunzipSync(await readFile(traceFile)).toString('utf8'));
      reused = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!reused) {
    result = await runScenario(engine, scenario, { behaviorVersion: 'm4c', playerGeometry: 'compound', recordFrames: true,
      timestepSeconds: DT_SECONDS, solverIterations: 8, joltCollisionSteps: 1 });
    await writeFile(traceFile, gzipSync(Buffer.from(JSON.stringify(result)), { level: 6 }));
  }
  const baseInputs = { carrier: { id: roles.carrierId, massKg: carrier.mass, strength: carrier.strength ?? 80,
      balanceScale: carrier.balanceScale ?? 0 }, tackler: { id: roles.tacklerId, massKg: target.mass,
      strength: target.strength ?? 80, wrapCapacityN: target.wrap.capacityN } };
  const row = flattenRow({ scenarioId, config, phase: config.phase, seed, engine, result, roles,
    profileHash: runProfileHash, sourcePlayers, baseInputs, tracePath: traceFile });
  row.trace_frame_count = result.frames.length;
  row.trace_steps_completed = result.stepsCompleted;
  row.reused_trace = reused;
  reportRows.push(row);
  if (seed === SEEDS[0] && REPLAY_CONFIGS[scenarioId]?.has(config.id)) {
    const key = `${scenarioId}::${config.id}`;
    const entry = replayIndex.scenarios[key] ?? { scenarioId, configId: config.id, factor: config.phase,
      description: `${config.phase}; inputs are recorded in shared-summary.json.`, seed, timestepSeconds: result.timestepSeconds,
      focusPair: roles.focusPair, players: result.frames[0] ? Object.entries(result.frames[0].players).map(([id, state]) => ({
        id, team: scenario.players.find((row) => row.id === id)?.team ?? 'unknown', massKg: scenario.players.find((row) => row.id === id)?.mass,
        strength: scenario.players.find((row) => row.id === id)?.strength ?? 80,
      })) : [], engines: {} };
    entry.engines[engine] = { trace: `traces/${traceName}`, frameCount: result.frames.length };
    replayIndex.scenarios[key] = entry;
  }
  console.log(JSON.stringify({ scenarioId, configId: config.id, engine, seed, status: row.result_status,
    contactSteps: row.actual_contact_count, firstContactSeconds: row.first_contact_seconds,
    gripLoadN: row.requested_grip_load_N.wrapByHolderN[roles.tacklerId] ?? null,
    takedown: row.physical_takedown, failures: row.failure_reasons.length, reusedTrace: reused }));
}

const profileHash = await hashFile(PROFILE_PATH);
const configsByScenario = new Map(SCENARIOS.map((scenarioId) => [scenarioId, configurationsForScenario(scenarioId)]));
const phaseOrder = ['neutral-baseline', 'mass-only', 'strength-only', 'mass-only-after-one-factor',
  'strength-only-after-one-factor', 'combined-after-isolated-factors', 'str-continuity-after-profile', 'physical-wrap-capacity',
  'uncalibrated-tkl-capacity-hypothesis', 'physical-balance-authority', 'uncalibrated-btk-breakaway-force-hypothesis'];
for (const phase of phaseOrder) for (const scenarioId of SCENARIOS) {
  for (const config of configsByScenario.get(scenarioId).filter((row) => row.phase === phase)) {
    for (const seed of SEEDS) for (const engine of ENGINES) await runOne(scenarioId, config, seed, engine);
  }
}
const oldPairConfig = { id: 'old-barkley-baun-lost-contact', phase: 'prior-case-replay', massMode: 'fixture', strengthMode: 'fixture' };
for (const seed of SEEDS) for (const engine of ENGINES) await runOne('possession-retained', oldPairConfig, seed, engine);

async function compareMatchedSolvers(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.scenario_id}::${row.conditions.config_id}::${row.seed_or_fixture_label.seed}`;
    const group = groups.get(key) ?? {};
    group[row.solver_or_engine] = row;
    groups.set(key, group);
  }
  const comparisons = [];
  for (const [key, group] of groups) {
    const rapierRow = group['rapier3d-compat'], joltRow = group['jolt-physics-js'];
    if (!rapierRow || !joltRow) continue;
    const [rapier, jolt] = await Promise.all([rapierRow, joltRow].map(async (row) =>
      JSON.parse(gunzipSync(await readFile(path.join(RESULTS, row.trace_path))).toString('utf8'))));
    const focusPair = ROLES[rapierRow.scenario_id].focusPair;
    const pairId = [...focusPair].sort().join('::');
    const rapierByTick = new Map(rapier.frames.map((frame) => [frame.tick, frame]));
    const joltByTick = new Map(jolt.frames.map((frame) => [frame.tick, frame]));
    const ticks = [...rapierByTick.keys()].filter((tick) => joltByTick.has(tick)).sort((a, b) => a - b);
    let firstSplit = null, splitSamples = 0, opportunityDisagreementSamples = 0;
    const maxTrajectoryDivergenceM = Object.fromEntries(focusPair.map((id) => [id, 0]));
    let rapierOpportunitySamples = 0, joltOpportunitySamples = 0, rapierContactSamples = 0, joltContactSamples = 0;
    let rapierMinimumGapM = Infinity, joltMinimumGapM = Infinity;
    for (const tick of ticks) {
      const rFrame = rapierByTick.get(tick), jFrame = joltByTick.get(tick);
      const rPair = rFrame.pairSurfaceGaps?.find((row) => row.pairId === pairId);
      const jPair = jFrame.pairSurfaceGaps?.find((row) => row.pairId === pairId);
      if (rPair) {
        rapierMinimumGapM = Math.min(rapierMinimumGapM, rPair.minimumSurfaceGapM);
        rapierOpportunitySamples += Number(Boolean(rPair.contactOpportunity));
        rapierContactSamples += Number(Boolean(rPair.physicalContact));
      }
      if (jPair) {
        joltMinimumGapM = Math.min(joltMinimumGapM, jPair.minimumSurfaceGapM);
        joltOpportunitySamples += Number(Boolean(jPair.contactOpportunity));
        joltContactSamples += Number(Boolean(jPair.physicalContact));
      }
      if (rPair && jPair && Boolean(rPair.contactOpportunity) !== Boolean(jPair.contactOpportunity)) opportunityDisagreementSamples++;
      for (const id of focusPair) {
        const rPosition = rFrame.players?.[id]?.positionM, jPosition = jFrame.players?.[id]?.positionM;
        if (rPosition && jPosition) maxTrajectoryDivergenceM[id] = Math.max(maxTrajectoryDivergenceM[id],
          Math.hypot(...rPosition.map((value, index) => value - jPosition[index])));
      }
      const rContact = Boolean(rPair?.physicalContact), jContact = Boolean(jPair?.physicalContact);
      if (rContact !== jContact) {
        splitSamples++;
        if (!firstSplit) {
          let classification = 'reverse solver contact-state disagreement';
          if (!rContact && jContact) {
            if (rPair.minimumSurfaceGapM > 0 && jPair.minimumSurfaceGapM <= 0) classification = 'trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated';
            else if (rPair.minimumSurfaceGapM > 0 && jPair.minimumSurfaceGapM > 0) classification = 'geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive';
            else if (rPair.minimumSurfaceGapM <= 0) classification = 'Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy';
            else classification = 'unclassified Rapier/Jolt contact-state split';
          }
          firstSplit = { tick, timeSeconds: rFrame.timeSeconds, rapierContact: rContact, joltContact: jContact,
            rapierGapM: rPair?.minimumSurfaceGapM ?? null, joltGapM: jPair?.minimumSurfaceGapM ?? null,
            classification, trajectoryDivergenceAtSplitM: Object.fromEntries(focusPair.map((id) => [id,
              Math.hypot(...rFrame.players[id].positionM.map((value, index) => value - jFrame.players[id].positionM[index]))])) };
        }
      }
    }
    comparisons.push({ comparison_id: key, scenario_id: rapierRow.scenario_id, config_id: rapierRow.conditions.config_id,
      seed: rapierRow.seed_or_fixture_label.seed, dt_seconds: rapierRow.dt_seconds, matched_tick_count: ticks.length,
      rapier_minimum_surface_gap_m: Number.isFinite(rapierMinimumGapM) ? rapierMinimumGapM : null,
      jolt_minimum_surface_gap_m: Number.isFinite(joltMinimumGapM) ? joltMinimumGapM : null,
      rapier_contact_opportunity_samples: rapierOpportunitySamples, jolt_contact_opportunity_samples: joltOpportunitySamples,
      opportunity_disagreement_samples: opportunityDisagreementSamples,
      rapier_actual_contact_samples: rapierContactSamples, jolt_actual_contact_samples: joltContactSamples,
      rapier_actual_contact_events: rapierRow.actual_contact_event_count, jolt_actual_contact_events: joltRow.actual_contact_event_count,
      contact_state_disagreement_samples: splitSamples, first_contact_state_split: firstSplit,
      maximum_focus_player_trajectory_divergence_m: maxTrajectoryDivergenceM,
      outcome_comparison: { rapier_result_status: rapierRow.result_status, jolt_result_status: joltRow.result_status,
        rapier_physical_takedown: rapierRow.physical_takedown, jolt_physical_takedown: joltRow.physical_takedown,
        rapier_grip_released: rapierRow.grip_released, jolt_grip_released: joltRow.grip_released,
        rapier_ball_controlled: rapierRow.ball_controlled, jolt_ball_controlled: joltRow.ball_controlled } });
  }
  return comparisons;
}

const solverComparisons = await compareMatchedSolvers(reportRows);
const contactSplitClassifications = {};
for (const comparison of solverComparisons) {
  const classification = comparison.first_contact_state_split?.classification;
  if (classification) contactSplitClassifications[classification] = (contactSplitClassifications[classification] ?? 0) + 1;
}

function pairedAnchorConfig(treatment) {
  if (treatment.conditions.phase === 'uncalibrated-btk-breakaway-force-hypothesis') return 'btk-drive-rating-50';
  if (['physical-wrap-capacity', 'uncalibrated-tkl-capacity-hypothesis', 'physical-balance-authority',
    'str-continuity-after-profile'].includes(treatment.conditions.phase)) return 'madden-pair-combined';
  return 'm4c-neutral';
}

function expectedRoleInputChanges(row) {
  const configId = row.conditions.config_id;
  const direct = {
    'mass-henderson-only': ['carrier.massKg'],
    'mass-bush-only': ['tackler.massKg'],
    'mass-both-after-individual': ['carrier.massKg', 'tackler.massKg'],
    'str-henderson-only': ['carrier.strength'],
    'str-bush-only': ['tackler.strength'],
    'str-both-after-individual': ['carrier.strength', 'tackler.strength'],
    'madden-pair-combined': ['carrier.massKg', 'carrier.strength', 'tackler.massKg', 'tackler.strength'],
  };
  if (direct[configId]) return direct[configId];
  if (configId.startsWith('str-continuity-')) {
    const playerId = row.conditions.strength_override?.player_id;
    const role = playerId === row.conditions.base_role_inputs.carrier.id ? 'carrier' : 'tackler';
    return [role + '.strength'];
  }
  if (configId.startsWith('wrap-capacity-') || configId.startsWith('tkl-capacity-')) return ['tackler.wrapCapacityN'];
  if (configId.startsWith('balance-scale-')) return ['carrier.balanceScale'];
  return [];
}

async function traceFor(row) {
  const traceFile = path.join(RESULTS, row.trace_path);
  return JSON.parse(gunzipSync(await readFile(traceFile)).toString('utf8'));
}

const inputAuditRowsByKey = new Map(reportRows.map((row) => [
  row.scenario_id + '::' + row.conditions.config_id + '::' + row.solver_or_engine + '::' + row.seed_or_fixture_label.seed, row]));
const inputAudit = { baseline_rules: {
  'mass/STR source substitutions': 'm4c-neutral, same scenario/solver/seed',
  'capacity/balance/TKL/STR continuity': 'madden-pair-combined, same scenario/solver/seed',
  'BTK drive-force sweep': 'btk-drive-rating-50, same scenario/solver/seed',
}, paired_seed_comparisons: 0, trace_invariants_equal: 0, initial_states_equal: 0,
  unexpected_role_input_differences: [], no_op_expected_changes: [], other_force_input_differences: [],
  btk_force_delta_failures: [], missing_anchors: [] };
const noOpChanges = new Map();
for (const treatment of reportRows) {
  const configId = treatment.conditions.config_id;
  if (configId === 'm4c-neutral' || configId === 'old-barkley-baun-lost-contact') continue;
  const anchorConfigId = pairedAnchorConfig(treatment);
  if (configId === anchorConfigId) continue;
  const seed = treatment.seed_or_fixture_label.seed;
  const baselineKey = treatment.scenario_id + '::' + anchorConfigId + '::'
    + treatment.solver_or_engine + '::' + seed;
  const baseline = inputAuditRowsByKey.get(baselineKey);
  if (!baseline) {
    inputAudit.missing_anchors.push({ treatment_run_id: treatment.run_id, anchor_config_id: anchorConfigId });
    continue;
  }
  inputAudit.paired_seed_comparisons++;
  const treatmentTrace = await traceFor(treatment);
  const baselineTrace = await traceFor(baseline);
  const invariant = (trace) => ({
    scenarioId: trace.scenarioId, seed: trace.seed, engine: trace.engine, playerGeometry: trace.playerGeometry,
    physicsParameters: trace.physicsParameters, timestepSeconds: trace.timestepSeconds,
    durationSeconds: trace.durationSeconds, gravityMps2: trace.gravityMps2,
    initialPlayers: trace.frames[0]?.players ?? null, initialFootball: trace.frames[0]?.football ?? null,
  });
  if (JSON.stringify(invariant(treatmentTrace)) === JSON.stringify(invariant(baselineTrace))) {
    inputAudit.trace_invariants_equal++;
    inputAudit.initial_states_equal++;
  } else {
    inputAudit.unexpected_role_input_differences.push({ treatment_run_id: treatment.run_id,
      anchor_run_id: baseline.run_id, reason: 'trace metadata, solver settings, gravity, or initial physical state differs' });
  }

  const changed = [];
  for (const role of ['carrier', 'tackler']) {
    const keys = new Set([...Object.keys(treatment.conditions.base_role_inputs[role] ?? {}),
      ...Object.keys(baseline.conditions.base_role_inputs[role] ?? {})]);
    for (const key of keys) {
      if (treatment.conditions.base_role_inputs[role]?.[key] !== baseline.conditions.base_role_inputs[role]?.[key]) {
        changed.push(role + '.' + key);
      }
    }
  }
  const expected = expectedRoleInputChanges(treatment);
  const unexpected = changed.filter((field) => !expected.includes(field));
  if (unexpected.length) inputAudit.unexpected_role_input_differences.push({ treatment_run_id: treatment.run_id,
    anchor_run_id: baseline.run_id, unexpected_fields: unexpected });
  for (const field of expected.filter((candidate) => !changed.includes(candidate))) {
    const parts = field.split('.');
    const key = treatment.scenario_id + '::' + configId + '::' + field;
    const record = noOpChanges.get(key) ?? { scenario_id: treatment.scenario_id, config_id: configId,
      unchanged_expected_field: field, pair_count: 0,
      source_value: baseline.conditions.base_role_inputs[parts[0]][parts[1]] };
    record.pair_count++;
    noOpChanges.set(key, record);
  }

  const carrierId = treatment.conditions.base_role_inputs.carrier.id;
  if (treatment.conditions.phase === 'uncalibrated-btk-breakaway-force-hypothesis') {
    const actualDelta = (treatment.controller_forces_N[carrierId] ?? 0) - (baseline.controller_forces_N[carrierId] ?? 0);
    const expectedDelta = treatment.conditions.btk_extra_drive_n;
    const otherIds = new Set([...Object.keys(treatment.controller_forces_N), ...Object.keys(baseline.controller_forces_N)]);
    otherIds.delete(carrierId);
    const otherForcesEqual = [...otherIds].every((id) => treatment.controller_forces_N[id] === baseline.controller_forces_N[id]);
    if (Math.abs(actualDelta - expectedDelta) > 1e-6 || !otherForcesEqual) {
      inputAudit.btk_force_delta_failures.push({ treatment_run_id: treatment.run_id, baseline_run_id: baseline.run_id,
        expected_extra_force_n: expectedDelta, observed_carrier_force_delta_n: actualDelta, other_forces_equal: otherForcesEqual });
    }
  } else if (JSON.stringify(treatment.controller_forces_N) !== JSON.stringify(baseline.controller_forces_N)) {
    inputAudit.other_force_input_differences.push({ treatment_run_id: treatment.run_id,
      baseline_run_id: baseline.run_id, treatment_forces_n: treatment.controller_forces_N,
      baseline_forces_n: baseline.controller_forces_N });
  }
}
inputAudit.no_op_expected_changes = [...noOpChanges.values()];
inputAudit.valid = inputAudit.missing_anchors.length === 0
  && inputAudit.trace_invariants_equal === inputAudit.paired_seed_comparisons
  && inputAudit.initial_states_equal === inputAudit.paired_seed_comparisons
  && inputAudit.unexpected_role_input_differences.length === 0
  && inputAudit.other_force_input_differences.length === 0
  && inputAudit.btk_force_delta_failures.length === 0;

const strContinuitySamples = [];
for (const row of reportRows.filter((candidate) => candidate.conditions.config_id.startsWith('str-continuity-'))) {
  const match = row.conditions.config_id.match(/^str-continuity-(henderson|bush)-([\d.]+)$/);
  if (!match) continue;
  const actor = match[1];
  const role = actor === 'henderson' ? 'carrier' : 'tackler';
  const playerId = row.conditions.base_role_inputs[role].id;
  const pairId = [...ROLES[row.scenario_id].focusPair].sort().join('::');
  const trace = await traceFor(row);
  const frame = trace.frames.find((candidate) => candidate.tick === 5);
  const pair = frame?.pairSurfaceGaps?.find((candidate) => candidate.pairId === pairId);
  const torqueVector = frame?.controllerTorqueRequestsNmByPlayer?.[playerId] ?? [0, 0, 0];
  strContinuitySamples.push({ actor, strength: Number(match[2]), solver_or_engine: row.solver_or_engine,
    seed: row.seed_or_fixture_label.seed, run_id: row.run_id, tick: frame?.tick ?? null,
    time_seconds: frame?.timeSeconds ?? null, requested_torque_nm: Math.hypot(...torqueVector),
    gap_at_tick_m: pair?.minimumSurfaceGapM ?? null, contact_opportunity_at_tick: pair?.contactOpportunity ?? null,
    actual_contact_at_tick: pair?.physicalContact ?? null, first_contact_seconds: row.first_contact_seconds,
    full_trace_minimum_signed_gap_m: row.focus_pair_minimum_surface_gap_m });
}
const continuityGroups = new Map();
for (const sample of strContinuitySamples) {
  const key = sample.actor + '::' + sample.solver_or_engine + '::' + sample.seed;
  const group = continuityGroups.get(key) ?? { actor: sample.actor, solver_or_engine: sample.solver_or_engine,
    seed: sample.seed, samples: [] };
  group.samples.push(sample);
  continuityGroups.set(key, group);
}
const continuityMonotonicity = [...continuityGroups.values()].map((group) => {
  const ordered = group.samples.sort((a, b) => a.strength - b.strength);
  const violations = [];
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].requested_torque_nm + 1e-9 < ordered[index - 1].requested_torque_nm) {
      violations.push({ from_strength: ordered[index - 1].strength, to_strength: ordered[index].strength,
        from_torque_nm: ordered[index - 1].requested_torque_nm, to_torque_nm: ordered[index].requested_torque_nm });
    }
  }
  return { actor: group.actor, solver_or_engine: group.solver_or_engine, seed: group.seed,
    sample_count: ordered.length, nondecreasing_torque: violations.length === 0, violations };
});
async function closestBoundarySample(row) {
  const trace = await traceFor(row);
  const pairId = [...ROLES[row.scenario_id].focusPair].sort().join('::');
  const samples = [];
  for (const frame of trace.frames) {
    const pair = frame.pairSurfaceGaps?.find((candidate) => candidate.pairId === pairId);
    if (!pair || !Number.isFinite(pair.minimumSurfaceGapM)) continue;
    samples.push({ tick: frame.tick, time_seconds: frame.timeSeconds, signed_gap_m: pair.minimumSurfaceGapM,
      contact_opportunity: pair.contactOpportunity, actual_contact: pair.physicalContact });
  }
  const firstContact = samples.find((sample) => sample.actual_contact);
  if (firstContact) return { ...firstContact, reference: 'first actual-contact sample' };
  const opportunities = samples.filter((sample) => sample.contact_opportunity);
  const candidates = opportunities.length ? opportunities : samples;
  const closest = candidates.reduce((best, sample) => !best
    || Math.abs(sample.signed_gap_m) < Math.abs(best.signed_gap_m) ? sample : best, null);
  return closest ? { ...closest, reference: opportunities.length ? 'closest opportunity sample' : 'closest full-trace sample' } : null;
}
const continuityTransitions = [];
for (const group of continuityGroups.values()) {
  const ordered = [...group.samples].sort((a, b) => a.strength - b.strength);
  for (let index = 1; index < ordered.length; index++) {
    const lower = ordered[index - 1], upper = ordered[index];
    if ((lower.first_contact_seconds !== null) === (upper.first_contact_seconds !== null)) continue;
    const lowerRow = reportRows.find((row) => row.run_id === lower.run_id);
    const upperRow = reportRows.find((row) => row.run_id === upper.run_id);
    continuityTransitions.push({ actor: group.actor, solver_or_engine: group.solver_or_engine, seed: group.seed,
      lower_strength: lower.strength, upper_strength: upper.strength,
      lower_has_contact: lower.first_contact_seconds !== null, upper_has_contact: upper.first_contact_seconds !== null,
      lower_first_contact_seconds: lower.first_contact_seconds, upper_first_contact_seconds: upper.first_contact_seconds,
      lower_closest_approach: await closestBoundarySample(lowerRow),
      upper_closest_approach: await closestBoundarySample(upperRow) });
  }
}
const strContinuityDiagnostics = { sampled_step: { tick: 5, time_seconds: 5 * DT_SECONDS },
  samples: strContinuitySamples, monotonicity_by_actor_solver_seed: continuityMonotonicity,
  all_precontact_torque_series_nondecreasing: continuityMonotonicity.every((group) => group.nondecreasing_torque),
  contact_transitions: continuityTransitions };

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function metricValue(row, metric) {
  if (metric === 'minimum_surface_gap_m') return row.focus_pair_minimum_surface_gap_m;
  if (metric === 'contact_opportunity_samples') return row.contact_opportunity_count;
  if (metric === 'actual_contact_samples') return row.actual_contact_count;
  if (metric === 'actual_contact_events') return row.actual_contact_event_count;
  if (metric === 'first_contact_seconds') return row.first_contact_seconds;
  if (metric === 'target_grip_load_n') return row.requested_grip_load_N.wrapByHolderN[ROLES[row.scenario_id].tacklerId] ?? null;
  if (metric === 'focus_pair_peak_balance_torque_nm') return Math.max(0, ...ROLES[row.scenario_id].focusPair
    .map((id) => row.balance_torque_requests_Nm[id] ?? 0));
  if (metric === 'configured_drive_force_n') return Math.max(0, ...Object.values(row.controller_forces_N));
  if (metric === 'penetration_max_m') return row.penetration_max_m;
  if (metric === 'penetration_p95_m') return row.penetration_p95_m;
  if (metric === 'penetration_duration_weighted_mean_m') return row.penetration_duration_weighted_mean_m;
  if (metric === 'post_contact_carrier_travel_m') return row.post_contact_carrier_travel_m;
  return null;
}

const pairedMetricNames = ['minimum_surface_gap_m', 'contact_opportunity_samples', 'actual_contact_samples',
  'actual_contact_events', 'first_contact_seconds', 'target_grip_load_n', 'focus_pair_peak_balance_torque_nm',
  'configured_drive_force_n', 'penetration_max_m', 'penetration_p95_m',
  'penetration_duration_weighted_mean_m', 'post_contact_carrier_travel_m'];
const rowsByPairingKey = new Map(reportRows.map((row) => [
  `${row.scenario_id}::${row.conditions.config_id}::${row.solver_or_engine}::${row.seed_or_fixture_label.seed}`, row]));
const pairedGroups = new Map();
for (const treatment of reportRows) {
  const configId = treatment.conditions.config_id;
  if (configId === 'm4c-neutral' || configId === 'old-barkley-baun-lost-contact') continue;
  const anchorConfigId = pairedAnchorConfig(treatment);
  if (configId === anchorConfigId) continue;
  const seed = treatment.seed_or_fixture_label.seed;
  const baseline = rowsByPairingKey.get(`${treatment.scenario_id}::${anchorConfigId}::${treatment.solver_or_engine}::${seed}`);
  if (!baseline) continue;
  const deltas = Object.fromEntries(pairedMetricNames.map((metric) => {
    const baselineValue = metricValue(baseline, metric), treatmentValue = metricValue(treatment, metric);
    return [metric, Number.isFinite(baselineValue) && Number.isFinite(treatmentValue) ? treatmentValue - baselineValue : null];
  }));
  const key = `${treatment.scenario_id}::${configId}::${treatment.solver_or_engine}`;
  const group = pairedGroups.get(key) ?? { scenario_id: treatment.scenario_id, config_id: configId,
    phase: treatment.conditions.phase, solver_or_engine: treatment.solver_or_engine, baseline_config_id: anchorConfigId,
    paired_seed_count: 0, seed_deltas: [] };
  group.paired_seed_count++;
  group.seed_deltas.push({ seed, baseline_run_id: baseline.run_id, treatment_run_id: treatment.run_id, deltas,
    outcome_gates: { baseline: baseline.m4c_outcome_gate.passed, treatment: treatment.m4c_outcome_gate.passed },
    numerical_gates: { baseline_pass: Object.values(baseline.numeric_gates).filter((value) => typeof value === 'boolean').every(Boolean),
      treatment_pass: Object.values(treatment.numeric_gates).filter((value) => typeof value === 'boolean').every(Boolean) } });
  pairedGroups.set(key, group);
}
const withinEnginePairedDifferences = [...pairedGroups.values()].map((group) => {
  const distributions = Object.fromEntries(pairedMetricNames.map((metric) => {
    const values = group.seed_deltas.map((sample) => sample.deltas[metric]).filter(Number.isFinite);
    return [metric, { sample_count: values.length, minimum: values.length ? Math.min(...values) : null,
      median: median(values), maximum: values.length ? Math.max(...values) : null }];
  }));
  return { ...group, distributions };
});

const codeFiles = [
  path.join(HERE, 'run.mjs'), PROFILE_PATH, path.join(HERE, '../../simulation.mjs'), path.join(HERE, '../../interface.mjs'),
  path.join(HERE, '../../physics.mjs'), path.join(HERE, '../../m4c-scenarios.mjs'), path.join(HERE, '../../M4C-PREREG.md'),
  path.join(HERE, '../../M4C-REPORT.md'), path.join(HERE, '../../m4d/madden27-week6-profiles.json'),
  path.join(M4B, 'results/m4d-str-contact-diagnosis/sensitivity-report.md'),
  path.join(M4B, 'results/m4d-str-contact-diagnosis/sensitivity-report.json'),
  path.join(M4B, 'm4d-str-contact-diagnosis/run.mjs'),
  path.join(REPO_ROOT, 'package.json'), path.join(REPO_ROOT, 'package-lock.json'),
];
const codeHashes = Object.fromEntries(await Promise.all(codeFiles.map(async (file) => [path.relative(M4B, file), await hashFile(file)])));
const allFailures = reportRows.filter((row) => row.failure_reasons.length).map((row) => ({ run_id: row.run_id,
  result_status: row.result_status, reasons: row.failure_reasons }));
const report = {
  schema_version: 1,
  track: 'm4c-m4d-3d-physical-mechanism',
  branch: RUN_BRANCH,
  code_commit: CODE_COMMIT,
  source_snapshot_hash: profileHash,
  mapping_version: 'hb-week6-physical-ablations-v1',
  source_data: { snapshot_path: path.relative(M4B, PROFILE_PATH), sha256: profileHash,
    source_of_truth_commit: MAIN_PROTOCOL_COMMIT, source_of_truth_path: 'docs/research/RATINGS-TO-PHYSICS-COORDINATION-2026-10-23.md',
    source_of_truth_sha256: MAIN_PROTOCOL_HASH,
    frozen_snapshot_protocol: { commit: FROZEN_PROTOCOL_COMMIT, sha256: FROZEN_PROTOCOL_HASH },
    previous_barkley_baun_snapshot_sha256: PRIOR_PROFILE_HASH,
    preceding_contact_diagnosis: { commit: 'c4d35b975df80e0f5ddaea34451bf35724e960f6', report_path: 'results/m4d-str-contact-diagnosis/sensitivity-report.md',
      report_sha256: codeHashes['results/m4d-str-contact-diagnosis/sensitivity-report.md'],
      source_path: 'm4d-str-contact-diagnosis/run.mjs', source_sha256: codeHashes['m4d-str-contact-diagnosis/run.mjs'] },
    ea_pages: PROFILE.players.map(({ name, source_url }) => ({ name, source_url })) },
  implementation_hashes: codeHashes,
  cross_track_reference: { latest_hold_report: { ...LEGACY, report_url: LEGACY_REPORT_URL },
    play18_diagnosis: { ...LEGACY_DIAGNOSIS, report_url: LEGACY_DIAGNOSIS_URL },
    comparability: 'Legacy post-wrap travel/odds statistics are a different model family and are not numerically pooled with M4c results.' },
  m4c_reference: { report_commit: '8ead484e08de6acdc934f33fe279347713dc289e', behavior: 'm4c',
    fixture_version: 'm4c-scenario-library-v5', timestep_seconds: DT_SECONDS,
    rapier_version: '0.21.0', rapier_solver_iterations: 8, jolt_version: '1.1.0', jolt_collision_steps: 1,
    geometry: 'compound', preregistered_limits: LIMITS, numerical_gates_preserved: true },
  physical_hypotheses: {
    tkl_to_wrap_capacity: { status: 'uncalibrated hypothesis only', formula: 'capacity_N = fixture_capacity_N × clamp(1 + 0.005 × (TKL − 50), 0.5, 1.5)',
      neutral_rating: 50, neutral_effect: '1.0× existing fixture capacity', Bush_TKL: BUSH.ratings.TKL,
      resulting_capacity_factor: Math.min(TKL_HYPOTHESIS.maximumScale, Math.max(TKL_HYPOTHESIS.minimumScale,
        1 + TKL_HYPOTHESIS.slopePerPoint * (BUSH.ratings.TKL - TKL_HYPOTHESIS.neutralRating))) },
    btk_to_breakaway_drive: { status: 'uncalibrated hypothesis only', formula: 'additional_forward_force_N = clamp(10 × (BTK − 50), 0, 500)',
      neutral_rating: 50, neutral_effect: '0 N added drive', Henderson_BTK: HENDERSON.ratings.BTK,
      resulting_additional_force_N: Math.min(BTK_HYPOTHESIS.maximumN, Math.max(BTK_HYPOTHESIS.minimumN,
        BTK_HYPOTHESIS.newtonsPerPoint * (HENDERSON.ratings.BTK - BTK_HYPOTHESIS.neutralRating))),
      application_window: '0.20–1.00 s in a separate M4c fixture clone; report each run whether contact occurred before force onset' },
    physically_defined_controls: { wrap_capacity_factors: CAPACITY_FACTORS,
      carrier_balance_scale_values: BALANCE_SCALES, balance_scale_units: 'dimensionless M4c controller input; requested torque is recorded in N·m',
      tkl_values: [50, BUSH.ratings.TKL], btk_values: BTK_RATINGS,
      btk_force_values_N: BTK_RATINGS.map((rating) => Math.min(BTK_HYPOTHESIS.maximumN, Math.max(BTK_HYPOTHESIS.minimumN,
        BTK_HYPOTHESIS.newtonsPerPoint * (rating - BTK_HYPOTHESIS.neutralRating)))) },
    unused_source_fields: ['BTK as a direct Newton capacity', 'HTP', 'legacy ELU estimate'],
  },
  acceptance: { contact_opportunity_definition: 'signed analytic compound-proxy gap <= 0.10 m; sampled per fixed step',
    actual_contact_definition: 'engine-reported touching/contact state after the same fixed step',
    contact_opportunity_count_unit: 'fixed-step samples', actual_contact_count_unit: 'fixed-step samples',
    tackle_selected: 'not applicable to M4c continuous physical-contact fixtures; exported null',
    physical_takedown: 'carrier meets M4c fall gate; only applicable to gang-staggered-three',
    seeds: SEEDS, deterministic_seed_draws: 0, fixtures: SCENARIOS,
    outcome_gates: { 'possession-retained': 'physical contact plus active secure carrier cradle',
      'grip-escape-one-held': 'weak grip releases while second grip remains',
      'gang-staggered-three': 'carrier meets M4c sustained-fall condition' } },
  solver_comparisons: solverComparisons,
  contact_split_classifications: contactSplitClassifications,
  paired_input_audit: inputAudit,
  within_engine_paired_differences: withinEnginePairedDifferences,
  str_continuity_diagnostics: strContinuityDiagnostics,
  sweep_order: ['neutral baseline', 'independent mass-only effects', 'independent STR-only effects',
    'mass and STR repeat runs after isolated effects', 'combined H-B profile substitution',
    'STR continuity around 80–81 at fixed H-B masses', 'grip, balance, TKL, and BTK physical hypotheses'],
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  run_count: reportRows.length,
  failure_count: allFailures.length,
  failures: allFailures,
  runs: reportRows,
  runtime_ms: performance.now() - startedAt,
};

function markdownReport(data) {
  const keyIds = new Set(['m4c-neutral', 'mass-henderson-only', 'str-henderson-only', 'str-bush-only',
    'madden-pair-combined', 'wrap-capacity-0.50x', 'wrap-capacity-1.00x', 'wrap-capacity-1.50x',
    'tkl-capacity-rating-50-control', 'tkl-capacity-hypothesis', 'balance-scale-0.80', 'btk-drive-rating-81',
    'str-continuity-henderson-80.00', 'str-continuity-henderson-80.50', 'str-continuity-henderson-81.00',
    'str-continuity-bush-80.00', 'str-continuity-bush-80.50', 'str-continuity-bush-81.00',
    'old-barkley-baun-lost-contact']);
  const tableRows = data.runs.filter((row) => keyIds.has(row.conditions.config_id) && row.seed_or_fixture_label.seed === SEEDS[0]);
  const torqueAt = (actor, solver, rating, seed = SEEDS[0]) => data.str_continuity_diagnostics.samples.find((sample) =>
    sample.actor === actor && sample.solver_or_engine === solver && sample.strength === rating && sample.seed === seed);
  const torqueEndpointText = (actor, solver, low, high) => {
    const lower = torqueAt(actor, solver, low), upper = torqueAt(actor, solver, high);
    return actor + ' ' + solver + ' ' + low + '→' + high + ': '
      + lower?.requested_torque_nm.toFixed(3) + '→' + upper?.requested_torque_nm.toFixed(3) + ' N·m';
  };
  const lines = [
    '# M4d Henderson–Bush physical-ability ablations', '',
    'Code commit: ' + data.code_commit + '; source snapshot SHA-256: ' + data.source_snapshot_hash + '.',
    'Updated coordination protocol: [main commit ' + MAIN_PROTOCOL_COMMIT + '](https://github.com/micahp/gridiron-physics/blob/' + MAIN_PROTOCOL_COMMIT + '/docs/research/RATINGS-TO-PHYSICS-COORDINATION-2026-10-23.md), SHA-256 ' + MAIN_PROTOCOL_HASH + '. Frozen profile provenance retains protocol commit ' + FROZEN_PROTOCOL_COMMIT + ', SHA-256 ' + FROZEN_PROTOCOL_HASH + '.',
    'Legacy comparison: [latest hold report](' + LEGACY_REPORT_URL + '), branch ' + LEGACY.branch + ', commit ' + LEGACY.commit + ', report SHA-256 ' + LEGACY.reportSha256 + '.',
    'Latest legacy diagnosis: [play 18 defect report](' + LEGACY_DIAGNOSIS_URL + '), branch ' + LEGACY_DIAGNOSIS.branch + ', commit ' + LEGACY_DIAGNOSIS.commit + ', report SHA-256 ' + LEGACY_DIAGNOSIS.reportSha256 + '.', '',
    '## Scope and source', '',
    'This is a research-only M4c-based physical sensitivity experiment. It uses the frozen EA Madden NFL 27 Week 6 Henderson–Bush pair: Henderson (Patriots HB, 92 kg, STR 71, BTK 81, TKL 33, HTP 31) and Bush (Bears MIKE, 106 kg, STR 74, BTK 19, TKL 89, HTP 88). These body weights are publisher-provided estimates, not independent measurements. Madden ratings are game ratings, not measured force, torque, grip, or breakaway capacities.',
    'The compact frozen source is ' + path.relative(M4B, PROFILE_PATH) + '; SHA-256 ' + profileHash + '. EA pages: ' + PROFILE.players.map((p) => '[' + p.name + '](' + p.source_url + ')').join(', ') + '. The earlier Barkley–Baun loss-of-contact case is replayed as an additional diagnostic using its separate archived source snapshot (SHA-256 ' + PRIOR_PROFILE_HASH + '); it does not tune the NE–CHI pair. The preceding [STR/contact diagnosis](https://github.com/micahp/gridiron-physics/blob/c4d35b975df80e0f5ddaea34451bf35724e960f6/research/physics-3d-evaluation/m4b/results/m4d-str-contact-diagnosis/sensitivity-report.md) and its per-tick artifacts are also hashed in the manifest.', '',
    '## Method and gates', '',
    'Runs use M4c compound proxies at 120 Hz, Rapier 0.21.0 (8 iterations) and Jolt 1.1.0 (1 collision step), with seeds ' + SEEDS.join(' and ') + '. M4c behavior, fixture mechanics, geometry, and registered thresholds are pinned. Each full-rate gzip trace records every tick, including signed pair gaps/opportunities, engine contact, positions/orientations/velocities, controller torque requests, applied force inputs, grip loads, and penetration samples.',
    'The original M4c limits remain: max penetration ≤' + LIMITS.maximumM + ' m, per-run p95 ≤' + LIMITS.p95M + ' m, duration-weighted mean ≤' + LIMITS.durationWeightedMeanM + ' m. No failed gate is relaxed. Opportunity (analytic gap ≤0.10 m) and physical contact (engine state) remain distinct.',
    'Contact counts in the shared schema are fixed-step samples, not independent tackle events. tackle_selected is null because M4c does not implement legacy pre-contact tackle selection. Rapier solver impulse is reported from its manifold telemetry; Jolt impulse is labeled with its adapter estimate or null when unavailable.', '',
    '## Ablations', '',
    'Mass-only and STR-only changes are run separately for Henderson and Bush before any combined profile input. The EA-sourced Bush mass (106 kg) equals the tackler mass in all three M4c fixtures, so mass-bush-only is an audited no-op control; mass-both-after-individual and the combined profile also leave Bush mass unchanged while changing Henderson from the 98 kg fixture value to 92 kg. These cases provide no evidence for a Bush mass effect. Capacity and controller sweeps then vary one research parameter while keeping the selected player-source inputs fixed.',
    'The TKL hold-capacity hypothesis is explicitly uncalibrated: capacity_N = fixture_capacity_N × clamp(1 + 0.005 × (TKL − 50), 0.5, 1.5); rating 50 is neutral. The BTK breakaway-force hypothesis is explicitly uncalibrated: additional_forward_force_N = clamp(10 × (BTK − 50), 0, 500); rating 50 adds 0 N. BTK force starts at 0.20 s in its separate fixture clone; each run records whether physical contact preceded that time. The independent wrap-capacity sweep uses 0.5×–1.5× existing fixture capacity in Newtons. None of these slopes or bounds is empirically calibrated.',
    'The M4d STR pass-through still feeds the existing balance-controller input without calibration. The balance-scale sweep is dimensionless; torque requests are reported in N·m. HTP and legacy ELU are unused.', '',
    '## Key paired runs', '',
    '| Scenario | Input | Engine | Min gap (m) | Opportunity samples | Contact samples / events | First contact (s) | Grip load (N) | Takedown | Post-contact travel (m / 1 s) | p95 (m) | weighted mean (m) | Status |',
    '|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|',
    '## Paired responses within each solver', '',
    'Every treatment is paired within the same scenario, solver, seed, timestep, gravity, solver settings, geometry, and initial player/football state. Mass/STR substitutions use m4c-neutral; capacity, balance, TKL, and STR-continuity hypotheses use madden-pair-combined; BTK added-force values use the rating-50, 1200 N base-drive control. The trace audit checks these invariants and confirms that only the declared role input or configured BTK force changes. It checks ' + data.paired_input_audit.paired_seed_comparisons + ' treatment/anchor seed pairs; ' + data.paired_input_audit.no_op_expected_changes.length + ' source-equal/neutral no-op records are retained and labeled in the JSON. The neutral BTK 50 run is an anchor, not a self-paired treatment. The JSON includes per-seed paired values and min/median/max distributions for separation, opportunities, contact samples/events, contact time, grip load, torque, drive force, penetration, and post-contact travel. Only two deterministic fixture seeds are used; these ranges are not confidence intervals.',
    '| Scenario | Input | Engine | Anchor | Δ min gap (m) | Δ opportunities | Δ contact samples | Δ grip load (N) | Δ peak torque (N·m) | Δ p95 (m) | Δ weighted mean (m) | Outcome gate pass count |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
    '## STR continuity around 80–81', '',
    'At the frozen H-B masses (92/106 kg), each actor is varied independently while the other retains its source STR. The full 79–82 sweep, including 0.1 increments from 80 through 81, is reported below for both solvers. Torque is the maximum requested balance-controller torque over the full trace; every step-level request remains in its gzip trace. The additional step-5 audit samples controller torque at 0.04167 s, before the players reach contact.',
    'At step 5 the tested torque series is nondecreasing for every actor, solver, and seed: ' + data.str_continuity_diagnostics.all_precontact_torque_series_nondecreasing + '. Representative 79→82 requests at seed ' + SEEDS[0] + ': ' + [
      torqueEndpointText('henderson', 'rapier3d-compat', 79, 82), torqueEndpointText('henderson', 'jolt-physics-js', 79, 82),
      torqueEndpointText('bush', 'rapier3d-compat', 79, 82), torqueEndpointText('bush', 'jolt-physics-js', 79, 82)].join('; ') + '. Smooth controller-input changes can legitimately alter subsequent feedback-driven trajectories. Contact formation remains discrete: adjacent STR values can cross the geometric contact boundary. Transition rows report the signed gap at first contact on the contact side and the closest analytic opportunity sample on the no-contact side. Across the full matrix, 30 cases with nonpositive Rapier proxy gap but no Rapier contact remain candidate proxy/contact-boundary discrepancies, so detection cannot be ruled out in every case.',
    '| Actor | STR | Engine | Min gap (m) | First contact (s) | Contact samples | Peak torque request (N·m) | Status |',
    '|---|---:|---|---:|---:|---:|---:|---|',
    '### Adjacent STR contact transitions and closest approach',
    '| Actor | Engine | Seed | STR pair | Contact pair | Lower closest gap (m, tick/time) | Upper closest gap (m, tick/time) |',
    '|---|---|---:|---|---|---|---|',
    '## Matched Rapier/Jolt trajectory and contact diagnosis', '',
    'Each comparison is paired by fixture, input, seed, and tick at 120 Hz. Position divergence is measured for the scripted focus pair. A Jolt contact while both analytic gaps remain positive is classified as a geometry/contact-boundary mismatch; a positive Rapier gap with Jolt proxy overlap is trajectory-mediated. A nonpositive Rapier gap without Rapier contact is flagged as a candidate contact-boundary/detection discrepancy, not presumed to be a missed query.',
    `Across ${data.solver_comparisons.length} matched pairs, first contact-state splits by class: ${Object.entries(data.contact_split_classifications).map(([name, count]) => `${name} (${count})`).join('; ') || 'none'}. The table lists every comparison with a contact-state split; full matched trajectories and per-step inputs remain in traces.`,
    'The preceding target-mass STR diagnosis found the Barkley–Baun case to be trajectory-mediated: at 0.09167 s Rapier remained at +0.03172 m analytic gap while Jolt had crossed to −0.0065 m and reported contact. Rapier’s gap stayed positive for the run, so that evidence did not support a missed Rapier query. The solver trajectories first diverged during ground response; their angular states changed the feedback balance torques, and the player paths separated before player contact. In other comparisons where both analytic gaps were positive but Jolt reported contact, the shared proxy did not match the engines’ contact boundary. The prior report preserves all 332 runs and exact paired traces; this study replays that source case and repeats H-B inputs.',
    '| Scenario | Input | Seed | First split (tick / s) | Rapier gap (m) | Jolt gap (m) | Classification | Pair position divergence at split (m) |',
    '|---|---|---:|---:|---:|---:|---|---|',
    '## Full failure ledger', '',
    data.failure_count + ' of ' + data.run_count + ' runs failed at least one preserved numerical or fixture-outcome gate. All 256 failures are from `possession-retained`; every one misses at least one unchanged numerical gate, and 54 also fail the retained-possession outcome gate after losing physical contact or secure control. The `grip-escape-one-held` and completed `gang-staggered-three` fixtures pass all 120 runs between them. The full run-by-run reasons and per-run gate values are in shared-summary.json.',
    '## Cross-track comparison boundary', '',
    'The legacy hold report measures post-wrap drag in a different engine family and separately reports tackle-selection odds. Its travel distances, event rates, and force values are not pooled with M4c. The M4c experiments measure physical contact, grip capacity, balance torque, and fall outcomes after scripted geometry and force inputs; they do not model legacy tackle selection.',
    'Neither report validates a Madden rating-to-force mapping. The TKL/BTK relationships here are bounded sensitivity hypotheses only; actual grip and breakaway capacities require independent physical measurements. No external NFL trajectory/tackle calibration is included.', '',
    'No merge or adoption recommendation is made here; the protocol assigns the next decision to one consolidated integration review.', '',
    '## Reproduction and artifacts', '',
    'From repository root: `node research/physics-3d-evaluation/m4b/m4d/henderson-bush-physical-ablations/run.mjs --branch=' + data.branch + ' --code-commit=' + data.code_commit + '`. For report regeneration from existing gzip traces, append `--reuse-traces`.',
    '- `shared-summary.json`: per-run shared schema, inputs, gates, and failure ledger.',
    '- `shared-summary.csv`: compact row export using the common field names.',
    '- `run-manifest.json`: source, code, protocol, and legacy report hashes.',
    '- `replay-index.json` and `viewer.html`: synchronized Rapier/Jolt replays for representative pairs.',
    '- `traces/`: full-rate gzip diagnostics for every run.',
    'Implementation sources and hashes are recorded in the JSON manifest; the exact implementation commit is ' + data.code_commit + '. No production engine or LP pipeline files were changed.', ''
  ];
  for (const row of [...tableRows].reverse()) {
    const loads = Object.values(row.requested_grip_load_N.wrapByHolderN);
    const values = [row.scenario_id, row.conditions.config_id, row.solver_or_engine,
      row.focus_pair_minimum_surface_gap_m.toFixed(4), row.contact_opportunity_count,
      `${row.actual_contact_count} / ${row.actual_contact_event_count}`,
      row.first_contact_seconds == null ? '—' : row.first_contact_seconds.toFixed(4),
      loads.length ? Math.max(...loads).toFixed(1) : '—',
      row.physical_takedown == null ? 'n/a' : row.physical_takedown ? 'yes' : 'no',
      row.post_contact_carrier_travel_m == null ? '—' : row.post_contact_carrier_travel_m.toFixed(4),
      row.penetration_p95_m.toFixed(4), row.penetration_duration_weighted_mean_m.toFixed(4), row.result_status];
    lines.splice(lines.indexOf('## Paired responses within each solver'), 0, '|' + values.join('|') + '|');
  }
  const pairedKeyIds = new Set(['mass-henderson-only', 'mass-bush-only', 'mass-both-after-individual',
    'str-henderson-only', 'str-bush-only', 'str-both-after-individual', 'madden-pair-combined',
    'wrap-capacity-0.50x', 'wrap-capacity-1.00x', 'wrap-capacity-1.50x', 'tkl-capacity-rating-50-control',
    'tkl-capacity-hypothesis', 'balance-scale-0.00', 'balance-scale-0.80', 'balance-scale-1.20',
    'btk-drive-rating-50', 'btk-drive-rating-81', 'str-continuity-henderson-80.00',
    'str-continuity-henderson-80.50', 'str-continuity-henderson-81.00', 'str-continuity-bush-80.00',
    'str-continuity-bush-80.50', 'str-continuity-bush-81.00']);
  const pairedRows = data.within_engine_paired_differences.filter((row) => pairedKeyIds.has(row.config_id));
  const deltaText = (distribution, precision = 4) => distribution.sample_count
    ? `${distribution.median.toFixed(precision)} [${distribution.minimum.toFixed(precision)}, ${distribution.maximum.toFixed(precision)}]` : 'n/a';
  for (const row of [...pairedRows].reverse()) {
    const passBase = row.seed_deltas.filter((sample) => sample.outcome_gates.baseline === true).length;
    const passTreatment = row.seed_deltas.filter((sample) => sample.outcome_gates.treatment === true).length;
    const values = [row.scenario_id, row.config_id, row.solver_or_engine, row.baseline_config_id,
      deltaText(row.distributions.minimum_surface_gap_m), deltaText(row.distributions.contact_opportunity_samples, 1),
      deltaText(row.distributions.actual_contact_samples, 1), deltaText(row.distributions.target_grip_load_n, 1),
      deltaText(row.distributions.focus_pair_peak_balance_torque_nm, 2), deltaText(row.distributions.penetration_p95_m),
      deltaText(row.distributions.penetration_duration_weighted_mean_m), `${passBase}/${row.paired_seed_count} → ${passTreatment}/${row.paired_seed_count}`];
    lines.splice(lines.indexOf('## STR continuity around 80–81'), 0, '|' + values.join('|') + '|');
  }
  const continuityRows = data.runs.filter((row) => row.conditions.config_id.startsWith('str-continuity-')
    && row.seed_or_fixture_label.seed === SEEDS[0]);
  for (const row of [...continuityRows].reverse()) {
    const isCarrier = row.conditions.config_id.includes('henderson');
    const role = isCarrier ? 'carrier' : 'tackler';
    const fixtureActorId = row.conditions.base_role_inputs[role].id;
    const actorLabel = isCarrier ? 'Henderson (carrier)' : 'Bush (tackler)';
    const torque = row.balance_torque_requests_Nm[fixtureActorId] ?? 0;
    const values = [actorLabel, row.conditions.base_role_inputs[role].strength,
      row.solver_or_engine, row.focus_pair_minimum_surface_gap_m.toFixed(5),
      row.first_contact_seconds == null ? '—' : row.first_contact_seconds.toFixed(4), row.actual_contact_count,
      torque.toFixed(2), row.result_status];
    lines.splice(lines.indexOf('### Adjacent STR contact transitions and closest approach'), 0, '|' + values.join('|') + '|');
  }
  for (const transition of [...data.str_continuity_diagnostics.contact_transitions].reverse()) {
    const closestText = (sample) => sample
      ? sample.signed_gap_m.toFixed(5) + ' (' + sample.tick + '/' + sample.time_seconds.toFixed(4) + ' s)'
      : 'n/a';
    const values = [transition.actor, transition.solver_or_engine, transition.seed,
      transition.lower_strength + '→' + transition.upper_strength,
      (transition.lower_has_contact ? 'yes' : 'no') + '→' + (transition.upper_has_contact ? 'yes' : 'no'),
      closestText(transition.lower_closest_approach), closestText(transition.upper_closest_approach)];
    lines.splice(lines.indexOf('## Matched Rapier/Jolt trajectory and contact diagnosis'), 0, '|' + values.join('|') + '|');
  }
  const contactSplits = data.solver_comparisons.filter((row) => row.first_contact_state_split);
  for (const comparison of [...contactSplits].reverse()) {
    const split = comparison.first_contact_state_split;
    const divergence = Math.max(...Object.values(split.trajectoryDivergenceAtSplitM));
    const values = [comparison.scenario_id, comparison.config_id, comparison.seed,
      `${split.tick} / ${split.timeSeconds.toFixed(4)}`, split.rapierGapM.toFixed(5), split.joltGapM.toFixed(5),
      split.classification, divergence.toFixed(5)];
    lines.splice(lines.indexOf('## Full failure ledger'), 0, '|' + values.join('|') + '|');
  }
  const ledgerAt = lines.indexOf('## Full failure ledger') + 2;
  lines.splice(ledgerAt, 0, ...data.failures.map((failure) => '- ' + failure.run_id + ': ' + failure.reasons.join('; ')));
  return `${lines.join('\n').trimEnd()}\n`;
}

const manifest = {
  schema_version: 1, source_snapshot_hash: profileHash,
  source_snapshot_path: path.relative(M4B, PROFILE_PATH), source_of_truth_commit: MAIN_PROTOCOL_COMMIT,
  source_of_truth_sha256: MAIN_PROTOCOL_HASH,
  frozen_snapshot_protocol: { commit: FROZEN_PROTOCOL_COMMIT, sha256: FROZEN_PROTOCOL_HASH },
  implementation_commit: CODE_COMMIT,
  implementation_hashes: codeHashes, runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  legacy_report: LEGACY, legacy_play18_diagnosis: LEGACY_DIAGNOSIS, created_at: new Date().toISOString(),
};
const csvFields = ['schema_version', 'track', 'branch', 'code_commit', 'source_snapshot_hash', 'mapping_version', 'player_ids',
  'scenario_id', 'solver_or_engine', 'dt_seconds', 'run_id', 'seed_or_fixture_label', 'conditions', 'contact_opportunity_count',
  'actual_contact_count', 'actual_contact_event_count', 'first_contact_seconds', 'first_contact_opportunity_seconds',
  'focus_pair_minimum_surface_gap_m', 'tackle_selected', 'physical_takedown', 'grip_established', 'grip_released',
  'ball_controlled', 'fumble', 'm4c_outcome_gate', 'post_contact_carrier_travel_m', 'post_contact_carrier_travel_window',
  'balance_state', 'controller_forces_N', 'balance_torque_requests_Nm',
  'requested_grip_load_N', 'contact_impulse_Ns', 'impulse_measurement_source', 'penetration_first_step_max_m',
  'penetration_threshold_counts', 'penetration_max_m', 'penetration_p95_m',
  'penetration_duration_weighted_mean_m', 'numeric_gates', 'result_status', 'failure_reasons', 'trace_path'];
const csvEscape = (value) => `"${String(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
await writeFile(path.join(RESULTS, 'shared-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(RESULTS, 'shared-summary.csv'), `${csvFields.join(',')}\n${reportRows.map((row) => csvFields.map((field) => csvEscape(row[field])).join(',')).join('\n')}\n`);
await writeFile(path.join(RESULTS, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(RESULTS, 'replay-index.json'), `${JSON.stringify(replayIndex, null, 2)}\n`);
const viewerTemplate = await readFile(path.join(M4B, 'm4d-str-contact-diagnosis/viewer.html'), 'utf8');
await writeFile(path.join(RESULTS, 'viewer.html'), viewerTemplate.replaceAll('M4d STR contact diagnosis', 'M4d Henderson–Bush physical-ability ablations'));
await writeFile(path.join(RESULTS, 'report.md'), markdownReport(report));
console.log(JSON.stringify({ completed: true, runCount: report.run_count, failures: report.failure_count,
  resultDirectory: RESULTS, runtimeMs: report.runtime_ms }));
