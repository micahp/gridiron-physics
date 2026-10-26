// Score shown at a touchdown play. A touchdown is six points; the try (one or two) is held back and shows when the
// next play starts, because that play's starting score already includes it.
export function touchdownScore(pre, post, play) {
  const touchdown = play?.outcome?.touchdown === true;
  const hold = (side) => {
    const gained = (post[side] ?? 0) - (pre[side] ?? 0);
    return touchdown && gained > 6 ? (pre[side] ?? 0) + 6 : post[side];
  };
  return { away: hold('away'), home: hold('home') };
}

// True once the playback clock is past the play's end: the scorebug shows the post-play score from then on.
export function afterPlayEnd(endT, t) {
  return endT != null && t > endT;
}
