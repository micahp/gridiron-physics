import { Renderer } from './render.js';
import { adaptLpGamePayload, validatePregameSourcePin } from './lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from './week7-statistical-model.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const PLAY_SPEED = () => Number($('speed').value) || 1;

let gamePayload;
let adapted;
let physicsGame;
let renderer;
let entries = [];
let currentIndex = 0;
let currentReplay = null;
let currentTime = 0;
let playing = false;
let lastFrame = null;
let endPause = 0;
const cache = new Map();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySnapshot(payload) {
  const snapshot = payload.pregame_snapshot;
  if (!snapshot?.snapshot_sha256) throw new Error('pregame snapshot hash is missing');
  const { snapshot_sha256: declared, ...body } = snapshot;
  if (await sha256Hex(new TextEncoder().encode(canonicalJson(body))) !== declared) {
    throw new Error('pregame snapshot hash mismatch');
  }
  if (payload.record.snapshot_hash !== declared || canonicalJson(payload.record.pregame_snapshot) !== canonicalJson(snapshot)) {
    throw new Error('record does not reference its frozen snapshot');
  }
}

function formatOutcome(play) {
  const outcome = play.outcome ?? {};
  if (play.event_type === 'field_goal_attempt' || play.event_type === 'blocked_field_goal') {
    return outcome.field_goal_result === 'blocked' ? 'Blocked field goal'
      : outcome.field_goal_result === 'made' ? 'Field goal made' : 'Field goal missed';
  }
  if (play.event_type === 'punt') return 'Punt';
  if (outcome.touchdown) return `Touchdown · ${outcome.yards_gained >= 0 ? '+' : ''}${outcome.yards_gained ?? 0} yd`;
  if (play.event_type === 'fumble_lost') return `Fumble lost · ${outcome.yards_gained >= 0 ? '+' : ''}${outcome.yards_gained ?? 0} yd`;
  if (play.event_type === 'sack') return `Sack · ${outcome.yards_gained ?? 0} yd`;
  if (outcome.turnover) return `${play.event_type.replaceAll('_', ' ')} · turnover`;
  if (Number.isFinite(outcome.yards_gained)) return `${play.event_type.replaceAll('_', ' ')} · ${outcome.yards_gained >= 0 ? '+' : ''}${outcome.yards_gained} yd`;
  return play.event_type.replaceAll('_', ' ');
}

function teamName(side) {
  return physicsGame.identities[side]?.team ?? side;
}

function renderScorebug(entry) {
  const play = entry.play;
  const state = play.state_after ?? play.state_before;
  const identity = physicsGame.identities;
  const awaySide = physicsGame.away;
  const homeSide = physicsGame.home;
  $('away-name').textContent = identity[awaySide].team;
  $('home-name').textContent = identity[homeSide].team;
  $('away-score').textContent = String(state.away_score ?? 0);
  $('home-score').textContent = String(state.home_score ?? 0);
  $('bug-q').textContent = `Q${play.state_before.quarter}`;
  $('game-clock').textContent = clock(play.state_before.clock_seconds);
  $('down-distance').textContent = `${play.state_before.down ?? '—'} & ${play.state_before.yards_to_go ?? '—'} · ${teamName(play.state_before.offense_team)} possession`;
  $('bug-away').style.setProperty('--team', physicsGame.teams[awaySide].color);
  $('bug-home').style.setProperty('--team', physicsGame.teams[homeSide].color);
  $('bug-away').classList.toggle('poss', play.state_before.offense_team === awaySide);
  $('bug-home').classList.toggle('poss', play.state_before.offense_team === homeSide);
}

