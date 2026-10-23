// Physical tackle probe: does a rating change move the ball carrier's body after contact?
//
// For each seed, one play runs from the same frozen 2026-10-22 NE-CHI lineups and the same seed. The probe
// measures what the physics does after the tackle: how far the carrier's body moves in the second after the
// wrap, and his speed at that point. Outcome odds are not compared, only the body.
//
// Conditions: baseline (snapshot as-is), defenders' TAK +10, and offensive skill players' BTK +10.
// Usage: node scripts/tackle_physics_probe.mjs --label baseline --seeds 200 --out path.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulatePlay } from '../engine/play.js';
import { buildLineups } from '../web/prototype-model.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const LABEL = opt('label', 'baseline');
const SEEDS = Number(opt('seeds', 200));
const OUT = opt('out', `${ROOT}/tackle-physics-${LABEL}.json`);

function mapRoster(team) {
  return SNAPSHOT.teams[team].roster.map((p) => ({ ...p, team: p.team_id, pos: p.rating_position, group: p.rating_group }));
}
function playersFor(teamIds) {
  const map = {};
  for (const id of teamIds) {
    for (const p of SNAPSHOT.teams[id].roster) {
      map[p.id] = { ...p, team: p.team_id, pos: p.rating_position, group: p.rating_group };
    }
  }
  return map;
}
function scenario(id, kind, off, def) {
  const base = buildLineups(mapRoster(off), mapRoster(def), { offense: {}, defense: {} });
  return { id, kind, off, def, lineup: { offense: base.offense, defense: base.defense } };
}
function playFor(sc, seed) {
  const common = { id: `${sc.id}|seed${seed}`, off: sc.off, def: sc.def, los: 45, dir: 1, shotgun: true,
    lineup: { [sc.off]: sc.lineup.offense, [sc.def]: sc.lineup.defense }, outcome_mode: 'free', text: 'tackle physics probe' };
  if (sc.kind === 'run') {
    return { ...common, kind: 'run', kindGroup: 'run', carrier: sc.lineup.offense.RB, loc: 'middle', gap: 'middle', shotgun: false };
  }
  return { ...common, kind: 'pass', kindGroup: 'pass', target: sc.lineup.offense.WR1, target_route: 'curl', air: 10, loc: 'middle' };
}
function shift(players, team, attr, delta, pos = null) {
  const copy = { ...players };
  for (const [id, p] of Object.entries(players)) {
    if (p.team !== team) continue;
    if (pos && !pos.includes(p.pos)) continue;
    copy[id] = { ...p, ratings: { ...p.ratings, [attr]: (p.ratings?.[attr] ?? 50) + delta } };
  }
  return copy;
}
const SKILL = ['RB', 'FB', 'WR', 'TE'];

function measure(res) {
  const tk = res.events.find((e) => e.type === 'tackle');
  if (!tk) return { tackle: false };
  const n = res.roster.length;
  if (res.stride !== n * 6 + 6) throw new Error(`frame layout mismatch: stride ${res.stride}, roster ${n}`);
  const idx = res.roster.findIndex((p) => p.id === tk.on);
  if (idx < 0) throw new Error(`carrier ${tk.on} not in roster`);
  const k0 = Math.round((tk.t - res.t0) * res.hz);
  const k1 = Math.min(res.frames.length - 1, k0 + Math.round(res.hz));
  const f0 = res.frames[k0], f1 = res.frames[k1];
  const o = idx * 6;
  return {
    tackle: true,
    closing: tk.closing,
    energy: tk.energy,
    drag_yd: Math.hypot(f1[o] - f0[o], f1[o + 1] - f0[o + 1]),
    speed_after: f1[o + 3],
  };
}

function summarise(rows) {
  const t = rows.filter((r) => r.tackle);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return {
    plays: rows.length,
    tackle_rate: t.length / rows.length,
    drag_yd_mean: mean(t.map((r) => r.drag_yd)),
    drag_yd_median: median(t.map((r) => r.drag_yd)),
    speed_after_mean: mean(t.map((r) => r.speed_after)),
    closing_mean: mean(t.map((r) => r.closing)),
    energy_mean: mean(t.map((r) => r.energy)),
  };
}

const base = playersFor(['NE', 'CHI']);
const conditions = {
  baseline: base,
  def_TAK_plus10: shift(base, 'CHI', 'TAK', 10),
  off_BTK_plus10: shift(base, 'NE', 'BTK', 10, SKILL),
};
const scenarios = [scenario('run_ne_at_chi', 'run', 'NE', 'CHI'), scenario('pass_ne_at_chi', 'pass', 'NE', 'CHI')];
const report = { label: LABEL, seeds: SEEDS, results: {} };
for (const [cname, players] of Object.entries(conditions)) {
  report.results[cname] = {};
  for (const sc of scenarios) {
    const rows = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(measure(simulatePlay({ players }, playFor(sc, seed))));
    }
    report.results[cname][sc.id] = summarise(rows);
  }
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.results, null, 1).slice(0, 1200));
console.log(`wrote ${OUT}`);
