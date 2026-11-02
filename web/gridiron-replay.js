import { Renderer } from './render.js?v=2';
import { executeSelectedPlay } from './prototype-execution.js';
import { adaptLpGamePayload } from './lp-game-record-adapter.js';
import { prepareSlcPhysicsReplay, selectionForSlcPlay, slcParticipantLine, slcPlayLabel } from './slc-seed-physics-replay.js';
import { teamLogoUrl } from './team-logo.js';
import { FootballAudio } from './audio-director.js';
import { animateScoreBug } from './score-animation.js';
import { playArtMarks, playArtSvg } from './play-art.js';

// <gridiron-replay> plays saved LP game records in the 3D engine. A page mounts it and sets
// attributes; it owns its own DOM and styles, so pages never copy the viewer again.
//   manifest  seed shortlist JSON              (default: min-det realism marketing seeds)
//   games     folder holding seed-<id>.json    (default: min-det realism games)
//   roster    local roster/ratings snapshot    (default: min-det week 8 snapshot)
//   seed      play one saved seed
//   playlist  "featured" plays the five featured seeds in order
//   autoplay  start playing the first clip as soon as it loads
const DEFAULTS = {
  manifest: 'docs/fixtures/e2/min-det-realism/marketing-seeds.json',
  games: 'docs/fixtures/e2/min-det-realism/games/',
  roster: 'data/teams/min-det-week8-2026-10-28.json',
};
const CSS_URL = new URL('./gridiron-replay.css?v=7', import.meta.url).href;
const TEAM_NAMES = { MIN: 'MIN', DET: 'DET' };
// Play-time seconds between the ball crossing the goal line and the score changing on a touchdown.
const SCORE_DELAY_S = 0.8;
const ESC = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const MARKUP = `
  <div class="app">
    <header class="bug" aria-label="Scoreboard">
      <div class="bug-team" id="bug-away"></div>
      <div class="bug-mid">
        <div class="bug-clock"><span id="bug-q">Q1</span><span id="bug-clock">15:00</span></div>
        <div class="bug-down" id="bug-down">KICKOFF</div>
      </div>
      <div class="bug-team" id="bug-home"></div>
      <div class="bug-meta" id="bug-meta"></div>
    </header>

    <main class="stage">
      <canvas id="view" aria-label="3D reconstruction of the current play"></canvas>
      <div class="tags" id="tags" aria-hidden="true"></div>
      <div class="ticker" id="ticker" aria-live="polite"></div>
      <div class="cams" role="group" aria-label="Camera">
        <button data-cam="broadcast" class="on">Broadcast</button>
        <button data-cam="all22">All-22</button>
        <button data-cam="sky">Skycam</button>
        <button data-cam="top">Chalkboard</button>
        <button data-cam="follow">Follow</button>
        <button data-cam="free">Free</button>
      </div>
      <div class="loader" id="loader">
        <div class="loader-k">Simulating 22 bodies per snap</div>
        <div class="loader-bar"><i id="loader-bar"></i></div>
        <div class="loader-n" id="loader-n">0 / 0 plays</div>
      </div>
    </main>

    <section class="transport" aria-label="Playback">
      <div class="tp-row">
        <button id="prev" title="Previous play (←)" aria-label="Previous play">‹</button>
        <button id="play" title="Play / pause (space)" aria-label="Play game">▶</button>
        <button id="next" title="Next play (→)" aria-label="Next play">›</button>
        <input id="scrub" type="range" min="0" max="1000" value="0" aria-label="Scrub within play">
        <select id="speed" aria-label="Playback speed">
          <option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
        </select>
        <label class="auto"><input type="checkbox" id="auto" checked> Auto-advance</label>
        <button id="audio-toggle" type="button" aria-pressed="false">Sound off</button>
      </div>
      <p class="playtext" id="playtext"></p>
      <canvas id="wp" height="46" aria-label="Win probability by play"></canvas>
    </section>

    <aside class="panel" aria-label="Details">
      <nav class="tabs" role="tablist">
        <button role="tab" data-tab="drives" class="on">Drives</button>
        <button role="tab" data-tab="box">Box score</button>
        <button role="tab" data-tab="playbook">Playbook</button>
        <button role="tab" data-tab="ratings">Ratings</button>
      </nav>
      <div class="tab" id="tab-drives">
        <div class="filterbar" id="filterbar" role="group" aria-label="Filter plays"></div>
        <p class="note" id="play-count-label"></p>
        <div id="drivelist"></div>
      </div>
      <div class="tab" id="tab-box" hidden></div>
      <div class="tab" id="tab-playbook" hidden></div>
      <div class="tab" id="tab-ratings" hidden></div>
    </aside>
  </div>`;

function clock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function outcomeText(play) {
  const kind = slcPlayLabel(play);
  if (play.event_type === 'field_goal_attempt') return `${kind} · ${play.outcome?.field_goal_result || 'result unavailable'}`;
  if (play.event_type === 'punt') return `${kind} · next possession recorded`;
  const yards = Number(play.outcome?.yards_gained ?? 0);
  const result = `${kind} · ${yards > 0 ? '+' : ''}${yards} yd`;
  return play.outcome?.touchdown ? `${result} · TOUCHDOWN` : result;
}

function isScoring(play) {
  return Boolean(play.outcome?.touchdown || play.outcome?.scoring_team || play.event_type === 'field_goal_attempt'
    && play.outcome?.field_goal_result === 'made');
}

function isKeyPlay(play) {
  return isScoring(play) || Boolean(play.outcome?.turnover || play.outcome?.turnover_on_downs
    || play.event_type === 'interception' || play.event_type === 'fumble_lost'
    || Math.abs(Number(play.outcome?.yards_gained || 0)) >= 20);
}

function matchesFilter(play, filter) {
  return filter === 'all' || (filter === 'scoring' ? isScoring(play) : isKeyPlay(play));
}

// A scrimmage plan from slc-seed-physics-replay has no `type`, so the football sound planner
// would skip it. Map it into the planner's shape here; special-teams plans already carry `type`.
function soundPlay(scenario, play) {
  if (scenario.type) return scenario;
  return {
    ...scenario,
    type: 'scrimmage',
    kind: scenario.kindGroup,
    touchdown: scenario.td,
    interception: scenario.kind === 'int',
    offense: scenario.off,
    defense: scenario.def,
    togo: play.state_before.yards_to_go,
  };
}

// "Jared Goff to Sam LaPorta" for a pass with both players named; '' otherwise
function passTo(play) {
  const pre = play.outcome?.pre_event || {};
  return pre.passer?.player_name && pre.receiver?.player_name ? `${pre.passer.player_name} to ${pre.receiver.player_name}` : '';
}

