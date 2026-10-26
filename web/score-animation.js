// Scorebug score for a replayed play. The scorebug shows the pre-play score until the scoring moment in the
// 3D replay, then the post-play score. Pure helpers, so they can be tested without a browser.

const SCORING_EVENTS = new Set(['touchdown', 'fg_good']);

// Points each side gained on the play, from its state before and after.
export function scoreDelta(play) {
  const before = play?.state_before ?? {};
  const after = play?.state_after ?? before;
  return {
    away: (after.away_score ?? 0) - (before.away_score ?? 0),
    home: (after.home_score ?? 0) - (before.home_score ?? 0),
  };
}

// Replay time of the first scoring event, on the same clock as the playback position, or null.
export function scoreMoment(record) {
  const event = (record?.events ?? []).find((e) => SCORING_EVENTS.has(e.type));
  return event && Number.isFinite(event.t) ? event.t : null;
}

// Score the scorebug shows at playback time t: pre-play before the moment, post-play from it on.
export function scoreShown(pre, post, t, moment) {
  return moment != null && t >= moment ? post : pre;
}

// Integer score on the way from `from` to `to`, progress 0 to 1, ease-out.
export function tweenScore(from, to, progress) {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(from + (to - from) * (1 - (1 - p) ** 3));
}
