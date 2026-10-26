import { simulatePlay } from '../engine/play.js';
import { nextBallY } from '../engine/game.js';
import { Renderer } from './render.js';
import { afterPlayEnd, animateScoreBug, touchdownScore } from './score-animation.js';
import { teamLogoUrl } from './team-logo.js';

const $ = (s) => document.querySelector(s);
const MPH = 2.23694;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const game = await (await fetch('web/data/game.json')).json();
await document.fonts.ready;
const P = game.players;
const T = game.teams;
const nm = (id) => (id && P[id] ? P[id].name : '—');
const shortNm = (id) => (id && P[id] ? (P[id].short || P[id].name) : '');

const view = $('#view');
const R = new Renderer(view, game, { displayFont: '"Saira Condensed", "Arial Narrow", sans-serif' });
new ResizeObserver(() => R.resize()).observe(view);
R.resize();

// ------------------------------------------------------------- simulate
const recs = new Array(game.plays.length).fill(null);
let bugAfter = null;
const simIdx = game.plays.map((p, i) => (p.kind === 'admin' ? -1 : i)).filter((i) => i >= 0);
{
  let prev = null, done = 0;
  await new Promise((resolve) => {
    const step = () => {
      const t0 = performance.now();
      while (done < simIdx.length && performance.now() - t0 < 30) {
        const i = simIdx[done++];
        const r = simulatePlay(game, game.plays[i], { ballY: nextBallY(prev, game.plays[i]) });
        recs[i] = r;
        if (r) prev = r;
      }
      $('#loader-bar').style.width = `${(100 * done) / simIdx.length}%`;
      $('#loader-n').textContent = `${done} / ${simIdx.length} plays`;
      if (done < simIdx.length) setTimeout(step, 0);
      else resolve();
    };
    step();
  });
  $('#loader').hidden = true;
}

// game-wide physics leaderboards
const leaders = { speed: [], hits: [] };
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  if (!r) continue;
  for (const s of r.stats) leaders.speed.push({ id: s.id, v: s.top, i });
  if (r.biggestHit) leaders.hits.push({ ...r.biggestHit, i });
}
const bestSpeed = new Map();
for (const s of leaders.speed) if (!bestSpeed.has(s.id) || bestSpeed.get(s.id).v < s.v) bestSpeed.set(s.id, s);
leaders.speed = [...bestSpeed.values()].sort((a, b) => b.v - a.v).slice(0, 8);
leaders.hits.sort((a, b) => b.closing - a.closing);
leaders.hits = leaders.hits.slice(0, 6);

// ------------------------------------------------- key & scoring plays
// ESPN's gamecast exposes three filters: All Plays / Scoring Plays / Key Plays.
// Scoring plays come straight from ESPN's scoringPlay flag. ESPN's "Key Plays"
// tab is a curated highlights reel, so we approximate it from the win-probability
// data we already pulled: the plays that moved the home team's win probability the
// most. Admin rows (END GAME, END QUARTER, ...) are excluded.
const scoringIdx = new Set(game.plays.map((p, i) => (p.scoring ? i : -1)).filter((i) => i >= 0));
const keyIdx = new Set(scoringIdx);
{
  const seq = game.plays.map((p, i) => (p.homeWp == null ? -1 : i)).filter((i) => i >= 0).sort((a, b) => a - b);
  const swings = [];
  for (let k = 1; k < seq.length; k++) swings.push([Math.abs(game.plays[seq[k]].homeWp - game.plays[seq[k - 1]].homeWp), seq[k]]);
  swings.sort((a, b) => b[0] - a[0]);
  for (const [d, i] of swings) {
    if (d < 0.05) break;
    const k = game.plays[i].kind;
    if (k === 'admin' || k === 'presnap') continue;
    keyIdx.add(i);
  }
}
const matches = (i) => state.filter === 'all' || (state.filter === 'scoring' ? scoringIdx.has(i) : keyIdx.has(i));

// -------------------------------------------------------------- state
const state = { i: simIdx[0], t: 0, playing: true, speed: 1, auto: true, pause: 0, evIdx: 0, sel: null, filter: 'all' };