// the drive row names the ball carrier on a run, and the passer and receiver on a pass
function whoText(play) {
  return passTo(play) || play.outcome?.pre_event?.rusher?.player_name || '';
}

const FORM_LABEL = { SHOTGUN: 'Shotgun', 'UNDER CENTER': 'Under center', PISTOL: 'Pistol' };
const GAP_LABEL = { end: 'End', tackle: 'Tackle', guard: 'Guard' };
// Diagram geometry in a 160x96 box: line of scrimmage at y=60, offensive line at x=56..104.
const DIAG_ALIGN = { 'UNDER CENTER': { qb: [80, 68], rb: [80, 84] }, SHOTGUN: { qb: [80, 80], rb: [68, 80] }, PISTOL: { qb: [80, 72], rb: [80, 88] } };
const DIAG_GAP = { end: { left: 46, right: 114 }, tackle: { left: 62, right: 98 }, guard: { left: 74, right: 86 } };
const DIAG_ZONE = { left: 44, middle: 80, right: 116 };

function cardLabel(card) {
  const a = card.attributes;
  const form = FORM_LABEL[a.formation] || a.formation;
  return card.action === 'run'
    ? `${form} · ${GAP_LABEL[a.run_gap]} ${a.run_location}`
    : `${form} · ${a.pass_length === 'deep' ? 'deep' : 'short'} ${a.pass_location}`;
}

function playDiagram(card) {
  const a = card.attributes;
  const align = DIAG_ALIGN[a.formation] || DIAG_ALIGN['UNDER CENTER'];
  const line = [56, 68, 80, 92, 104].map((x) => `<circle cx="${x}" cy="60" r="3.2" class="pd-ol"/>`).join('');
  let back = '';
  let play;
  if (card.action === 'run') {
    const gx = DIAG_GAP[a.run_gap]?.[a.run_location] ?? 80;
    back = `<circle cx="${align.rb[0]}" cy="${align.rb[1]}" r="3.6" class="pd-rb"/>`;
    play = `<path d="M${align.rb[0]} ${align.rb[1]} L${gx} 60 L${gx} 26" class="pd-run"/><circle cx="${gx}" cy="26" r="2.6" class="pd-end"/>`;
  } else {
    const tx = DIAG_ZONE[a.pass_location] ?? 80;
    const ty = a.pass_length === 'deep' ? 18 : 40;
    play = `<path d="M${align.qb[0]} ${align.qb[1]} L${tx} ${ty}" class="pd-pass"/><circle cx="${tx}" cy="${ty}" r="4" class="pd-target"/>`;
  }
  return `<svg viewBox="0 0 160 96" role="img" aria-label="${ESC(cardLabel(card))}"><rect width="160" height="96" class="pd-field"/><line x1="6" x2="154" y1="60" y2="60" class="pd-los"/>${line}<circle cx="${align.qb[0]}" cy="${align.qb[1]}" r="3.6" class="pd-qb"/>${back}${play}</svg>`;
}

function playCard(card) {
  return `<div class="pcard">${playDiagram(card)}<div class="pc-t">${ESC(cardLabel(card))}</div><div class="pc-n">${card.count} of ${card.denominator} · ${(card.rate * 100).toFixed(1)}%</div></div>`;
}

function driveResult(drive) {
  const last = drive.plays.at(-1);
  if (!last) return drive.terminal.replaceAll('_', ' ');
  if (drive.terminal === 'touchdown') return 'TOUCHDOWN';
  if (drive.terminal === 'field_goal_attempt') return last.outcome?.field_goal_result === 'made' ? 'FIELD GOAL' : 'FG ATTEMPT';
  return drive.terminal.replaceAll('_', ' ');
}

const COVERAGE_LABEL = { '2_MAN': '2-man', COVER_0: 'Cover 0', COVER_1: 'Cover 1', COVER_2: 'Cover 2', COVER_3: 'Cover 3', COVER_4: 'Cover 4', COVER_6: 'Cover 6', COVER_9: 'Cover 9', COMBO: 'Combo', PREVENT: 'Prevent' };

// The offense's call in words, from the replay's selection and the saved play's pre-snap labels.
function offenseCall(scenario, pre, source) {
  const form = FORM_LABEL[pre.formation] || (pre.formation ? pre.formation.toLowerCase() : 'formation not charted');
  const personnel = pre.personnel ? `${pre.personnel} personnel` : '';
  const action = scenario.kindGroup === 'run'
    ? `Run ${GAP_LABEL[scenario.gap] || 'middle'} ${scenario.loc}`
    : `Pass ${scenario.air >= 15 ? 'deep' : 'short'} ${scenario.loc}${passTo(source) ? ` · ${passTo(source)}` : ''}`;
  return [form, personnel, action].filter(Boolean).join(' · ');
}

// The defense's call in words: its coverage as charted, against the offense's personnel.
function defenseCall(pre) {
  const coverage = pre.coverage ? (COVERAGE_LABEL[pre.coverage] || String(pre.coverage).replaceAll('_', ' ').toLowerCase()) : 'coverage not charted';
  return pre.personnel ? `${coverage} · vs ${pre.personnel} personnel` : coverage;
}

