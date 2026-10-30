// P0 source-boundary assertions for the autonomous passing agent.
// The test deliberately audits the private decision functions because the
// current public simulator API has no deterministic gaze/position injection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const passingPath = new URL('../engine/autonomous/passing.js', import.meta.url);
const source = readFileSync(passingPath, 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');

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
const failures = [];
const check = (passes, assertion, fragment) => {
  if (!passes) failures.push({
    failure_class: 'NONCAUSAL_INFORMATION', assertion, fragment,
    game_id: null, seed: null, play_index: null,
    source_artifact_hashes: { passing_js_sha256: sourceSha256 },
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
check(!/\bb\.landing\b/.test(defenseBrain),
  'defensive agents must estimate ball landing from the observed trajectory',
  'defenseBrain reads the ball simulator landing coordinate directly');

assert.equal(failures.length, 0,
  `NONCAUSAL_INFORMATION assertions failed on game_id=unavailable seed=unavailable play_index=unavailable; `
  + `source_sha256=${sourceSha256}; findings=${JSON.stringify(failures)}`);
console.log('autonomous perception ok: field of view, occlusion, observed QB reads, and estimated defensive ball flight');
