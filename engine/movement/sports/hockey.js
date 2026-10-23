/** Ordinal, rink-plane research adapter; none of its limits represent timed physics. */
import { stepMovement } from '../index.js';

const RINK = Object.freeze({ minX: -100, maxX: 100, minY: -42.5, maxY: 42.5 });
export const hockeyResearchConfig = Object.freeze({
  sport: 'hockey', stepUnit: 'image_id_increment',
  timebaseValidated: false, geometry: Object.freeze({ ...RINK, plane: 'observed_rink_xy' }),
  mechanicsStatus: '2D research proxy; no validated player-contact or puck physics',
});

const norm = (x, y) => Math.hypot(x, y);
const wrap = (angle) => {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

function kinematicVelocity(points = []) {
  const rows = points.slice(-6);
  if (rows.length < 2) return [0, 0];
  const mean = (rows.length - 1) / 2;
  let denom = 0, x = 0, y = 0;
  rows.forEach((p, i) => { const t = i - mean; denom += t*t; x += t*p.x; y += t*p.y; });
  return denom ? [x / denom, y / denom] : [0, 0];
}

// Ridge features are [vx, vy, ax, ay, puck dx/dy, puck vx/vy, puck missing,
// teammate weighted dx/dy/dvx/dvy, opponent equivalent, then 6 distance counts].
export function hockeyFeatures(state, player) {
  const positions = player.history?.length >= 6
    ? player.history.slice(-6) : [...(player.history ?? []), { x: player.x, y: player.y }].slice(-6);
  const points = positions.length ? positions : [{ x: player.x, y: player.y }];
  const meanT = (points.length - 1) / 2;
  let denom = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < points.length; i++) {
    const t = i - meanT; denom += t * t; sx += t * points[i].x; sy += t * points[i].y;
    sxx += t * t * points[i].x; sxy += t * t * points[i].y;
  }
  const vx = denom ? sx / denom : 0, vy = denom ? sy / denom : 0;
  const ax = denom ? 2 * (sxx / denom) : 0, ay = denom ? 2 * (sxy / denom) : 0;
  const puck = state.puck;
  const puckMissing = !puck || !Number.isFinite(puck.x) || !Number.isFinite(puck.y);
  const priorPuck = state.puckHistory?.at(-2);
  const puckDx = puckMissing ? 0 : puck.x - player.x;
  const puckDy = puckMissing ? 0 : puck.y - player.y;
  const puckVx = puckMissing || !priorPuck ? 0 : puck.x - priorPuck.x;
  const puckVy = puckMissing || !priorPuck ? 0 : puck.y - priorPuck.y;
  const peer = (team) => {
    let weight = 0, dx = 0, dy = 0, dvx = 0, dvy = 0;
    const counts = [0, 0, 0];
    for (const other of state.players) {
      if (other.id === player.id || other.team !== team) continue;
      const rx = other.x - player.x, ry = other.y - player.y, d = norm(rx, ry);
      const w = Math.exp(-d / 20);
      weight += w; dx += rx * w; dy += ry * w;
      const [ovx, ovy] = kinematicVelocity(other.history ?? []);
      dvx += (ovx - vx) * w; dvy += (ovy - vy) * w;
      if (d <= 10) counts[0]++;
      if (d <= 20) counts[1]++;
      if (d <= 40) counts[2]++;
    }
    return [weight ? dx / weight : 0, weight ? dy / weight : 0,
      weight ? dvx / weight : 0, weight ? dvy / weight : 0, ...counts];
  };
  const mates = peer(player.team), opponents = peer(player.team === 'Home' ? 'Away' : 'Home');
  return [vx, vy, ax, ay, puckDx, puckDy, puckVx, puckVy, puckMissing ? 1 : 0,
    ...mates.slice(0, 4), ...opponents.slice(0, 4), ...mates.slice(4), ...opponents.slice(4)];
}

export function createHockeyMovementPolicy(model) {
  if (!model || !Array.isArray(model.mean) || !Array.isArray(model.scale) ||
      !Array.isArray(model.coefficients) || model.mean.length !== model.scale.length ||
      model.coefficients.length !== model.mean.length + 1) {
    throw new TypeError('invalid serialized hockey ridge model');
  }
  return (state, playerId) => {
    const player = state.players.find((row) => row.id === playerId);
    const allFeatures = hockeyFeatures(state, player);
    const features = allFeatures.slice(0, model.mean.length);
    let rx = model.coefficients[0][0], ry = model.coefficients[0][1];
    for (let i = 0; i < features.length; i++) {
      const z = (features[i] - model.mean[i]) / (model.scale[i] || 1);
      rx += z * model.coefficients[i + 1][0]; ry += z * model.coefficients[i + 1][1];
    }
    const velocity = allFeatures.slice(0, 2);
    const endpointDx = velocity[0] * 15 + rx, endpointDy = velocity[1] * 15 + ry;
    return { playerId, dx: endpointDx / 15, dy: endpointDy / 15,
      metadata: { endpointHorizonOrdinalSteps: 15, featureVersion: model.featureVersion } };
  };
}