class GridironReplay extends HTMLElement {
  constructor() {
    super();
    this.audio = new FootballAudio(null);
    this.queue = [];
    this.queueIndex = 0;
    this.model = null;
    this.payload = null;
    this.items = [];
    this.visibleItems = [];
    this.renderer = null;
    this.currentIndex = -1;
    this.currentRecord = null;
    this.currentSelection = null;
    this.clipSeconds = 0;
    this.clipDuration = 0;
    this.lastFrame = null;
    this.clipPlaying = false;
    this.continuous = false;
    this.speed = 1;
    this.autoAdvance = true;
    this.eventCursor = 0;
    this.activeFilter = 'all';
    this.playOverlay = false;
    this.rosterTeam = null;
    this.selectedPlayer = null;
    this.home = null;
    this.away = null;
    this.options = null;
    this.started = false;
    this.frameId = 0;
    this.tagElements = new Map();
    this.animate = this.animate.bind(this);
    this.onResize = () => this.renderScoreChart();
    this.onKeydown = (event) => this.handleKey(event);
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' }).innerHTML = `<link rel="stylesheet" href="${CSS_URL}">${MARKUP}`;
      this.bindControls();
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeydown);
    cancelAnimationFrame(this.frameId);
    this.frameId = requestAnimationFrame(this.animate);
    if (!this.started) {
      this.started = true;
      this.init();
    }
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeydown);
    cancelAnimationFrame(this.frameId);
  }

  $(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  readOptions() {
    const attr = (name, fallback) => this.getAttribute(name) || fallback;
    return {
      manifest: attr('manifest', DEFAULTS.manifest),
      games: attr('games', DEFAULTS.games),
      roster: attr('roster', DEFAULTS.roster),
      seed: this.getAttribute('seed'),
      playlist: this.getAttribute('playlist'),
      autoplay: this.hasAttribute('autoplay'),
    };
  }

  async init() {
    try {
      this.options = this.readOptions();
      const response = await fetch(this.options.manifest, { cache: 'no-store' });
      if (!response.ok) throw new Error(`marketing seed list HTTP ${response.status}`);
      const manifest = await response.json();
      const featured = manifest.seeds.filter((entry) => entry.selection !== 'additional_realistic_scenario').slice(0, 5);
      if (this.options.playlist === 'featured') this.queue = featured.map((entry) => Number(entry.seed));
      else if (this.options.seed != null) this.queue = [Number(this.options.seed)];
      else this.queue = [Number(featured[0]?.seed)];
      if (!this.queue.length || this.queue.some((seed) => !Number.isInteger(seed))) throw new Error('seed shortlist has no playable IDs');
      await this.loadSeed(0, this.options.autoplay);
    } catch (error) {
      this.reportFailure(error);
    }
  }

  reportFailure(error) {
    this.updateStatus(error.message, true);
    this.showLoader('Could not load SLC replay', error.message);
  }

  updateStatus(message, failure = false) {
    if (failure) this.$('#bug-meta').textContent = message;
  }

  showLoader(title, detail = '') {
    this.$('.loader-k').textContent = title;
    this.$('#loader-n').textContent = detail;
    this.$('#loader-bar').style.width = detail ? '100%' : '0%';
    this.$('#loader').hidden = false;
  }

  bindControls() {
    this.$('#prev').addEventListener('click', () => this.stepPlay(-1));
    this.$('#next').addEventListener('click', () => this.stepPlay(1));
    this.$('#play').addEventListener('click', () => this.togglePlay());
    this.$('#scrub').addEventListener('input', (event) => {
      if (!this.currentRecord) return;
      this.clipSeconds = (Number(event.target.value) / 1000) * this.clipDuration;
      this.clipPlaying = false;
      this.setContinuous(false);
    });
    this.$('#speed').addEventListener('change', (event) => { this.speed = Number(event.target.value) || 1; });
    this.$('#auto').addEventListener('change', (event) => { this.autoAdvance = event.target.checked; });
    this.$('#audio-toggle').addEventListener('click', () => this.toggleSound());
    this.$('#filterbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      this.activeFilter = button.dataset.filter;
      this.renderFilter();
      this.renderDrives();
      const next = this.visibleItems.find((entry) => entry.index === this.currentIndex) || this.visibleItems[0];
      if (next) this.selectPlay(next.index);
      this.renderScoreChart();
    });
    this.$('#tab-drives').addEventListener('click', (event) => {
      const button = event.target.closest('.pl');
      if (!button) return;
      this.selectPlay(Number(button.dataset.i), { playClip: true });
      this.setContinuous(this.autoAdvance);
    });
    this.$('#tab-playbook').addEventListener('click', (event) => {
      if (event.target.closest('[data-overlay]')) {
        this.playOverlay = !this.playOverlay;
        this.renderPlaybook();
        this.updatePlayArt();
        return;
      }
      const teamButton = event.target.closest('[data-team]');
      if (teamButton) { this.bookTeam = teamButton.dataset.team; this.renderPlaybook(); this.updatePlayArt(); }
    });
    this.$('#tab-ratings').addEventListener('click', (event) => {
      if (event.target.closest('[data-back]')) { this.clearPlayer(); return; }
      const teamButton = event.target.closest('[data-team]');
      if (teamButton) { this.rosterTeam = teamButton.dataset.team; this.renderRoster(); return; }
      const playerButton = event.target.closest('[data-pid]');
      if (playerButton) this.renderPlayer(playerButton.dataset.pid);
    });
    this.shadowRoot.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => this.showTab(button.dataset.tab)));
    this.shadowRoot.querySelectorAll('.cams button').forEach((button) => button.addEventListener('click', () => {
      this.shadowRoot.querySelectorAll('.cams button').forEach((candidate) => candidate.classList.toggle('on', candidate === button));
      this.renderer?.setCamera(button.dataset.cam);
    }));
    this.$('#view').addEventListener('click', (event) => {
      const playerId = this.renderer?.pick(event.clientX, event.clientY);
      if (playerId) this.renderPlayer(playerId);
    });
    this.$('#wp').addEventListener('click', (event) => {
      if (!this.items.length) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const index = Math.round((event.clientX - bounds.left) / bounds.width * (this.items.length - 1));
      this.selectPlay(index, { playClip: true });
    });
  }

  async toggleSound() {
    const button = this.$('#audio-toggle');
    if (this.audio.enabled) {
      this.audio.disable();
      button.textContent = 'Sound off';
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    button.disabled = true;
    button.textContent = 'Loading sound…';
    const loaded = await this.audio.enable();
    button.disabled = false;
    button.textContent = loaded ? 'Sound on' : 'Sound files missing';
    button.setAttribute('aria-pressed', String(this.audio.enabled));
  }

  handleKey(event) {
    const target = event.composedPath()[0];
    if (target?.matches?.('input, select')) return;
    if (event.code === 'Space') { event.preventDefault(); this.togglePlay(); }
    if (event.code === 'ArrowRight') this.stepPlay(1);
    if (event.code === 'ArrowLeft') this.stepPlay(-1);
  }

  renderFilter() {
    const counts = {
      all: this.items.length,
      scoring: this.items.filter(({ play }) => isScoring(play)).length,
      key: this.items.filter(({ play }) => isKeyPlay(play)).length,
    };
    const options = [['all', 'All Plays'], ['scoring', 'Scoring'], ['key', 'Key Plays']];
    this.$('#filterbar').innerHTML = options.map(([value, label]) =>
      `<button data-filter="${value}" class="${this.activeFilter === value ? 'on' : ''}">${label}<span>${counts[value]}</span></button>`).join('');
  }

  renderDrives() {
    this.visibleItems = this.items.map((item, index) => ({ ...item, index })).filter(({ play }) => matchesFilter(play, this.activeFilter));
    const shown = new Set(this.visibleItems.map((entry) => entry.index));
    const list = this.$('#drivelist');
    const tab = this.$('#tab-drives');
    const scrollTop = tab.scrollTop;
    list.innerHTML = this.payload.record.drives.map((drive) => {
      const team = this.model.teamsBySide[drive.offense_team];
      const sourceTeam = this.model.game.teams[team];
      const rows = this.items.map((item, index) => ({ item, index }))
        .filter(({ item, index }) => item.drive === drive && shown.has(index))
        .map(({ item, index }) => {
          const play = item.play;
          const state = play.state_before;
          const down = state.down == null ? 'ST' : `${state.down}&${state.yards_to_go}`;
          return `<button class="pl ${index === this.currentIndex ? 'on' : ''}" data-i="${index}">
            <span class="dd">Q${state.quarter} ${ESC(clock(state.clock_seconds))}<br>${ESC(down)}</span>
            <span class="txt">${ESC(outcomeText(play))}${whoText(play) ? ` · ${ESC(whoText(play))}` : ''}</span>
          </button>`;
        });
      if (!rows.length) return '';
      const scored = drive.terminal === 'touchdown' || drive.terminal === 'field_goal_attempt' && drive.field_goal_made;
      return `<div class="drive"><div class="drive-h" style="--team:${ESC(sourceTeam?.color || '#8d9aa8')}"><span>${ESC(team)} · DRIVE ${drive.index} · Q${drive.quarter_start}</span><span class="res ${scored ? 'score' : ''}">${ESC(driveResult(drive))}</span></div>${rows.join('')}</div>`;
    }).join('');
    if (!this.visibleItems.length) list.innerHTML = '<p class="note">No saved plays match this filter.</p>';
    this.$('#play-count-label').textContent = `${this.items.length} saved plays · ${this.visibleItems.length} shown`;
    tab.scrollTop = scrollTop;
  }

  setScoreState(play, after = false, { animate = false } = {}) {
    const state = after ? (play.state_after || play.state_before) : play.state_before;
    const before = play.state_before;
    const tween = animate && after;
    const offense = this.model.teamsBySide[state.offense_team];
    const stateRows = [
      { team: this.away, node: this.$('#bug-away'), score: state.away_score, from: before.away_score, side: 'away' },
      { team: this.home, node: this.$('#bug-home'), score: state.home_score, from: before.home_score, side: 'home' },
    ];
    for (const row of stateRows) {
      const info = this.model.game.teams[row.team];
      const right = row.side === 'home';
      const logo = `<img src="${ESC(teamLogoUrl(row.team))}" alt="">`;
      const name = `<span class="abbr">${ESC(TEAM_NAMES[row.team] || row.team)}</span>`;
      row.node.innerHTML = `${right ? name + logo : logo + name}<span class="score">${Number(tween ? row.from : row.score) || 0}</span>`;
      row.node.style.setProperty('--team', info.color);
      row.node.classList.toggle('poss', offense === row.team);
      if (tween && row.from !== row.score) animateScoreBug(row.node, row.node.querySelector('.score'), Number(row.from || 0), Number(row.score || 0));
    }
    this.$('#bug-q').textContent = state.quarter > 4 ? 'OT' : `Q${state.quarter}`;
    this.$('#bug-clock').textContent = clock(state.clock_seconds);
    this.$('#bug-down').textContent = state.down == null ? 'SPECIAL TEAMS' : `${state.down} & ${state.yards_to_go}`;
  }

  updateMeta() {
    const record = this.payload.record;
    this.$('#bug-meta').innerHTML = `Seed ${record.seed} · ${this.queueIndex + 1}/${this.queue.length}<br>Saved outcomes preserved`;
  }

  setPlayText(play, selection = null, error = null) {
    const node = this.$('#playtext');
    node.replaceChildren();
    const heading = document.createElement('b');
    heading.textContent = `PLAY ${play.sequence}`;
    const summary = document.createElement('span');
    // a pass names both players as "passer to receiver"; other plays keep the shared list
    const pre = play.outcome?.pre_event || {};
    const who = pre.passer?.player_name && pre.receiver?.player_name ? `${pre.passer.player_name} to ${pre.receiver.player_name}` : slcParticipantLine(play);
    summary.textContent = ` ${outcomeText(play)}${who ? ` · ${who}` : ''}`;
    node.append(heading, summary);
    if (selection?.execution_contract?.unsupported?.length) {
      const caveat = document.createElement('span');
      caveat.className = 'note';
      caveat.textContent = ` ${selection.execution_contract.unsupported.join(' ')}`;
      node.append(caveat);
    }
    if (error) {
      const failed = document.createElement('span');
      failed.className = 'note';
      failed.textContent = ` 3D unavailable: ${error}`;
      node.append(failed);
    }
  }

  renderPosition() {
    if (this.currentIndex < 0) return;
    this.updateStatus(`HYPOTHETICAL SLC · PLAY ${this.currentIndex + 1}/${this.items.length}`);
  }

  setTagPositions() {
    const box = this.$('#tags');
    if (!this.currentRecord || !this.renderer) return;
    const frameIndex = Math.max(0, Math.min(this.currentRecord.frames.length - 1.001, this.clipSeconds * this.currentRecord.hz));
    const i0 = Math.floor(frameIndex), alpha = frameIndex - i0;
    const f0 = this.currentRecord.frames[i0], f1 = this.currentRecord.frames[Math.min(this.currentRecord.frames.length - 1, i0 + 1)];
    const lerp = (i) => f0[i] + (f1[i] - f0[i]) * alpha;
    const visible = new Set();
    this.currentRecord.roster.forEach((entry, index) => {
      if (f0[index * 6 + 5] <= 0.5 && entry.id !== this.selectedPlayer) return;
      const projected = this.renderer.project(lerp(index * 6), lerp(index * 6 + 1), 2.6);
      if (projected.behind) return;
      visible.add(entry.id);
      let tag = this.tagElements.get(entry.id);
      if (!tag) {
        const person = this.model.game.players[entry.id];
        tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = `#${person.jersey} ${person.short || person.name}`;
        tag.append(document.createElement('small'));
        box.append(tag);
        this.tagElements.set(entry.id, tag);
      }
      tag.style.left = `${projected.x}px`;
      tag.style.top = `${projected.y}px`;
      tag.querySelector('small').textContent = `${(lerp(index * 6 + 3) * 2.23694).toFixed(1)} mph`;
    });
    for (const [id, tag] of this.tagElements) {
      if (!visible.has(id)) { tag.remove(); this.tagElements.delete(id); }
    }
  }

  clearTags() {
    for (const tag of this.tagElements.values()) tag.remove();
    this.tagElements.clear();
  }

  pushTicker(text, big = false) {
    const box = this.$('#ticker');
    const row = document.createElement('div');
    if (big) row.className = 'big';
    row.textContent = text;
    box.append(row);
    while (box.children.length > 4) box.firstElementChild.remove();
  }

  showTab(name) {
    this.shadowRoot.querySelectorAll('.tabs button').forEach((button) => button.classList.toggle('on', button.dataset.tab === name));
    this.shadowRoot.querySelectorAll('.tab').forEach((tab) => { tab.hidden = tab.id !== `tab-${name}`; });
    if (name === 'playbook') this.renderPlaybook();
    if (name === 'box') this.renderBox();
    if (name === 'ratings') this.renderRoster();
  }

  renderRoster() {
    if (this.selectedPlayer) { this.$('#tab-ratings').innerHTML = this.playerCard(this.selectedPlayer); return; }
    const roster = this.model.rosterByTeam[this.rosterTeam];
    const groups = [...new Set(roster.map((player) => player.rating_group || player.position))].sort();
    this.$('#tab-ratings').innerHTML = `<div class="roster-t">${[this.away, this.home].map((team) =>
      `<button data-team="${ESC(team)}" class="${team === this.rosterTeam ? 'on' : ''}">${ESC(TEAM_NAMES[team] || team)}</button>`).join('')}</div>
      <p class="note">Full local roster snapshot · depth-chart ranks are used for lineup selection. Availability is not verified against gameday inactives.</p>
      ${groups.map((group) => {
        const players = roster.filter((player) => (player.rating_group || player.position) === group)
          .sort((a, b) => (a.depth_chart_rank ?? 999) - (b.depth_chart_rank ?? 999) || (b.overall_estimate ?? 0) - (a.overall_estimate ?? 0) || a.name.localeCompare(b.name));
        return `<div class="rgroup">${ESC(group)}</div>${players.map((player) =>
          `<button class="rrow" data-pid="${ESC(player.id)}"><span class="ovr ${(player.overall_estimate || 0) >= 85 ? 'hi' : ''}">${player.overall_estimate ?? '—'}</span><span>${ESC(player.name)} <small>${ESC(player.status)}${player.depth_chart_position ? ` · ${ESC(player.depth_chart_position)}` : ''}</small></span><span class="pos">${ESC(player.position)}</span><span class="pos">#${ESC(player.jersey)}</span></button>`).join('')}`;
      }).join('')}`;
  }

  renderPlayer(id) {
    if (!this.model.game.players[id]) return;
    this.selectedPlayer = id;
    this.renderer?.select(id);
    this.showTab('ratings');
  }

  clearPlayer() {
    this.selectedPlayer = null;
    this.renderer?.select(null);
    this.renderRoster();
  }

  playerCard(id) {
    const player = this.model.game.players[id];
    const ratingEntries = Object.entries(player.ratings || {});
    const phys = player.physics || {};
    const heightFeet = Math.floor((player.height_in || 0) / 12);
    const heightInches = (player.height_in || 0) % 12;
    return `<button class="back" data-back type="button">✕ All players</button><div class="card-h">${player.headshot_url ? `<img src="${ESC(player.headshot_url)}" alt="">` : '<span></span>'}
      <div><h2>${ESC(player.name)}</h2><p>#${ESC(player.jersey)} · ${ESC(player.position)} · ${ESC(player.team_id)} · ${heightFeet}'${heightInches}" · ${ESC(player.weight_lb)} lb</p>
      <p>${ESC(player.status)} · ${ESC(player.depth_chart_position || 'No captured chart role')} · depth ${player.depth_chart_rank ?? '—'}</p></div>
      <div class="big" title="Overall estimate">${player.overall_estimate ?? '—'}</div></div>
      <div class="sec">Physics body · generated by Gridiron pipeline</div><dl class="kv">
        <dt>Top speed</dt><dd>${(phys.vmax * 2.23694).toFixed(1)} mph</dd><dt>Mass</dt><dd>${phys.mass} kg</dd>
        <dt>Acceleration time</dt><dd>${phys.tau} s</dd><dt>Propulsive force</dt><dd>${phys.f0} N</dd>
        <dt>Lateral acceleration</dt><dd>${phys.alat} m/s²</dd><dt>Reach</dt><dd>${phys.reach} m</dd></dl>
      <div class="sec">Ratings</div><div class="attrs">${ratingEntries.map(([key, value]) =>
        `<div class="attr"><div class="top"><span>${ESC(key)}</span><b>${ESC(value)}</b></div><div class="meter"><i style="width:${Number(value)}%"></i></div></div>`).join('')}</div>
      <p class="note">Ratings and physical attributes come from the existing local Gridiron player pipeline. Some combine measurables are estimated as recorded in the source snapshot.</p>`;
  }

  // The team's 2025 charted offense as play diagrams, from data/playbooks/<team>-2025.json.
  renderPlaybook() {
    if (!this.away) return;
    if (!this.books) {
      this.$('#tab-playbook').innerHTML = '<p class="hint">Loading the 2025 playbooks.</p>';
      this.loadPlaybooks().catch((error) => this.reportFailure(error));
      return;
    }
    this.bookTeam ??= this.away;
    const offense = this.books[this.bookTeam].offense;
    const group = (kind, label) => {
      const cards = [...offense.play_candidates[kind].candidates].sort((a, b) => b.count - a.count);
      return `<div class="pgroup">${label} · ${cards.length} combinations</div><div class="pgrid">${cards.map(playCard).join('')}</div>`;
    };
    this.$('#tab-playbook').innerHTML = `<div class="roster-t">${[this.away, this.home].map((team) =>
      `<button data-team="${ESC(team)}" class="${team === this.bookTeam ? 'on' : ''}">${ESC(TEAM_NAMES[team] || team)}</button>`).join('')}</div>
      ${this.currentPlayHtml(this.bookTeam)}
      <div class="sec">${ESC(TEAM_NAMES[this.bookTeam] || this.bookTeam)} · 2025 charted offense</div>
      ${group('run', 'Run')}${group('pass', 'Pass')}
      <p class="note">Diagrams show the alignment and the run gap or pass target, not routes, blocks or coverage. These are tendencies, not play calls.</p>`;
  }

  // The called play as the playbook's team saw it: its offense's call, or its defense's coverage. The art is built from
  // the assignments the engine set up at the snap, so it shows the call and not where the play ended.
  currentPlayHtml(team) {
    const sel = this.currentSelection, rec = this.currentRecord, item = this.items[this.currentIndex];
    if (!sel || !rec || !item) return '<div class="curplay"><p class="hint">No play loaded yet.</p></div>';
    if (sel.play.kindGroup === 'kick') return '<div class="curplay"><p class="hint">Special teams: this play has no play art.</p></div>';
    const source = item.play;
    const pre = source.outcome?.pre_event || {};
    const onOffense = team === sel.play.off;
    const legend = onOffense
      ? 'Routes in colour, with arrows. Yellow bars mark the defender each lineman blocks.'
      : 'Shaded zones, sized and coloured by zone size: blue deep, cream underneath, teal flat. A line ends in an X on the zone, receiver, or landmark he holds. Red arrows are rushers.';
    return `<section class="curplay" aria-label="Current play">
      <div class="cp-head"><b>${ESC(TEAM_NAMES[team] || team)} ${onOffense ? 'offense' : 'defense'}</b><span>PLAY ${ESC(source.sequence)} · ${ESC(outcomeText(source))}</span></div>
      <div class="cp-art">${playArtSvg(rec, sel, team, { togo: source.state_before?.yards_to_go })}</div>
      <p class="cp-call">${ESC(onOffense ? offenseCall(sel.play, pre, source) : defenseCall(pre))}</p>
      <div class="cp-tools"><button type="button" data-overlay aria-pressed="${this.playOverlay}" class="${this.playOverlay ? 'on' : ''}">${this.playOverlay ? 'Hide' : 'Show'} play on the field</button><span class="note">${ESC(legend)}</span></div>
    </section>`;
  }

  // The overlay on the field: the team the playbook shows, on its side of the called play, while the button is on.
  updatePlayArt() {
    if (!this.renderer?.setPlayArt) return;
    const sel = this.currentSelection, rec = this.currentRecord;
    const team = this.bookTeam ?? this.away;
    if (!this.playOverlay || !sel || !rec || !team || sel.play.kindGroup === 'kick') {
      this.renderer.setPlayArt(null);
      return;
    }
    this.renderer.setPlayArt(playArtMarks(rec, team));
  }

  async loadPlaybooks() {
    const teams = [this.away, this.home];
    const responses = await Promise.all(teams.map((team) => fetch(`data/playbooks/${team}-2025.json`, { cache: 'force-cache' })));
    for (const response of responses) if (!response.ok) throw new Error(`2025 playbook HTTP ${response.status}`);
    const books = await Promise.all(responses.map((response) => response.json()));
    this.books = Object.fromEntries(teams.map((team, index) => [team, books[index]]));
    this.renderPlaybook();
  }

  // Team totals and player lines for the whole saved game, derived from the saved plays.
  renderBox() {
    const teams = [this.away, this.home];
    const totals = Object.fromEntries(teams.map((team) => [team, { plays: 0, rushAtt: 0, rushYds: 0, passAtt: 0, passComp: 0, passYds: 0, sacks: 0, turnovers: 0, punts: 0, fgAtt: 0 }]));
    const passing = {}, rushing = {}, receiving = {};
    const credit = (map, pre, role, team) => {
      const name = pre[role]?.player_name;
      if (!name) return null;
      const key = `${team}:${name}`;
      map[key] ??= { name, team, att: 0, comp: 0, yds: 0, td: 0 };
      return map[key];
    };
    for (const { play } of this.items.slice(0, this.boxCount ?? 0)) {
      const team = this.model.teamsBySide[play.state_before.offense_team];
      if (!totals[team]) continue;
      const t = totals[team];
      const pre = play.outcome?.pre_event || {};
      const yards = Number(play.outcome?.yards_gained ?? 0);
      const td = Boolean(play.outcome?.touchdown);
      const kind = play.event_type;
      t.plays += 1;
      if (kind === 'run') {
        t.rushAtt += 1;
        t.rushYds += yards;
        const r = credit(rushing, pre, 'rusher', team);
        if (r) { r.att += 1; r.yds += yards; if (td) r.td += 1; }
      } else if (kind === 'sack') {
        t.sacks += 1;
      } else if (kind === 'pass_complete' || kind === 'pass_incomplete' || kind === 'interception') {
        const complete = kind === 'pass_complete';
        t.passAtt += 1;
        if (complete) { t.passComp += 1; t.passYds += yards; }
        if (kind === 'interception') t.turnovers += 1;
        const p = credit(passing, pre, 'passer', team);
        if (p) { p.att += 1; if (complete) { p.comp += 1; p.yds += yards; } if (td) p.td += 1; }
        const target = credit(receiving, pre, 'receiver', team);
        if (target) { target.att += 1; if (complete) { target.comp += 1; target.yds += yards; } if (td) target.td += 1; }
      } else if (kind === 'fumble_lost') {
        t.turnovers += 1;
      } else if (kind === 'punt') {
        t.punts += 1;
      } else if (kind === 'field_goal_attempt') {
        t.fgAtt += 1;
      }
    }
    const byYards = (map) => Object.values(map).sort((a, b) => b.yds - a.yds || a.name.localeCompare(b.name));
    const teamRows = [
      ['Plays', (t) => t.plays],
      ['Rushes · yards', (t) => `${t.rushAtt} · ${t.rushYds}`],
      ['Pass comp/att', (t) => `${t.passComp}/${t.passAtt}`],
      ['Pass yards', (t) => t.passYds],
      ['Sacks', (t) => t.sacks],
      ['Turnovers', (t) => t.turnovers],
      ['Punts', (t) => t.punts],
      ['Field goal attempts', (t) => t.fgAtt],
    ];
    const playerTable = (title, list, columns) => (list.length ? `<div class="sec">${title}</div><table class="stat"><thead><tr><th>Player</th>${columns.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${list.map((p) => `<tr><th>${ESC(p.name)} <small>${ESC(p.team)}</small></th>${columns.map(([, value]) => `<td>${ESC(value(p))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');
    this.$('#tab-box').innerHTML = `<div class="sec">Team totals</div><table class="stat"><thead><tr><th></th>${teams.map((team) => `<th>${ESC(TEAM_NAMES[team] || team)}</th>`).join('')}</tr></thead><tbody>${teamRows.map(([label, value]) => `<tr><th>${label}</th>${teams.map((team) => `<td>${ESC(value(totals[team]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${playerTable('Passing', byYards(passing), [['C/ATT', (p) => `${p.comp}/${p.att}`], ['YDS', (p) => p.yds], ['TD', (p) => p.td]])}
      ${playerTable('Rushing', byYards(rushing), [['CAR', (p) => p.att], ['YDS', (p) => p.yds], ['TD', (p) => p.td]])}
      ${playerTable('Receiving', byYards(receiving), [['REC/TGT', (p) => `${p.comp}/${p.att}`], ['YDS', (p) => p.yds], ['TD', (p) => p.td]])}
      <p class="note">Through play ${this.boxCount ?? 0} of ${this.items.length}. Derived from the saved plays.Passing, rushing and receiving come from the named players on each play. Not an official box score.</p>`;
  }

  renderScoreChart() {
    if (!this.model) return;
    const canvas = this.$('#wp');
    canvas.setAttribute('aria-label', `Saved ${TEAM_NAMES[this.home] || this.home} score by play`);
    canvas.title = 'Saved home-team score by play, not win probability';
    const dpr = Math.min(2, devicePixelRatio || 1);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    const max = Math.max(7, ...this.items.map(({ play }) => Number(play.state_after?.home_score ?? play.state_before.home_score ?? 0)));
    const x = (index) => this.items.length < 2 ? width / 2 : index / (this.items.length - 1) * width;
    const y = (score) => height - 5 - (score / max) * (height - 12);
    const token = (name) => getComputedStyle(this).getPropertyValue(name);
    g.strokeStyle = token('--rail');
    g.beginPath(); g.moveTo(0, height - 5); g.lineTo(width, height - 5); g.stroke();
    g.fillStyle = token('--dim');
    g.font = '10px "IBM Plex Mono", monospace';
    g.fillText(`${TEAM_NAMES[this.home] || this.home} points`, 4, 11);
    g.beginPath();
    this.items.forEach(({ play }, index) => {
      const score = Number(play.state_after?.home_score ?? play.state_before.home_score ?? 0);
      index ? g.lineTo(x(index), y(score)) : g.moveTo(x(index), y(score));
    });
    g.strokeStyle = this.model.game.teams[this.home].alt;
    g.lineWidth = 1.6;
    g.stroke();
    if (this.items[this.currentIndex]) {
      g.strokeStyle = token('--firstdown');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x(this.currentIndex), 0); g.lineTo(x(this.currentIndex), height); g.stroke();
    }
  }

  initializeRenderer() {
    if (!this.renderer) {
      this.renderer = new Renderer(this.$('#view'), this.model.game, { displayFont: '"Saira Condensed", "Arial Narrow", sans-serif', steadyCamera: true });
      this.renderer.setCamera('broadcast');
      this.renderer.resize();
    } else {
      this.renderer.game = this.model.game;
      this.renderer.kits = this.renderer.makeKits();
    }
  }

  selectPlay(index, { playClip = false } = {}) {
    if (!this.items.length) return;
    this.currentIndex = Math.max(0, Math.min(this.items.length - 1, index));
    const item = this.items[this.currentIndex];
    const play = item.play;
    this.currentRecord = null;
    this.currentSelection = null;
    this.updatePlayArt();
    this.clipPlaying = false;
    this.clipSeconds = 0;
    this.eventCursor = 0;
    this.audio.setPlay(null, null);
    this.scoreKey = null;
    this.endZoneAt = null;
    this.scoredIndex = null;
    this.boxCount = index;
    this.setScoreState(play);
    if (!this.$('#tab-box').hidden) this.renderBox();
    this.renderDrives();
    // only scroll the row when the drive list is its own scroller (desktop); on phones the
    // document scrolls, and scrolling it to the row moves the field on every play change
    const drives = this.$('#tab-drives');
    if (drives.scrollHeight > drives.clientHeight) this.$('.pl.on')?.scrollIntoView({ block: 'nearest' });
    this.setPlayText(play);
    this.renderPosition();
    if (!this.$('#tab-playbook').hidden) this.renderPlaybook();
    this.$('#ticker').replaceChildren();
    try {
      const selection = selectionForSlcPlay(this.model, item);
      const result = executeSelectedPlay(selection);
      if (result.failure) throw new Error(result.failure.message);
      if (!result.record?.frames?.length) throw new Error('Gridiron Physics returned no 3D frames for this play');
      this.currentSelection = selection;
      this.currentRecord = result.record;
      this.updatePlayArt();
      this.clipDuration = (this.currentRecord.frames.length - 1) / this.currentRecord.hz;
      const roster = this.currentRecord.roster.map((entry) => ({ id: entry.id, team: entry.team, slot: entry.slot }));
      this.renderer.setRoster(roster);
      this.renderer.clearTrail();
      this.renderer.showFlag(null);
      if (this.selectedPlayer && !roster.some((entry) => entry.id === this.selectedPlayer)) {
        this.selectedPlayer = null;
        this.renderer.select(null);
      }
      const sourcePlay = selection.play;
      const firstDown = sourcePlay.kindGroup === 'kick' ? null
        : sourcePlay.los + sourcePlay.dir * (play.state_before.yards_to_go || 0);
      this.renderer.setLines(sourcePlay.los, firstDown);
      this.audio.setPlay(soundPlay(sourcePlay, play), this.currentRecord);
      this.setPlayText(play, selection);
      this.$('#loader').hidden = true;
      this.clipPlaying = playClip || this.continuous;
      this.lastFrame = null;
      if (!this.$('#tab-playbook').hidden) this.renderPlaybook();
      this.renderPosition();
    } catch (error) {
      this.currentSelection = null;
      this.currentRecord = null;
      this.clipPlaying = false;
      this.audio.setPlay(null, null);
      this.setPlayText(play, null, error.message);
      this.showLoader('3D play unavailable', error.message);
      this.updateStatus(`3D unavailable at play ${play.sequence}: ${error.message}`, true);
    }
    this.renderScoreChart();
  }

  // A clip started from a play row plays without the continuous run, so the button pauses that too.
  togglePlay() {
    this.setContinuous(!(this.continuous || this.clipPlaying));
  }

  setContinuous(value) {
    this.continuous = value;
    this.$('#play').textContent = this.continuous ? '❚❚' : '▶';
    this.$('#play').setAttribute('aria-label', this.continuous ? 'Pause game' : 'Play game');
    if (this.continuous && this.currentRecord) {
      if (this.clipSeconds >= this.clipDuration) this.clipSeconds = 0;
      this.clipPlaying = true;
      this.lastFrame = null;
    } else {
      this.clipPlaying = false;
    }
  }

  // Steps through the plays the active filter shows; crosses to the next seed when they run out.
  stepPlay(direction) {
    const index = this.visibleItems.findIndex((entry) => entry.index === this.currentIndex);
    const next = this.visibleItems[index + direction];
    if (next) this.selectPlay(next.index, { playClip: true });
    else if (direction > 0 && this.queueIndex + 1 < this.queue.length) this.loadSeed(this.queueIndex + 1, true).catch((error) => this.reportFailure(error));
  }

  advance() {
    if (!this.continuous || !this.autoAdvance) { this.clipPlaying = false; return; }
    const index = this.visibleItems.findIndex((entry) => entry.index === this.currentIndex);
    const next = this.visibleItems[index + 1];
    if (next) {
      this.selectPlay(next.index, { playClip: true });
      return;
    }
    if (this.queueIndex + 1 < this.queue.length) {
      this.loadSeed(this.queueIndex + 1, true).catch((error) => this.reportFailure(error));
      return;
    }
    this.setContinuous(false);
    this.setScoreState((this.visibleItems.at(-1) || this.items.at(-1)).play, true);
    this.updateStatus('End of saved SLC play record.');
  }

  addPhysicsEvent(event) {
    const names = (id) => this.model.game.players[id]?.short || this.model.game.players[id]?.name || id || '';
    const text = {
      throw: () => `Throw · ${names(event.by)}${event.to ? ` to ${names(event.to)}` : ''}`,
      catch: () => `Catch · ${names(event.by)}`,
      handoff: () => `Handoff · ${names(event.to)}`,
      tackle: () => `Tackle · ${names(event.by)}`,
      broken_tackle: () => `Broken tackle · ${names(event.on)}`,
      touchdown: () => `Touchdown · ${names(event.by)}`,
      interception: () => `Interception · ${names(event.by)}`,
      kick: () => `Kick · ${names(event.by)}`,
      fg_good: () => `Field goal good · ${event.distance} yd`,
      fg_miss: () => `Field goal missed · ${event.miss || ''}`,
    }[event.type]?.();
    if (text) this.pushTicker(text, ['touchdown', 'interception', 'fg_good', 'fg_miss'].includes(event.type));
  }

  animate(now) {
    if (this.lastFrame == null) this.lastFrame = now;
    const dt = Math.min(0.06, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.renderer) {
      if (this.currentRecord) {
        if (this.clipPlaying) this.clipSeconds = Math.min(this.clipDuration, this.clipSeconds + dt * this.speed);
        const time = this.currentRecord.t0 + this.clipSeconds;
        while (this.eventCursor < this.currentRecord.events.length && this.currentRecord.events[this.eventCursor].t <= time) {
          this.addPhysicsEvent(this.currentRecord.events[this.eventCursor++]);
        }
        this.audio.update(this.clipSeconds, this.clipPlaying);
        this.renderer.draw(this.currentRecord, time, this.clipPlaying ? dt * this.speed : 0);
        this.renderer.updateCamera(dt, { dir: this.currentSelection?.play?.dir ?? 1 });
        this.renderer.setPaths(this.currentRecord, Math.floor(this.clipSeconds * this.currentRecord.hz));
        this.setTagPositions();
        const atEnd = this.clipSeconds >= this.clipDuration;
        // the ball crossing a goal line (x below 0 or above 100) starts the touchdown clock; the score changes a moment later
        const ballX = this.renderer.ballPos?.x;
        if (this.endZoneAt == null && (ballX < 0 || ballX > 100)) this.endZoneAt = time;
        const scoreEvent = this.currentRecord.events.find((event) => event.type === 'touchdown' || event.type === 'fg_good');
        let scored;
        if (!scoreEvent) scored = atEnd;
        else if (scoreEvent.type === 'fg_good') scored = time >= scoreEvent.t;
        else scored = (this.endZoneAt != null && time >= this.endZoneAt + SCORE_DELAY_S) || atEnd;
        // once the score has changed for this play it stays changed, so the animation runs once
        if (this.scoredIndex === this.currentIndex) scored = true;
        else if (scored) this.scoredIndex = this.currentIndex;
        const scoreKey = `${this.currentIndex}:${scored}`;
        if (scoreKey !== this.scoreKey) {
          this.scoreKey = scoreKey;
          this.boxCount = this.currentIndex + (scored ? 1 : 0);
          this.setScoreState(this.items[this.currentIndex].play, scored, { animate: scored });
          if (!this.$('#tab-box').hidden) this.renderBox();
        }
        this.$('#scrub').value = String(Math.round(1000 * this.clipSeconds / Math.max(0.01, this.clipDuration)));
        if (atEnd && this.clipPlaying) {
          this.clipPlaying = false;
          if (this.continuous && this.autoAdvance) setTimeout(() => this.advance(), 450);
          else if (this.continuous) this.setContinuous(false);
        }
      }
      this.renderer.render();
    }
    this.frameId = requestAnimationFrame(this.animate);
  }

  setTeamLabels(record) {
    const teams = record.teams || {};
    this.home = teams.home || Object.values(record.team_identity || {}).find((entry) => entry.side === 'home')?.team;
    this.away = teams.away || Object.values(record.team_identity || {}).find((entry) => entry.side === 'away')?.team;
    this.rosterTeam = this.home;
    this.audio.homeTeam = this.home;
    this.$('#bug-away').setAttribute('aria-label', `${this.away} away score`);
    this.$('#bug-home').setAttribute('aria-label', `${this.home} home score`);
  }

  async loadSeed(nextQueueIndex, start = false) {
    this.queueIndex = nextQueueIndex;
    const seed = this.queue[this.queueIndex];
    this.updateStatus(`Loading saved SLC seed ${seed}…`);
    this.showLoader('Loading saved game', `Seed ${seed} · source outcomes preserved`);
    this.currentRecord = null;
    this.currentSelection = null;
    this.clipPlaying = false;
    this.clearTags();
    const response = await fetch(`${this.options.games}seed-${encodeURIComponent(seed)}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`seed ${seed} payload HTTP ${response.status}`);
    const sourcePayload = await response.json();
    if (Number(sourcePayload.record?.seed) !== Number(seed)) throw new Error(`seed identity mismatch for ${seed}`);
    const adapted = adaptLpGamePayload(sourcePayload, { requireCompleteRegulation: true });
    this.payload = { ...sourcePayload, record: adapted.record };
    const teamResponse = await fetch(this.options.roster, { cache: 'force-cache' });
    if (!teamResponse.ok) throw new Error(`local Gridiron roster/ratings snapshot HTTP ${teamResponse.status}`);
    const teamSnapshot = await teamResponse.json();
    this.model = prepareSlcPhysicsReplay(this.payload.record, teamSnapshot);
    this.setTeamLabels(this.payload.record);
    this.updateMeta();
    this.items = this.payload.record.drives.flatMap((drive) => drive.plays.map((play) => ({ play, drive })));
    this.currentIndex = -1;
    this.renderFilter();
    this.renderDrives();
    this.initializeRenderer();
    this.renderRoster();
    this.selectPlay(this.visibleItems[0]?.index ?? 0, { playClip: start || this.continuous || this.options.autoplay });
    if (start) this.setContinuous(true);
  }
}

if (!customElements.get('gridiron-replay')) customElements.define('gridiron-replay', GridironReplay);