function playable(i, step) {
  let j = i;
  do j += step; while (j >= 0 && j < recs.length && (!recs[j] || !matches(j)));
  return j >= 0 && j < recs.length ? j : null;
}

function load(i, { keepPlaying = true } = {}) {
  if (i == null || isNaN(i)) i = simIdx[0];
  if (!recs[i] || !matches(i)) {
    const j = playable(i, 1) ?? playable(i, -1) ?? playable(simIdx[0], 1) ?? simIdx[0];
    if (j != null) i = j;
  }
  state.i = i;
  const rec = recs[i];
  state.t = rec.t0;
  state.evIdx = 0;
  state.pause = 0;
  if (!keepPlaying) state.playing = false;
  R.setRoster(rec.roster);
  R.clearTrail();
  R.showFlag(null);
  if (state.sel && !rec.roster.some((r) => r.id === state.sel)) R.select(null);
  else R.select(state.sel);
  const S = game.plays[i];
  const scrim = !['kickoff', 'punt', 'fg', 'xp'].includes(S.kind);
  R.setLines(S.los ?? null, scrim && S.down > 0 && S.dist ? S.los + S.dir * S.dist : null);
  $('#ticker').replaceChildren();
  renderBug();
  renderPlayText();
  markDriveList();
  renderPhysics();
  try { history.replaceState(null, '', `#p${i}`); } catch {}
}

// ----------------------------------------------------------- scorebug
function prevScore(i) {
  for (let j = i - 1; j >= 0; j--) if (game.plays[j].score) return game.plays[j].score;
  return [0, 0];
}
function renderBug(opts = {}) {
  const S = game.plays[state.i];
  const rec = recs[state.i];
  const after = afterPlayEnd(rec.end.t, state.t);
  const pre = prevScore(state.i);
  const held = touchdownScore({ away: pre[0], home: pre[1] }, { away: S.score[0], home: S.score[1] }, { outcome: { touchdown: !!S.td } });
  const [as, hs] = after ? [held.away, held.home] : pre;
  const team = (id, score) => {
    const t = T[id];
    const poss = S.off === id && !['kickoff'].includes(S.kind);
    return `<img src="${esc(teamLogoUrl(t.abbr))}" alt=""><span class="abbr">${esc(t.short || t.abbr)}</span><span class="rec">${esc(t.record || '')}</span><span class="score">${score}</span>`
      + (poss ? '' : '');
  };
  const a = $('#bug-away'), h = $('#bug-home');
  a.innerHTML = team(game.away, as);
  h.innerHTML = team(game.home, hs);
  a.style.setProperty('--team', T[game.away].color);
  h.style.setProperty('--team', T[game.home].color);
  a.classList.toggle('poss', S.off === game.away && S.kind !== 'kickoff');
  h.classList.toggle('poss', S.off === game.home && S.kind !== 'kickoff');
  if (opts.animate && after) {
    animateScoreBug(a, a.querySelector('.score'), pre[0], as);
    animateScoreBug(h, h.querySelector('.score'), pre[1], hs);
  }
  $('#bug-q').textContent = S.q > 4 ? 'OT' : `Q${S.q}`;
  $('#bug-clock').textContent = S.clock;
  const dd = { kickoff: 'Kickoff', punt: `${S.downText} · Punt`, fg: `${S.downText} · FG try`, xp: 'Extra point' }[S.kind] || `${S.downText}${S.posText ? ' at ' + S.posText : ''}`;
  $('#bug-down').textContent = dd;
  const wp = S.homeWp != null ? `${T[game.home].abbr} win prob ${(S.homeWp * 100).toFixed(0)}%` : '';
  $('#bug-meta').innerHTML = `${esc(game.venue)}<br>${wp}`;
}

function renderPlayText() {
  const S = game.plays[state.i];
  const label = { complete: 'Pass', incomplete: 'Pass', int: 'Interception', sack: 'Sack', run: 'Run', scramble: 'Scramble', kickoff: 'Kickoff', punt: 'Punt', fg: 'Field goal', xp: 'PAT', presnap: 'Penalty', kneel: 'Kneel', spike: 'Spike' }[S.kind] || S.type;
  $('#playtext').innerHTML = `<b>${esc(label)}</b>${esc(S.text)}`;
}

