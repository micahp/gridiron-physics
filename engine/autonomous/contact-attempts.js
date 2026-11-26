// A continuous contact is one opportunity. Leaving contact permits a new
// attempt, and other players already in reach must not be starved by the
// nearest player's failed attempt.
export function nextRecoveryAttempt(attempted, candidates) {
  const active = new Set(candidates.map((player) => player.id));
  for (const id of attempted) if (!active.has(id)) attempted.delete(id);
  const candidate = candidates.find((player) => !attempted.has(player.id));
  if (candidate) attempted.add(candidate.id);
  return candidate ?? null;
}
