// Sequences every play of the game through the physics director, carrying
// the ball's lateral spot from one play to the next (hash-mark rules).
import { simulatePlay } from './play.js';
import { FIELD_W_YD } from './constants.js';

const HASH_LO_YD = 23.583;
const HASH_HI_YD = FIELD_W_YD - 23.583;

export function nextBallY(prev, play) {
  if (!prev || !prev.end) return FIELD_W_YD / 2;
  const r = prev.end.reason;
  if (['touchdown', 'fg_good', 'fg_miss', 'touchback', 'kick_out_of_bounds'].includes(r)) return FIELD_W_YD / 2;
  if (play && ['kickoff', 'fg', 'xp'].includes(play.kind)) return FIELD_W_YD / 2;
  // ball is spotted where it was downed, moved in to the nearest hash
  return Math.min(HASH_HI_YD, Math.max(HASH_LO_YD, prev.end.y));
}

export function simulateGame(game, { onProgress, only } = {}) {
  const out = new Array(game.plays.length).fill(null);
  let prev = null;
  for (let i = 0; i < game.plays.length; i++) {
    const S = game.plays[i];
    if (S.kind === 'admin' || (only && !only.includes(i))) continue;
    const res = simulatePlay(game, S, { ballY: nextBallY(prev, S) });
    out[i] = res;
    if (res) prev = res;
    onProgress && onProgress(i + 1, game.plays.length);
  }
  return out;
}
