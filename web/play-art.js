// Play art for one called play, drawn the way Madden draws it. Offense: each receiver's route in its own colour, and
// a yellow block bar on the defender each lineman is on. Defense: a shaded zone for each zone defender, a connector from
// him to the zone (or to the receiver he covers, or to a run-fit landmark) ending in an X, and red arrows for rushers.
// It reads the assignments the engine set up at the snap, not where the play ended, so the art shows the call.
//
// Every mark carries its colour. Coordinates are yards: x along the field, y across it. playArtMarks feeds both the
// card's SVG and the 3D overlay.

export const PALETTE = {
  zone: ['#3f7bff', '#e6d28a', '#a166ff', '#2fd3c0', '#ff9f43', '#7bd389', '#ff7eb6'],
  route: ['#ffffff', '#ffd23f', '#5fd3ff', '#7cf08a', '#ff9ad5'],
  block: '#ffd23f',
  rush: '#ff3b30',
  los: '#3d8bff',
  firstDown: '#f5d33a',
  field: '#101a14',
  other: '#5b6672',
};

// A zone is drawn at the engine's radius for it, so its size is the zone's size. The colour follows that size: the
// engine sets radius = 4.5 + zone rating / 25 yd, and the bands below are the sizes it produces (deep, underneath, flat).
const ZONE_GROW = 1.3; // the shape is a little wider than the radius, as Madden's zone shapes are
const ZONE_ASPECT = 0.5; // depth of a zone shape against its width
const ZONE_SIZES = [{ min: 7, color: '#3f7bff' }, { min: 5.5, color: '#e6d28a' }, { min: 0, color: '#2fd3c0' }];
const zoneColour = (radius) => ZONE_SIZES.find((band) => radius >= band.min).color;

// the frame at the snap, as an index into record.frames
export function snapFrame(record) {
  return Math.round(-record.t0 * record.hz);
}

// every player's alignment at the snap, in yards
export function alignment(record) {
  const f = record.frames[snapFrame(record)];
  return record.roster.map((entry, i) => ({ team: entry.team, slot: entry.slot, x: f[i * 6], y: f[i * 6 + 1] }));
}

// One team's assignments on the called play. Kinds: route (a route, or a run lane), block (the defender a lineman is on),
// zone (a zone and the defender who holds it), man (the receiver a defender covers), fit (a run-fit landmark), rush (a
// rusher going at the passer). Connectors start at the player's alignment; the X sits on what he is assigned to.
export function playArtMarks(record, teamId) {
  const lined = alignment(record);
  const qb = record.roster.findIndex((entry) => entry.slot === 'QB');
  const at = (j) => ({ x: lined[j].x, y: lined[j].y });
  const marks = [];
  let routes = 0;
  record.roster.forEach((entry, i) => {
    if (entry.team !== teamId) return;
    const a = record.assignments?.[i];
    if (!a) return;
    const from = at(i);
    const mine = PALETTE.zone[i % PALETTE.zone.length];
    if (a.route) marks.push({ kind: 'route', slot: entry.slot, color: PALETTE.route[routes++ % PALETTE.route.length], points: [from, ...a.route] });
    if (a.block != null) marks.push({ kind: 'block', from, to: at(a.block), color: PALETTE.block });
    if (a.zone) {
      const rx = a.zone.r * ZONE_GROW;
      marks.push({ kind: 'zone', slot: entry.slot, from, at: { x: a.zone.x, y: a.zone.y }, rx, ry: rx * ZONE_ASPECT, color: zoneColour(a.zone.r) });
    }
    if (a.man != null) marks.push({ kind: 'man', slot: entry.slot, from, to: at(a.man), color: mine });
    if (a.landmark) marks.push({ kind: 'fit', slot: entry.slot, from, to: a.landmark, color: mine });
    if (a.mode === 'rush' && qb >= 0) marks.push({ kind: 'rush', slot: entry.slot, from, to: at(qb), color: PALETTE.rush });
  });
  return marks;
}

// Card coordinates: 53.3 yd across left to right, downfield up, with the line of scrimmage near the bottom.
const PX = 3;
const SVG_W = 160;
const DEPTH_TOP = 30;
const DEPTH_BOTTOM = -10;
const SVG_H = PX * (DEPTH_TOP - DEPTH_BOTTOM);

const f1 = (n) => n.toFixed(1);

// the arrowhead at `to`, pointing along from -> to, as an SVG polygon
function head(from, to, color) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return '';
  const ux = dx / len, uy = dy / len;
  const bx = to.x - ux * 3.4, by = to.y - uy * 3.4;
  return `<polygon points="${f1(to.x)},${f1(to.y)} ${f1(bx - uy * 1.8)},${f1(by + ux * 1.8)} ${f1(bx + uy * 1.8)},${f1(by - ux * 1.8)}" fill="${color}"/>`;
}

