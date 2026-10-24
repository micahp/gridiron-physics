export const MATCHUP_INDEX_URL = 'docs/fixtures/e2/matchup-index.json';

export const MATCHUPS = [
  { slug: 'bengals-at-ravens', label: 'Bengals at Ravens', away: 'Cincinnati Bengals', home: 'Baltimore Ravens', awayKey: 'CIN', homeKey: 'BAL' },
  { slug: 'dolphins-at-jets', label: 'Dolphins at Jets', away: 'Miami Dolphins', home: 'New York Jets', awayKey: 'MIA', homeKey: 'NYJ' },
  { slug: '49ers-at-falcons', label: '49ers at Falcons', away: 'San Francisco 49ers', home: 'Atlanta Falcons', awayKey: 'SF', homeKey: 'ATL' },
  { slug: 'buccaneers-at-panthers', label: 'Buccaneers at Panthers', away: 'Tampa Bay Buccaneers', home: 'Carolina Panthers', awayKey: 'TB', homeKey: 'CAR' },
  { slug: 'packers-at-lions', label: 'Packers at Lions', away: 'Green Bay Packers', home: 'Detroit Lions', awayKey: 'GB', homeKey: 'DET' },
  { slug: 'cowboys-at-eagles', label: 'Cowboys at Eagles', away: 'Dallas Cowboys', home: 'Philadelphia Eagles', awayKey: 'DAL', homeKey: 'PHI' },
];

const TEAM_ALIASES = {
  CIN: ['cin', 'cincinnati', 'cincinnatibengals', 'bengals'],
  BAL: ['bal', 'baltimore', 'baltimoreravens', 'ravens'],
  MIA: ['mia', 'miami', 'miamidolphins', 'dolphins'],
  NYJ: ['nyj', 'newyorkjets', 'jets'],
  SF: ['sf', '49ers', 'sanfrancisco', 'sanfrancisco49ers'],
  ATL: ['atl', 'atlanta', 'atlantafalcons', 'falcons'],
  TB: ['tb', 'tampa', 'tampabay', 'tampabaybuccaneers', 'buccaneers'],
  CAR: ['car', 'carolina', 'carolinapanthers', 'panthers'],
  GB: ['gb', 'greenbay', 'greenbaypackers', 'packers'],
  DET: ['det', 'detroit', 'detroitlions', 'lions'],
  DAL: ['dal', 'dallas', 'dallascowboys', 'cowboys'],
  PHI: ['phi', 'philadelphia', 'philadelphiaeagles', 'eagles'],
};

const compact = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function teamValue(value) {
  if (value && typeof value === 'object') {
    for (const key of ['abbr', 'abbreviation', 'code', 'short_name', 'nickname', 'name', 'team_name', 'team']) {
      if (value[key] !== undefined) {
        const result = teamValue(value[key]);
        if (result) return result;
      }
    }
    return '';
  }
  const token = compact(value);
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(token)) return key;
  }
  return token.toUpperCase();
}

function indexRows(index) {
  if (Array.isArray(index)) return index;
  for (const key of ['matchups', 'games', 'fixtures', 'items']) {
    if (Array.isArray(index?.[key])) return index[key];
  }
  return [];
}

function rowTeams(row) {
  const matchup = row.matchup && typeof row.matchup === 'object' ? row.matchup : {};
  const teams = row.teams && typeof row.teams === 'object' ? row.teams : {};
  const away = row.away_team ?? row.awayTeam ?? row.visitor_team ?? row.visitor ?? matchup.away ?? teams.away;
  const home = row.home_team ?? row.homeTeam ?? row.host_team ?? row.host ?? matchup.home ?? teams.home;
  return { away: teamValue(away), home: teamValue(home) };
}

function rowHasMatchup(row, expected) {
  const ids = [row.matchup_id, row.matchup_slug, row.slug, row.key, row.id, row.matchup, row.label]
    .filter((value) => typeof value === 'string').map(compact);
  if (ids.includes(compact(expected.slug)) || ids.includes(compact(expected.label))) return true;
  const { away, home } = rowTeams(row);
  if (away && home) return away === expected.awayKey && home === expected.homeKey;
  const searchable = compact(JSON.stringify(row));
  return TEAM_ALIASES[expected.awayKey].some((alias) => searchable.includes(alias))
    && TEAM_ALIASES[expected.homeKey].some((alias) => searchable.includes(alias));
}

