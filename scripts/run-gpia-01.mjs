#!/usr/bin/env node
// Matched-seed factorial runner for GPIA-01. Each arm executes from its own
// detached worktree so module loading cannot mix implementation versions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REFS = { A: 'f031fd98', B: 'e1f98a4', C: '61eac5b4' };
const SCENARIOS = [
  'inside_zone', 'slant_flat_man', 'slant_flat_zone', 'four_verticals',
  'check_release', 'collapsing_pocket', 'forced_turnover',
];

function args(argv) {
  const out = { arms: {}, armNames: null, seeds: 1000, timestepSeeds: 100, output: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') out.help = true;
    else if (token === '--arm') {
      const [name, ref, ...extra] = (argv[++i] ?? '').split('=');
      if (!['A', 'B', 'C', 'D'].includes(name) || !ref || extra.length) throw new Error('--arm format is NAME=GIT_REF');
      out.arms[name] = ref;
    } else if (token === '--arms') {
      const names = (argv[++i] ?? '').split(',');
      if (!names.length || names.some((name) => !['A', 'B', 'C', 'D'].includes(name))
          || new Set(names).size !== names.length) throw new Error('--arms must be a comma-separated subset of A,B,C,D');
      out.armNames = names;
    } else if (token === '--seeds') out.seeds = positiveInt(argv[++i], '--seeds');
    else if (token === '--timestep-seeds') out.timestepSeeds = nonnegativeInt(argv[++i], '--timestep-seeds');
    else if (token === '--output') out.output = path.resolve(argv[++i] ?? '');
    else throw new Error(`unknown option: ${token}`);
  }
  return out;
}

function positiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function nonnegativeInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function usage() {
  process.stdout.write(`Usage: node scripts/run-gpia-01.mjs --arm A=REF --arm B=REF --arm C=REF --arm D=REF [options]\n       node scripts/run-gpia-01.mjs --arms A,B,C --arm A=REF --arm B=REF --arm C=REF [options]\n\nOptions:\n  --seeds N             Matched seeds per scenario and arm (default 1000)\n  --timestep-seeds N    Matched pass seeds per scenario, arm, and 60/120/240 Hz (default 100)\n  --output DIR          Output directory (default docs/experiments/gpia-01/<run-id>)\n\nD must name the combined candidate for a full factorial. Partial runs produce\narm summaries but omit four-arm contrasts.\n`);
}

function git(ref, ...extra) {
  return execFileSync('git', ['-C', ROOT, ...extra, ref], { encoding: 'utf8' }).trim();
}