// the X on a target: where a connector ends
const cross = (p, color) => `<path d="M${f1(p.x - 2.8)} ${f1(p.y - 2.8)}L${f1(p.x + 2.8)} ${f1(p.y + 2.8)}M${f1(p.x + 2.8)} ${f1(p.y - 2.8)}L${f1(p.x - 2.8)} ${f1(p.y + 2.8)}" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none"/>`;

// the card's SVG for one team's side of the called play. selection is the replay's selection (line of scrimmage, dir, offense).
export function playArtSvg(record, selection, teamId, { togo = null } = {}) {
  const { los, dir, off } = selection.play;
  const q = (p) => {
    const depth = (p.x - los) * dir;
    return { x: p.y * PX, y: (DEPTH_TOP - depth) * PX };
  };
  const lined = alignment(record);
  const grid = [];
  for (let d = DEPTH_BOTTOM + 5; d < DEPTH_TOP; d += 5) grid.push(`<line x1="0" x2="${SVG_W}" y1="${f1((DEPTH_TOP - d) * PX)}" y2="${f1((DEPTH_TOP - d) * PX)}" stroke="#ffffff" stroke-opacity="0.07"/>`);
  const losY = q({ x: los, y: 0 }).y;
  const fdY = togo == null ? null : q({ x: los + dir * togo, y: 0 }).y;
  const firstDown = fdY == null ? '' : `<line x1="0" x2="${SVG_W}" y1="${f1(fdY)}" y2="${f1(fdY)}" stroke="${PALETTE.firstDown}" stroke-width="0.8" stroke-dasharray="2 2"/>`;
  const dots = lined.map((p, i) => {
    const c = q(p);
    if (p.team !== teamId) return `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="1.5" fill="${PALETTE.other}"/>`;
    const color = teamId === off ? (record.assignments?.[i]?.route ? PALETTE.route[0] : '#f2efe6') : PALETTE.zone[i % PALETTE.zone.length];
    return `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="2.6" fill="${color}"/>`;
  }).join('');
  const shapes = playArtMarks(record, teamId).map((m) => {
    if (m.kind === 'zone') {
      const c = q(m.at);
      return `<ellipse cx="${f1(c.x)}" cy="${f1(c.y)}" rx="${f1(m.rx * PX)}" ry="${f1(m.ry * PX)}" fill="${m.color}" fill-opacity="0.22" stroke="${m.color}" stroke-width="1"/>`
        + `<line x1="${f1(q(m.from).x)}" y1="${f1(q(m.from).y)}" x2="${f1(c.x)}" y2="${f1(c.y)}" stroke="${m.color}" stroke-width="1.4"/>${cross(c, m.color)}`;
    }
    if (m.kind === 'route') {
      const pts = m.points.map(q);
      const line = `<polyline points="${pts.map((c) => `${f1(c.x)},${f1(c.y)}`).join(' ')}" fill="none" stroke="${m.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      return line + head(pts.at(-2), pts.at(-1), m.color);
    }
    const a = q(m.from), b = q(m.to);
    const link = `<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" stroke="${m.color}" stroke-width="${m.kind === 'block' ? 2 : 1.4}"/>`;
    if (m.kind === 'block') {
      const ux = b.x - a.x, uy = b.y - a.y, len = Math.hypot(ux, uy) || 1;
      const px = -uy / len * 2.4, py = ux / len * 2.4;
      return `${link}<line x1="${f1(b.x - px)}" y1="${f1(b.y - py)}" x2="${f1(b.x + px)}" y2="${f1(b.y + py)}" stroke="${m.color}" stroke-width="1.6"/>`;
    }
    if (m.kind === 'rush') return `${link}${head(a, b, m.color)}<rect x="${f1(a.x - 1.5)}" y="${f1(a.y - 1.5)}" width="3" height="3" fill="${m.color}"/>`;
    return link + cross(b, m.color);
  }).join('');
  return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${teamId === off ? 'Offensive' : 'Defensive'} play art">`
    + `<rect width="${SVG_W}" height="${SVG_H}" fill="${PALETTE.field}"/>${grid.join('')}`
    + `<line x1="0" x2="${SVG_W}" y1="${f1(losY)}" y2="${f1(losY)}" stroke="${PALETTE.los}" stroke-width="1"/>${firstDown}`
    + `${shapes}${dots}</svg>`;
}
