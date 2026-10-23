/**
 * Sport-neutral movement scene execution for isolated research adapters.
 * This module is deliberately independent of the NFL play/world solvers.
 */

const clone = (value) => structuredClone(value);

function assertScene(scene) {
  if (!scene || !Array.isArray(scene.players) || !Number.isInteger(scene.observationStep)) {
    throw new TypeError('movement scene requires players and an integer observationStep');
  }
  const seen = new Set();
  for (const player of scene.players) {
    if (!player?.id || seen.has(player.id) || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      throw new TypeError('each movement player needs a unique id and finite x/y');
    }
    seen.add(player.id);
  }
}

export function initializeMovementScene(state, sportConfig) {
  if (!sportConfig || typeof sportConfig.sport !== 'string' ||
      typeof sportConfig.stepUnit !== 'string' || !sportConfig.geometry) {
    throw new TypeError('sportConfig must declare sport, stepUnit, and geometry');
  }
  const scene = clone(state);
  scene.observationStep ??= 0;
  scene.sport = sportConfig.sport;
  scene.stepUnit = sportConfig.stepUnit;
  scene.history ??= [];
  assertScene(scene);
  return scene;
}

export function proposeMovement(state, policy, observationStep = state.observationStep) {
  assertScene(state);
  if (typeof policy !== 'function') throw new TypeError('policy must be a function');
  const intents = state.players.map((player) => {
    const intent = policy(clone(state), player.id, observationStep);
    if (!intent || intent.playerId !== player.id || !Number.isFinite(intent.dx) || !Number.isFinite(intent.dy)) {
      throw new TypeError(`policy returned an invalid intent for ${player.id}`);
    }
    return { playerId: player.id, dx: intent.dx, dy: intent.dy, metadata: clone(intent.metadata ?? {}) };
  });
  return intents;
}

export function stepMovement(state, intents, constraints = null) {
  assertScene(state);
  if (!Array.isArray(intents) || intents.length !== state.players.length) {
    throw new TypeError('one intent per player is required');
  }
  const intentById = new Map(intents.map((intent) => [intent.playerId, intent]));
  if (intentById.size !== state.players.length) throw new TypeError('duplicate or missing movement intent');
  const proposed = state.players.map((player) => {
    const intent = intentById.get(player.id);
    if (!intent || !Number.isFinite(intent.dx) || !Number.isFinite(intent.dy)) {
      throw new TypeError(`invalid movement intent for ${player.id}`);
    }
    return { ...clone(player), x: player.x + intent.dx, y: player.y + intent.dy,
      movementIntent: { dx: intent.dx, dy: intent.dy } };
  });
  let next = { ...clone(state), players: proposed, observationStep: state.observationStep + 1 };
  if (constraints != null) {
    if (typeof constraints !== 'function') throw new TypeError('constraints must be a projector function');
    next = constraints(next, clone(state), clone(intents));
  }
  assertScene(next);
  next.players = next.players.map((player) => {
    const previous = state.players.find((row) => row.id === player.id);
    const history = [...(previous.history ?? []), { x: player.x, y: player.y }].slice(-6);
    return { ...player, history };
  });
  return next;
}

export function recordMovementFrame(state, provenance = {}) {
  assertScene(state);
  return {
    observationStep: state.observationStep,
    stepUnit: state.stepUnit,
    sport: state.sport,
    puck: clone(state.puck ?? null),
    puckHistory: clone(state.puckHistory ?? []),
    players: state.players.map(({ id, team, x, y, history, movementIntent, ...rest }) => ({
      id, team, x, y, history: clone(history ?? []),
      ...(movementIntent ? { movementIntent: clone(movementIntent) } : {}), ...clone(rest),
    })),
    provenance: clone(provenance),
  };
}

export function replayMovement(recording) {
  if (!recording || !Array.isArray(recording.frames)) throw new TypeError('recording.frames is required');
  return recording.frames.map((frame) => clone(frame));
}
