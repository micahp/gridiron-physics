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

// Tween a scorebug number from `from` to `to` and flash its team when it changed. Reduced motion shows the final value.
export function animateScoreBug(bugEl, scoreEl, from, to, { durationMs = 600, flashMs = 1400 } = {}) {
  scoreEl.textContent = String(from);
  if (from === to || !bugEl || !scoreEl) return;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { scoreEl.textContent = String(to); return; }
  bugEl.classList.add('scored');
  clearTimeout(bugEl._scoredTimer);
  bugEl._scoredTimer = setTimeout(() => bugEl.classList.remove('scored'), flashMs);
  const start = performance.now();
  const step = (now) => {
    scoreEl.textContent = String(tweenScore(from, to, (now - start) / durationMs));
    if (now - start < durationMs) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Integer score on the way from `from` to `to`, progress 0 to 1, ease-out.
export function tweenScore(from, to, progress) {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(from + (to - from) * (1 - (1 - p) ** 3));
}
