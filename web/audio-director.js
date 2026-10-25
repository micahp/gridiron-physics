// Audio cues are driven by the same 120 Hz replay events as the visualisation.
// Planner is pure so timeline, scrubbing and game-outcome behaviour can be tested.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const FOOTBALL_SOUNDS = Object.freeze({
  ambience: 'web/audio/stadium-bed.ogg',
  cheer: 'web/audio/crowd-cheer.ogg',
  bigCheer: 'web/audio/crowd-big-cheer.ogg',
  boo: 'web/audio/crowd-murmur.ogg',
  snap: 'web/audio/snap.ogg',
  hit1: 'web/audio/pads-1.ogg',
  hit2: 'web/audio/pads-2.ogg',
  foot1: 'web/audio/cleat-1.ogg',
  foot2: 'web/audio/cleat-2.ogg',
  whistle: 'web/audio/whistle.ogg',
  click: 'web/audio/ui-select.ogg',
});

// These are synthetic/gamey stand-ins, not recorded football gear. Keep the
// files for controlled A/B audition only; never play them during games until
// we have listened to and approved proper football-specific replacements.
export const SUSPENDED_FOLEY = new Set(['snap', 'hit1', 'hit2', 'whistle']);
function cue(at, name, gain = 1) { return { at: Math.max(0, at), name, gain }; }
export function planFootballSound(play, record, homeTeam) {
  if (!play) return [];
  const cues = [];
  const scrimmage = play.type === 'scrimmage';
  const duration = Math.max(0.4, record?.frames && record?.hz ? (record.frames.length - 1) / record.hz : 2.5);
  if (scrimmage) {
    const snapTime = Math.max(0, -(record?.t0 ?? -0.6));
    cues.push(cue(snapTime, 'snap', 0.7));
    // Only one pair of audible cleats; never 22 overlapping footsteps.
    if (play.kind === 'run') cues.push(cue(snapTime + 0.55, 'foot1', 0.22));
    for (const ev of record?.events || []) {
      const at = Number(ev.t) - Number(record?.t0 ?? 0);
      if (!Number.isFinite(at) || at < 0 || at > duration + 0.25) continue;
      if (ev.type === 'hit' || ev.type === 'tackle') cues.push(cue(at, ev.type === 'tackle' ? 'hit2' : 'hit1', clamp((ev.closing ?? 3) / 8, 0.3, 0.78)));
      else if (ev.type === 'catch') cues.push(cue(at, 'hit1', 0.14));
      else if (ev.type === 'whistle') cues.push(cue(at, 'whistle', 0.55));
    }
    if (!(record?.events || []).some(e => e.type === 'whistle')) cues.push(cue(duration - 0.16, 'whistle', 0.5));
  } else if (play.type === 'punt' || play.type === 'field_goal' || play.type === 'kickoff') {
    if (record?.events?.length) {
      // A replayed kick has real snap, kick, catch and whistle times.
      for (const ev of record.events) {
        const at = Number(ev.t) - Number(record.t0 ?? 0);
        if (!Number.isFinite(at) || at < 0 || at > duration + 0.25) continue;
        if (ev.type === 'snap' || ev.type === 'kick') cues.push(cue(at, 'hit1', 0.3));
        else if (ev.type === 'catch' || ev.type === 'hit') cues.push(cue(at, 'hit1', 0.2));
        else if (ev.type === 'tackle') cues.push(cue(at, 'hit2', 0.6));
        else if (ev.type === 'whistle') cues.push(cue(at, 'whistle', 0.55));
      }
    } else {
      // Text-only kick: no physical event times to follow.
      cues.push(cue(0.25, 'hit1', 0.22));
      cues.push(cue(1.6, 'whistle', 0.48));
    }
  }

  let react = null;
  if (play.touchdown || (play.type === 'field_goal' && play.good) || play.type === 'punt' && play.touchdown) {
    const scoringTeam = play.scoring_team || play.offense;
    react = scoringTeam === homeTeam ? 'bigCheer' : 'boo';
  } else if (play.interception) {
    react = play.defense === homeTeam ? 'bigCheer' : 'boo';
  } else if (play.type === 'scrimmage' && Number(play.gain) >= Math.max(10, Number(play.togo) || 10)) {
    react = play.offense === homeTeam ? 'cheer' : null;
  } else if (play.type === 'field_goal' && !play.good) {
    react = play.offense === homeTeam ? 'boo' : 'cheer';
  }
  if (react) cues.push(cue(Math.max(0.3, duration - 0.3), react, 0.55));
  return cues.filter(c => !SUSPENDED_FOLEY.has(c.name)).sort((a, b) => a.at - b.at);
}