// ------------------------------------------------------------- ticker
function fmtEvent(e) {
  const n = (id) => esc(shortNm(id));
  switch (e.type) {
    case 'throw': return { html: `Throw · ${n(e.by)}<span>${(e.speed * MPH).toFixed(0)} mph release · ${e.T.toFixed(2)} s in the air</span>` };
    case 'catch': return e.kick ? { html: `${e.fair ? 'Fair catch' : 'Fielded'} · ${n(e.by)}` } : { html: `Catch · ${n(e.by)}`, big: true };
    case 'handoff': return { html: `Handoff · ${n(e.to)}` };
    case 'tackle': return { html: `Tackle · ${n(e.by)}<span>${e.closing.toFixed(1)} m/s closing · ${(e.energy / 1000).toFixed(2)} kJ absorbed</span>`, big: true };
    case 'broken_tackle': return { html: `Broken tackle · ${n(e.by)}<span>${n(e.on)} slips off</span>` };
    case 'kick': return { html: `Kick · ${n(e.by)}<span>${(e.speed * MPH).toFixed(0)} mph off the foot${e.hang ? ` · ${e.hang.toFixed(1)} s hang` : ''}</span>` };
    case 'fg_good': return { html: `It's good · ${e.distance} yards`, big: true };
    case 'fg_miss': return { html: `No good · ${esc(e.miss || '')}`, big: true };
    case 'touchdown': return { html: `Touchdown · ${n(e.by)}`, big: true };
    case 'interception': return { html: `Intercepted · ${n(e.by)}`, big: true };
    case 'pass_breakup': return { html: `Pass broken up · ${n(e.by)}` };
    case 'drop': return { html: `Dropped · ${n(e.by)}` };
    case 'scramble': return { html: `Scramble · ${n(e.by)} takes off` };
    case 'downed': return { html: `Downed · ${n(e.by)}` };
    case 'flag': return { html: `Flag · ${esc((e.text || '').replace(/^PENALTY on /, '').slice(0, 70))}`, flag: true };
    case 'whistle': {
      const r = { out_of_bounds: 'Out of bounds', kick_out_of_bounds: 'Out of bounds', incomplete: 'Incomplete', touchback: 'Touchback', fair_catch: '', tackle: '', touchdown: '', fg_good: '', fg_miss: '', kneel: 'Kneel down', spike: 'Spiked', penalty: '', downed: '' }[e.reason];
      return r ? { html: r } : null;
    }
    default: return null;
  }
}
function pushTicker(e) {
  const f = fmtEvent(e);
  if (!f) return;
  const box = $('#ticker');
  const d = document.createElement('div');
  d.innerHTML = f.html;
  if (f.big) d.className = 'big';
  if (f.flag) d.className = 'flag';
  box.append(d);
  while (box.children.length > 4) box.firstChild.remove();
  if (e.type === 'flag') R.showFlag(e.at);
}

// -------------------------------------------------------------- tags
// Tags track the *interpolated* body position (same as Renderer.draw), not the
// nearest recorded frame, and their DOM nodes are reused instead of being rebuilt
// each frame. Both were sources of visible jitter while a player was moving.
const tagBox = $('#tags');
const tagEls = new Map();
function clearTags() {
  for (const el of tagEls.values()) el.remove();
  tagEls.clear();
}
function renderTags() {
  const rec = recs[state.i];
  if (!rec) { clearTags(); return null; }
  const fi = Math.max(0, Math.min(rec.frames.length - 1.001, (state.t - rec.t0) * rec.hz));
  const k0 = Math.floor(fi), a = fi - k0;
  const f0 = rec.frames[k0], f1 = rec.frames[Math.min(rec.frames.length - 1, k0 + 1)];
  const L = (i) => f0[i] + (f1[i] - f0[i]) * a;
  const seen = new Set();
  for (let i = 0; i < rec.roster.length; i++) {
    const r = rec.roster[i];
    if (f0[i * 6 + 5] <= 0.5 && r.id !== state.sel) continue;
    const p = R.project(L(i * 6), L(i * 6 + 1), 2.6);
    if (p.behind) continue;
    seen.add(r.id);
    let el = tagEls.get(r.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = `#${esc(P[r.id].jersey)} ${esc(shortNm(r.id))}<small></small>`;
      tagBox.append(el);
      tagEls.set(r.id, el);
    }
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    const mph = `${(L(i * 6 + 3) * MPH).toFixed(1)} mph`;
    if (el.lastElementChild.textContent !== mph) el.lastElementChild.textContent = mph;
  }
  for (const [id, el] of tagEls) if (!seen.has(id)) { el.remove(); tagEls.delete(id); }
  return f0;
}

