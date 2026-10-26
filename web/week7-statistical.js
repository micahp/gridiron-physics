import { Renderer } from './render.js';
import { FootballAudio } from './audio-director.js';
import { adaptLpGamePayload, validatePregameSourcePin } from './lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from './week7-statistical-model.js';
import { scoreDelta, scoreMoment, tweenScore } from './score-animation.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const ordinal = (down) => ({ 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' })[down] ?? '—';

let gamePayload;
let adapted;
let physicsGame;
let renderer;
let stadiumAudio;
let entries = [];
let currentIndex = 0;
let currentReplay = null;
let currentTime = 0;
let playing = false;
let lastFrame = null;
let scorePlan = null;
let endPause = 0;
let filter = 'all';
let rosterTeam;
let playbookTeam;
let cameraMode = 'broadcast';
const cache = new Map();
const scoringIndexes = new Set();
const keyIndexes = new Set();

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

function teamName(side) {
  return physicsGame.identities[side]?.team ?? side;
}

function sideForTeam(team) {
  return Object.keys(physicsGame.identities).find((side) => physicsGame.identities[side].team === team);
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
  if (Number.isFinite(outcome.yards_gained)) {
    return `${play.event_type.replaceAll('_', ' ')} · ${outcome.yards_gained >= 0 ? '+' : ''}${outcome.yards_gained} yd`;
  }
  return play.event_type.replaceAll('_', ' ');
}

function classifyPlays() {
  entries.forEach(({ play }, index) => {
    const before = play.state_before;
    const after = play.state_after;
    const scored = before.home_score !== after.home_score || before.away_score !== after.away_score;
    if (scored) scoringIndexes.add(index);
    if (scored || play.outcome.turnover || play.outcome.safety || play.event_type === 'blocked_field_goal'
        || Math.abs(Number(play.outcome.yards_gained) || 0) >= 20) keyIndexes.add(index);
  });
}

function matchesFilter(index) {
  return filter === 'all' || (filter === 'scoring' ? scoringIndexes.has(index) : keyIndexes.has(index));
}

function playable(index, step) {
  for (let next = index + step; next >= 0 && next < entries.length; next += step) {
    if (matchesFilter(next)) return next;
  }
  return null;
}

// Scoreboard state for the selected play. The scorebug shows the pre-play score until the scoring moment, then tweens
// to the post-play score and flashes the scoring team.
const SCORE_TWEEN_S = 0.6;
const SCORE_FLASH_MS = 1400;

function setScorebugScores(scores) {
  $('away-score').textContent = String(scores.away);
  $('home-score').textContent = String(scores.home);
}

function clearScoringFlash() {
  $('bug-away').classList.remove('scored');
  $('bug-home').classList.remove('scored');
}

function updateScorebug(now) {
  if (!scorePlan || !currentReplay) return;
  const record = currentReplay.record;
  if (scorePlan.replay !== currentReplay) {
    scorePlan.replay = currentReplay;
    scorePlan.moment = scoreMoment(record) ?? record.t0 + (record.frames.length - 1) / record.hz;
  }
  if (!scorePlan.delta.away && !scorePlan.delta.home) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const { pre, post, moment } = scorePlan;
  if (currentTime < moment) {
    if (scorePlan.phase !== 'pre') {
      scorePlan.phase = 'pre';
      clearScoringFlash();
    }
    setScorebugScores(pre);
    return;
  }
  if (scorePlan.phase === 'pre') {
    scorePlan.phase = 'post';
    scorePlan.start = now;
    if (!reduced) {
      if (scorePlan.delta.away > 0) $('bug-away').classList.add('scored');
      if (scorePlan.delta.home > 0) $('bug-home').classList.add('scored');
    }
  }
  if (!reduced && now - scorePlan.start > SCORE_FLASH_MS) clearScoringFlash();
  const progress = reduced ? 1 : (now - scorePlan.start) / 1000 / SCORE_TWEEN_S;
  setScorebugScores({
    away: tweenScore(pre.away, post.away, progress),
    home: tweenScore(pre.home, post.home, progress),
  });
}

