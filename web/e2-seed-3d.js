// Film-room page: maps the URL onto the reusable <gridiron-replay> element's attributes.
// Attributes are set before the element module loads, so it reads them when it connects.
const params = new URLSearchParams(location.search);
const replay = document.querySelector('gridiron-replay');
if (params.get('playlist') === 'featured') replay.setAttribute('playlist', 'featured');
else if (params.has('seed')) replay.setAttribute('seed', params.get('seed'));
if (params.get('autoplay') === '1') replay.setAttribute('autoplay', '');
import('./gridiron-replay.js?v=8');
