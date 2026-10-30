const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function angleDifference(a, b) {
  let difference = a - b;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

/** Geometric field-of-view and body-height sightline check for a point observer. */
export function observationVisibility(observer, target, blockers = [], {
  heading = observer.headDirection ?? observer.h ?? 0,
  fieldOfView = 220 * Math.PI / 180,
  maxDistance = Infinity,
  observerEyeHeight = 1.72,
  targetEyeHeight = 1.72,
  defaultBlockerHeight = 1.85,
  endpointMargin = 0.08,
} = {}) {
  const dx = target.p.x - observer.p.x, dy = target.p.y - observer.p.y;
  const distance = Math.hypot(dx, dy);
  if (distance > maxDistance) return { visible: false, reason: 'out_of_range', distance };
  if (distance > 1e-8 && Math.abs(angleDifference(Math.atan2(dy, dx), heading)) > fieldOfView / 2) {
    return { visible: false, reason: 'outside_fov', distance };
  }
  if (distance <= 1e-8) return { visible: true, reason: 'visible', distance };

  const ux = dx / distance, uy = dy / distance;
  for (const blocker of blockers) {
    if (blocker === observer || blocker === target || blocker.down) continue;
    const rx = blocker.p.x - observer.p.x, ry = blocker.p.y - observer.p.y;
    const along = rx * ux + ry * uy;
    const near = (observer.r ?? 0) + endpointMargin;
    const far = distance - (target.r ?? 0) - endpointMargin;
    if (along <= near || along >= far) continue;
    const perpendicular = Math.abs(rx * uy - ry * ux);
    if (perpendicular > (blocker.r ?? 0) + endpointMargin) continue;
    const heightOnSightline = observerEyeHeight + (targetEyeHeight - observerEyeHeight) * (along / distance);
    if (heightOnSightline <= (blocker.height ?? defaultBlockerHeight)) {
      return { visible: false, reason: 'occluded', distance, blockerId: blocker.id };
    }
  }
  return { visible: true, reason: 'visible', distance };
}

/** Delayed, finite player observations with last-seen extrapolation and growing uncertainty. */
export class ObservationMemory {
  constructor({
    reactionDelaySeconds = 0.18,
    maxMemorySeconds = 1.6,
    maxPredictionSeconds = 0.35,
    confidenceDecaySeconds = 0.7,
    baseUncertaintyMeters = 0.12,
    uncertaintyGrowthMetersPerSecond = 1.1,
  } = {}) {
    this.reactionDelaySeconds = reactionDelaySeconds;
    this.maxMemorySeconds = maxMemorySeconds;
    this.maxPredictionSeconds = maxPredictionSeconds;
    this.confidenceDecaySeconds = confidenceDecaySeconds;
    this.baseUncertaintyMeters = baseUncertaintyMeters;
    this.uncertaintyGrowthMetersPerSecond = uncertaintyGrowthMetersPerSecond;
    this.pending = [];
    this.lastSeen = new Map();
    this.counts = { captured: 0, delivered: 0, outside_fov: 0, occluded: 0, out_of_range: 0, stale_reads: 0, expired_reads: 0 };
  }

  capture(observer, target, blockers, observedAt, options = {}) {
    const visibility = observationVisibility(observer, target, blockers, options);
    if (!visibility.visible) {
      if (Object.hasOwn(this.counts, visibility.reason)) this.counts[visibility.reason]++;
      return visibility;
    }
    this.pending.push({
      id: target.id,
      position: { x: target.p.x, y: target.p.y },
      velocity: { x: target.v?.x ?? 0, y: target.v?.y ?? 0 },
      z: target.z ?? 0,
      vz: target.vz ?? 0,
      down: !!target.down,
      observedAt,
      availableAt: observedAt + this.reactionDelaySeconds,
    });
    this.counts.captured++;
    return { ...visibility, reason: 'queued', availableAt: observedAt + this.reactionDelaySeconds };
  }

  advance(now) {
    const stillPending = [];
    for (const observation of this.pending) {
      if (observation.availableAt > now + 1e-9) {
        stillPending.push(observation);
        continue;
      }
      const previous = this.lastSeen.get(observation.id);
      if (!previous || observation.observedAt > previous.observedAt) {
        this.lastSeen.set(observation.id, observation);
        this.counts.delivered++;
      }
    }
    this.pending = stillPending;
  }

  estimate(id, now) {
    const observation = this.lastSeen.get(id);
    if (!observation) return null;
    const age = Math.max(0, now - observation.observedAt);
    if (age > this.maxMemorySeconds) {
      this.counts.expired_reads++;
      return null;
    }
    if (age > this.reactionDelaySeconds + 0.05) this.counts.stale_reads++;
    const predicted = Math.min(age, this.maxPredictionSeconds);
    return {
      id,
      position: { x: observation.position.x + observation.velocity.x * predicted,
        y: observation.position.y + observation.velocity.y * predicted },
      velocity: { ...observation.velocity },
      z: observation.z + observation.vz * predicted,
      vz: observation.vz,
      down: observation.down,
      observedAt: observation.observedAt,
      ageSeconds: age,
      confidence: Math.exp(-age / this.confidenceDecaySeconds),
      uncertaintyMeters: this.baseUncertaintyMeters + age * this.uncertaintyGrowthMetersPerSecond,
    };
  }
}

/** Estimate where an observed airborne ball will reach turf, ignoring drag and spin. */
export function estimateBallLanding(observation, gravity = 9.80665) {
  const z = Math.max(0, observation.z);
  const vz = observation.vz;
  const flightSeconds = (vz + Math.sqrt(vz * vz + 2 * gravity * z)) / gravity;
  return {
    x: observation.position.x + observation.velocity.x * flightSeconds,
    y: observation.position.y + observation.velocity.y * flightSeconds,
    flightSeconds,
    uncertaintyMeters: observation.uncertaintyMeters + flightSeconds * 0.8,
  };
}

export function turnHeadingToward(current, target, maxTurnRadians) {
  const difference = angleDifference(target, current);
  return current + clamp(difference, -maxTurnRadians, maxTurnRadians);
}
