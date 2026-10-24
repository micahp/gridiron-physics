import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConversionSources, validateDriveIndices, validateFullGameIngest } from '../engine/full-game-ingest-guards.js';

function recordWith(play, extraDrive = {}) {
  return { drives: [{ index: 4, plays: [play], ...extraDrive }] };
}

function statePlay(before, after) {
  return { id: 'sim:4', state_before: { drive_index: before }, state_after: { drive_index: after } };
}

test('accepts matching play state and enclosing game-level drive index', () => {
  assert.deepEqual(validateDriveIndices(recordWith(statePlay(4, 4))), { drives_checked: 1, plays_checked: 1 });
});

test('rejects before/after drive-index mismatch', () => {
  assert.throws(() => validateDriveIndices(recordWith(statePlay(4, 5))), /state_before=4, state_after=5, game-level=4/);
});

test('rejects matching play indices that disagree with the game-level drive index', () => {
  assert.throws(() => validateDriveIndices(recordWith(statePlay(3, 3))), /state_before=3, state_after=3, game-level=4/);
});

test('rejects extra-point scoring when only EPA success is present', () => {
  const record = recordWith(statePlay(4, 4), {
    points_scored_on_drive: { points: 7, try: { kind: 'extra_point', made: true, success: 1.0 } },
  });
  assert.throws(() => validateConversionSources(record), /extra_point_result must be supplied.*EPA success/);
});

test('rejects two-point scoring when only EPA success is present', () => {
  const record = recordWith(statePlay(4, 4), {
    points_scored_on_drive: { points: 8, try: { kind: 'two_point_try', made: true, success: 0.0 } },
  });
  assert.throws(() => validateConversionSources(record), /two_point_conv_result must be supplied.*EPA success/);
});

test('derives conversion points from publisher result fields even when EPA success disagrees', () => {
  const record = { drives: [
    { index: 1, plays: [], points_scored_on_drive: { points: 7, try: { kind: 'extra_point', extra_point_result: 'good', success: 0.0 } } },
    { index: 2, plays: [], points_scored_on_drive: { points: 6, try: { kind: 'extra_point', extra_point_result: 'blocked', success: 1.0 } } },
    { index: 3, plays: [], points_scored_on_drive: { points: 8, try: { kind: 'two_point_try', two_point_conv_result: 'success', success: 0.0 } } },
    { index: 4, plays: [], points_scored_on_drive: { points: 6, try: { kind: 'two_point_try', two_point_conv_result: 'failure', success: 1.0 } } },
  ] };
  assert.deepEqual(validateConversionSources(record).map(({ source_field, source_result, points_scored }) => [source_field, source_result, points_scored]), [
    ['extra_point_result', 'good', 1],
    ['extra_point_result', 'blocked', 0],
    ['two_point_conv_result', 'success', 2],
    ['two_point_conv_result', 'failure', 0],
  ]);
});

test('rejects points or made flags that conflict with the publisher result', () => {
  const record = recordWith(statePlay(4, 4), {
    points_scored_on_drive: { points: 7, try: { kind: 'extra_point', extra_point_result: 'failed', made: true, points_scored: 1 } },
  });
  assert.throws(() => validateFullGameIngest(record), /made conflicts with producer extra_point_result=failed/);
});
