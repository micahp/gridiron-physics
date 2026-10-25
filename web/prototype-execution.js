import { simulatePlay } from '../engine/play.js';

/** Execute one selected scenario and preserve the director's support limits. */
export function executeSelectedPlay(selection) {
  const base = {
    schema_version: 'gridiron.play_execution.v1',
    selection_id: selection?.selection?.play_id ?? null,
    status: 'unsupported',
    predictive_success: false,
    unsupported_action_flags: selection?.execution_contract?.unsupported || [],
    outcome_anchor: selection?.action_policy_inputs?.outcome_anchor ?? null,
    failure: null,
    record: null,
  };
  try {
    if (!selection?.play || !selection?.players || !selection?.execution_contract) {
      throw new Error('selection is missing play, player, or support-contract inputs');
    }
    const record = simulatePlay({ players: selection.players }, selection.play);
    if (!record) {
      return { ...base, failure: { code: 'unsupported_action', message: 'physics director returned no record' } };
    }
    const teamCounts = record.roster.reduce((counts, p) => {
      counts[p.team] = (counts[p.team] || 0) + 1;
      return counts;
    }, {});
    const rosterIds = record.roster.map((p) => p.id);
    if (record.roster.length !== 22 || new Set(rosterIds).size !== 22 ||
        teamCounts[selection.play.off] !== 11 || teamCounts[selection.play.def] !== 11) {
      return { ...base, failure: { code: 'invalid_physics_roster', message: 'execution did not spawn 11 unique players per team' } };
    }
    return {
      ...base,
      status: selection.execution_contract.mode || 'constrained_visualization',
      trajectory: { roster: record.roster, stride: record.stride, frames: record.frames, t0: record.t0, hz: record.hz },
      interactions: record.events,
      resulting_state: record.end,
      statistics: record.stats,
      record,
    };
  } catch (error) {
    return { ...base, failure: { code: 'physics_execution_failed', message: error.message } };
  }
}