function renderScorebug(entry) {
  const play = entry.play;
  const state = play.state_before;
  const awaySide = physicsGame.away;
  const homeSide = physicsGame.home;
  $('away-name').textContent = teamName(awaySide);
  $('home-name').textContent = teamName(homeSide);
  $('away-score').textContent = String(state.away_score ?? 0);
  $('home-score').textContent = String(state.home_score ?? 0);
  $('bug-q').textContent = `Q${state.quarter}`;
  $('game-clock').textContent = clock(state.clock_seconds);
  $('down-distance').textContent = state.down == null
    ? `${teamName(state.offense_team)} possession`
    : `${ordinal(state.down)} & ${state.yards_to_go ?? '—'} · ${teamName(state.offense_team)} possession`;
  $('bug-away').style.setProperty('--team', physicsGame.teams[awaySide].color);
  $('bug-home').style.setProperty('--team', physicsGame.teams[homeSide].color);
  $('bug-away').classList.toggle('poss', state.offense_team === awaySide);
  $('bug-home').classList.toggle('poss', state.offense_team === homeSide);
  const after = entry.play.state_after ?? state;
  scorePlan = {
    pre: { away: state.away_score ?? 0, home: state.home_score ?? 0 },
    post: { away: after.away_score ?? 0, home: after.home_score ?? 0 },
    delta: scoreDelta(entry.play), phase: 'pre', start: 0, replay: null, moment: null,
  };
  clearScoringFlash();
}

function renderSummary(entry, replay) {
  const play = entry.play;
  const participants = play.participants ?? {};
  const actors = [participants.passer_name, participants.receiver_name, participants.rusher_name].filter(Boolean).join(' → ');
  $('snap-title').textContent = `Drive ${entry.drive.index} · Play ${play.sequence} · ${formatOutcome(play)}`;
  $('play-detail').innerHTML = `<b>${esc(formatOutcome(play))}</b> · ${esc(teamName(play.state_before.offense_team))} · Q${play.state_before.quarter} ${clock(play.state_before.clock_seconds)}`
    + (actors ? `<br>${esc(actors)} · frozen depth-chart participants` : '')
    + `<br><span class="note">Pinned LP event ${esc(play.id)} · ${esc(replay.script.replayNote)}</span>`;
  $('replay-type').textContent = replay.visualKind === 'blocked_kick'
    ? '22-player 3D · blocked-kick outcome cue'
    : replay.visualKind === 'schematic_turnover'
      ? '22-player 3D · fumble movement schematic'
      : '22-player 3D · outcome-anchored physics';
}

