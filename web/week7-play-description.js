// Player credits for the illustrative Week 7 3D replay.
// Names come from the exact 2026 roster IDs chosen by selectPlay, never from
// the 2025 PBP row sampled for the result. Nothing here alters game outcomes.
export function describeWeek7Play(play, selection = null, players = {}) {
  const name = id => id != null && players?.[id]?.name ? players[id].name : '';
  let actors = '';
  if (play.type === 'scrimmage' && selection?.play) {
    const off = selection.lineups?.offense || {};
    if (play.kind === 'run') {
      actors = name(selection.play.carrier);
    } else if (play.kind === 'pass') {
      const qb = name(off.QB);
      const target = name(selection.play.target);
      actors = qb;
      if (target) actors += (actors ? ' ' : '') + (play.completed && !play.interception ? 'to ' : 'intended for ') + target;
      if (play.interception) {
        const defender = name(selection.play.interceptor);
        if (defender) actors += (actors ? ' · ' : '') + 'picked by ' + defender;
      }
    }
  }
  // A scoring play says so once, at the front: "TOUCHDOWN · QB to WR · 22 yd".
  // The sampled action code (RUN / PASS COMPLETE) and the trailing
  // "Touchdown · " tag never both appear on the same line.
  const action = play.touchdown && play.type === 'scrimmage' ? 'TOUCHDOWN' : play.action;
  let result = '';
  if (play.type === 'scrimmage') {
    if (play.touchdown || play.kind === 'run' || (play.kind === 'pass' && play.completed && !play.interception))
      result = play.gain + ' yd';
  } else if (play.type === 'punt' || play.type === 'field_goal') {
    if (Number.isFinite(Number(play.distance))) result = play.distance + ' yd';
  } else if (play.type === 'kickoff') {
    if (play.outcome === 'returned') result = play.return_yards + ' yd return';
    else result = String(play.outcome || '').replace(/_/g, ' ');
  }
  const line = [action, actors, result].filter(Boolean).join(' · ');
  return { action, actors, result, line };
}

/** Summarize the tracked movement and contact sequence for an illustrative run. */
export function describeWeek7Movement(play, selection = null, record = null, players = {}) {
  if (play?.type !== 'scrimmage' || play.kind !== 'run' || !record?.frames?.length || !record?.roster?.length) return '';

  const handoff = record.events?.find(event => event.type === 'handoff');
  const carrierId = handoff?.to || record.carrierId || selection?.play?.carrier;
  const carrierIndex = record.roster.findIndex(player => player.id === carrierId);
  if (carrierIndex < 0) return '';

  const carrier = record.roster[carrierIndex];
  const direction = Number(selection?.play?.dir) || 1;
  const startTime = Number.isFinite(handoff?.t) ? handoff.t : 0;
  const frameAt = time => {
    const frameIndex = Math.max(0, Math.min(record.frames.length - 1,
      Math.round((time - record.t0) * record.hz)));
    return record.frames[frameIndex];
  };
  const positionAt = (playerIndex, time) => {
    const frame = frameAt(time), offset = playerIndex * 6;
    return { x: frame[offset], y: frame[offset + 1] };
  };
  const start = positionAt(carrierIndex, startTime);
  const atHalf = positionAt(carrierIndex, startTime + 0.5);
  const atOne = positionAt(carrierIndex, startTime + 1);
  const carrierName = players?.[carrierId]?.name || carrier.slot || 'The runner';
  const distanceText = value => `${Math.abs(value).toFixed(1)} yd`;
  const movementAt = (position, label) => {
    const forward = (position.x - start.x) * direction;
    const lateral = (position.y - start.y) * direction;
    const progress = forward < -0.1 ? `moved ${distanceText(forward)} backward` :
      forward <= 0.1 ? 'made no downfield progress' : `advanced ${distanceText(forward)} forward`;
    const side = lateral < -0.1 ? `drifted ${distanceText(lateral)} to the offense's right` :
      lateral > 0.1 ? `drifted ${distanceText(lateral)} to the offense's left` : 'held his lateral line';
    return label === '0.5s'
      ? `In the first 0.5s after the handoff, he ${progress} and ${side}.`
      : `By 1.0s after the handoff, he ${progress} and ${side}.`;
  };

  const nearest = record.roster
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.team !== carrier.team)
    .map(({ player, index }) => ({ player, index,
      distance: Math.hypot(positionAt(index, startTime).x - start.x,
        positionAt(index, startTime).y - start.y) }))
    .sort((a, b) => a.distance - b.distance)[0];

  let defenderText = '';
  if (nearest) {
    const defenderName = players?.[nearest.player.id]?.name || nearest.player.slot || 'nearest defender';
    const defenderStart = positionAt(nearest.index, startTime);
    const defenderAtOne = positionAt(nearest.index, startTime + 1);
    const gapAtOne = Math.hypot(defenderAtOne.x - atOne.x, defenderAtOne.y - atOne.y);
    const defenderForward = (defenderAtOne.x - defenderStart.x) * direction;
    const defenderLateral = (defenderAtOne.y - defenderStart.y) * direction;
    const downfield = defenderForward > 0.1 ? `${distanceText(defenderForward)} downfield` :
      defenderForward < -0.1 ? `${distanceText(defenderForward)} backfield` : 'stayed at the same depth';
    const side = defenderLateral < -0.1 ? `moved ${distanceText(defenderLateral)} to the offense's right` :
      defenderLateral > 0.1 ? `moved ${distanceText(defenderLateral)} to the offense's left` : '';
    const trend = gapAtOne < nearest.distance - 0.2 ? 'closed' :
      gapAtOne > nearest.distance + 0.2 ? 'widened' : 'stayed about the same';
    defenderText = ` Closest defender at the handoff: ${defenderName} ${downfield}${side ? ` and ${side}` : ''}; the gap ${trend} from ${distanceText(nearest.distance)} to ${distanceText(gapAtOne)} after 1.0s.`;
  }

  const broken = (record.events || []).filter(event => event.type === 'broken_tackle' && event.by === carrierId).length;
  const handoffText = handoff ? `${carrierName} got the handoff ${startTime.toFixed(1)}s after the snap.` :
    `${carrierName} kept the ball.`;
  const tackleText = `${broken} broken tackle${broken === 1 ? '' : 's'}`;
  const contactText = broken ? ` The sampled ${play.gain} yd gain is fixed; the animation recorded ${tackleText} before the play ended.` :
    ` This animation follows the sampled ${play.gain} yd gain; it does not predict the outcome.`;
  return `Movement: ${handoffText} ${movementAt(atHalf, '0.5s')} ${movementAt(atOne, '1.0s')}${defenderText}${contactText}`;
}
