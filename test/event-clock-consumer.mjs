import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ingestEventClockEnvelope } from '../engine/event-clock-consumer.js';

const schema = JSON.parse(readFileSync(new URL('../docs/research/event-driven-clock-v1.schema.json', import.meta.url)));
const base = {
  clock_contract_version: 'gridiron.event-driven-clock.v1',
  model_version: 'producer-model-v1',
  rules_version: 'producer-rules-v1',
  events: [{ sequence: 0, event_type: 'period_start', game_elapsed_ms: 0, period: 1, game_clock_seconds: 900, game_clock_status: 'stopped', period_kind: 'regulation', transition_reason: 'opening' }],
};

test('clock schema requires producer model and rules versions', () => {
  assert.ok(schema.required.includes('model_version'));
  assert.ok(schema.required.includes('rules_version'));
});

test('clock ingest preserves explicit producer versions and events', () => {
  assert.equal(ingestEventClockEnvelope(base), base);
});

test('clock ingest rejects missing model_version instead of defaulting', () => {
  const { model_version, ...withoutModel } = base;
  assert.ok(model_version);
  assert.throws(() => ingestEventClockEnvelope(withoutModel), /producer must supply non-empty model_version/);
});

test('clock ingest rejects missing rules_version instead of defaulting', () => {
  const { rules_version, ...withoutRules } = base;
  assert.ok(rules_version);
  assert.throws(() => ingestEventClockEnvelope(withoutRules), /producer must supply non-empty rules_version/);
});
