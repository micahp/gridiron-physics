// Controlled rating probes for the free-play physics prototype.
//
// For each probe, one rating of one player is changed by a fixed offset while everything else is held
// fixed: the same scenario, the same lineups, and the same seeds (one play per seed). The engine seeds
// each play from its id, so a baseline and a variant that differ only in a rating see identical random
// streams, and any difference in outcome comes from the rating's effect on the engine's odds.
//
// Usage:  node scripts/rating_probe.mjs [--seeds 200] [--json out.json] [--md out.md] [--mode all|null|examples]
//
// The engine is not modified. Rosters are read from the frozen 2026 Week 7 snapshot; the rating change is applied
// to a copy of the one player's info object for each variant.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulatePlay } from '../engine/play.js';
import { buildLineups } from '../web/prototype-model.js';

const YD = 0.9144;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8'));
const ATTRS = 'ACC AGI AWR BCV BSH BTK CAR CIT CTH ELU FMV IBL INJ JMP KAC KPW MCV PBK PMV POW PRC PRS PUR RBK RET RTE SPC SPD STA STR TAK THA THP TRK ZCV'.split(' ');
const USED_BY_ENGINE = new Set(['AGI', 'AWR', 'BSH', 'BTK', 'CIT', 'CTH', 'ELU', 'FMV', 'KPW', 'PBK', 'PMV', 'RBK', 'STR', 'TAK', 'THA', 'THP']);
const OFFSETS = [-10, -5, 5, 10];

function args() {
  const out = { seeds: 200, json: null, md: null, mode: 'all' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    out[key] = key === 'seeds' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return out;
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

const ACTIVE = (team) => SNAPSHOT.teams[team].roster.filter((p) => p.status === 'ACT' && p.availability === 'available');
function findPlayer(team, name) {
  const p = SNAPSHOT.teams[team].roster.find((x) => x.name === name);
  if (!p) throw new Error(`player ${name} not on ${team} snapshot`);
  return p;
}

function mapRoster(team) {
  return SNAPSHOT.teams[team].roster.map((p) => ({ ...p, team: p.team_id, pos: p.rating_position, group: p.rating_group }));
}

/** Scenario = { id, kind, off, def, lineup }. Lineups come from the same builder the web app uses.
 *  pins = { offense: {slot: id}, defense: {slot: id} } (the builder's override shape). A pinned player who sits in
 *  another slot by default trades places with that slot's default player, so no one is listed twice. */
function scenario(id, kind, off, def, pins = {}) {
  const offRoster = mapRoster(off), defRoster = mapRoster(def);
  const dflt = buildLineups(offRoster, defRoster).offense;
  const offense = { ...(pins.offense || {}) };
  for (const [slot, pid] of Object.entries(offense)) {
    const other = Object.keys(dflt).find((s) => dflt[s] === pid && s !== slot);
    if (other && !(other in offense)) offense[other] = dflt[slot];
  }
  const base = buildLineups(offRoster, defRoster, { offense, defense: pins.defense || {} });
  return { id, kind, off, def, lineup: { offense: base.offense, defense: base.defense } };
}

/** Where a player sits in the scenario lineup. Throws if the player is not on the field: a probe must fail loudly. */
function placement(sc, playerId) {
  for (const side of ['offense', 'defense']) {
    const slot = Object.keys(sc.lineup[side]).find((s) => sc.lineup[side][s] === playerId);
    if (slot) return { side, slot };
  }
  throw new Error(`player ${playerId} is not in lineup ${sc.id}`);
}

function nameOf(playerId) {
  for (const t of ['NE', 'CHI']) {
    const p = SNAPSHOT.teams[t].roster.find((x) => x.id === playerId);
    if (p) return p.name;
  }
  return null;
}

function playFor(sc, seed) {
  const common = { id: `${sc.id}|seed${seed}`, off: sc.off, def: sc.def, los: 45, dir: 1, shotgun: true,
    lineup: { [sc.off]: sc.lineup.offense, [sc.def]: sc.lineup.defense }, outcome_mode: 'free', text: 'rating probe' };
  if (sc.kind === 'run') {
    return { ...common, kind: 'run', kindGroup: 'run', carrier: sc.lineup.offense.RB, loc: 'middle', gap: 'middle', shotgun: false };
  }
  return { ...common, kind: 'pass', kindGroup: 'pass', target: sc.lineup.offense.WR1, target_route: 'curl', air: 10, loc: 'middle' };
}

/** Patch one rating on one player; returns a fresh players map so the snapshot is never mutated. */
function withRating(base, playerId, attr, value) {
  const copy = { ...base };
  copy[playerId] = { ...base[playerId], ratings: { ...base[playerId].ratings, [attr]: value } };
  return copy;
}

function summarise(record, sc) {
  const ev = record.events;
  const count = (type, pred = () => true) => ev.filter((e) => e.type === type && pred(e)).length;
  const yards = sc.kind === 'run' ? (record.end.x / YD - 45) : null;
  const windowOpp = ev.filter((e) => ['catch', 'drop', 'pass_breakup', 'interception'].includes(e.type)
    || (e.type === 'incomplete' && e.catch_window === true)).length;
  return {
    throws: count('throw'),
    catch: count('catch'),
    drop: count('drop'),
    interception: count('interception'),
    pass_breakup: count('pass_breakup'),
    incomplete: count('incomplete'),
    catch_window_opportunities: windowOpp,
    sack: count('sack'),
    pressure: count('pressure'),
    run_block_engage: count('run_block_engage'),
    shed: count('shed'),
    tackle_attempts: count('wrapped') + count('broken_tackle'),
    tackle_success: count('wrapped'),
    broken_tackle: count('broken_tackle'),
    rush_yards: yards,
    end_reason: record.end.reason,
    outcome_class: outcomeClass(ev, sc),
  };
}

function outcomeClass(ev, sc) {
  const has = (t) => ev.some((e) => e.type === t);
  if (sc.kind === 'run') return has('wrapped') ? 'tackled' : has('broken_tackle') ? 'broken_tackle_only' : 'no_tackle_event';
  if (has('sack')) return 'sack';
  if (has('interception')) return 'interception';
  if (has('catch')) return 'complete';
  if (has('drop')) return 'drop';
  if (has('pass_breakup')) return 'breakup';
  return 'incomplete';
}

function wilson(k, n) {
  if (n === 0) return [null, null];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Run one scenario over all seeds for one players map. Returns per-seed summaries. */
function runSeeds(sc, players, seeds) {
  return seeds.map((seed) => summarise(simulatePlay({ players }, playFor(sc, seed)), sc));
}

function rateTable(rows, keys) {
  const n = rows.length;
  const out = {};
  for (const k of keys) {
    const hits = rows.filter((r) => r[k] !== null && r[k] !== undefined && r[k] !== 0 && r[k] !== false).length;
    const sum = rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : 0), 0);
    out[k] = { total: sum, plays_with_event: hits, share: n ? hits / n : null, ci95: wilson(hits, n) };
  }
  return out;
}

function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function probe(sc, playerId, attr, base, seeds) {
  const baseRows = runSeeds(sc, base, seeds);
  const results = { baseline: rateTable(baseRows, COUNT_KEYS), by_offset: {} };
  for (const offset of OFFSETS) {
    const cur = SNAPSHOT.teams[playerTeam(playerId)].roster.find((p) => p.id === playerId);
    const value = Math.max(25, Math.min(99, cur.ratings[attr] + offset));
    const variant = withRating(base, playerId, attr, value);
    const rows = runSeeds(sc, variant, seeds);
    const flips = rows.filter((r, i) => r.outcome_class !== baseRows[i].outcome_class).length;
    const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(baseRows[i])).length;
    results.by_offset[offset] = {
      value, rating_baseline: cur.ratings[attr],
      table: rateTable(rows, COUNT_KEYS),
      outcome_flip_rate: flips / seeds.length, any_output_change_rate: changed / seeds.length,
      mean_rush_yards: sc.kind === 'run' ? rows.reduce((s, r) => s + r.rush_yards, 0) / rows.length : null,
    };
  }
  results.baseline_mean_rush_yards = sc.kind === 'run' ? baseRows.reduce((s, r) => s + r.rush_yards, 0) / baseRows.length : null;
  return results;
}

