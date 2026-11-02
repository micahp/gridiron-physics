const MANIFEST_URL = 'docs/fixtures/e2/min-det-realism/marketing-seeds.json';
const $ = (selector) => document.querySelector(selector);

function cell(row, value) {
  const node = document.createElement('td');
  node.textContent = value === null || value === undefined ? '—' : String(value);
  row.append(node);
}

async function load() {
  const status = $('#library-status');
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`marketing seed list HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.schema !== 'lp.nfl.slc-marketing-seeds.v1' || !Array.isArray(payload.seeds)) {
      throw new Error('marketing seed list has an unsupported schema');
    }
    const body = $('#seed-rows');
    const featured = payload.seeds.filter((item) => item.selection !== 'additional_realistic_scenario').slice(0, 5);
    if (featured.length === 5) {
      const button = $('#featured-replay');
      button.href = 'e2-seed-3d.html?playlist=featured&autoplay=1';
      button.hidden = false;
    }
    for (const item of payload.seeds) {
      const row = document.createElement('tr');
      cell(row, item.selection);
      cell(row, item.seed);
      cell(row, Number(item.realism_score).toFixed(1));
      cell(row, item.visual_interest_score);
      cell(row, item.replay_status);
      const linkCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = `e2-seed-3d.html?seed=${encodeURIComponent(item.seed)}&autoplay=1`;
      link.className = 'replay-button';
      link.setAttribute('aria-label', `Watch ${item.selection.replaceAll('_', ' ')} seed ${item.seed} in 3D`);
      link.textContent = '▶ Watch in 3D';
      linkCell.append(link);
      row.append(linkCell);
      body.append(row);
    }
    status.textContent = `${payload.seeds.length} replay-verified SLC scenarios · select a seed to watch its 3D physics reconstruction`;
  } catch (error) {
    status.textContent = 'Seed library unavailable';
    const panel = $('#library-error');
    panel.hidden = false;
    panel.textContent = error.message;
  }
}

load();
