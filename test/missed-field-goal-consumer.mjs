import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeMissedFieldGoalDrive, requireProducerVersions } from '../engine/missed-field-goal-consumer.js';

function drive({ snap = 19, kickSpot, made = false } = {}) {
  const outcome = {};
  if (kickSpot !== undefined) outcome.kick_spot_yardline_100 = kickSpot;
  return {
    terminal: 'field_goal_attempt',
    field_goal_made: made,
    plays: [{
      event_type: 'field_goal_attempt',
      state_before: { offense_team: 'A', defense_team: 'B', yardline_100: snap },
      outcome,
    }],
  };
}

test('missed kick outside receiving 20 uses the separate kick spot, not snap spot', () => {
  const resolved = consumeMissedFieldGoalDrive(drive({ snap: 19, kickSpot: 26 }));
  assert.deepEqual(resolved, {
    offense_team: 'B',
    yardline_100: 74,
    kick_spot_yardline_100: 26,
    receiving_20_exception_applied: false,
    spot_source: 'producer_outcome.kick_spot_yardline_100',
  });
  assert.notEqual(resolved.yardline_100, 80, 'snap at 19 must not trigger the receiving-20 exception when kick spot is 26');
});

test('missed kick inside receiving 20 gives the receiving team its own 20', () => {
  const resolved = consumeMissedFieldGoalDrive(drive({ snap: 24, kickSpot: 15 }));
  assert.equal(resolved.yardline_100, 80);
  assert.equal(resolved.receiving_20_exception_applied, true);
});

test('rejects a missing separate kick spot instead of falling back to snap yardline', () => {
  assert.throws(
    () => consumeMissedFieldGoalDrive(drive({ snap: 15 })),
    /kick_spot_yardline_100.*only the snap position/,
  );
});

test('does not label a made field goal as a missed-kick restart', () => {
  assert.throws(() => consumeMissedFieldGoalDrive(drive({ snap: 15, kickSpot: 22, made: true })), /missed field_goal_attempt/);
});

test('requires model_version and rules_version from the producer', () => {
  assert.deepEqual(requireProducerVersions({ model_version: 'lp-model-1', rules_version: 'nfl-rules-2026' }), {
    model_version: 'lp-model-1', rules_version: 'nfl-rules-2026',
  });
  assert.throws(() => requireProducerVersions({ rules_version: 'nfl-rules-2026' }), /producer must supply non-empty model_version/);
  assert.throws(() => requireProducerVersions({ model_version: 'lp-model-1' }), /producer must supply non-empty rules_version/);
});