function prepareArms(config) {
  const names = config.armNames ?? ['A', 'B', 'C', 'D'];
  const available = { ...DEFAULT_REFS, ...config.arms };
  const refs = {};
  for (const arm of names) {
    if (!available[arm]) throw new Error(`missing arm ${arm}; specify --arm ${arm}=GIT_REF`);
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${available[arm]}^{commit}`]);
    refs[arm] = git(available[arm], 'rev-parse');
  }
  if (new Set(Object.values(refs)).size !== Object.keys(refs).length) throw new Error('selected arms must resolve to distinct commits');
  return refs;
}

async function armRuntime(repo) {
  const importAt = (relative) => import(pathToFileURL(path.join(repo, relative)).href);
  const [{ simulateAutonomousPlay }, assignments, { buildSampleCall }] = await Promise.all([
    importAt('engine/autonomous/simulator.js'),
    importAt('engine/autonomous/example-assignments.js'),
    importAt('test/autonomous-fixtures.mjs'),
  ]);
  return { simulateAutonomousPlay, ...assignments, buildSampleCall };
}

function makeCall(runtime, scenario, seed) {
  const isRun = scenario === 'inside_zone' || scenario === 'forced_turnover';
  const coverage = scenario === 'slant_flat_man' || scenario === 'check_release' ? 'man' : 'zone';
  const concept = scenario === 'four_verticals' ? 'four_verticals' : 'slant_flat';
  const call = runtime.buildSampleCall({
    family: isRun ? 'run' : 'pass', concept: isRun ? 'inside_zone' : 'assigned',
    snap_type: 'shotgun', coverage: coverage === 'man' ? 'cover_1' : 'cover_3',
    direction: 'right', front: 'nickel_over',
  });
  call.play_id = `gpia01:${scenario}:${seed}`;
  call.seed = seed;
  call.situation.yardline_100 = scenario === 'forced_turnover' ? 40 : 45;
  call.assignments = isRun
    ? runtime.exampleRunAssignments('right')
    : runtime.exampleAssignments(concept, coverage, 'right');
  call.player_evaluation_mode = 'shared_snapshot';
  call.output_mode = 'result_only';

  if (scenario === 'check_release') call.assignments.defense.MLB = { kind: 'rush' };
  if (scenario === 'collapsing_pocket') {
    for (const slot of ['LT', 'LG', 'C', 'RG', 'RT', 'RB']) {
      call.player_profiles[call.offense.lineup[slot]].ratings.PBK = 30;
      call.player_profiles[call.offense.lineup[slot]].ratings.RBK = 30;
    }
    for (const slot of ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB']) {
      const ratings = call.player_profiles[call.defense.lineup[slot]].ratings;
      ratings.BSH = 95; ratings.PMV = 95; ratings.FMV = 95; ratings.SPD = 88;
    }
  }
  if (scenario === 'forced_turnover') {
    call.player_profiles[call.offense.lineup.RB].ratings.CAR = 1;
    for (const id of Object.values(call.defense.lineup)) {
      const ratings = call.player_profiles[id].ratings;
      ratings.TAK = 99; ratings.STR = 99; ratings.PRC = 99;
    }
  }
  return call;
}

function digest(result) {
  const outcome = result.result ?? {};
  const events = result.events ?? [];
  return {
    status: result.status,
    ending: outcome.event ?? null,
    yards: outcome.yards_gained ?? null,
    turnover: outcome.turnover ?? null,
    completion: outcome.completion ?? null,
    fumble: outcome.fumble?.recovery_side ?? null,
    event_counts: Object.fromEntries(['throw', 'catch', 'interception', 'sack', 'fumble',
      'fumble_recovery', 'tackle', 'broken_tackle', 'throw_away'].map((type) => [
      type, events.filter((event) => event.type === type).length,
    ])),
    reconciliation_ok: result.diagnostics?.reconciliation?.ok ?? null,
    outcome_inputs: result.diagnostics?.outcome_inputs ?? null,
  };
}

function statsFor(rows) {
  const complete = rows.filter((row) => row.result.status === 'complete');
  const rate = (fn) => complete.length ? complete.filter(fn).length / complete.length : null;
  const passRows = complete.filter((row) => row.result.event_counts.throw > 0
    || row.result.event_counts.interception > 0 || row.result.event_counts.sack > 0);
  const attempts = passRows.reduce((sum, row) => sum + row.result.event_counts.throw, 0);
  const completions = passRows.reduce((sum, row) => sum + row.result.event_counts.catch, 0);
  const yards = complete.map((row) => row.result.yards).filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (q) => yards.length ? yards[Math.round((yards.length - 1) * q)] : null;
  return {
    attempted: rows.length, completed: complete.length, failed: rows.length - complete.length,
    pass_plays: passRows.length,
    pass_attempts: attempts,
    completions,
    completion_rate: attempts ? completions / attempts : null,
    interception_rate: passRows.length ? passRows.filter((row) => row.result.event_counts.interception > 0).length / passRows.length : null,
    sack_rate: passRows.length ? passRows.filter((row) => row.result.event_counts.sack > 0).length / passRows.length : null,
    fumble_rate: rate((row) => row.result.event_counts.fumble > 0),
    mean_yards: yards.length ? yards.reduce((sum, value) => sum + value, 0) / yards.length : null,
    yards_p10: quantile(0.1), yards_p50: quantile(0.5), yards_p90: quantile(0.9),
    reconciliation_failures: rows.filter((row) => row.result.reconciliation_ok === false).length,
    outcome_input_leaks: rows.filter((row) => row.result.outcome_inputs?.length).length,
  };
}

async function main() {
  const config = args(process.argv.slice(2));
  if (config.help) return usage();
  const refs = prepareArms(config);
  const runId = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const output = config.output ?? path.join(ROOT, 'docs/experiments/gpia-01', runId);
  fs.mkdirSync(output, { recursive: true });
  if (fs.readdirSync(output).length) throw new Error(`output directory is not empty: ${output}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpia01-'));
  const rowsByCell = new Map();
  const timestepByCell = new Map();
  const metadata = {
    experiment: 'GPIA-01', created_at: new Date().toISOString(), root_commit: git('HEAD', 'rev-parse'),
    refs, seeds_per_cell: config.seeds, timestep_seeds: config.timestepSeeds,
    arms: Object.keys(refs), factorial_complete: ['A', 'B', 'C', 'D'].every((arm) => refs[arm]),
    scenarios: SCENARIOS, timestep_hz: [60, 120, 240],
    timestep_scope: 'pass scenarios only; inside-zone executor currently exposes a fixed physics step',
  };
  fs.writeFileSync(path.join(output, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  try {
    for (const [arm, ref] of Object.entries(refs)) {
      const repo = path.join(temp, arm);
      execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', repo, ref], { stdio: 'ignore' });
      const runtime = await armRuntime(repo);
      for (const scenario of SCENARIOS) {
        const rows = [];
        for (let i = 0; i < config.seeds; i++) {
          const seed = `gpia01-${scenario}-${String(i + 1).padStart(4, '0')}`;
          const call = makeCall(runtime, scenario, seed);
          let result;
          try { result = digest(runtime.simulateAutonomousPlay(call)); }
          catch (error) { result = { status: 'exception', error: String(error) }; }
          const row = { arm, ref, scenario, seed, physics_hz: null, result };
          rows.push(row);
          fs.appendFileSync(path.join(output, 'plays.jsonl'), `${JSON.stringify(row)}\n`);
        }
        rowsByCell.set(`${arm}/${scenario}`, rows);
      }
      // Timestep sensitivity is currently exposed only by the pass executor.
      for (const scenario of SCENARIOS.filter((name) => name !== 'inside_zone' && name !== 'forced_turnover')) {
        for (const hz of [60, 120, 240]) for (let i = 0; i < config.timestepSeeds; i++) {
          const seed = `gpia01-timestep-${scenario}-${String(i + 1).padStart(4, '0')}`;
          const call = makeCall(runtime, scenario, seed);
          const validated = (await import(pathToFileURL(path.join(repo, 'engine/autonomous/schema.js')).href))
            .validatePlayInput(call);
          const { scenarioFromCall } = await import(pathToFileURL(path.join(repo, 'engine/autonomous/simulator.js')).href);
          const lowLevel = scenarioFromCall(validated).config;
          lowLevel.physicsHz = hz;
          const { simulatePassPlay } = await import(pathToFileURL(path.join(repo, 'engine/autonomous/passing.js')).href);
          const { toResultRecord, reconcileResult } = await import(pathToFileURL(path.join(repo, 'engine/autonomous/results.js')).href);
          let result;
          try {
            const record = toResultRecord(validated, simulatePassPlay(lowLevel));
            record.diagnostics.reconciliation = reconcileResult(record);
            result = digest(record);
          }
          catch (error) { result = { status: 'exception', error: String(error) }; }
          const row = { arm, ref, scenario, seed, physics_hz: hz, result };
          const cell = `${arm}/${scenario}/${hz}Hz`;
          if (!timestepByCell.has(cell)) timestepByCell.set(cell, []);
          timestepByCell.get(cell).push(row);
          fs.appendFileSync(path.join(output, 'timestep.jsonl'), `${JSON.stringify(row)}\n`);
        }
      }
      execFileSync('git', ['-C', ROOT, 'worktree', 'remove', repo], { stdio: 'ignore' });
    }
  } finally {
    for (const arm of Object.keys(refs)) {
      const repo = path.join(temp, arm);
      if (fs.existsSync(repo)) {
        try { execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', repo], { stdio: 'ignore' }); } catch {}
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const summaries = {};
  for (const [cell, rows] of rowsByCell) summaries[cell] = statsFor(rows);
  fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summaries, null, 2)}\n`);
  const metrics = ['completion_rate', 'interception_rate', 'sack_rate', 'fumble_rate', 'mean_yards'];
  const contrasts = {};
  for (const scenario of Object.keys(refs).length === 4 ? SCENARIOS : []) {
    contrasts[scenario] = {};
    for (const metric of metrics) {
      const values = Object.fromEntries(['A', 'B', 'C', 'D'].map((arm) => [arm, summaries[`${arm}/${scenario}`][metric]]));
      const subtract = (left, right) => values[left] == null || values[right] == null ? null : values[left] - values[right];
      contrasts[scenario][metric] = {
        values, B_minus_A: subtract('B', 'A'), C_minus_A: subtract('C', 'A'),
        D_minus_B: subtract('D', 'B'), D_minus_C: subtract('D', 'C'),
        interaction_D_minus_B_minus_C_plus_A: ['A', 'B', 'C', 'D'].some((arm) => values[arm] == null)
          ? null : values.D - values.B - values.C + values.A,
      };
    }
  }
  const contrastReport = Object.keys(contrasts).length ? contrasts : {
    status: 'incomplete_factorial', available_arms: Object.keys(refs),
    missing_arms: ['A', 'B', 'C', 'D'].filter((arm) => !refs[arm]),
  };
  fs.writeFileSync(path.join(output, 'contrasts.json'), `${JSON.stringify(contrastReport, null, 2)}\n`);
  const timestepSummaries = {};
  for (const [cell, rows] of timestepByCell) timestepSummaries[cell] = statsFor(rows);
  fs.writeFileSync(path.join(output, 'timestep-summary.json'), `${JSON.stringify(timestepSummaries, null, 2)}\n`);
  process.stdout.write(`GPIA-01 complete: ${output}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