function audioPlay(entry) {
  const play = entry.play;
  const kick = ['punt', 'field_goal_attempt', 'blocked_field_goal'].includes(play.event_type);
  return {
    type: kick ? (play.event_type === 'punt' ? 'punt' : 'field_goal') : 'scrimmage',
    kind: play.event_type === 'run' ? 'run' : 'pass',
    offense: teamName(play.state_before.offense_team),
    defense: teamName(play.state_before.defense_team),
    gain: play.outcome.yards_gained,
    togo: play.state_before.yards_to_go,
    touchdown: play.outcome.touchdown,
    scoring_team: play.outcome.scoring_team ? teamName(play.outcome.scoring_team) : undefined,
    interception: play.event_type === 'interception',
    good: play.outcome.field_goal_result === 'made',
  };
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
    stadiumAudio?.setPlay(audioPlay(entry), replay.record);
    $('scrub').value = '0';
    renderTimeline();
    $('timeline-head').textContent = `Drive ${entry.drive.index} · ${entry.drive.plays.length} plays · ${currentIndex + 1} / ${entries.length} game plays`;
    renderRoster();
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

function renderFilter() {
  const counts = { all: entries.length, scoring: scoringIndexes.size, key: keyIndexes.size };
  $('filterbar').innerHTML = [['all', 'All plays'], ['scoring', 'Scoring'], ['key', 'Key plays']].map(([value, label]) =>
    `<button data-filter="${value}" class="${filter === value ? 'on' : ''}">${label}<span>${counts[value]}</span></button>`).join('');
}

function setFilter(value) {
  filter = value;
  renderFilter();
  renderTimeline();
  if (!matchesFilter(currentIndex)) {
    const next = playable(currentIndex - 1, 1) ?? playable(currentIndex + 1, -1);
    if (next != null) selectPlay(next);
  }
}

function renderTimeline() {
  if (!adapted) return;
  const byDrive = new Map();
  let shown = 0;
  entries.forEach((entry, index) => {
    if (!matchesFilter(index)) return;
    shown += 1;
    if (!byDrive.has(entry.drive.index)) byDrive.set(entry.drive.index, { drive: entry.drive, rows: [] });
    byDrive.get(entry.drive.index).rows.push({ entry, index });
  });
  $('timeline-head').textContent = `${shown} of ${entries.length} events · ${byDrive.size} drives`;
  $('timeline').innerHTML = [...byDrive.values()].map(({ drive, rows }) =>
    `<div class="drive"><div class="drive-h" style="--team:${esc(physicsGame.teams[drive.offenseTeam].color)}"><span>Drive ${drive.index} · ${esc(teamName(drive.offenseTeam))}</span><span class="res">${rows.length}${rows.length === 1 ? ' event' : ' events'}</span></div>`
      + rows.map(({ entry, index }) => `<button class="pl${index === currentIndex ? ' on' : ''}" data-index="${index}"><span class="dd">Q${entry.play.state_before.quarter} ${clock(entry.play.state_before.clock_seconds)}</span><span class="txt"><b>${esc(formatOutcome(entry.play))}</b> · ${esc(teamName(entry.play.state_before.offense_team))}${entry.play.state_before.down == null ? '' : ` · ${ordinal(entry.play.state_before.down)} &amp; ${entry.play.state_before.yards_to_go ?? '—'}`}</span></button>`).join('')
      + '</div>').join('');
  $('timeline').querySelectorAll('button[data-index]').forEach((button) => {
    button.addEventListener('click', () => selectPlay(Number(button.dataset.index)));
  });
}

function renderPlaybook() {
  const teams = [physicsGame.away, physicsGame.home];
  $('book-t').innerHTML = teams.map((side) => `<button data-team="${esc(teamName(side))}" class="${teamName(side) === playbookTeam ? 'on' : ''}">${esc(teamName(side))}</button>`).join('');
  const side = sideForTeam(playbookTeam);
  const counts = new Map();
  for (const entry of entries) {
    if (entry.play.state_before.offense_team !== side) continue;
    const event = entry.play.event_type;
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const cards = [...counts].sort((a, b) => b[1] - a[1]).map(([event, count]) =>
    `<div class="pcard"><div class="pc-t">${esc(event.replaceAll('_', ' '))}</div><div class="pc-n">${count} of ${total} plays · ${total ? (100 * count / total).toFixed(1) : '0.0'}%</div></div>`).join('');
  $('playbook-head').textContent = `${playbookTeam} · LP game event mix`;
  $('playbook-detail').innerHTML = `<p class="note">${total} offensive event records for ${esc(playbookTeam)} in this one pinned game, including kicks and punts.</p><div class="pgrid">${cards || '<p class="note">No offensive events in this game record.</p>'}</div><p class="note">The source has no formation, play concept, route, or called-play data. These counts describe statistical event types in this game; they are not a team playbook or historical tendencies.</p>`;
}

function renderRoster() {
  if (!currentReplay || !physicsGame) return;
  const teams = [physicsGame.away, physicsGame.home].map(teamName);
  if (!teams.includes(rosterTeam)) rosterTeam = teams[0];
  $('roster-t').hidden = false;
  $('roster-t').innerHTML = teams.map((team) => `<button data-team="${esc(team)}" class="${team === rosterTeam ? 'on' : ''}">${esc(team)}</button>`).join('');
  const side = sideForTeam(rosterTeam);
  const identitySide = physicsGame.identities[side].side;
  const snapshot = gamePayload.pregame_snapshot.rosters[identitySide];
  const roster = snapshot?.players ?? [];
  const uniquePlayers = new Set(roster.map((player) => player.gsis_id)).size;
  const lineup = currentReplay.script.lineup[side] ?? {};
  const depthRows = [...roster].sort((a, b) => a.pos_abb.localeCompare(b.pos_abb)
    || (a.pos_rank ?? 999) - (b.pos_rank ?? 999)).map((player) =>
    `<div class="rrow"><span class="pos">${esc(player.pos_abb)}</span><span>${esc(player.player_name)}</span><span class="jersey">#${esc(player.jersey_number ?? '—')}</span><span class="pos">Depth ${esc(player.pos_rank ?? '—')}</span><span class="starter-tag ${player.starter ? 'is-starter' : ''}">${player.starter ? 'Starter' : 'Backup'}</span></div>`).join('');
  const lineupRows = Object.entries(lineup).map(([slot, id]) => {
    const player = physicsGame.players[id];
    const generic = id.startsWith('gridiron:');
    const jersey = player?.jersey && player.jersey !== '?' ? `#${player.jersey}` : '—';
    const status = generic ? 'Template' : player?.starter ? 'Starter' : 'Backup';
    return `<div class="rrow"><span class="pos">${esc(slot)}</span><span>${esc(player?.name ?? 'Unknown')}</span><span class="jersey">${esc(jersey)}</span><span class="pos">${generic ? 'Template' : 'LP roster'}</span><span class="starter-tag ${player?.starter ? 'is-starter' : ''}">${esc(status)}</span></div>`;
  }).join('');
  const jerseyWeek = snapshot?.jersey_week;
  $('players').innerHTML = `<div class="rgroup">Frozen full depth chart · ${roster.length} role rows / ${uniquePlayers} players</div><p class="note">Jersey numbers and starter/backup flags come from the frozen week ${esc(jerseyWeek ?? '—')} snapshot. Players can have more than one depth-chart role.</p><div class="rgroup">Pregame roster</div>${depthRows}<div class="rgroup">Current replay lineup · ${Object.keys(lineup).length} slots</div>${lineupRows}<p class="note">Player ratings are not supplied by the LP snapshot. Jersey identities use the frozen roster; defensive alignment and movement remain schematic.</p>`;
}

function pointsByQuarter() {
  const totals = {
    [teamName(physicsGame.away)]: [0, 0, 0, 0],
    [teamName(physicsGame.home)]: [0, 0, 0, 0],
  };
  for (const entry of entries) {
    const { state_before: before, state_after: after } = entry.play;
    const quarter = Math.min(4, Math.max(1, before.quarter)) - 1;
    const awayDelta = (after.away_score ?? 0) - (before.away_score ?? 0);
    const homeDelta = (after.home_score ?? 0) - (before.home_score ?? 0);
    totals[teamName(physicsGame.away)][quarter] += awayDelta;
    totals[teamName(physicsGame.home)][quarter] += homeDelta;
  }
  return totals;
}

function teamStatRows(stats) {
  const number = (key) => Number(stats[key] ?? 0);
  const possession = Number(stats.possession_seconds ?? 0);
  return [
    ['Drives', number('drives')],
    ['Plays', number('plays')],
    ['Pass completions / attempts', `${number('pass_comp')} / ${number('pass_att')}`],
    ['Pass yards', number('pass_yds')],
    ['Pass targets', number('pass_tgt')],
    ['Rush attempts / yards', `${number('rush_att')} / ${number('rush_yds')}`],
    ['Sacks taken / sack yards', `${number('sacks_taken')} / ${number('sack_yds')}`],
    ['Field goals made / attempts', `${number('fg_made')} / ${number('fg_att')}`],
    ['Touchdowns', number('touchdowns')],
    ['Turnovers', number('turnovers')],
    ['Fumbles lost', number('fumbles_lost')],
    ['Blocked field goals', number('blocked_field_goals')],
    ['Possession', clock(possession)],
  ];
}

function statLine(player) {
  const passing = player.passing;
  const rushing = player.rushing;
  const receiving = player.receiving;
  const parts = [];
  if (passing) parts.push(`PASS ${passing.comp ?? 0}/${passing.att ?? 0}, ${passing.yds ?? 0} yds, ${passing.td ?? 0} TD`);
  if (rushing) parts.push(`RUSH ${rushing.att ?? 0} att, ${rushing.yds ?? 0} yds, ${rushing.td ?? 0} TD`);
  if (receiving) parts.push(`REC ${receiving.rec ?? 0}/${receiving.tgt ?? 0}, ${receiving.yds ?? 0} yds, ${receiving.td ?? 0} TD`);
  const lost = player.miscellaneous?.fumbles_lost;
  if (lost) parts.push(`${lost} fumbles lost`);
  return parts.join(' · ') || '—';
}

function renderBoxScore(record) {
  const quarters = pointsByQuarter();
  const teams = [teamName(physicsGame.away), teamName(physicsGame.home)];
  $('linescore').innerHTML = `<thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>T</th></tr></thead><tbody>${teams.map((team) => {
    const side = sideForTeam(team);
    const score = record.points[side];
    return `<tr><td>${esc(team)}</td>${quarters[team].map((points) => `<td>${points}</td>`).join('')}<td><b>${score}</b></td></tr>`;
  }).join('')}</tbody>`;

  const stats = record.stats?.team ?? {};
  const rows = [];
  const canonicalStats = teams.map((team) => stats[sideForTeam(team)] ?? {});
  for (const [label, get] of teamStatRows(canonicalStats[0])) {
    const keyLabel = label;
    const values = teams.map((team) => {
      const teamStats = stats[sideForTeam(team)] ?? {};
      return teamStatRows(teamStats).find(([candidate]) => candidate === keyLabel)?.[1] ?? '—';
    });
    rows.push(`<tr><td>${esc(label)}</td>${values.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`);
  }
  $('teamstats').innerHTML = `<thead><tr><th></th>${teams.map((team) => `<th>${esc(team)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;

  const players = record.stats?.player ?? [];
  $('playerstats').innerHTML = `<thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>LP game stat line</th></tr></thead><tbody>${players.map((player) =>
    `<tr><td>${esc(player.player_name)}</td><td>${esc(player.player_team)}</td><td>${esc(player.player_position)}</td><td>${esc(statLine(player))}</td></tr>`).join('')}</tbody>`;
}

function renderPlayButton() {
  $('play').textContent = playing ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Pause game' : 'Play through game');
  $('play').title = playing ? 'Pause (space)' : 'Play through the plays (space)';
}

function animate(now) {
  if (lastFrame === null) lastFrame = now;
  const dt = Math.min(0.06, (now - lastFrame) / 1000);
  lastFrame = now;
  if (currentReplay) {
    const duration = (currentReplay.record.frames.length - 1) / currentReplay.record.hz;
    if (playing) {
      if (currentTime < currentReplay.record.t0 + duration) currentTime += dt * (Number($('speed').value) || 1);
      else {
        endPause += dt;
        if (endPause > 0.65) {
          const next = playable(currentIndex, 1);
          if (next != null) selectPlay(next, { preservePlaying: true });
          else { playing = false; renderPlayButton(); }
        }
      }
    }
    currentTime = Math.min(currentReplay.record.t0 + duration, currentTime);
    updateScorebug(now);
    renderer.draw(currentReplay.record, currentTime, dt);
    $('scrub').value = String(Math.round(1000 * (currentTime - currentReplay.record.t0) / Math.max(0.01, duration)));
    stadiumAudio?.update(Math.max(0, currentTime - currentReplay.record.t0), playing);
  }
  if (renderer) {
    renderer.updateCamera(1 / 60, { dir: currentReplay?.script.dir ?? 1 });
    renderer.render();
  }
  requestAnimationFrame(animate);
}

function wireControls() {
  $('simulate').disabled = false;
  $('again').disabled = false;
  $('simulate').addEventListener('click', () => selectPlay(0));
  $('again').addEventListener('click', () => selectPlay(0));
  $('previous').addEventListener('click', () => {
    const previous = playable(currentIndex, -1);
    if (previous != null) selectPlay(previous);
  });
  $('next').addEventListener('click', () => {
    const next = playable(currentIndex, 1);
    if (next != null) selectPlay(next);
  });
  $('play').addEventListener('click', () => {
    if (!playing && currentIndex === entries.length - 1 && currentReplay
        && currentTime >= currentReplay.record.t0 + (currentReplay.record.frames.length - 1) / currentReplay.record.hz) {
      selectPlay(0);
    }
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
  $('filterbar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(button.dataset.filter);
  });
  $('roster-t').addEventListener('click', (event) => {
    const button = event.target.closest('[data-team]');
    if (!button) return;
    rosterTeam = button.dataset.team;
    renderRoster();
  });
  $('book-t').addEventListener('click', (event) => {
    const button = event.target.closest('[data-team]');
    if (!button) return;
    playbookTeam = button.dataset.team;
    renderPlaybook();
  });
  for (const button of document.querySelectorAll('.cams button[data-cam]')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.cams button')) other.classList.toggle('on', other === button);
      cameraMode = button.dataset.cam;
      renderer.setCamera(cameraMode);
    });
  }
  for (const button of document.querySelectorAll('.tabs button[data-tab]')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tabs button')) other.classList.toggle('on', other === button);
      for (const tab of document.querySelectorAll('.tab')) tab.hidden = tab.id !== `tab-${button.dataset.tab}`;
    });
  }
  $('audio-toggle').addEventListener('click', async () => {
    const button = $('audio-toggle');
    if (stadiumAudio.enabled) {
      stadiumAudio.disable();
      button.textContent = 'Sound off';
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    button.disabled = true;
    button.textContent = 'Loading audio…';
    const loaded = await stadiumAudio.enable();
    button.disabled = false;
    button.textContent = loaded ? 'Sound on' : 'Audio unavailable';
    button.setAttribute('aria-pressed', String(stadiumAudio.enabled));
  });
  $('audio-volume').addEventListener('input', (event) => stadiumAudio.setVolume(Number(event.target.value) / 100));
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target === document.body) {
      event.preventDefault();
      $('play').click();
    }
  });
}