// ------------------------------------------------------------ physics
function renderPhysics(f) {
  const rec = recs[state.i];
  if (!rec) return;
  const box = $('#tab-physics');
  if (box.hidden && !f) return;
  let carrier = null;
  if (f) rec.roster.forEach((r, i) => { if (f[i * 6 + 5] > 0.5) carrier = { id: r.id, v: f[i * 6 + 3] }; });
  const bh = rec.biggestHit;
  const ts = rec.topSpeed;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  box.innerHTML = `
    <div class="sec">Live</div>
    <dl class="kv">
      ${row('Ball carrier', carrier ? esc(nm(carrier.id)) : '—')}
      ${row('Carrier speed', carrier ? `${(carrier.v * MPH).toFixed(1)} mph · ${carrier.v.toFixed(2)} m/s` : '—')}
      ${row('Carrier top speed (model)', carrier ? `${(P[carrier.id].physics.vmax * MPH).toFixed(1)} mph` : '—')}
      ${row('Ball height', R.ballPos ? `${(R.ballPos.z * 0.9144).toFixed(2)} m` : '—')}
    </dl>
    <div class="sec">This play</div>
    <dl class="kv">
      ${row('Fastest player', ts?.id ? `${esc(shortNm(ts.id))} · ${(ts.v * MPH).toFixed(1)} mph` : '—')}
      ${row('Biggest collision', bh ? `${esc(shortNm(bh.a))} ↔ ${esc(shortNm(bh.b))}` : '—')}
      ${row('Closing speed', bh ? `${bh.closing.toFixed(2)} m/s (${(bh.closing * MPH).toFixed(1)} mph)` : '—')}
      ${row('Impulse', bh ? `${bh.impulse.toFixed(0)} N·s` : '—')}
      ${row('Throw release', rec.throwSpeed ? `${(rec.throwSpeed * MPH).toFixed(1)} mph` : '—')}
      ${row('Whistle', esc(rec.end.reason?.replace(/_/g, ' ') || '—'))}
      ${row('Spot (sim / ESPN)', rec.expectEndX != null ? `${rec.end.x.toFixed(1)} / ${rec.expectEndX.toFixed(1)} yd line` : '—')}
    </dl>
    <p class="note">Concussion reconstructions of NFL hits (Pellman et al., 2003) put helmet impact speeds around 9.3 m/s; the hardest contact on a typical play here closes at about 7 m/s.</p>
    <div class="sec">Game leaders · top speed</div>
    <dl class="kv">${leaders.speed.map((s) => row(`<a href="#p${s.i}" data-jump="${s.i}">${esc(nm(s.id))}</a>`, `${(s.v * MPH).toFixed(1)} mph`)).join('')}</dl>
    <div class="sec">Game leaders · hardest hits</div>
    <dl class="kv">${leaders.hits.map((h) => row(`<a href="#p${h.i}" data-jump="${h.i}">${esc(shortNm(h.a))} ↔ ${esc(shortNm(h.b))}</a>`, `${h.closing.toFixed(1)} m/s`)).join('')}</dl>
    <div class="sec">Engine</div>
    <p class="note">120 Hz rigid-body step. Locomotion: F(v) = F0(1 − v/vmax) (Samozino et al. 2016), capped by cleat traction μg and lateral agility. Contacts: momentum-conserving impulses, e = 0.12. Blocks: spring-damper hand fight with leg drive = m·g·μ·(0.55 + 0.35·STR). Ball: drag ½ρC<sub>d</sub>A|v|v at Denver's ρ = 0.98 kg/m³.</p>`;
}