const COUNT_KEYS = ['throws', 'catch', 'drop', 'interception', 'pass_breakup', 'incomplete', 'catch_window_opportunities',
  'sack', 'pressure', 'run_block_engage', 'shed', 'tackle_attempts', 'tackle_success', 'broken_tackle'];

function playerTeam(playerId) {
  for (const t of ['NE', 'CHI']) if (SNAPSHOT.teams[t].roster.some((p) => p.id === playerId)) return t;
  throw new Error(`unknown player ${playerId}`);
}

function nullTest(seeds) {
  // Every attribute the engine never reads must leave every event and the end state unchanged.
  const sc = scenario('null_pass', 'pass', 'NE', 'CHI');
  const base = playersFor(['NE', 'CHI']);
  const target = sc.lineup.offense.WR1;
  const out = {};
  for (const attr of ATTRS.filter((a) => !USED_BY_ENGINE.has(a))) {
    const cur = SNAPSHOT.teams.NE.roster.find((p) => p.id === target);
    const variant = withRating(base, target, attr, Math.min(99, cur.ratings[attr] + 10));
    let changed = 0;
    for (const seed of seeds) {
      const a = simulatePlay({ players: base }, playFor(sc, seed));
      const b = simulatePlay({ players: variant }, playFor(sc, seed));
      if (!sameRecord({ e: a.events, end: a.end, stats: a.stats }, { e: b.events, end: b.end, stats: b.stats })) changed += 1;
    }
    out[attr] = { seeds: seeds.length, plays_with_any_change: changed, offset: 10, player: target };
  }
  return out;
}

