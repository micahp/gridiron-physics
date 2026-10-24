import { auditFootballState } from './lp-game-state-audit.js';
import { auditConversionSource } from './conversion-source-semantics.js';

const DATA_ROOT = 'docs/fixtures/e3/observed-2022-2025/';
const $ = (selector) => document.querySelector(selector);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function csvRows(text) {
  const lines = text.trim().split(/\r?\n/);
  const parseLine = (line) => {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { field += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { fields.push(field); field = ''; }
      else field += char;
    }
    fields.push(field);
    return fields;
  };
  const headers = parseLine(lines.shift());
  return lines.map((line) => Object.fromEntries(parseLine(line).map((value, i) => [headers[i], value])));
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readTable(manifest, filename) {
  const entry = manifest.tables?.[filename];
  if (!entry || entry.file !== filename) throw new Error(`E3 manifest is missing ${filename}`);
  const response = await fetch(DATA_ROOT + filename);
  if (!response.ok) throw new Error(`${filename} HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== entry.sha256) throw new Error(`${filename} SHA-256 mismatch`);
  return csvRows(new TextDecoder().decode(bytes));
}

function rowsFor(rows, metric) {
  return rows.filter((row) => row.metric === metric).map((row) => ({
    value: row.value,
    count: Number(row.count),
    denominator: Number(row.denominator),
  }));
}

function histogram(rows, bins) {
  return bins.map((bin) => ({
    label: bin.label,
    count: rows.filter((row) => bin.contains(Number(row.value))).reduce((sum, row) => sum + row.count, 0),
    denominator: rows[0]?.denominator ?? 0,
  }));
}

function renderTable(container, headers, rows) {
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const header of headers) headerRow.append(element('th', header));
  head.append(headerRow);
  table.append(head);
  const body = document.createElement('tbody');
  for (const values of rows) {
    const row = document.createElement('tr');
    for (const value of values) row.append(element('td', value));
    body.append(row);
  }
  table.append(body);
  container.replaceChildren(table);
}

function renderUnsupported(record) {
  const list = $('#e3-unsupported-list');
  list.replaceChildren();
  for (const rule of record.unsupported_rules ?? []) list.append(element('li', rule, 'rule-chip'));
  if (!list.children.length) list.append(element('li', 'No unsupported rules supplied', 'rule-chip'));
}

function renderStateAudit(record) {
  const audit = auditFootballState(record);
  const box = $('#state-audit-summary');
  const codes = Object.entries(audit.counts).sort(([a], [b]) => a.localeCompare(b));
  box.replaceChildren();
  box.append(element('p', `Independent audit: ${audit.finding_count} findings across ${codes.length} categories. This audit does not consume LP rules_matrix.`));
  renderTable($('#state-audit-table'), ['Finding category', 'Count'], codes.map(([code, count]) => [code, count]));
  return audit;
}

function renderConversionAudit(payload) {
  const producerFiles = payload.source?.producer_file_sha256 ?? {};
  const sourceDescription = payload.source?.data_source?.kick_table ?? payload.sources?.kick_table ?? '';
  const audit = auditConversionSource({ producerFileSha256: producerFiles, sourceDescription });
  const panel = $('#conversion-source-status');
  panel.className = audit.passed ? 'audit-label pass' : 'audit-label fail';
  panel.textContent = audit.passed
    ? 'Conversion source audit PASS: publisher conversion result fields are pinned for both try types.'
    : `Conversion source audit FAIL for the viewer-pinned LP source (${payload.source?.base_commit ?? 'raw source'}): ${audit.findings.map((finding) => finding.message).join(' ')}`;
  return audit;
}

function renderPlayComparison(generated, observedRows) {
  const observedAll = rowsFor(observedRows, 'play_type').filter((row) => ['pass', 'run', 'punt', 'field_goal'].includes(row.value));
  const observedDenominator = observedAll.reduce((sum, row) => sum + row.count, 0);
  const generatedCounts = { pass: 0, run: 0, punt: 0, field_goal: 0 };
  for (const drive of generated.drives ?? []) for (const play of drive.plays ?? []) {
    const kind = play.decision?.type;
    const category = kind === 'dropback' ? 'pass' : kind === 'field_goal_attempt' ? 'field_goal' : kind;
    if (Object.hasOwn(generatedCounts, category)) generatedCounts[category] += 1;
  }
  const n = Object.values(generatedCounts).reduce((sum, count) => sum + count, 0);
  const rows = ['pass', 'run', 'punt', 'field_goal'].map((kind) => {
    const observed = observedAll.find((row) => row.value === kind);
    const generatedCount = generatedCounts[kind];
    return [kind, `${generatedCount}/${n} (${(100 * generatedCount / n).toFixed(1)}%)`,
      `${observed?.count ?? 0}/${observedDenominator} (${(100 * (observed?.count ?? 0) / observedDenominator).toFixed(1)}%)`];
  });
  renderTable($('#e3-play-table'), ['Aligned category', 'Generated · n=144', `Observed · n=${observedDenominator}`], rows);
  $('#e3-play-note').textContent = `Both denominators include only pass, run, punt, and field-goal attempts. Observed PBP source rows: ${observedRows.find((row) => row.metric === 'play_type')?.denominator ?? 'unknown'}; excluded categories are not silently redistributed.`;
}

function driveBin(value) {
  if (value <= 2) return '0–2';
  if (value <= 4) return '3–4';
  if (value <= 6) return '5–6';
  if (value <= 9) return '7–9';
  return '10+';
}

function renderDriveComparison(generated, observedRows) {
  const observed = rowsFor(observedRows, 'offensive_play_rows_per_drive');
  const bins = [
    { label: '0–2', contains: (value) => value <= 2 },
    { label: '3–4', contains: (value) => value >= 3 && value <= 4 },
    { label: '5–6', contains: (value) => value >= 5 && value <= 6 },
    { label: '7–9', contains: (value) => value >= 7 && value <= 9 },
    { label: '10+', contains: (value) => value >= 10 },
  ];
  const observedBins = histogram(observed, bins);
  const generatedBins = Object.fromEntries(bins.map((bin) => [bin.label, 0]));
  for (const drive of generated.drives ?? []) generatedBins[driveBin(drive.plays?.length ?? 0)] += 1;
  const generatedDenom = (generated.drives ?? []).length;
  renderTable($('#e3-drive-table'), ['Offensive plays per drive', `Generated · n=${generatedDenom}`, `Observed · n=${observed[0]?.denominator ?? 0}`],
    bins.map((bin, index) => [bin.label, `${generatedBins[bin.label]}/${generatedDenom}`,
      `${observedBins[index].count}/${observedBins[index].denominator}`]));
  $('#e3-drive-note').textContent = 'Observed uses offensive_play_rows_per_drive (23,579 drives); generated counts nested E2 play records per drive (24 drives). These are descriptive marginals.';
}

function binSpec(metric) {
  if (metric === 'total_points') return [
    { label: '<30', contains: (v) => v < 30 }, { label: '30–39', contains: (v) => v >= 30 && v < 40 },
    { label: '40–49', contains: (v) => v >= 40 && v < 50 }, { label: '50–59', contains: (v) => v >= 50 && v < 60 },
    { label: '60+', contains: (v) => v >= 60 },
  ];
  if (metric === 'absolute_margin') return [
    { label: '0–6', contains: (v) => v <= 6 }, { label: '7–13', contains: (v) => v >= 7 && v <= 13 },
    { label: '14–20', contains: (v) => v >= 14 && v <= 20 }, { label: '21+', contains: (v) => v >= 21 },
  ];
  return [
    { label: '≤18', contains: (v) => v <= 18 }, { label: '19–22', contains: (v) => v >= 19 && v <= 22 },
    { label: '23–26', contains: (v) => v >= 23 && v <= 26 }, { label: '27+', contains: (v) => v >= 27 },
  ];
}

function renderGameComparison(generated, observedRows) {
  const definitions = [
    ['total_points', generated.points.A + generated.points.B],
    ['absolute_margin', Math.abs(generated.points.A - generated.points.B)],
    ['nonnull_drive_groups_per_game', generated.drives.length],
  ];
  const rows = [];
  for (const [metric, generatedValue] of definitions) {
    const observed = rowsFor(observedRows, metric);
    const denom = observed[0]?.denominator ?? 0;
    const bins = binSpec(metric);
    const counts = histogram(observed, bins);
    const average = observed.reduce((sum, row) => sum + Number(row.value) * row.count, 0) / denom;
    for (const [index, bin] of bins.entries()) {
      rows.push([metric, bin.label, `${generatedValue} · ${bin.contains(generatedValue) ? 1 : 0}/1`,
        `${counts[index].count}/${denom} (${(100 * counts[index].count / denom).toFixed(1)}%)`, average.toFixed(2)]);
    }
  }
  renderTable($('#e3-game-table'), ['Game metric', 'Observed bin', 'Generated value · in-bin count', 'Observed · count / 1,087', 'Observed mean'], rows);
  $('#e3-game-note').textContent = 'Each observed bin is shown. The generated value comes from one seed, so this is a descriptive location, not a distributional fit or forecast evaluation.';
}

export async function renderE3Comparison(payload) {
  const panel = $('#e3-comparison');
  panel.hidden = false;
  const record = payload?.record ?? payload;
  renderStateAudit(record);
  renderUnsupported(record);
  renderConversionAudit(payload?.record ? payload : { record });
  try {
    const manifestResponse = await fetch('docs/fixtures/e3/MANIFEST.json');
    if (!manifestResponse.ok) throw new Error(`E3 manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const [playRows, driveRows, gameRows] = await Promise.all([
      readTable(manifest, 'play_distribution.csv'),
      readTable(manifest, 'drive_distribution.csv'),
      readTable(manifest, 'game_distribution.csv'),
    ]);
    renderPlayComparison(record, playRows);
    renderDriveComparison(record, driveRows);
    renderGameComparison(record, gameRows);
    const census = manifest.clock_clamp_census;
    $('#e3-clock-caveat').textContent = `${census.clamped_plays} / ${census.plays} plays (${(100 * census.share).toFixed(1)}%) were clamped at the sampled quarter boundary. This is E1 boundary bookkeeping, not realistic predictive clock behavior.`;
    $('#e3-source-label').textContent = `Observed reference: ${manifest.population.nfl_pbp_rows.toLocaleString()} PBP rows · ${manifest.population.drives.toLocaleString()} drives · ${manifest.population.games.toLocaleString()} games · ${manifest.source.commit.slice(0, 12)}.`;
    $('#e3-load-status').textContent = 'E3 reference tables verified by SHA-256.';
  } catch (error) {
    $('#e3-load-status').textContent = `E3 reference unavailable: ${error.message}`;
    $('#e3-load-status').className = 'audit-label fail';
  }
}
