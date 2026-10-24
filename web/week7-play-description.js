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
  let result = '';
  if (play.type === 'scrimmage') {
    if (play.touchdown) result = 'Touchdown · ' + play.gain + ' yd';
    else if (play.kind === 'run' || (play.kind === 'pass' && play.completed && !play.interception))
      result = play.gain + ' yd';
  } else if (play.type === 'punt' || play.type === 'field_goal') {
    if (Number.isFinite(Number(play.distance))) result = play.distance + ' yd';
  } else if (play.type === 'kickoff') {
    if (play.outcome === 'returned') result = play.return_yards + ' yd return';
    else result = String(play.outcome || '').replace(/_/g, ' ');
  }
  const line = [play.action, actors, result].filter(Boolean).join(' · ');
  return { actors, result, line };
}
