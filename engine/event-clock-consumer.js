export function ingestEventClockEnvelope(envelope) {
  if (envelope?.clock_contract_version !== 'gridiron.event-driven-clock.v1') {
    throw new TypeError('unsupported clock_contract_version');
  }
  for (const field of ['model_version', 'rules_version']) {
    if (typeof envelope[field] !== 'string' || envelope[field].trim() === '') {
      throw new TypeError(`producer must supply non-empty ${field}`);
    }
  }
  if (!Array.isArray(envelope.events) || envelope.events.length === 0) {
    throw new TypeError('clock envelope must contain producer-supplied events');
  }
  return envelope;
}