// ------------------------------------------------------------- drives
function renderFilter() {
  const counts = { all: game.plays.length, scoring: scoringIdx.size, key: keyIdx.size };
  const opts = [['all', 'All Plays'], ['scoring', 'Scoring'], ['key', 'Key Plays']];
  $('#filterbar').innerHTML = opts.map(([v, label]) =>
    `<button data-filter="${v}" class="${state.filter === v ? 'on' : ''}">${label}<span>${counts[v]}</span></button>`).join('');
}
function renderDrives() {
  const box = $('#drivelist');
  box.innerHTML = game.drives.map((d) => {
    const t = T[d.team];
    const scored = /TD|FG|Touchdown|Field Goal/i.test(d.result || '');
    const rows = [];
    for (let i = d.first; i <= d.last; i++) {
      const S = game.plays[i];
      const ok = !!recs[i];
      if (!matches(i)) continue;
      rows.push(`<button class="pl ${ok ? '' : 'admin'}" data-i="${i}" ${ok ? '' : 'disabled'}><span class="dd">Q${S.q} ${esc(S.clock)}<br>${esc(S.downText || '')}</span><span class="txt">${esc(S.text)}</span></button>`);
    }
    if (!rows.length) return '';
    return `<div class="drive"><div class="drive-h" style="--team:${t.alt}"><span>${esc(t.abbr)} · ${esc(d.desc || '')}</span><span class="res ${scored ? 'score' : ''}">${esc(d.result || '')}</span></div>${rows.join('')}</div>`;
  }).join('');
}
function markDriveList() {
  const box = $('#tab-drives');
  box.querySelectorAll('.pl.on').forEach((b) => b.classList.remove('on'));
  const b = box.querySelector(`.pl[data-i="${state.i}"]`);
  if (b) {
    b.classList.add('on');
    // scroll the list itself, never the page
    if (!box.hidden && box.scrollHeight > box.clientHeight) {
      const top = b.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - b.offsetHeight) box.scrollTop = top - 60;
    }
  }
}

// ------------------------------------------------------------ ratings
const GROUP_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'K', 'P', 'LS'];
let rosterTeam = game.home;
function renderRoster() {
  const box = $('#tab-roster');
  const ps = Object.values(P).filter((p) => p.team === T[rosterTeam].abbr);
  const groups = GROUP_ORDER.map((g) => [g, ps.filter((p) => p.group === g).sort((a, b) => b.ovr - a.ovr)]).filter(([, l]) => l.length);
  box.innerHTML = `<div class="roster-t">${[game.away, game.home].map((id) => `<button data-team="${id}" class="${id === rosterTeam ? 'on' : ''}">${esc(T[id].name)}</button>`).join('')}</div>
    <p class="note">OVR is a percentile among all 1,686 active NFL players at the same position, mapped onto a Madden-like scale. Click a player for the full card.</p>
    ${groups.map(([g, l]) => `<div class="rgroup">${g}</div>` + l.map((p) => `<button class="rrow" data-pid="${p.id}"><span class="ovr ${p.ovr >= 85 ? 'hi' : ''}">${p.ovr}</span><span>${esc(p.name)}</span><span class="pos">${esc(p.pos)}</span><span class="pos">#${esc(p.jersey)}</span></button>`).join('')).join('')}`;
}

