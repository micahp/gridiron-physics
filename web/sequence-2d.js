import { adaptSequence, clockLabel } from './sequence-2d-model.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
let model = null;
let selected = 0;
let playing = false;
let progress = 0;
let lastTick = null;
const PLAY_MS = 1600; // viewer pacing only; NOT a modeled snap duration

function svgElement(tag, attributes = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== null) node.textContent = String(text);
  return node;
}

function add(svg, tag, attributes, text = null) {
  const node = svgElement(tag, attributes, text);
  svg.appendChild(node);
  return node;
}

function fx(yards) {
  return 50 + 9 * yards;
}

function renderField() {
  const svg = $('field');
  svg.replaceChildren();
  add(svg, 'rect', {x: 50, y: 20, width: 900, height: 270, fill: '#28784a'});
  add(svg, 'rect', {x: 0, y: 20, width: 50, height: 270, fill: '#233767'});
  add(svg, 'rect', {x: 950, y: 20, width: 50, height: 270, fill: '#233767'});
  add(svg, 'text', {x: 25, y: 166, 'text-anchor': 'middle', 'font-size': 9, fill: '#fff'}, 'OWN');
  add(svg, 'text', {x: 975, y: 166, 'text-anchor': 'middle', 'font-size': 9, fill: '#fff'}, 'OPP');
  for (let yard = 0; yard <= 100; yard += 5) {
    const x = fx(yard);
    add(svg, 'line', {x1: x, x2: x, y1: 20, y2: 290,
      stroke: '#d5f1df', 'stroke-opacity': yard % 10 === 0 ? .72 : .23, 'stroke-width': yard % 10 === 0 ? 2 : 1});
    if (yard > 0 && yard < 100 && yard % 10 === 0) {
      const n = yard <= 50 ? yard : 100 - yard;
      for (const y of [49, 276]) add(svg, 'text', {x, y, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600, fill: '#e5f5ea'}, n);
    }
  }
  for (let yard = 0; yard <= 100; yard += 1) {
    const x = fx(yard);
    for (const y of [103, 207]) add(svg, 'line', {x1:x, x2:x,y1:y-5,y2:y+5,stroke:'#dbf3e3','stroke-opacity':.55,'stroke-width':1});
  }
  const play = model?.plays[selected];
  if (!play || play.startX === null) {
    add(svg, 'text', {x:500,y:161,'text-anchor':'middle',fill:'#fff','font-size':18}, 'Ball spot unavailable in source record');
    return;
  }
  const x = fx(play.startX);
  const gainX = play.lineToGain === null ? null : fx(play.lineToGain);
  add(svg, 'line', {x1:x, x2:x, y1:20, y2:290, stroke:'#58b2fa','stroke-width':4});
  if (gainX !== null && gainX !== x) {
    add(svg, 'line', {x1:gainX,x2:gainX,y1:20,y2:290,stroke:'#fee051','stroke-width':3,'stroke-dasharray':'10 7'});
  }
  if (play.endX !== null && play.endX !== play.startX) {
    const endX = fx(play.endX);
    add(svg, 'line', {x1:x,x2:endX,y1:161,y2:161,stroke:'#e8b8ff','stroke-width':5,'stroke-dasharray':'10 6'});
    add(svg, 'circle', {cx:endX, cy:161, r:9, fill:'none', stroke:'#e8b8ff','stroke-width':3});
    add(svg, 'text', {x:(x+endX)/2,y:143, 'text-anchor':'middle','font-size':13,fill:'#fff'}, 'sourced Δ yards');
  }
  const movable = play.endX !== null ? fx(play.endX) : x;
  const ballX = x + (movable - x) * progress;
  add(svg, 'ellipse', {cx:ballX,cy:161,rx:13,ry:8,fill:'#a76836',stroke:'#fff','stroke-width':2});
  add(svg, 'line', {x1:ballX-6,x2:ballX+6,y1:161,y2:161,stroke:'#fff','stroke-width':1.5});
  add(svg, 'text', {x:500,y:302,'text-anchor':'middle','font-size':10,fill:'#bdedce'},
    'Offense-relative 0–100 yards | geometric transition only; no tracked players');
}

function displayState(state) {
  if (!state) return 'Unavailable';
  const q = state.quarter === null ? '?' : state.quarter > 4 ? 'OT' : 'Q' + state.quarter;
  const pos = state.yardline_100 === null ? 'unknown spot' : state.yardline_100 + ' yd to opponent goal';
  return q + ' ' + clockLabel(state.clock_seconds) + ' · ' +
    (state.offense_team ?? 'unknown possession') + ' · ' + pos;
}

function setText(id, value) { $(id).textContent = value === null || value === undefined ? 'Unavailable' : String(value); }

function renderTimeline() {
  const container = $('play-list');
  const fragment = document.createDocumentFragment();
  model.plays.forEach((play, idx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'play-entry' + (idx === selected ? ' selected' : '');
    button.setAttribute('data-index', String(idx));
    const strong = document.createElement('strong');
    strong.textContent = '#' + play.sequence + ' · ' + play.title;
    const sub = document.createElement('small');
    sub.textContent = 'Drive ' + play.driveIndex + ' · ' + displayState(play.before);
    button.append(strong, sub);
    button.addEventListener('click', () => select(idx));
    fragment.appendChild(button);
  });
  container.replaceChildren(fragment);
}