function examples(seeds) {
  const ne = (name) => findPlayer('NE', name).id;
  const chi = (name) => findPlayer('CHI', name).id;
  const names = { maye: 'Drake Maye', odunze: 'Rome Odunze', henderson: 'TreVeyon Henderson' };
  const base = playersFor(['NE', 'CHI']);
  const passNE = scenario('pass_ne_at_chi', 'pass', 'NE', 'CHI', { offense: { QB: ne(names.maye) } });
  const catchCHI = scenario('catch_chi_at_ne', 'pass', 'CHI', 'NE', { offense: { WR1: chi(names.odunze) } });
  const runNE = scenario('run_ne_at_chi', 'run', 'NE', 'CHI', { offense: { RB: ne(names.henderson) } });
  const probes = [
    ['Drake Maye, throwing accuracy (THA)', passNE, ne(names.maye), 'THA'],
    ['Drake Maye, throwing power (THP)', passNE, ne(names.maye), 'THP'],
    ['Rome Odunze, catching (CTH)', catchCHI, chi(names.odunze), 'CTH'],
    ['NE left cornerback, interception odds (CIT, defender side)', catchCHI, catchCHI.lineup.defense.LCB, 'CIT'],
    ['TreVeyon Henderson, break tackle (BTK)', runNE, ne(names.henderson), 'BTK'],
    ['TreVeyon Henderson, elusiveness (ELU)', runNE, ne(names.henderson), 'ELU'],
    ['CHI MLB, tackling (TAK)', runNE, runNE.lineup.defense.MLB, 'TAK'],
    ['NE left tackle, pass blocking (PBK)', passNE, passNE.lineup.offense.LT, 'PBK'],
    ['CHI left edge, pass rush (PMV)', passNE, passNE.lineup.defense.LEDGE, 'PMV'],
    ['CHI left edge, block-shedding (BSH) on run plays', runNE, runNE.lineup.defense.LEDGE, 'BSH'],
  ];
  const out = [];
  for (const [label, sc, playerId, attr] of probes) {
    const where = placement(sc, playerId);
    const res = probe(sc, playerId, attr, base, seeds);
    out.push({ label, scenario: sc.id, player_id: playerId, player_name: nameOf(playerId), placed: where, attribute: attr, ...res });
  }
  return out;
}

const fmt = (x, d = 3) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(d));

function markdown(report) {
  const out = [`# Rating probe: ${report.seeds} seeds, offsets ${report.offsets.join(' / ')}`, ''];
  if (report.null_test) {
    out.push('## Null test: unread attributes (+10 on the WR1 target, one play per seed)', '',
      '| attribute | plays with any change |', '|---|---|');
    for (const [attr, v] of Object.entries(report.null_test)) out.push(`| ${attr} | ${v.plays_with_any_change} / ${v.seeds} |`);
    out.push('');
  }
  for (const p of report.examples || []) {
    out.push(`## ${p.label}`, '', `Scenario ${p.scenario}; ${p.player_name} (${p.player_id}) in ${p.placed.side} slot ${p.placed.slot}; attribute ${p.attribute}.`, '',
      '| case | value | throws | catch | drop | INT | PBU | sack | pressure | shed | tackle att | tackle won | broken | catch/throw | tackle won/att | rush yd | outcome flip | any change |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const rowFor = (label, value, t, yards, flip, change) => `| ${label} | ${value} | ${t.throws.total} | ${t.catch.total} | ${t.drop.total} | ${t.interception.total} | ${t.pass_breakup.total} | ${t.sack.total} | ${t.pressure.total} | ${t.shed.total} | ${t.tackle_attempts.total} | ${t.tackle_success.total} | ${t.broken_tackle.total} | ${fmt(t.throws.total ? t.catch.total / t.throws.total : null)} | ${fmt(t.tackle_attempts.total ? t.tackle_success.total / t.tackle_attempts.total : null)} | ${fmt(yards, 2)} | ${fmt(flip)} | ${fmt(change)} |`;
    out.push(rowFor('baseline', p.baseline_rating ?? p.by_offset[-5].rating_baseline, p.baseline, p.baseline_mean_rush_yards));
    for (const o of Object.keys(p.by_offset)) {
      const v = p.by_offset[o];
      out.push(rowFor(`${Number(o) > 0 ? '+' : ''}${o}`, `${v.value} (effective ${v.value - v.rating_baseline >= 0 ? '+' : ''}${v.value - v.rating_baseline})`, v.table, v.mean_rush_yards, v.outcome_flip_rate, v.any_output_change_rate));
    }
    out.push('');
  }
  return out.join('\n');
}

function main() {
  const opt = args();
  const seeds = Array.from({ length: opt.seeds }, (_, i) => i + 1);
  const report = { seeds: seeds.length, offsets: OFFSETS, engine_used_attributes: [...USED_BY_ENGINE].sort() };
  if (opt.mode === 'all' || opt.mode === 'null') report.null_test = nullTest(seeds);
  if (opt.mode === 'all' || opt.mode === 'examples') report.examples = examples(seeds);
  if (opt.json) writeFileSync(opt.json, JSON.stringify(report, null, 2));
  if (opt.md) writeFileSync(opt.md, markdown(report));
  process.stdout.write(JSON.stringify({ seeds: seeds.length, null_attrs: report.null_test ? Object.keys(report.null_test).length : 0, probes: report.examples ? report.examples.length : 0 }) + '\n');
}

main();
