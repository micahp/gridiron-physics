// P0 source-boundary assertions for the autonomous passing agent.
// The test deliberately audits the private decision functions because the
// current public simulator API has no deterministic gaze/position injection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { estimateBallLanding, ObservationMemory, observationVisibility, turnHeadingToward } from '../engine/autonomous/perception.js';
import { assertFootballInvariant } from './football-assertion.mjs';

const passingPath = new URL('../engine/autonomous/passing.js', import.meta.url);
const source = readFileSync(passingPath, 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const perceptionSha256 = createHash('sha256')
  .update(readFileSync(new URL('../engine/autonomous/perception.js', import.meta.url))).digest('hex');
const sourceHashes = { 'passing.js': sourceSha256, 'perception.js': perceptionSha256 };

function perceptionCheck(passes, violated_assertion, details = {}) {
  assertFootballInvariant(passes, {
    failure_class: 'NONCAUSAL_INFORMATION',
    game_id: 'synthetic-perception-fixture', seed: 'perception-seed-1', play_index: 1,
    state_before: details.state_before ?? { quarterback: qb, receiver, gaze_heading: qb.h },
    decision: details.decision ?? { operation: 'observe_or_estimate_player_state' },
    outcome: details.outcome ?? 'perception_check',
    state_after: details.state_after ?? 'perception_fixture_complete',
    violated_assertion, source_artifact_hashes: sourceHashes,
  });
}

const qb = { id: 'qb', p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, h: 0, r: 0.25 };
const receiver = { id: 'wr', p: { x: 10, y: 0 }, v: { x: 2, y: 0 }, r: 0.25 };
const hiddenRusher = { id: 'rush', p: { x: -8, y: 0 }, v: { x: 0, y: 0 }, r: 0.3 };
perceptionCheck(observationVisibility(qb, receiver).visible, 'a target in front of the QB is visible',
  { outcome: observationVisibility(qb, receiver) });
perceptionCheck(observationVisibility(qb, hiddenRusher).reason === 'outside_fov',
  'a rusher behind the QB is outside the gaze cone', { outcome: observationVisibility(qb, hiddenRusher) });
const headTurned = turnHeadingToward(qb.h, Math.PI, Math.PI);
perceptionCheck(qb.h === 0, 'turning gaze does not rotate the QB body',
  { decision: { gaze_heading: headTurned, body_heading: qb.h }, outcome: { body_heading: qb.h } });
perceptionCheck(observationVisibility(qb, hiddenRusher, [], { heading: headTurned }).visible,
  'turning gaze makes the previously hidden rusher visible',
  { decision: { gaze_heading: headTurned }, outcome: observationVisibility(qb, hiddenRusher, [], { heading: headTurned }) });
const blocker = { id: 'ol', p: { x: 5, y: 0 }, r: 0.5, height: 1.95 };
perceptionCheck(observationVisibility(qb, receiver, [blocker]).reason === 'occluded',
  'a player body blocks the sightline', { outcome: observationVisibility(qb, receiver, [blocker]) });
perceptionCheck(observationVisibility(qb, receiver, [{ ...blocker, height: 1.0 }]).visible,
  'a blocker below the sightline does not occlude the target',
  { outcome: observationVisibility(qb, receiver, [{ ...blocker, height: 1.0 }]) });

const memory = new ObservationMemory({ reactionDelaySeconds: 0.2 });
memory.capture(qb, receiver, [], 0);
memory.advance(0.19);
perceptionCheck(memory.estimate('wr', 0.19) === null, 'a new observation is unavailable before reaction latency',
  { outcome: memory.estimate('wr', 0.19) });
memory.advance(0.2);
const freshEstimate = memory.estimate('wr', 0.2);
perceptionCheck(!!freshEstimate && freshEstimate.confidence < 1, 'a delivered estimate has finite confidence',
  { outcome: freshEstimate });
perceptionCheck(freshEstimate.uncertaintyMeters > 0, 'the estimate exposes uncertainty',
  { outcome: freshEstimate });
receiver.p.x = 40;
const staleEstimate = memory.estimate('wr', 0.7);
perceptionCheck(staleEstimate.position.x < 20, 'unseen movement cannot overwrite the last-seen estimate',
  { outcome: staleEstimate });
perceptionCheck(staleEstimate.confidence < freshEstimate.confidence, 'memory confidence declines with age',
  { outcome: staleEstimate });
perceptionCheck(staleEstimate.uncertaintyMeters > freshEstimate.uncertaintyMeters,
  'memory uncertainty grows with age', { outcome: staleEstimate });
perceptionCheck(memory.estimate('wr', 1.7) === null,
  'expired observations do not provide permanent ground truth', { outcome: memory.estimate('wr', 1.7) });

const landingEstimate = estimateBallLanding({ position: { x: 0, y: 0 }, velocity: { x: 10, y: 0 },
  z: 2, vz: -1, uncertaintyMeters: 0.5 });
perceptionCheck(landingEstimate.flightSeconds > 0 && landingEstimate.uncertaintyMeters > 0.5,
  'a defender landing estimate has positive flight time and uncertainty', { outcome: landingEstimate });
perceptionCheck(landingEstimate.x === landingEstimate.flightSeconds * 10,
  'defenders project the visible trajectory without reading the stored ball landing point',
  { decision: { observed_velocity_x: 10, observed_height: 2, observed_vertical_velocity: -1 },
    outcome: landingEstimate });

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} implementation`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not find end of ${name}`);
}