function renderSummary(entry, replay) {
  const play = entry.play;
  const participants = play.participants ?? {};
  const actors = [participants.passer_name, participants.receiver_name, participants.rusher_name].filter(Boolean).join(' → ');
  $('snap-title').textContent = `Drive ${entry.drive.index} · Play ${play.sequence} · ${formatOutcome(play)}`;
  $('play-detail').innerHTML = `<b>${esc(formatOutcome(play))}</b> · ${esc(teamName(play.state_before.offense_team))} · Q${play.state_before.quarter} ${clock(play.state_before.clock_seconds)}`
    + (actors ? `<br>${esc(actors)} · frozen depth-chart participants` : '')
    + `<br><span class="note">LP result: ${esc(play.id)} · ${esc(replay.script.replayNote)}</span>`;
  $('replay-type').textContent = replay.visualKind === 'blocked_kick'
    ? '22-player 3D · blocked-kick outcome cue'
    : replay.visualKind === 'schematic_turnover'
      ? '22-player 3D · fumble movement schematic'
      : '22-player 3D · outcome-anchored physics';
}

function populatePlaySelect(driveOffset, selectedPlayOffset) {
  const select = $('play-select');
  select.replaceChildren();
  const drive = adapted.drives[driveOffset];
  drive.plays.forEach((item, offset) => {
    const option = document.createElement('option');
    option.value = String(offset);
    option.textContent = `Play ${item.source.sequence} · ${item.source.event_type.replaceAll('_', ' ')}`;
    select.append(option);
  });
  select.value = String(selectedPlayOffset);
}

function selectPlay(index, { preservePlaying = false } = {}) {
  if (!entries.length) return;
  currentIndex = Math.max(0, Math.min(entries.length - 1, index));
  const entry = entries[currentIndex];
  const key = entry.play.id;
  try {
    let replay = cache.get(key);
    if (!replay) {
      replay = simulateWeek7StatisticalPlay(physicsGame, entry.play);
      cache.set(key, replay);
    }
    currentReplay = replay;
    renderer.setRoster(replay.record.roster);
    renderer.clearTrail();
    const isScrimmage = replay.script.kindGroup !== 'kick';
    renderer.setLines(replay.script.los,
      isScrimmage && entry.play.state_before.yards_to_go != null
        ? replay.script.los + replay.script.dir * entry.play.state_before.yards_to_go : null);
    renderer.setCamera(cameraMode);
    currentTime = replay.record.t0;
    endPause = 0;
    if (!preservePlaying) playing = false;
    renderScorebug(entry);
    renderSummary(entry, replay);
    $('scrub').value = '0';
    $('drive-select').value = String(entry.driveOffset);
    populatePlaySelect(entry.driveOffset, entry.playOffset);
    for (const button of $('timeline').querySelectorAll('[data-index]')) {
      button.classList.toggle('on', Number(button.dataset.index) === currentIndex);
    }
    $('timeline-head').textContent = `Drive ${entry.drive.index} · ${entry.drive.plays.length} plays · ${currentIndex + 1} / ${entries.length} game plays`;
    renderer.draw(replay.record, currentTime, 1 / 60);
    renderPlayButton();
  } catch (error) {
    currentReplay = null;
    playing = false;
    $('replay-type').textContent = '3D replay unavailable for this play';
    $('snap-title').textContent = `Drive ${entry.drive.index} · Play ${entry.play.sequence} · ${formatOutcome(entry.play)}`;
    $('play-detail').textContent = `LP result is preserved. Gridiron could not build this replay: ${error.message}`;
    renderScorebug(entry);
    renderPlayButton();
  }
}

function renderPlayButton() {
  $('play').textContent = playing ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Pause game' : 'Play through game');
}