// Browser-only audio mixer. No audio is loaded or played until the user clicks
// Enable Audio; browser autoplay rules remain intact.
export class FootballAudio {
  constructor(homeTeam, manifest = FOOTBALL_SOUNDS) {
    this.homeTeam = homeTeam;
    this.manifest = manifest;
    this.enabled = false;
    this.volume = 0.6;
    this.context = null;
    this.buffers = new Map();
    this.cues = [];
    this.nextCue = 0;
    this.lastTime = 0;
    this.ambientSource = null;
    this.ambientGain = null;
  }
  async enable() {
    if (this.enabled) return true;
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    this.context ||= new Ctx();
    await this.context.resume();
    this.enabled = true;
    const names = Object.keys(this.manifest).filter(name => !SUSPENDED_FOLEY.has(name));
    await Promise.all(names.map(async name => {
      if (this.buffers.has(name)) return;
      try {
        const res = await fetch(this.manifest[name]);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const buffer = await this.context.decodeAudioData(data);
        this.buffers.set(name, buffer);
      } catch { /* unavailable optional clip stays silent */ }
    }));
    if (this.enabled) this.startAmbience();
    return this.buffers.size > 0;
  }
  startAmbience() {
    if (!this.enabled || !this.context || this.ambientSource) return;
    const buffer = this.buffers.get('ambience');
    if (!buffer) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = this.volume * 0.18;
    source.connect(gain).connect(this.context.destination);
    source.start();
    this.ambientSource = source;
    this.ambientGain = gain;
  }
  disable() {
    this.enabled = false;
    if (this.ambientSource) { try { this.ambientSource.stop(); } catch {} }
    this.ambientSource = null;
    this.ambientGain = null;
  }
  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.ambientGain) this.ambientGain.gain.value = this.volume * 0.18;
  }
  playCue(name, volume = 1) {
    if (SUSPENDED_FOLEY.has(name) || !this.enabled || !this.context) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    // Mild deterministic-to-listener variation without changing football RNG.
    source.playbackRate.value = name.startsWith('hit') || name.startsWith('foot') ? 0.94 + Math.random() * 0.12 : 1;
    gain.gain.value = this.volume * clamp(volume, 0, 1);
    source.connect(gain).connect(this.context.destination);
    source.start();
  }
  setPlay(play, record) {
    this.cues = planFootballSound(play, record, this.homeTeam);
    this.nextCue = 0;
    this.lastTime = 0;
  }
  update(seconds, playing) {
    if (!this.enabled || !playing) return;
    if (seconds + 0.03 < this.lastTime) {
      this.nextCue = this.cues.findIndex(c => c.at >= seconds);
      if (this.nextCue < 0) this.nextCue = this.cues.length;
    }
    // Skipping/scrubbing over the play must not fire a backlog of hits.
    const jumped = seconds - this.lastTime > 0.4;
    while (this.nextCue < this.cues.length && this.cues[this.nextCue].at <= seconds + 0.03) {
      const current = this.cues[this.nextCue++];
      if (!jumped || current.at >= seconds - 0.14) this.playCue(current.name, current.gain);
    }
    this.lastTime = seconds;
  }
}
