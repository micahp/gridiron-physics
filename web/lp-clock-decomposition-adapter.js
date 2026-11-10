const MANIFEST_PATH = 'docs/fixtures/e3/lp-clock-decomposition/MANIFEST.json';
const SOURCE_DIR = 'docs/fixtures/e3/lp-clock-decomposition/';

const FIELD_MAP = Object.freeze({
  in_play_s: ['in_play_label', 'in_play_rule', 'seconds'],
  game_clock_delta_s: ['game_clock_delta_label', 'game_clock_delta_rule', 'seconds'],
  residual_s: ['residual_label', 'residual_rule', 'seconds'],
  real_snap_to_next_snap_s: ['real_snap_label', 'real_snap_rule', 'seconds'],
  stoppage_context: ['stoppage_label', 'stoppage_rule', 'string'],
  timeouts_remaining: ['timeouts_label', 'timeouts_rule', 'number'],
  penalty_clock_stop: ['penalty_label', 'penalty_rule', 'source_scalar'],
  two_minute_warning_event: ['warning_label', 'warning_rule', 'source_scalar'],
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field) throw new Error('Malformed LP clock CSV: quote inside unquoted field');
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Malformed LP clock CSV: unterminated quoted field');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function finiteNumber(raw, name) {
  if (raw === '') throw new Error(`LP clock field ${name} has a value label but no value`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`LP clock field ${name} is not finite numeric data`);
  return value;
}

function labelledValue(raw, label, rule, name, kind) {
  if (!['observed', 'inferred', 'unresolvable'].includes(label)) {
    throw new Error(`LP clock field ${name} has unsupported label ${label || '(blank)'}`);
  }
  if (!rule) throw new Error(`LP clock field ${name} is missing its source rule`);
  if (label === 'unresolvable') {
    if (raw !== '') throw new Error(`LP clock field ${name} has a value marked unresolvable`);
    return Object.freeze({ value: null, label, rule });
  }
  let value;
  if (kind === 'seconds' || kind === 'number') value = finiteNumber(raw, name);
  else if (kind === 'string') {
    if (!raw) throw new Error(`LP clock field ${name} has a value label but no value`);
    value = raw;
  } else {
    // The pinned LP source does not resolve these fields. Preserve any future
    // producer-supplied scalar verbatim; do not assume boolean or duration.
    if (raw === '') throw new Error(`LP clock field ${name} has a value label but no value`);
    value = raw;
  }
  return Object.freeze({ value, label, rule });
}

function parseFlag(raw, name) {
  if (raw === '') return null;
  if (raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`LP clock flag ${name} must be blank, 0, or 1`);
}

function rowObject(headers, values, lineNumber) {
  if (headers.length !== values.length) {
    throw new Error(`LP clock CSV row ${lineNumber} has ${values.length} cells; expected ${headers.length}`);
  }
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

export function parseLpClockCsv(text, manifest) {
  const rows = parseCsv(text);
  const headers = rows.shift()?.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '') : header);
  if (!headers || JSON.stringify(headers) !== JSON.stringify(manifest.csv_header)) {
    throw new Error('LP clock CSV header differs from the pinned source schema');
  }
  const ids = new Set();
  const output = rows.filter((cells) => !(cells.length === 1 && cells[0] === '')).map((cells, index) => {
    const raw = rowObject(headers, cells, index + 2);
    if (!raw.lp_game_id || !/^\d+$/.test(raw.lp_play_id)) {
      throw new Error(`LP clock CSV row ${index + 2} has an invalid composite LP key`);
    }
    const lpPlayId = Number(raw.lp_play_id);
    const key = `${raw.lp_game_id}\u0000${lpPlayId}`;
    if (ids.has(key)) throw new Error(`LP clock CSV has duplicate LP key ${raw.lp_game_id}/${lpPlayId}`);
    ids.add(key);
    const metrics = Object.fromEntries(Object.entries(FIELD_MAP).map(([name, [labelColumn, ruleColumn, kind]]) => [
      name,
      labelledValue(raw[name], raw[labelColumn], raw[ruleColumn], name, kind),
    ]));
    const row = {
      lp_game_id: raw.lp_game_id,
      lp_play_id: lpPlayId,
      week: finiteNumber(raw.week, 'week'),
      quarter: finiteNumber(raw.quarter, 'quarter'),
      metrics,
      flags: {
        out_of_bounds: parseFlag(raw.flag_out_of_bounds, 'flag_out_of_bounds'),
        timeout: parseFlag(raw.flag_timeout, 'flag_timeout'),
        penalty: parseFlag(raw.flag_penalty, 'flag_penalty'),
      },
      raw,
    };
    if (!Number.isInteger(row.week) || !Number.isInteger(row.quarter)) {
      throw new Error(`LP clock CSV row ${index + 2} has a non-integer week or quarter`);
    }
    return row;
  });
  if (output.length !== manifest.source.rows) {
    throw new Error(`LP clock CSV has ${output.length} rows; expected ${manifest.source.rows}`);
  }
  return output;
}