async function load() {
  try {
    const manifestResponse = await fetch('docs/fixtures/pregame/MANIFEST.json');
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const fixture = manifest.fixtures?.find((entry) => entry.file === manifest.default_fixture) ?? manifest.fixtures?.[0];
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
    entries = adapted.drives.flatMap((drive) => drive.plays.map((item, playOffset) => ({
      drive, play: item.source, playOffset,
    })));
    classifyPlays();
    rosterTeam = teamName(physicsGame.away);
    playbookTeam = rosterTeam;
    stadiumAudio = new FootballAudio(teamName(physicsGame.home));
    renderer = new Renderer($('view'), physicsGame, { displayFont: '"Saira Condensed", "Arial Narrow", sans-serif' });
    renderer.setCamera('broadcast');
    renderer.resize();
    new ResizeObserver(() => renderer.resize()).observe($('view'));
    window.addEventListener('resize', () => renderer.resize());
    const matchup = $('matchup');
    matchup.innerHTML = `<option value="${esc(gamePayload.game_id)}">${esc(`${teamName(physicsGame.away)} at ${teamName(physicsGame.home)} · Week 7 · seed ${adapted.record.seed}`)}</option>`;
    $('seed').value = String(adapted.record.seed);
    $('game-summary').textContent = `${teamName(physicsGame.away)} at ${teamName(physicsGame.home)} · ${adapted.record.points[physicsGame.away]}–${adapted.record.points[physicsGame.home]} · frozen pregame game`;
    $('record-status').textContent = `LP valid full game · ${adapted.drives.length} drives · ${adapted.sourcePlayCount} plays · producer ${adapted.source.base_commit.slice(0, 12)} · fixture checksum verified`;
    $('status').textContent = 'Pinned LP source, snapshot and game checks passed';
    renderFilter();
    renderTimeline();
    renderPlaybook();
    renderBoxScore(adapted.record);
    wireControls();
    selectPlay(0);
    requestAnimationFrame(animate);
  } catch (error) {
    $('status').textContent = 'Game replay failed to load';
    $('record-status').textContent = error.message;
    $('replay-type').textContent = 'Pinned statistical game unavailable';
    $('play-detail').textContent = error.stack ?? error.message;
  }
}

load();
