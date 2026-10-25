// Outcome-blind scorer for an already-completed autonomous trajectory. The
// observed rows are read only here, after simulation, and can never steer it.
const ROW_KEYS = new Set(['player_id', 't', 'x', 'y']);
const YD_TO_M = 0.9144;

function simulatedAt(samples, t) {
  if (!samples?.length || t < samples[0].t || t > samples.at(-1).t) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[Math.min(samples.length - 1, hi)];
  const span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function summarize(rows, rosterById) {
  const errors = rows.map((row) => row.errorYards);
  const meanYards = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  const groups = (keyFn) => {
    const groups = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.errorYards);
    }
    return Object.fromEntries([...groups].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, values]) => [key, {
      samples: values.length,
      mean_error_yards: values.reduce((a, b) => a + b, 0) / values.length,
      mean_error_meters: values.reduce((a, b) => a + b, 0) / values.length * YD_TO_M,
    }]));
  };
  return {
    samples_scored: rows.length,
    players_scored: new Set(rows.map((r) => r.player_id)).size,
    expected_players: rosterById.size,
    mean_xy_error_yards: meanYards,
    mean_xy_error_meters: meanYards == null ? null : meanYards * YD_TO_M,
    by_team: groups((r) => rosterById.get(r.player_id).team),
    by_role: groups((r) => rosterById.get(r.player_id).roleKey),
  };
}

export function scoreAutonomousTracking(simulation, observedRows) {
  if (simulation?.schema_version !== 'gridiron.autonomous-inside-zone.v1' || simulation.mode !== 'autonomous') {
    throw new TypeError('expected a completed autonomous inside-zone simulation');
  }
  if (!Array.isArray(observedRows)) throw new TypeError('observedRows must be a separate evaluation-only array');
  const rosterById = new Map(simulation.roster.map((r) => [r.id, r]));
  if (rosterById.size !== 22) throw new TypeError('simulation roster must contain 22 unique players');
  const seen = new Set();
  const fullTrack = [];
  for (const row of observedRows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('each observed row must be an object');
    for (const key of Object.keys(row)) if (!ROW_KEYS.has(key)) throw new TypeError(`observed trajectory rows may contain positions and time only; rejected ${key}`);
    if (typeof row.player_id !== 'string' || !rosterById.has(row.player_id)) throw new TypeError(`unmatched observed player_id ${row.player_id}`);
    if (!Number.isFinite(row.t) || row.t <= 0) throw new RangeError('observed target time must be after snap; origin frames are not scored');
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) throw new TypeError('observed x/y must be finite yards in the simulation field frame');
    const key = `${row.player_id}|${row.t.toFixed(6)}`;
    if (seen.has(key)) throw new TypeError(`duplicate observed player/time row ${key}`);
    seen.add(key);
    const predicted = simulatedAt(simulation.trajectories[row.player_id], row.t);
    if (!predicted) continue;
    fullTrack.push({
      player_id: row.player_id,
      t: row.t,
      errorYards: Math.hypot(predicted.x - row.x, predicted.y - row.y),
    });
  }
  const horizons = {};
  for (const t of [0.5, 1.0]) {
    const rows = [], baselineRows = [];
    for (const player of simulation.roster) {
      const observed = observedRows
        .filter((row) => row.player_id === player.id && Math.abs(row.t - t) <= 0.051)
        .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
      if (!observed) continue;
      const predicted = simulatedAt(simulation.trajectories[player.id], t);
      if (!predicted) continue;
      rows.push({ player_id: player.id, errorYards: Math.hypot(predicted.x - observed.x, predicted.y - observed.y) });
      const origin = simulation.trajectories[player.id][0];
      const baselineX = origin.x + origin.vx * t;
      const baselineY = origin.y + origin.vy * t;
      baselineRows.push({ player_id: player.id, errorYards: Math.hypot(baselineX - observed.x, baselineY - observed.y) });
    }
    const model = summarize(rows, rosterById);
    const baseline = summarize(baselineRows, rosterById);
    horizons[`${t.toFixed(1)}s`] = {
      ...model,
      constant_velocity_baseline: baseline,
      model_minus_baseline_meters: model.mean_xy_error_meters == null || baseline.mean_xy_error_meters == null
        ? null : model.mean_xy_error_meters - baseline.mean_xy_error_meters,
    };
  }
  return {
    mode: 'evaluation_only',
    sim_schema_version: simulation.schema_version,
    scored_input_rows: fullTrack.length,
    trajectory: summarize(fullTrack, rosterById),
    horizons,
    leakage_guard: 'observed t>0 positions are evaluated after the autonomous simulation and are not passed to its decision engine',
  };
}