const ATTR_NAMES = {
  SPD: 'Speed', ACC: 'Acceleration', AGI: 'Agility', STR: 'Strength', JMP: 'Jumping', STA: 'Stamina', AWR: 'Awareness',
  THP: 'Throw power', THA: 'Throw accuracy', BCV: 'Ball-carrier vision', ELU: 'Elusiveness', BTK: 'Break tackle', TRK: 'Trucking',
  CAR: 'Carrying', CTH: 'Catching', CIT: 'Catch in traffic', SPC: 'Spectacular catch', RTE: 'Route running', RBK: 'Run block',
  PBK: 'Pass block', IBL: 'Impact block', PMV: 'Power moves', FMV: 'Finesse moves', BSH: 'Block shedding', TAK: 'Tackle',
  POW: 'Hit power', PUR: 'Pursuit', PRC: 'Play recognition', MCV: 'Man coverage', ZCV: 'Zone coverage', PRS: 'Press', KPW: 'Kick power',
  KAC: 'Kick accuracy', RET: 'Return',
};
const KEY_ATTRS = {
  QB: ['THP', 'THA', 'AWR', 'SPD', 'ACC', 'AGI', 'STR', 'ELU'], RB: ['SPD', 'ACC', 'AGI', 'BCV', 'ELU', 'BTK', 'TRK', 'CAR', 'CTH', 'STR'],
  FB: ['RBK', 'STR', 'IBL', 'CAR', 'CTH', 'SPD'], WR: ['SPD', 'ACC', 'AGI', 'CTH', 'RTE', 'CIT', 'SPC', 'JMP', 'ELU', 'RET'],
  TE: ['CTH', 'RTE', 'CIT', 'RBK', 'PBK', 'STR', 'SPD', 'ACC'], OT: ['PBK', 'RBK', 'STR', 'IBL', 'AWR', 'ACC', 'AGI'],
  IOL: ['RBK', 'PBK', 'STR', 'IBL', 'AWR', 'ACC'], EDGE: ['PMV', 'FMV', 'BSH', 'ACC', 'SPD', 'STR', 'TAK', 'PUR'],
  IDL: ['BSH', 'STR', 'PMV', 'FMV', 'TAK', 'ACC', 'PUR'], LB: ['TAK', 'PUR', 'PRC', 'BSH', 'ZCV', 'MCV', 'SPD', 'POW'],
  CB: ['MCV', 'ZCV', 'SPD', 'ACC', 'AGI', 'PRS', 'PRC', 'TAK', 'JMP'], S: ['ZCV', 'MCV', 'SPD', 'PRC', 'TAK', 'PUR', 'POW', 'ACC'],
  K: ['KPW', 'KAC'], P: ['KPW', 'KAC'], LS: ['AWR', 'STR'],
};
const PHYS_ATTRS = { SPD: 'forty', ACC: 'forty', AGI: 'cone', STR: 'bench', JMP: 'vertical' };