function renderText() {
  const play = model.plays[selected];
  const b = play.before;
  const a = play.after;
  setText('home-name', model.labels.A);
  setText('away-name', model.labels.B);
  setText('home-score', b?.home_score === null || b?.home_score === undefined ? '–' : b.home_score);
  setText('away-score', b?.away_score === null || b?.away_score === undefined ? '–' : b.away_score);
  setText('mode', model.origin);
  setText('period-clock', b ? ((b.quarter > 4 ? 'OT' : 'Q' + (b.quarter ?? '?')) + ' · ' + clockLabel(b.clock_seconds)) : 'Unknown clock');
  setText('ball-state', b ? ((b.offense_team ?? 'Unknown team') + ' possession · ' +
    (b.down ?? '?') + ' & ' + (b.yards_to_go ?? '?') + ' · ' +
    (b.yardline_100 === null ? 'spot unknown' : b.yardline_100 + ' yards to goal')) : 'Ball state unavailable');
  setText('run-identity', 'Game: ' + (model.gameId ?? 'unidentified') + ' · Seed: ' + (model.seed ?? 'unknown') +
    ' · ' + model.plays.length + ' plays · Status: ' + model.status);
  setText('play-heading', play.title);
  setText('play-location', 'Drive ' + play.driveIndex + ' · play ' + play.sequence +
    ' · ' + displayState(b));
  setText('event-type', play.supportedLabel ? play.eventType : 'Unsupported source event: ' + play.eventType);
  setText('play-id', play.id);
  setText('down-distance', b ? ((b.down ?? '?') + ' & ' + (b.yards_to_go ?? '?')) : 'Unavailable');
  const out = play.sourcePlay.outcome;
  setText('outcome', out ? JSON.stringify(out) : 'Not recorded');
  setText('after', displayState(a));
  setText('validity', (model.validFullGame ? 'Valid full game (source claim)' : 'NOT certified as a valid full game') +
    (model.blocker ? ' · Blocker: ' + model.blocker : ''));
  setText('provenance', model.limitation + ' Source mode: ' + model.mode +
    '. Scores and results reflect only the supplied hypothetical/research record.');
  $('raw-play').textContent = JSON.stringify(play.sourcePlay, null, 2);
  $('seek').max = String(model.plays.length - 1);
  $('seek').value = String(selected);
  setText('position', (selected + 1) + '/' + model.plays.length);
  $('toggle').textContent = playing ? 'Pause ❚❚' : 'Play ▶';
  for (const entry of $('play-list').children) entry.classList.toggle('selected', Number(entry.dataset.index) === selected);
  $('play-list').querySelector('.selected')?.scrollIntoView({block: 'nearest'});
}

function select(index) {
  if (!model) return;
  selected = Math.min(model.plays.length - 1, Math.max(0, index));
  progress = 0;
  lastTick = null;
  renderText();
  renderField();
}

function setPlaying(value) {
  playing = !!value;
  lastTick = null;
  if (model) $('toggle').textContent = playing ? 'Pause ❚❚' : 'Play ▶';
}

function tick(now) {
  if (playing && model) {
    if (lastTick !== null) progress += ((now - lastTick) / PLAY_MS) * Number($('speed').value);
    lastTick = now;
    if (progress >= 1) {
      if (selected === model.plays.length - 1) {
        progress = 1; setPlaying(false);
      } else {
        selected += 1; progress = 0; renderText();
      }
    }
    renderField();
  }
  requestAnimationFrame(tick);
}

function load(data, sourceName) {
  const result = adaptSequence(data);
  model = result;
  selected = 0;
  progress = 0;
  setPlaying(false);
  $('warning').hidden = true;
  renderTimeline();
  renderText();
  renderField();
  document.title = '2D Replay · ' + (result.gameId ?? sourceName);
}

function fail(error) {
  setPlaying(false);
  $('warning').textContent = 'Cannot load run: ' + error.message +
    '\nFor saved SLC batches, export one seed with its complete ordered plays; box scores alone are insufficient.';
  $('warning').hidden = false;
}

$('previous').addEventListener('click', () => { setPlaying(false); select(selected - 1); });
$('next').addEventListener('click', () => { setPlaying(false); select(selected + 1); });
$('toggle').addEventListener('click', () => {
  if (!model) return;
  if (!playing && selected === model.plays.length - 1) select(0);
  setPlaying(!playing);
});
$('seek').addEventListener('input', (event) => { setPlaying(false); select(Number(event.target.value)); });
$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { load(JSON.parse(await file.text()), file.name); } catch (error) { fail(error); }
});
window.addEventListener('keydown', (event) => {
  if (event.target?.matches('input,select,button')) return;
  if (event.key === 'ArrowRight') { setPlaying(false); select(selected + 1); }
  if (event.key === 'ArrowLeft') { setPlaying(false); select(selected - 1); }
  if (event.code === 'Space' && model) { event.preventDefault(); setPlaying(!playing); }
});

const requested = new URLSearchParams(location.search).get('fixture');
const defaultFixture = './docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json';
const safeFixture = requested && /^docs\/fixtures\/[A-Za-z0-9_./-]+\.json$/.test(requested) &&
  !requested.split('/').includes('..') ? './' + requested : defaultFixture;
fetch(safeFixture).then((response) => {
  if (!response.ok) throw new Error('Fixture HTTP ' + response.status);
  return response.json();
}).then((data) => load(data, safeFixture)).catch(fail);
requestAnimationFrame(tick);