function renderTimeline() {
  const driveSelect = $('drive-select');
  const playSelect = $('play-select');
  const timeline = $('timeline');
  driveSelect.replaceChildren();
  playSelect.replaceChildren();
  timeline.replaceChildren();
  adapted.drives.forEach((drive, driveOffset) => {
    const option = document.createElement('option');
    option.value = String(driveOffset);
    option.textContent = `Drive ${drive.index} · ${teamName(drive.offenseTeam)} · ${drive.plays.length} plays`;
    driveSelect.append(option);
    const heading = document.createElement('div');
    heading.className = 'stat-drive';
    heading.textContent = `Drive ${drive.index} · ${teamName(drive.offenseTeam)} · Q${drive.quarterStart}`;
    timeline.append(heading);
    drive.plays.forEach((item, playOffset) => {
      const entry = { drive, driveOffset, play: item.source, playOffset };
      const index = entries.length;
      entries.push(entry);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stat-play';
      button.dataset.index = String(index);
      const sequence = document.createElement('b');
      sequence.textContent = String(item.source.sequence);
      const copy = document.createElement('span');
      copy.innerHTML = `<b>${esc(formatOutcome(item.source))}</b><small>${esc(teamName(item.source.state_before.offense_team))} · Q${item.source.state_before.quarter} ${clock(item.source.state_before.clock_seconds)}</small>`;
      button.append(sequence, copy);
      button.addEventListener('click', () => selectPlay(index));
      timeline.append(button);
    });
  });
  driveSelect.disabled = false;
  playSelect.disabled = false;
  driveSelect.addEventListener('change', () => {
    const offset = Number(driveSelect.value);
    const index = entries.findIndex((entry) => entry.driveOffset === offset);
    if (index >= 0) {
      const firstPlay = entries[index];
      populatePlaySelect(offset, firstPlay.playOffset);
      selectPlay(index);
    }
  });
  playSelect.addEventListener('change', () => {
    const driveOffset = Number(driveSelect.value);
    const playOffset = Number(playSelect.value);
    const index = entries.findIndex((entry) => entry.driveOffset === driveOffset && entry.playOffset === playOffset);
    if (index >= 0) selectPlay(index);
  });
}