function renderPlayer(id) {
  const p = P[id];
  const box = $('#tab-player');
  if (!p) return;
  const r = p.ratings, ph = p.physics, m = p.measurables;
  const imp = new Set(p.imputed_drills || []);
  const conf = p.confidence || {};
  const keys = KEY_ATTRS[p.group] || Object.keys(r);
  const attr = (k) => {
    const est = (PHYS_ATTRS[k] && imp.has(PHYS_ATTRS[k])) || (conf[k] != null && conf[k] < 0.25);
    return `<div class="attr ${est ? 'est' : ''}"><div class="top"><span>${ATTR_NAMES[k] || k}</span><b>${r[k]}</b></div><div class="meter"><i style="width:${r[k]}%"></i></div></div>`;
  };
  const meas = (k, label, unit) => `<dt>${label}${imp.has(k) ? ' <span class="note">(est.)</span>' : ''}</dt><dd>${m[k]}${unit}</dd>`;
  const ft = Math.floor(p.height_in / 12), inch = p.height_in % 12;
  const draft = p.draft_round ? `Rd ${p.draft_round}, pick ${p.draft_pick}` : 'Undrafted';
  box.innerHTML = `
    <div class="card-h">${p.headshot ? `<img src="${esc(p.headshot)}" alt="">` : '<span></span>'}
      <div><h2>${esc(p.name)}</h2><p>#${esc(p.jersey)} · ${esc(p.pos)} · ${esc(p.team)} · ${ft}'${inch}" ${p.weight_lb} lb · age ${p.age ?? '—'} · ${p.experience} yr exp</p><p>${esc(p.college || '')} · ${draft}</p></div>
      <div class="big" title="Overall">${p.ovr}</div></div>
    <div class="sec">Key attributes</div>
    <div class="attrs">${keys.filter((k) => r[k] != null).map(attr).join('')}</div>
    <div class="sec">Combine measurables</div>
    <dl class="kv">${meas('forty', '40-yard dash', ' s')}${meas('bench', 'Bench (225 lb)', ' reps')}${meas('vertical', 'Vertical', '″')}${meas('broad_jump', 'Broad jump', '″')}${meas('cone', '3-cone', ' s')}${meas('shuttle', '20-yd shuttle', ' s')}</dl>
    <p class="note">"est." drills were not run; they are predicted from height, weight and position using a regression on every Combine since 2000.</p>
    <div class="sec">Physics body</div>
    <dl class="kv">
      <dt>Mass</dt><dd>${ph.mass} kg</dd>
      <dt>Top speed v<sub>max</sub> (in pads)</dt><dd>${ph.vmax.toFixed(2)} m/s · ${(ph.vmax * MPH).toFixed(1)} mph</dd>
      <dt>Accel. time constant τ</dt><dd>${ph.tau.toFixed(2)} s</dd>
      <dt>Max propulsive force F0</dt><dd>${ph.f0.toFixed(0)} N</dd>
      <dt>Time to 10 yd (model)</dt><dd>${p.t10.toFixed(2)} s</dd>
      <dt>Leg drive when engaged</dt><dd>${ph.drive.toFixed(0)} N</dd>
      <dt>Lateral accel (cutting)</dt><dd>${ph.alat.toFixed(1)} m/s²</dd>
      <dt>Max reach</dt><dd>${ph.reach.toFixed(2)} m</dd>
      <dt>Collision radius</dt><dd>${ph.radius.toFixed(2)} m</dd>
    </dl>
    <div class="sec">All ratings</div>
    <dl class="kv">${Object.entries(r).map(([k, v]) => `<dt>${ATTR_NAMES[k] || k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  if (name === 'physics') renderPhysics(lastFrame);
  if (name === 'drives') markDriveList();
}

function selectPlayer(id) {
  state.sel = id;
  R.select(id);
  renderPlayer(id);
  showTab('player');
}

// ----------------------------------------------------------- WP chart
const wpC = $('#wp');
function drawWP() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = wpC.clientWidth, h = wpC.clientHeight;
  wpC.width = w * dpr;
  wpC.height = h * dpr;
  const g = wpC.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const n = game.plays.length;
  const X = (i) => (i / (n - 1)) * w;
  const Y = (p) => 4 + (1 - p) * (h - 8);
  g.strokeStyle = css.getPropertyValue('--rail');
  g.beginPath(); g.moveTo(0, Y(0.5)); g.lineTo(w, Y(0.5)); g.stroke();
  g.fillStyle = css.getPropertyValue('--dim');
  g.font = '10px "IBM Plex Mono", monospace';
  g.fillText(`${T[game.home].abbr} win prob`, 4, 11);
  g.beginPath();
  let last = 0.5;
  game.plays.forEach((p, i) => {
    const v = p.homeWp ?? last;
    last = v;
    i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v));
  });
  g.strokeStyle = T[game.home].alt;
  g.lineWidth = 1.6;
  g.stroke();
  const cx = X(state.i);
  g.strokeStyle = css.getPropertyValue('--firstdown');
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
  // when a filter is active, mark the plays it keeps
  if (state.filter !== 'all') {
    g.fillStyle = css.getPropertyValue('--firstdown');
    for (let i = 0; i < game.plays.length; i++) {
      if (!matches(i)) continue;
      g.beginPath();
      g.arc(X(i), Y(game.plays[i].homeWp ?? 0.5), 2.2, 0, 7);
      g.fill();
    }
  }
}
wpC.addEventListener('click', (e) => {
  const r = wpC.getBoundingClientRect();
  const i = Math.round(((e.clientX - r.left) / r.width) * (game.plays.length - 1));
  load(recs[i] ? i : playable(i, 1) ?? playable(i, -1));
  drawWP();
});

