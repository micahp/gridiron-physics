import {
  MATCHUP_INDEX_URL,
  MATCHUPS,
  findMatchup,
  matchupFixture,
  summarizeMatchup,
} from './e2-matchup-index.js';

const rowsNode = document.querySelector('#matchup-rows');
const statusNode = document.querySelector('#index-status');
const errorNode = document.querySelector('#index-error');

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function render(index, failure = null) {
  rowsNode.replaceChildren();
  for (const matchup of MATCHUPS) {
    const entry = index ? findMatchup(index, matchup.slug) : null;
    const summary = entry ? summarizeMatchup(entry, matchup) : { score: null, drives: null, plays: null };
    const row = document.createElement('tr');
    addCell(row, matchup.label);
    addCell(row, summary.score ? `${summary.score.away} – ${summary.score.home}` : 'Unavailable', 'score');
    addCell(row, summary.drives ?? 'Unavailable');
    addCell(row, summary.plays ?? 'Unavailable');
    const action = document.createElement('td');
    const fixture = entry ? matchupFixture(entry) : null;
    if (fixture) {
      const link = document.createElement('a');
      link.href = `e2-game-viewer.html?matchup=${encodeURIComponent(matchup.slug)}`;
      link.textContent = 'Open play by play';
      link.setAttribute('aria-label', `Open ${matchup.label} play by play`);
      action.append(link);
    } else {
      const note = document.createElement('span');
      note.className = 'state';
      note.textContent = entry ? 'Play record not indexed' : 'LP entry not published';
      action.append(note);
    }
    row.append(action);
    rowsNode.append(row);
  }
  if (failure) {
    errorNode.hidden = false;
    errorNode.textContent = `LP matchup index is not available yet (${failure}). The six requested matchups remain listed with unavailable values.`;
    statusNode.textContent = 'Showing fallback matchup list; no generated records were substituted.';
  } else {
    errorNode.hidden = false;
    errorNode.textContent = 'A missing matchup stays unavailable; the page does not reuse another game’s score or play record.';
    statusNode.textContent = `Loaded LP matchup index · ${MATCHUPS.filter((item) => findMatchup(index, item.slug)).length} of ${MATCHUPS.length} requested matchups found.`;
  }
}

try {
  const response = await fetch(MATCHUP_INDEX_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const index = await response.json();
  render(index);
} catch (error) {
  render(null, error.message);
}