export function validateLpClockSummary(summary, rows, manifest) {
  if (rows.length !== manifest.source.rows) throw new Error('LP clock summary row denominator mismatch');
  for (const field of Object.keys(FIELD_MAP)) {
    const expected = summary.labels?.[field];
    if (!expected) throw new Error(`LP clock summary is missing ${field} label counts`);
    const actual = {};
    for (const row of rows) {
      const label = row.metrics[field].label;
      actual[label] = (actual[label] ?? 0) + 1;
    }
    if (JSON.stringify(Object.fromEntries(Object.entries(actual).sort()))
        !== JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))) {
      throw new Error(`LP clock summary label counts disagree for ${field}`);
    }
  }
  return true;
}

export function joinPhysicalTiming(physicalRecords, lpClockRows) {
  const sourceByKey = new Map();
  for (const row of lpClockRows) {
    const key = `${row.lp_game_id}\u0000${row.lp_play_id}`;
    if (sourceByKey.has(key)) throw new Error(`Duplicate LP clock key ${row.lp_game_id}/${row.lp_play_id}`);
    sourceByKey.set(key, row);
  }
  return physicalRecords.map((physical) => {
    if (physical.lp_join_status !== 'matched' || !physical.lp_game_id || physical.lp_play_id == null) {
      return { physical, join_status: 'no_lp_key', clock: null };
    }
    const key = `${physical.lp_game_id}\u0000${Number(physical.lp_play_id)}`;
    const clock = sourceByKey.get(key);
    if (!clock) return { physical, join_status: 'no_source_row', clock: null };
    if (Number(physical.week) !== clock.week) {
      throw new Error(`LP clock week disagrees for ${physical.lp_game_id}/${physical.lp_play_id}`);
    }
    return { physical, join_status: 'matched', clock };
  });
}

export function summarizeClockJoin(joined) {
  const counts = { matched: 0, no_lp_key: 0, no_source_row: 0 };
  const fields = Object.fromEntries(Object.keys(FIELD_MAP).map((name) => [name, {}]));
  for (const item of joined) {
    counts[item.join_status] += 1;
    if (!item.clock) continue;
    for (const [name, metric] of Object.entries(item.clock.metrics)) {
      fields[name][metric.label] = (fields[name][metric.label] ?? 0) + 1;
    }
  }
  return { counts, fields };
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readVerifiedBytes(fetchImpl, path, expectedSha) {
  const response = await fetchImpl(path);
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== expectedSha) throw new Error(`${path} SHA-256 mismatch: ${actualSha}`);
  return bytes;
}

export async function loadLpClockDecomposition(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('LP clock loader requires fetch');
  const response = await fetchImpl(MANIFEST_PATH);
  if (!response.ok) throw new Error(`LP clock manifest HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.consumer_schema !== 'gridiron.lp-clock-decomposition-consumer.v1') {
    throw new Error('Unsupported Gridiron LP clock consumer schema');
  }
  const csvBytes = await readVerifiedBytes(fetchImpl, SOURCE_DIR + 'e3-clock-decomposition.csv', manifest.source.artifact_sha256);
  const summaryBytes = await readVerifiedBytes(fetchImpl, SOURCE_DIR + 'e3-clock-decomposition-summary.json', manifest.source.summary_sha256);
  const rows = parseLpClockCsv(new TextDecoder().decode(csvBytes), manifest);
  const summary = JSON.parse(new TextDecoder().decode(summaryBytes));
  validateLpClockSummary(summary, rows, manifest);
  const physicalBytes = await readVerifiedBytes(fetchImpl, manifest.physical_cohort.file, manifest.physical_cohort.sha256);
  const physical = JSON.parse(new TextDecoder().decode(physicalBytes));
  if (physical.schema !== manifest.physical_cohort.schema || physical.plays?.length !== manifest.physical_cohort.records) {
    throw new Error('Physical timing cohort schema or record count differs from the pinned manifest');
  }
  const joined = joinPhysicalTiming(physical.plays, rows);
  return { manifest, rows, summary, physical, joined, joinSummary: summarizeClockJoin(joined) };
}