const readOptions = functionBody('readOptions');
const qbDecision = functionBody('qbDecision');
const defenseBrain = functionBody('defenseBrain');
const sensedPressure = functionBody('sensedPressure');
const resolveContest = functionBody('resolveContest');
const brainsMarker = 'const brains = (p) =>';
const brainsStart = source.indexOf(brainsMarker);
assert.notEqual(brainsStart, -1, 'missing player brain scheduler');
const brainsEnd = source.indexOf('// ------------------------------------------------------------------ finish', brainsStart);
assert.notEqual(brainsEnd, -1, 'missing player brain terminal boundary');
const playerBrain = source.slice(brainsStart, brainsEnd);
const failures = [];
let nextAssertion = 1;
const check = (passes, assertion, fragment) => {
  const assertionId = `A-${String(nextAssertion++).padStart(2, '0')}`;
  if (!passes) failures.push({
    failure_class: 'NONCAUSAL_INFORMATION', assertion_id: assertionId,
    violated_assertion: assertion, fragment, context_scope: 'source_boundary_audit',
    game_id: 'source-audit-passing.js', seed: 'static-source-audit', play_index: 1,
    state_before: { module: 'engine/autonomous/passing.js' },
    decision: { assertion_id: assertionId, requirement: assertion },
    outcome: { source_fragment: fragment }, state_after: { source_sha256: sourceSha256 },
    source_artifact_hashes: sourceHashes,
  });
};

check(!/nearestDefenderTo\s*\(\s*rec\s*\)/.test(readOptions),
  'QB target separation must come from visible or remembered observations',
  'readOptions currently calls nearestDefenderTo(rec) over current defender positions');
check(/\b(?:observe|observation|belief|visible|visibility|gaze|eyes)\b/i.test(readOptions),
  'QB reads must pass through an explicit observation boundary',
  'readOptions has no observation, gaze, or visibility input');
check(/(?:field.?of.?view|\bfov\b|sightline|occlu)/i.test(source),
  'QB visibility must have bounded field-of-view and occlusion logic',
  'passing.js contains no field-of-view, sightline, or occlusion model');
check(/\b(?:gaze|eyes|headDirection|head_direction)\b/i.test(readOptions),
  'QB head or gaze direction must bound visibility independently of body direction',
  'readOptions does not use a head/gaze direction');
check(/reaction.?delay|observation.?delay/i.test(source),
  'new observations must pass through deterministic reaction latency',
  'passing.js has no observation reaction-delay model');
check(/lastSeen|last_seen|lastSeenState|observationMemory/i.test(source)
    && /confidence|uncertainty|decay/i.test(source),
  'unseen players must use aging last-seen estimates with declining confidence',
  'passing.js has no stale-observation memory and uncertainty decay');
check(!/nearestRusherToQb\s*\(\)/.test(qbDecision),
  'pressure awareness may sense contact without exact unseen rusher coordinates',
  'qbDecision queries the nearest rusher from live positions');
check(/return\s*\{\s*level:\s*'contact',\s*distance:\s*0\.65\s*\}/.test(sensedPressure)
    && /return\s*\{\s*level:\s*'nearby',\s*distance:\s*1\.65\s*\}/.test(sensedPressure)
    && !/return\s*\{[^}]*\b(?:player|rusher|position|coordinates|id|slot)\b/.test(sensedPressure),
  'unseen pressure may reveal a coarse contact level without an exact rusher identity or position',
  'sensedPressure must return only coarse level/distance cues, never player identity or coordinates');
check(!/\bb\.landing\b/.test(defenseBrain),
  'defensive agents must estimate ball landing from the observed trajectory',
  'defenseBrain reads the ball simulator landing coordinate directly');
check(/const chance = clamp\([\s\S]*?0\.35,\s*0\.97\)/.test(resolveContest)
    && /if\s*\(rand\(\)\s*<\s*chance\)\s*\{\s*secure\(receiver\.player\)/.test(resolveContest),
  'selecting a receiver must not guarantee a catch',
  'resolveContest must resolve the ball at the catch point using a probability below one');
check(!/\brouteTarget\s*\(|\bp\.ai\.(?:route|routeAssignment)\b/.test(defenseBrain),
  'defensive decisions must not read private offensive route assignments',
  'defenseBrain must react to visible simulated positions instead of private route data');
check(/if\s*\(!p\.down\)\s*\{/.test(playerBrain)
    && /if\s*\(p\.down\)\s*\{\s*p\.dv\s*=\s*\{\s*x:\s*0,\s*y:\s*0\s*\};\s*return;\s*\}/.test(playerBrain),
  'a downed player must not resume route running, pursuit, or ball contests',
  'the player scheduler must suppress decisions and zero movement after a player is down');

assertFootballInvariant(failures.length === 0, {
  failure_class: 'NONCAUSAL_INFORMATION', game_id: 'source-audit-passing.js',
  seed: 'static-source-audit', play_index: 1,
  state_before: { module: 'engine/autonomous/passing.js' },
  decision: { operation: 'source_boundary_audit' }, outcome: failures,
  state_after: { source_sha256: sourceSha256 },
  violated_assertion: 'every source-boundary perception assertion must pass',
  source_artifact_hashes: sourceHashes,
});
console.log('autonomous perception ok: causal reads, ball contests, defensive privacy, and dead-player behavior');