// ------------------------------------------------------------- events
$('#play').onclick = () => { state.playing = !state.playing; };
$('#next').onclick = () => { const j = playable(state.i, 1); if (j != null) load(j); };
$('#prev').onclick = () => { const j = playable(state.i, -1); if (j != null) load(j); };
$('#speed').onchange = (e) => { state.speed = +e.target.value; };
$('#auto').onchange = (e) => { state.auto = e.target.checked; };
$('#scrub').oninput = (e) => {
  const rec = recs[state.i];
  const dur = rec.frames.length / rec.hz;
  state.t = rec.t0 + (e.target.value / 1000) * dur;
  state.evIdx = rec.events.findIndex((ev) => ev.t > state.t);
  if (state.evIdx < 0) state.evIdx = rec.events.length;
  R.clearTrail();
  state.scrubbing = true;
};
$('#scrub').onchange = () => { state.scrubbing = false; };
document.querySelectorAll('.cams button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.cams button').forEach((x) => x.classList.toggle('on', x === b));
  R.setCamera(b.dataset.cam);
}));
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$('#tab-drives').addEventListener('click', (e) => { const b = e.target.closest('.pl'); if (b && !b.disabled) { load(+b.dataset.i); state.playing = true; drawWP(); } });
$('#filterbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  renderFilter();
  renderDrives();
  load(matches(state.i) ? state.i : (playable(state.i, 1) ?? playable(state.i, -1) ?? simIdx[0]));
  drawWP();
});
$('#tab-roster').addEventListener('click', (e) => {
  const t = e.target.closest('[data-team]');
  if (t) { rosterTeam = t.dataset.team; renderRoster(); return; }
  const r = e.target.closest('[data-pid]');
  if (r) selectPlayer(r.dataset.pid);
});
$('#tab-physics').addEventListener('click', (e) => { const a = e.target.closest('[data-jump]'); if (a) { e.preventDefault(); load(+a.dataset.jump); drawWP(); } });
let down = null;
view.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
view.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const id = R.pick(e.clientX, e.clientY);
  if (id) selectPlayer(id);
});
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return;
  if (e.code === 'Space') { e.preventDefault(); state.playing = !state.playing; }
  if (e.code === 'ArrowRight') $('#next').click();
  if (e.code === 'ArrowLeft') $('#prev').click();
});
addEventListener('resize', drawWP);

// ---------------------------------------------------------------- loop
let lastFrame = null;
let last = performance.now();
let physT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const rec = recs[state.i];
  const S = game.plays[state.i];
  const end = rec.t0 + rec.frames.length / rec.hz;
  if (state.playing && !state.scrubbing) {
    if (state.t < end) state.t = Math.min(end, state.t + dt * state.speed);
    else if (state.auto) {
      state.pause += dt;
      if (state.pause > 0.9) { const j = playable(state.i, 1); if (j != null) { load(j); drawWP(); } else state.playing = false; }
    }
  }
  while (state.evIdx < rec.events.length && rec.events[state.evIdx].t <= state.t) pushTicker(rec.events[state.evIdx++]);
  R.draw(rec, state.t, state.playing ? dt * state.speed : 0);
  R.updateCamera(dt, { dir: S.dir });
  R.setPaths(rec, Math.floor((state.t - rec.t0) * rec.hz));
  R.render();
  lastFrame = renderTags();
  if (!state.scrubbing) $('#scrub').value = String(Math.round(((state.t - rec.t0) / (end - rec.t0)) * 1000));
  $('#play').textContent = state.playing ? '❚❚' : '▶';
  // Refresh the scorebug whenever the clock crosses the play's end, whatever the speed, scrubbing or pausing.
  const afterNow = afterPlayEnd(rec.end.t, state.t);
  if (afterNow !== bugAfter) { bugAfter = afterNow; renderBug({ animate: afterNow }); }
  physT += dt;
  if (physT > 0.2) { physT = 0; renderPhysics(lastFrame); }
  requestAnimationFrame(frame);
}

renderFilter();
renderDrives();
renderRoster();
const hash = /^#p(\d+)$/.exec(location.hash);
load(hash && recs[+hash[1]] ? +hash[1] : simIdx[0]);
drawWP();
requestAnimationFrame(frame);