export function findMatchup(index, slug) {
  const expected = MATCHUPS.find((item) => item.slug === slug);
  if (!expected) return null;
  return indexRows(index).find((row) => row && rowHasMatchup(row, expected)) ?? null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function scorePair(row, expected) {
  const raw = row.final_score ?? row.finalScore ?? row.score ?? row.final ?? {};
  const home = firstValue(row.home_score, row.homeScore, row.home_points, row.score_home, raw.home, raw.home_score, raw.homeScore);
  const away = firstValue(row.away_score, row.awayScore, row.away_points, row.score_away, raw.away, raw.away_score, raw.awayScore);
  const valid = (value) => value !== undefined && Number.isFinite(Number(value));
  if (valid(away) && valid(home)) return { away: Number(away), home: Number(home) };
  const record = row.record ?? row.game_record ?? row.payload?.record ?? row.payload?.game ?? {};
  const points = row.points ?? record.points ?? {};
  const sides = row.score_sides ?? row.team_labels ?? row.teams ?? {};
  const sideA = teamValue(sides.A ?? sides.a ?? row.team_a ?? row.teamA);
  const sideB = teamValue(sides.B ?? sides.b ?? row.team_b ?? row.teamB);
  if (valid(points.A) && valid(points.B)) {
    if (sideA === expected.homeKey && sideB === expected.awayKey) return { away: Number(points.B), home: Number(points.A) };
    if (sideA === expected.awayKey && sideB === expected.homeKey) return { away: Number(points.A), home: Number(points.B) };
  }
  return null;
}

export function summarizeMatchup(row, expected) {
  const record = row.record ?? row.game_record ?? row.payload?.record ?? row.payload?.game ?? {};
  const drivesRaw = firstValue(row.drive_count, row.drives_count, row.drives, record.drives?.length);
  const playsRaw = firstValue(row.play_count, row.plays_count, row.total_plays, row.plays,
    Array.isArray(record.drives) ? record.drives.reduce((n, drive) => n + (drive.plays?.length ?? 0), 0) : undefined);
  const numericCount = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    score: scorePair(row, expected),
    drives: numericCount(Array.isArray(drivesRaw) ? drivesRaw.length : drivesRaw),
    plays: numericCount(Array.isArray(playsRaw) ? playsRaw.length : playsRaw),
  };
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /^[a-z]+:/i.test(value)) return null;
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some((part) => part === '..' || part === '')) return null;
  return value;
}

export function matchupFixture(row) {
  const artifact = row.fixture ?? row.artifact ?? row.payload_artifact ?? row.payload ?? row;
  const file = safeRelativePath(firstValue(
    row.fixture_file, row.envelope_file, row.payload_file, row.game_file, row.record_file, row.game_record_path, row.record_path,
    artifact.file, artifact.path, artifact.relative_path,
  ));
  const sha256 = firstValue(row.fixture_sha256, row.envelope_sha256, row.payload_sha256, row.game_record_sha256, row.record_sha256, row.sha256,
    artifact.sha256, artifact.payload_sha256);
  if (!file || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) return null;
  const sourceFile = safeRelativePath(firstValue(
    row.upstream_source_file, row.source_payload_file, row.lp_payload_file,
    artifact.upstream_source_file, artifact.source_payload_file,
  ));
  const sourceSha = firstValue(row.upstream_source_sha256, row.source_payload_sha256, row.lp_payload_sha256,
    artifact.upstream_source_sha256, artifact.source_payload_sha256);
  const fixture = {
    file,
    sha256,
    ...(sourceFile && typeof sourceSha === 'string' ? {
      upstream_source_file: sourceFile,
      upstream_source_sha256: sourceSha,
    } : {}),
  };
  return fixture;
}

export function matchupLpSource(index, row, fallback) {
  const rowSource = row?.lp_source ?? row?.provenance ?? row?.source ?? {};
  const safeRowSource = rowSource && typeof rowSource === 'object' && !Array.isArray(rowSource) ? rowSource : {};
  return { ...(fallback ?? {}), ...(index?.lp_source ?? {}), ...safeRowSource };
}
