// Broadcast spot notation: the ball's yard line and the team whose side of the field it is on, like "KC 15" or "BAL 20".
// `yardline_100` is the distance to the end zone the offense attacks, so above 50 the ball is on the offense's own side.

export function mascotOf(name) {
  return String(name ?? '').trim().split(/\s+/).pop() ?? '';
}

export function spotText(yardline100, offenseAbbr, defenseAbbr) {
  if (!Number.isFinite(yardline100)) return '';
  if (yardline100 === 50) return 'MIDFIELD';
  return yardline100 > 50 ? `${offenseAbbr} ${100 - yardline100}` : `${defenseAbbr} ${yardline100}`;
}
