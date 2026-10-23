// Audit of the 35 player ratings: provenance, engine use, and estimate uncertainty.
//
// Classification and provenance are written out by hand from pipeline/ratings.py and engine/*.js (line numbers
// are checked by the script against the source, so a moved line fails loudly). Uncertainty numbers are computed
// from the frozen 2026 Week 7 snapshot, data/teams/matchup-2026-10-22.json.
//
// Usage: node scripts/rating_audit.mjs [--md out.md] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const snapshot = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8'));
const engine = readFileSync(`${ROOT}/engine/play.js`, 'utf8').split('\n');
const world = readFileSync(`${ROOT}/engine/world.js`, 'utf8').split('\n');
const ratingsPy = readFileSync(`${ROOT}/pipeline/ratings.py`, 'utf8').split('\n');

// class: physical | physical-health | skill | decision | generated-unused (set below from engine use)
// basis: measured (combine/40 directly), imputed-possible (combine with imputed drills), production, usage, formula, placeholder
// engine: [{ file, line, must }] — `must` is a substring the line must contain, so a moved line fails loudly
const A = {
  ACC: { cls: 'physical', basis: 'imputed-possible', src: '10-yd time t10 from the 40 through the sprint model (ratings.py:494); ACC_CURVE interp minus 0.6/yr past 29 (ratings.py:501)', engine: [], effect: 'acceleration (documented as separate from top speed)', validation: 'none in repo' },
  AGI: { cls: 'physical', basis: 'imputed-possible', src: 'z of 3-cone and shuttle (league pool, ratings.py:503–505) → 72 + 11z − 0.5/yr past 29 (ratings.py:506); physics alat uses the same z (ratings.py:525)', engine: [{ file: 'play.js', line: 496, must: 'R.AGI' }], effect: 'cutting and avoidance; physics alat = max(4.5, 7.2 + 1.1·agi_z) comes from the drills directly (ratings.py:525)', validation: 'none in repo' },
  AWR: { cls: 'decision', basis: 'usage', src: 'experience curve and draft prior (ratings.py:552); blended with playing-time share (ratings.py:557); QB blend with sack, INT and EPA (ratings.py:571)', engine: [{ file: 'play.js', line: 1224, must: 'R.AWR' }, { file: 'play.js', line: 1233, must: 'R.AWR' }], effect: 'decision quality: interception and catch odds', validation: 'none in repo' },
  BCV: { cls: 'skill', basis: 'production', src: 'RB: repa, first downs, YPC (ratings.py:576); QB: rush (ratings.py:572); others: placeholder 48 (ratings.py:563–565)', engine: [], effect: 'ball-carrier vision (documented)', validation: 'none in repo' },
  BSH: { cls: 'skill', basis: 'production', src: 'EDGE/IDL/LB: TFL and tackles per game with STR adjustment (ratings.py:623); CB/S: 0.6·STR + 10 (ratings.py:626)', engine: [{ file: 'play.js', line: 260, must: 'R.BSH' }, { file: 'play.js', line: 858, must: 'R.BSH' }], effect: 'defender block-shedding against run blocks', validation: 'none in repo' },
  BTK: { cls: 'skill', basis: 'production', src: 'RB: YPC, first downs, YAC with mass adjustment (ratings.py:578); WR/TE: 0.5·ELU + 0.5·STR + 6·mass z (ratings.py:594)', engine: [{ file: 'play.js', line: 359, must: 'R.BTK' }, { file: 'play.js', line: 368, must: 'R.BTK' }, { file: 'play.js', line: 374, must: 'R.BTK' }], effect: 'breaking tackles', validation: 'none in repo' },
  CAR: { cls: 'skill', basis: 'production', src: 'QB: constant 70 (ratings.py:573); RB: fumble rate (ratings.py:580); WR/TE: fumble rate (ratings.py:596); all others: placeholder 48 (ratings.py:563–565)', engine: [], effect: 'ball security (documented)', validation: 'none in repo' },
  CIT: { cls: 'skill', basis: 'production', src: 'WR/TE: catch over expected and first downs, adjusted by JMP (ratings.py:591); all others keep the placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 1223, must: 'R.CIT' }], effect: 'documented nowhere; the engine uses it as a defender interception term', validation: 'none in repo' },
  CTH: { cls: 'skill', basis: 'production', src: 'WR: catch over expected, base 74 (ratings.py:589); TE: base 68 (ratings.py:589); RB: base 66 (ratings.py:581); CB/S/LB: MCV − 14 (ratings.py:632); others: placeholder 48', engine: [{ file: 'play.js', line: 1232, must: 'R.CTH' }], effect: 'catch probability when the ball is in the window', validation: 'none in repo' },
  ELU: { cls: 'skill', basis: 'production', src: 'QB: 0.5·AGI + 0.5·rush production (ratings.py:574); RB: 0.45·AGI + 0.55·explosive and YAC (ratings.py:577); WR/TE: 0.5·AGI + 0.5·YAC (ratings.py:593)', engine: [{ file: 'play.js', line: 359, must: 'R.ELU' }, { file: 'play.js', line: 368, must: 'R.ELU' }, { file: 'play.js', line: 374, must: 'R.ELU' }, { file: 'play.js', line: 496, must: 'R.ELU' }], effect: 'avoiding tacklers; tackle odds use max(BTK, ELU)', validation: 'none in repo' },
  FMV: { cls: 'skill', basis: 'production', src: 'EDGE/IDL/LB: rush production with AGI adjustment (ratings.py:622); others: placeholder 48', engine: [{ file: 'play.js', line: 260, must: 'R.FMV' }, { file: 'play.js', line: 688, must: 'R.FMV' }, { file: 'play.js', line: 858, must: 'R.FMV' }], effect: 'finesse pass-rush and block-shedding', validation: 'none in repo' },
  IBL: { cls: 'skill', basis: 'placeholder', src: 'RB: equal to RBK (ratings.py:585); TE/WR: equal to RBK (ratings.py:600); OL: mean of PBK and RBK (ratings.py:610); others: placeholder 48', engine: [], effect: 'inline blocking (documented nowhere in the engine)', validation: 'none; not read by engine' },
  INJ: { cls: 'physical-health', basis: 'placeholder', src: 'constant 85 for every player (ratings.py:560)', engine: [], effect: 'injury risk; no injury model in the engine', validation: 'none; constant' },
  JMP: { cls: 'physical', basis: 'measured', src: 'vertical jump through JMP_CURVE (ratings.py:510); feeds CIT and SPC adjustments (ratings.py:591–592); reach uses the vertical drill directly (ratings.py:527)', engine: [], effect: 'leaping; feeds CIT and SPC adjustments (ratings.py:591–592); reach uses the vertical drill directly (ratings.py:527)', validation: 'none in repo' },
  KAC: { cls: 'skill', basis: 'production', src: 'K: field goal and PAT percentages (ratings.py:637); P: inside-20 and net (ratings.py:641)', engine: [], effect: 'kick accuracy (documented)', validation: 'none in repo; not read by engine' },
  KPW: { cls: 'skill', basis: 'production', src: 'K: long field goals (ratings.py:638); P: gross punting (ratings.py:640)', engine: [{ file: 'play.js', line: 1324, must: 'R.KPW' }, { file: 'play.js', line: 1357, must: 'R.KPW' }], effect: 'kick hang time', validation: 'none in repo' },
  MCV: { cls: 'skill', basis: 'production', src: 'CB/S/LB: coverage production with SPD adjustment (ratings.py:629); EDGE/IDL: 30 + 0.2·SPD (ratings.py:634)', engine: [], effect: 'man coverage (documented)', validation: 'none in repo; not read by engine' },
  PBK: { cls: 'skill', basis: 'imputed-possible', src: 'OL: tools and draft/experience, confidence 0 (ratings.py:606–608); RB: RBK + 2 (ratings.py:584); WR/TE: blocking base − 4 (ratings.py:599); QB and others: placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 259, must: 'R.PBK' }, { file: 'play.js', line: 859, must: 'R.PBK' }, { file: 'play.js', line: 1634, must: 'PBK' }], effect: 'pass blocking; line 1634 reads the QB\'s PBK for sack odds, not the blocker\'s', validation: 'none in repo; line 1634 is a defect (see report)' },
  PMV: { cls: 'skill', basis: 'production', src: 'EDGE/IDL/LB: rush production with STR adjustment (ratings.py:621); CB/S: constant 35 (ratings.py:625); others: placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 260, must: 'R.PMV' }, { file: 'play.js', line: 688, must: 'R.PMV' }, { file: 'play.js', line: 858, must: 'R.PMV' }, { file: 'play.js', line: 1634, must: 'R.PMV' }], effect: 'pass rush and sack odds; block-shedding', validation: 'none in repo' },
  POW: { cls: 'skill', basis: 'production', src: 'defenders: 0.45·STR + 0.3·SPD + production + 10·mass z − 5 (ratings.py:617); others: placeholder 48 (ratings.py:563–565)', engine: [], effect: 'power (documented)', validation: 'none in repo; not read by engine' },
  PRC: { cls: 'decision', basis: 'production', src: 'defenders: 0.6·AWR + 0.4·production (ratings.py:618); other positions: equal to AWR (ratings.py:558)', engine: [], effect: 'pursuit (undocumented; mostly a copy of AWR)', validation: 'none in repo; not read by engine' },
  PRS: { cls: 'skill', basis: 'placeholder', src: 'LB/CB/S: 0.5·MCV + 0.5·STR + 8 (ratings.py:631); others: placeholder 48 (ratings.py:563–565)', engine: [], effect: 'press coverage (documented)', validation: 'none in repo; not read by engine' },
  PUR: { cls: 'skill', basis: 'production', src: 'defenders: 0.5·SPD + production (tackles, TFL) (ratings.py:616); others: placeholder 48 (ratings.py:563–565)', engine: [], effect: 'pursuit (documented)', validation: 'none in repo; not read by engine' },
  RBK: { cls: 'skill', basis: 'imputed-possible', src: 'OL: tools (ratings.py:609); TE/WR: 46 + 0.35·STR + 14·mass z (+14 for TE) (ratings.py:598); RB/FB: 40 + 0.4·STR + 12·mass z (+25 for FB) (ratings.py:583)', engine: [{ file: 'play.js', line: 259, must: 'R.RBK' }, { file: 'play.js', line: 859, must: 'R.RBK' }], effect: 'run blocking', validation: 'none in repo' },
  RET: { cls: 'skill', basis: 'formula', src: 'RB: 0.5·SPD + 0.5·ELU (ratings.py:586); WR: 0.55·SPD + 0.45·ELU (ratings.py:601); defenders: 0.6·SPD + 0.4·AGI − 10 (ratings.py:635)', engine: [], effect: 'returns (documented)', validation: 'none in repo; not read by engine' },
  RTE: { cls: 'skill', basis: 'production', src: 'RB: CTH − 8 (ratings.py:582); WR/TE: target share, first downs and yards per target with AGI adjustment (ratings.py:590)', engine: [], effect: 'route running; the probe scenarios assign routes, so this is never read', validation: 'none in repo; not read by engine' },
  SPC: { cls: 'skill', basis: 'production', src: 'WR/TE: deep production and catch over expected with JMP adjustment (ratings.py:592)', engine: [], effect: 'undocumented in RATINGS.md', validation: 'none; not read by engine' },
  SPD: { cls: 'physical', basis: 'measured-or-imputed-40', src: '40 time through SPD_CURVE (ratings.py:499), minus age penalty, minus 2 for QB (ratings.py:500)', engine: [], effect: 'the displayed speed; the simulator uses vmax from the 40 directly (ratings.py:518–519), not this rating', validation: 'none in repo' },
  STA: { cls: 'physical-health', basis: 'formula', src: '92 − 0.8·(age − 29)+ − 6 for IDL/OT/IOL (ratings.py:559)', engine: [], effect: 'stamina; the engine has no fatigue model', validation: 'none; not read by engine' },
  STR: { cls: 'physical', basis: 'measured-or-imputed-bench', src: 'measured bench z: 58 + 9·bench z + 0.11·(weight − 230) (ratings.py:509); drive force uses the same z (ratings.py:523)', engine: [{ file: 'play.js', line: 259, must: 'R.STR' }, { file: 'play.js', line: 260, must: 'R.STR' }], effect: 'strength in engagements; also sets drive force', validation: 'none in repo' },
  TAK: { cls: 'skill', basis: 'production', src: 'defenders: tackles, forced fumbles, TFL with mass adjustment (ratings.py:615); others: placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 362, must: 'R.TAK' }, { file: 'play.js', line: 368, must: 'R.TAK' }, { file: 'play.js', line: 374, must: 'R.TAK' }], effect: 'tackle odds (defender TAK minus carrier max(BTK, ELU))', validation: 'none in repo' },
  THA: { cls: 'skill', basis: 'production', src: 'QB: CPOE, yards per attempt, interception rate, EPA (ratings.py:569); non-QB: placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 1198, must: 'R.THA' }], effect: 'throw error scale (100 − THA)/100 at the aim point', validation: 'none in repo' },
  THP: { cls: 'skill', basis: 'production', src: 'QB: air yards, deep completions, YPA with broad jump adjustment (ratings.py:570); non-QB: placeholder 48 (ratings.py:563–565)', engine: [{ file: 'play.js', line: 1042, must: 'R.THP' }, { file: 'play.js', line: 1696, must: 'R.THP' }], effect: 'throw speed: 24 + 0.2·(THP − 75) m/s', validation: 'none in repo' },
  TRK: { cls: 'skill', basis: 'formula', src: 'RB: 0.5·STR + 0.5·BTK + 12·mass z (ratings.py:579); WR/TE: 0.6·STR + 14·mass z + 25 (ratings.py:595)', engine: [], effect: 'trucking (documented)', validation: 'none in repo; not read by engine' },
  ZCV: { cls: 'skill', basis: 'production', src: 'LB/CB/S: zone coverage production with AWR adjustment (ratings.py:630); EDGE/IDL: 30 + 0.2·SPD (ratings.py:634)', engine: [], effect: 'zone coverage (documented)', validation: 'none in repo; not read by engine' },
};

// Lines we cite must still contain the expected token; otherwise the audit refuses to render.
function checkEngineRefs() {
  const problems = [];
  for (const [attr, info] of Object.entries(A)) {
    for (const ref of info.engine) {
      const text = (ref.file === 'play.js' ? engine : world)[ref.line - 1] ?? '';
      if (!text.includes(ref.must)) problems.push(`${attr}: ${ref.file}:${ref.line} no longer contains ${ref.must}`);
    }
  }
  return problems;
}

function stats(attr) {
  const teams = ['NE', 'CHI'];
  const out = {};
  const all = [];
  for (const team of teams) {
    const roster = snapshot.teams[team].roster;
    const vals = roster.map((p) => p.ratings[attr]).filter((v) => typeof v === 'number');
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    out[team] = { n: vals.length, mean: +mean.toFixed(1), sd: +sd.toFixed(1) };
    for (const p of roster) all.push({ p, v: p.ratings[attr], c: p.rating_confidence_by_attribute?.[attr] ?? 0 });
  }
  const placeholder = all.filter(({ p, v }) => (p.rating_group === 'OT' || p.rating_group === 'IOL' || p.rating_group === 'IDL') ? v === 42 : v === 48).length;
  const evidence = all.filter(({ c }) => c >= 0.5).length;
  out.placeholder_share = +(placeholder / all.length).toFixed(2);
  out.evidence_share_conf_ge_0_5 = +(evidence / all.length).toFixed(2);
  return out;
}

function imputation() {
  const out = {};
  for (const team of ['NE', 'CHI']) {
    const roster = snapshot.teams[team].roster;
    const count = (d) => roster.filter((p) => (p.imputed_combine_drills || []).includes(d)).length;
    out[team] = { players: roster.length, forty: count('forty'), bench: count('bench'), vertical: count('vertical'), broad_jump: count('broad_jump'), cone: count('cone'), shuttle: count('shuttle') };
  }
  return out;
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (i % 2 === 0 ? [...acc, [v.replace(/^--/, ''), arr[i + 1]]] : acc), []));
  const problems = checkEngineRefs();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  const attrs = Object.keys(A).sort();
  const rows = attrs.map((attr) => {
    const engineLines = A[attr].engine.map((r) => `${r.file}:${r.line}`);
    const used = engineLines.length > 0;
    const cls = used ? A[attr].cls : (A[attr].cls === 'skill' || A[attr].cls === 'physical' || A[attr].cls === 'decision' || A[attr].cls === 'physical-health' ? A[attr].cls : A[attr].cls);
    return { attr, cls, used, ...A[attr], engine: engineLines, stats: stats(attr) };
  });
  const generated_unused = rows.filter((r) => !r.used).map((r) => r.attr);
  const report = { attributes: rows, generated_unused, engine_used: rows.filter((r) => r.used).map((r) => r.attr), imputation: imputation() };
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
  if (args.md) {
    const lines = [];
    lines.push('| attribute | class | used by engine (file:line) | basis | source and calculation | intended effect | validation |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of rows) lines.push(`| ${r.attr} | ${r.cls} | ${r.engine.length ? r.engine.join(', ') : 'none'} | ${r.basis} | ${r.src} | ${r.effect} | ${r.validation} |`);
    lines.push('');
    lines.push('| attribute | NE mean (sd) | CHI mean (sd) | placeholder share | evidence share (confidence ≥ 0.5) |');
    lines.push('|---|---|---|---|---|');
    for (const r of rows) lines.push(`| ${r.attr} | ${r.stats.NE.mean} (${r.stats.NE.sd}) | ${r.stats.CHI.mean} (${r.stats.CHI.sd}) | ${r.stats.placeholder_share} | ${r.stats.evidence_share_conf_ge_0_5} |`);
    writeFileSync(args.md, lines.join('\n') + '\n');
  }
  process.stdout.write(JSON.stringify({ attributes: rows.length, engine_used: report.engine_used.length, generated_unused: generated_unused.length }) + '\n');
}

main();