export function createHockeyConstraints(limits = {}) {
  const maxStep = limits.maxDisplacement ?? Infinity;
  const maxDelta = limits.maxDisplacementChange ?? Infinity;
  const maxTurn = limits.maxTurnRadians ?? Math.PI;
  const minSeparation = limits.minimumPairSeparation ?? 0;
  return (next, previous) => {
    const byId = new Map(previous.players.map((p) => [p.id, p]));
    let players = next.players.map((p) => {
      const old = byId.get(p.id), hist = old.history ?? [];
      let dx = p.x - old.x, dy = p.y - old.y;
      const magnitude = norm(dx, dy);
      if (magnitude > maxStep) { dx *= maxStep / magnitude; dy *= maxStep / magnitude; }
      if (hist.length >= 2) {
        const prior = hist.at(-1), before = hist.at(-2);
        let vx = prior.x - before.x, vy = prior.y - before.y;
        const dvx = dx - vx, dvy = dy - vy, dmag = norm(dvx, dvy);
        if (dmag > maxDelta) { dx = vx + dvx * maxDelta / dmag; dy = vy + dvy * maxDelta / dmag; }
        const currentAngle = Math.atan2(dy, dx), priorAngle = Math.atan2(vy, vx);
        if (norm(vx, vy) > 0.1 && norm(dx, dy) > 0.1) {
          const delta = wrap(currentAngle - priorAngle);
          if (Math.abs(delta) > maxTurn) {
            const angle = priorAngle + Math.sign(delta) * maxTurn, speed = norm(dx, dy);
            dx = Math.cos(angle) * speed; dy = Math.sin(angle) * speed;
          }
        }
      }
      return { ...p, x: Math.max(RINK.minX, Math.min(RINK.maxX, old.x + dx)),
        y: Math.max(RINK.minY, Math.min(RINK.maxY, old.y + dy)) };
    });
    if (minSeparation > 0) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
          let dx = players[j].x - players[i].x, dy = players[j].y - players[i].y;
          let d = norm(dx, dy);
          if (d >= minSeparation) continue;
          if (d < 1e-9) { dx = players[i].id < players[j].id ? 1 : -1; dy = 0; d = 1; }
          const push = (minSeparation - d) / 2, ux = dx / d, uy = dy / d;
          players[i].x = Math.max(RINK.minX, Math.min(RINK.maxX, players[i].x - ux * push));
          players[i].y = Math.max(RINK.minY, Math.min(RINK.maxY, players[i].y - uy * push));
          players[j].x = Math.max(RINK.minX, Math.min(RINK.maxX, players[j].x + ux * push));
          players[j].y = Math.max(RINK.minY, Math.min(RINK.maxY, players[j].y + uy * push));
        }
      }
    }
    return { ...next, players };
  };
}

/** Advance the non-physical puck context with an explicit ordinal constant-displacement helper. */
export function advanceHockeyPuckOrdinal(next, previous) {
  const history = previous.puckHistory ?? [];
  const puck = previous.puck;
  if (!puck || history.length < 2) {
    next.puck = null;
    next.puckHistory = [];
    return next;
  }
  const a = history.at(-2), b = history.at(-1);
  const x = puck.x + (b.x - a.x), y = puck.y + (b.y - a.y);
  if (x < RINK.minX || x > RINK.maxX || y < RINK.minY || y > RINK.maxY) {
    next.puck = null;
    next.puckHistory = [];
  } else {
    next.puck = { ...puck, x, y, generatedBy: 'constant_ordinal_displacement_helper' };
    next.puckHistory = [...history, next.puck].slice(-6);
  }
  return next;
}

export function stepHockeyMovement(state, intents, constraints = null) {
  return stepMovement(state, intents, (next, previous, rows) => {
    const projected = constraints ? constraints(next, previous, rows) : next;
    return advanceHockeyPuckOrdinal(projected, previous);
  });
}

export { RINK as hockeyRinkBounds };
