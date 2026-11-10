export const TEAM_PERIOD_FIELD_END_VERSION = 'team-period-field-end-v1';

const PERIODS = new Set(['Q1', 'Q2', 'Q3', 'Q4']);

/**
 * Resolve an offense-relative ball spot using an explicit, versioned
 * team-by-period field-end assignment. No direction defaults are applied.
 */
export function resolveAssignedFieldSpot({ assignment, teamId, period, yardline100 }) {
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
    throw new TypeError('A versioned team-period field-end assignment is required');
  }
  if ('home_dir' in assignment || 'away_dir' in assignment || 'home' in assignment || 'away' in assignment) {
    throw new TypeError('Implicit home/away field direction is not accepted; assign actual team IDs by period');
  }
  if (assignment.assignment_version !== TEAM_PERIOD_FIELD_END_VERSION) {
    throw new TypeError(`Unsupported or missing field-end assignment version: ${String(assignment.assignment_version ?? 'null')}`);
  }
  if (typeof assignment.source !== 'string' || assignment.source.trim() === '') {
    throw new TypeError('Field-end assignment source must be explicit');
  }
  if (!Array.isArray(assignment.assignments)) {
    throw new TypeError('Field-end assignment must contain explicit team-period assignments');
  }
  if (typeof teamId !== 'string' || teamId.trim() === '' || /^(home|away)$/i.test(teamId)) {
    throw new TypeError('An actual team ID is required; home/away labels are not team assignments');
  }
  if (!PERIODS.has(period)) {
    throw new TypeError(`Unsupported or missing period assignment key: ${String(period ?? 'null')}`);
  }
  if (!Number.isFinite(yardline100) || yardline100 < 0 || yardline100 > 100) {
    throw new RangeError('yardline_100 must be a finite value from 0 through 100');
  }

  const byTeamPeriod = new Map();
  for (const entry of assignment.assignments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Each field-end assignment must be an object');
    }
    if (typeof entry.team_id !== 'string' || entry.team_id.trim() === '' || /^(home|away)$/i.test(entry.team_id)) {
      throw new TypeError('Each field-end assignment must use an actual team ID');
    }
    if (!PERIODS.has(entry.period)) {
      throw new TypeError(`Unsupported field-end assignment period: ${String(entry.period ?? 'null')}`);
    }
    if (entry.dir !== 1 && entry.dir !== -1) {
      throw new TypeError(`Field-end dir for ${entry.team_id} ${entry.period} must be +1 or -1`);
    }
    const key = `${entry.team_id}\u0000${entry.period}`;
    if (byTeamPeriod.has(key)) {
      throw new TypeError(`Duplicate field-end assignment for ${entry.team_id} ${entry.period}`);
    }
    byTeamPeriod.set(key, entry.dir);
  }

  const key = `${teamId}\u0000${period}`;
  if (!byTeamPeriod.has(key)) {
    throw new TypeError(`No versioned field-end assignment exists for team ${teamId} in ${period}`);
  }
  const dir = byTeamPeriod.get(key);
  const los = dir === 1 ? 100 - yardline100 : yardline100;
  return { dir, los };
}