function renderStatistics(record) {
  const teamTable = $('team-stats');
  teamTable.innerHTML = '<thead><tr><th>Team</th><th>Statistic</th><th>Value</th></tr></thead><tbody></tbody>';
  const teamBody = teamTable.querySelector('tbody');
  for (const [side, stats] of Object.entries(record.stats?.team ?? {})) {
    for (const [name, value] of Object.entries(stats)) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${esc(teamName(side))}</td><td>${esc(name)}</td><td>${esc(value)}</td>`;
      teamBody.append(row);
    }
  }
  const playerTable = $('player-stats');
  playerTable.innerHTML = '<thead><tr><th>Player</th><th>Team</th><th>Position</th><th>Passing</th><th>Rushing</th><th>Receiving</th></tr></thead><tbody></tbody>';
  const body = playerTable.querySelector('tbody');
  for (const player of record.stats?.player ?? []) {
    const row = document.createElement('tr');
    const summary = (stats) => Object.entries(stats ?? {}).map(([name, value]) => `${name} ${value}`).join(', ') || '—';
    row.innerHTML = `<td>${esc(player.player_name)}</td><td>${esc(player.player_team)}</td><td>${esc(player.player_position)}</td>`
      + `<td>${esc(summary(player.passing))}</td><td>${esc(summary(player.rushing))}</td><td>${esc(summary(player.receiving))}</td>`;
    body.append(row);
  }
}

function animate(now) {
  if (lastFrame === null) lastFrame = now;
  const dt = Math.min(0.06, (now - lastFrame) / 1000);
  lastFrame = now;
  if (currentReplay) {
    const duration = (currentReplay.record.frames.length - 1) / currentReplay.record.hz;
    if (playing) {
      if (currentTime < currentReplay.record.t0 + duration) currentTime += dt * PLAY_SPEED();
      else {
        endPause += dt;
        if (endPause > 0.65) {
          if (currentIndex + 1 < entries.length) selectPlay(currentIndex + 1, { preservePlaying: true });
          else { playing = false; renderPlayButton(); }
        }
      }
    }
    currentTime = Math.min(currentReplay.record.t0 + duration, currentTime);
    currentReplay && renderer.draw(currentReplay.record, currentTime, dt);
    $('scrub').value = String(Math.round(1000 * (currentTime - currentReplay.record.t0) / Math.max(0.01, duration)));
  }
  if (renderer) {
    renderer.updateCamera(1 / 60, { dir: currentReplay?.script.dir ?? 1 });
    renderer.render();
  }
  requestAnimationFrame(animate);
}

async function load() {
  try {
    const manifestResponse = await fetch('docs/fixtures/pregame/MANIFEST.json');
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const fixture = manifest.fixtures?.[0];
    if (!fixture) throw new Error('pinned full-game fixture is missing from the manifest');
    const fixtureResponse = await fetch(`docs/fixtures/pregame/${fixture.file}`);
    if (!fixtureResponse.ok) throw new Error(`game fixture HTTP ${fixtureResponse.status}`);
    const bytes = await fixtureResponse.arrayBuffer();
    if (await sha256Hex(bytes) !== fixture.sha256) throw new Error('pinned game fixture SHA-256 mismatch');
    gamePayload = JSON.parse(new TextDecoder().decode(bytes));
    validatePregameSourcePin(gamePayload, manifest, fixture);
    await verifySnapshot(gamePayload);
    adapted = adaptLpGamePayload(gamePayload, { requireCompleteRegulation: true });
    if (!adapted.validation.passed || gamePayload.record.valid_full_game !== true) {
      throw new Error('the pinned LP game did not pass full-game validation');
    }
    physicsGame = createWeek7StatisticalGame(gamePayload);
    renderer = new Renderer($('view'), physicsGame, { displayFont: '"Saira Condensed", "Arial Narrow", sans-serif' });
    renderer.setCamera('broadcast');
    renderer.resize();
    new ResizeObserver(() => renderer.resize()).observe($('view'));
    window.addEventListener('resize', () => renderer.resize());
    renderTimeline();
    renderStatistics(adapted.record);
    $('game-summary').textContent = `${physicsGame.identities[physicsGame.away].team} at ${physicsGame.identities[physicsGame.home].team} · ${adapted.record.points.B}–${adapted.record.points.A} · seed ${adapted.record.seed}`;
    $('record-status').textContent = `LP ${adapted.record.valid_full_game ? 'valid full game' : 'incomplete'} · ${adapted.drives.length} drives · ${adapted.sourcePlayCount} plays · producer ${adapted.source.base_commit.slice(0, 12)}`;
    $('status').textContent = 'Pregame source and full-game checks passed';
    selectPlay(0);
    $('previous').addEventListener('click', () => selectPlay(currentIndex - 1));
    $('next').addEventListener('click', () => selectPlay(currentIndex + 1));
    $('play').addEventListener('click', () => {
      if (currentIndex === entries.length - 1 && currentTime >= currentReplay.record.t0
          + (currentReplay.record.frames.length - 1) / currentReplay.record.hz) selectPlay(0);
      playing = !playing;
      renderPlayButton();
    });
    $('scrub').addEventListener('input', () => {
      if (!currentReplay) return;
      playing = false;
      const duration = (currentReplay.record.frames.length - 1) / currentReplay.record.hz;
      currentTime = currentReplay.record.t0 + duration * Number($('scrub').value) / 1000;
      renderPlayButton();
    });
    for (const button of document.querySelectorAll('.cams button[data-cam]')) {
      button.addEventListener('click', () => {
        for (const other of document.querySelectorAll('.cams button')) other.classList.toggle('on', other === button);
        cameraMode = button.dataset.cam;
        renderer.setCamera(cameraMode);
      });
    }
    requestAnimationFrame(animate);
  } catch (error) {
    $('status').textContent = 'Game replay failed to load';
    $('record-status').textContent = error.message;
    $('replay-type').textContent = 'Pinned statistical game unavailable';
    $('play-detail').textContent = error.stack ?? error.message;
  }
}

let cameraMode = 'broadcast';
load();
