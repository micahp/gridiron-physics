export const FOOTBALL_FAILURE_CLASSES = new Set([
  'ILLEGAL_STATE', 'NONCAUSAL_INFORMATION', 'STAT_ACCOUNTING',
  'UNSUPPORTED_RULE', 'DISTRIBUTION_WARNING',
]);

export function footballFailureEnvelope(evidence) {
  if (!FOOTBALL_FAILURE_CLASSES.has(evidence.failure_class)) {
    throw new TypeError(`unknown football failure class: ${evidence.failure_class}`);
  }
  if (!evidence.violated_assertion) throw new TypeError('football failure needs a violated assertion');
  return {
    schema: 'gridiron.football-realism-assertion-failure.v1',
    failure_class: evidence.failure_class,
    game_id: evidence.game_id ?? 'unavailable',
    seed: evidence.seed ?? 'unavailable',
    play_index: evidence.play_index ?? 'unavailable',
    state_before: evidence.state_before ?? 'unavailable',
    decision: evidence.decision ?? 'unavailable',
    outcome: evidence.outcome ?? 'unavailable',
    state_after: evidence.state_after ?? 'unavailable',
    violated_assertion: evidence.violated_assertion,
    source_artifact_hashes: evidence.source_artifact_hashes ?? {},
  };
}

export function assertFootballInvariant(passes, evidence) {
  if (passes) return;
  const failure = footballFailureEnvelope(evidence);
  const error = new Error(`${failure.failure_class}: ${failure.violated_assertion}; evidence=${JSON.stringify(failure)}`);
  error.name = 'FootballInvariantError';
  error.failure = failure;
  throw error;
}
