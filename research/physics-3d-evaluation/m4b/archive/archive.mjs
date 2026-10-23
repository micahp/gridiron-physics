import * as THREE from '../../../../web/vendor/three.module.js';
import { BODY_LAYOUT } from '../../scenarios.js';

const $ = (id) => document.getElementById(id);
const manifestUrl = '../results/archive-index.json';
const manifest = await fetch(manifestUrl).then((response) => {
  if (!response.ok) throw new Error(`Archive manifest returned ${response.status}`);
  return response.json();
});
const profileMap = new Map(manifest.profiles.map((profile) => [profile.id, profile]));
const records = manifest.records;
const cache = new Map();
const rigs = {};
let leftReplay = null, rightReplay = null;
let currentTimeSeconds = 0, playing = false, lastPlayMs = 0;

function fillSelect(select, rows, valueOf, labelOf, selected) {
  select.replaceChildren();
  for (const row of rows) {
    const option = document.createElement('option');
    option.value = valueOf(row); option.textContent = labelOf(row);
    if (option.value === selected) option.selected = true;
    select.append(option);
  }
}

function unique(values) { return [...new Set(values)]; }
const scenarios = unique(records.map((row) => row.scenarioId)).map((id) => ({ id,
  title: records.find((row) => row.scenarioId === id)?.scenarioTitle ?? id,
  category: records.find((row) => row.scenarioId === id)?.category ?? 'stress',
}));
fillSelect($('scenario'), scenarios, (row) => row.id, (row) => `${row.category} · ${row.title}`, scenarios[0]?.id);
fillSelect($('seed'), unique(records.map((row) => row.seed)), String, String, String(records[0]?.seed ?? 41027));
for (const side of ['left', 'right']) {
  const engines = unique(records.map((row) => row.engine));
  const profilesByKey = new Map();
  for (const row of records) profilesByKey.set(`${row.simulationVersion}|${row.sourceCommit}`, {
    id: row.simulationVersion, commit: row.sourceCommit, key: `${row.simulationVersion}|${row.sourceCommit}`,
    title: profileMap.get(row.simulationVersion)?.title ?? row.simulationVersion,
  });
  const profiles = [...profilesByKey.values()];
  fillSelect($(`${side}-engine`), engines, String, (value) => value === 'rapier3d-compat' ? 'Rapier 3D' : 'Jolt',
    side === 'left' ? 'rapier3d-compat' : 'jolt-physics-js');
  const activeRight = profiles.find((row) => row.id === 'proxy-v2-compound') ?? profiles[1] ?? profiles[0];
  fillSelect($(`${side}-version`), profiles, (row) => row.key,
    (row) => `${row.title} · ${row.commit.slice(0, 8)}`,
    side === 'left' ? profiles[0]?.key : activeRight?.key);
}

function makeRig(canvasId) {
  const canvas = $(canvasId);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#172322');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight(0xe1f0e8, 0x343b2d, 2.05));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-5, 9, 8); scene.add(key);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: '#284438', roughness: 1 }));
  field.rotation.x = -Math.PI / 2; field.position.y = -0.025; scene.add(field);
  const markings = new THREE.Group(); scene.add(markings);
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#779080', transparent: true, opacity: 0.5 });
  for (let x = -36; x <= 36; x += 5) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.002, -19), new THREE.Vector3(x, 0.002, 19)]);
    markings.add(new THREE.Line(geometry, lineMaterial));
  }
  const centerLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-40, 0.003, 0), new THREE.Vector3(40, 0.003, 0)]);
  markings.add(new THREE.Line(centerLine, lineMaterial));
  const actorGroup = new THREE.Group(); scene.add(actorGroup);
  const debugGroup = new THREE.Group(); scene.add(debugGroup);
  const actors = new Map();
  let replay = null;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
    drawAt(currentTimeSeconds);
  };
  const initialRect = canvas.getBoundingClientRect();
  renderer.setSize(initialRect.width || 800, initialRect.height || 480, false);
  camera.aspect = (initialRect.width || 800) / (initialRect.height || 480); camera.updateProjectionMatrix();
  window.addEventListener('resize', resize);
  const clearActors = () => {
    for (const child of [...actorGroup.children, ...debugGroup.children]) {
      child.traverse?.((node) => { node.geometry?.dispose(); if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose()); else node.material?.dispose(); });
      actorGroup.remove(child); debugGroup.remove(child);
    }
    actors.clear();
  };
  const clearDebug = () => {
    while (debugGroup.children.length) {
      const child = debugGroup.children.at(-1);
      debugGroup.remove(child);
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose()); else child.material?.dispose();
    }
  };
  const makePlayer = (spec, geometryKind) => {
    const root = new THREE.Group();
    const color = spec.team === 'defense' ? '#f18467' : '#71c6ef';
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const headMaterial = new THREE.MeshStandardMaterial({ color: '#26333a', roughness: 0.62, metalness: 0.12 });
    const parts = geometryKind === 'single-capsule' ? [{ part: 'player-capsule', shape: 'capsule', pos: [0, 0, 0], halfHeight: 0.55, radius: 0.27 }] : BODY_LAYOUT;
    for (const part of parts) {
      const geometry = part.shape === 'sphere' ? new THREE.SphereGeometry(part.radius, 16, 12)
        : new THREE.CapsuleGeometry(part.radius, part.halfHeight * 2, 5, 10);
      const mesh = new THREE.Mesh(geometry, part.part === 'head' ? headMaterial : bodyMaterial);
      mesh.position.set(...part.pos);
      if (part.axis === 'x') mesh.rotation.z = -Math.PI / 2;
      root.add(mesh);
      const wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#e8f0ec', wireframe: true, transparent: true, opacity: 0.52 }));
      wire.position.copy(mesh.position); wire.rotation.copy(mesh.rotation); wire.visible = false; wire.userData.collider = true; root.add(wire);
    }
    actorGroup.add(root);
    return { root, color };
  };
  const load = (record, payload) => {
    clearActors(); replay = { record, payload, data: payload.replay };
    const geometryKind = profileMap.get(record.simulationVersion)?.geometry ?? payload.archiveMetadata.playerGeometry;
    for (const spec of payload.initialState.players) actors.set(spec.id, makePlayer(spec, geometryKind));
    if (payload.initialState.football) {
      const geometry = new THREE.SphereGeometry(1, 20, 16);
      const material = new THREE.MeshStandardMaterial({ color: '#c5965d', roughness: 0.52 });
      const ball = new THREE.Mesh(geometry, material); ball.scale.set(0.29, 0.17, 0.17); actorGroup.add(ball);
      const seam = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.009, 6, 22), new THREE.MeshBasicMaterial({ color: '#f2e0c4' }));
      seam.rotation.y = Math.PI / 2; ball.add(seam);
      const collider = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#f3efe5', wireframe: true, transparent: true, opacity: 0.62 }));
      collider.visible = false; collider.userData.collider = true; ball.add(collider);
      actors.set('football', { root: ball, color: '#c5965d', football: true });
    }
  };
  const setCamera = (preset) => {
    const p = manifest.cameras[preset];
    camera.position.set(...p.position); camera.up.set(0, 1, 0); camera.lookAt(...p.target); camera.updateProjectionMatrix();
  };
  const sampleFrame = (time) => {
    if (!replay?.data.frames?.length) return null;
    const frames = replay.data.frames;
    let low = 0, high = frames.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (frames[mid].timeSeconds < time) low = mid + 1; else high = mid;
    }
    const after = frames[low], before = frames[Math.max(0, low - 1)];
    return Math.abs(after.timeSeconds - time) < Math.abs(before.timeSeconds - time) ? after : before;
  };
  const drawAt = (time, selectedCamera = $('camera').value) => {
    if (!replay) { renderer.render(scene, camera); return null; }
    const frame = sampleFrame(time);
    if (!frame) return null;
    for (const [id, state] of Object.entries(frame.players)) {
      const actor = actors.get(id); if (!actor) continue;
      actor.root.position.set(...state.positionM); actor.root.quaternion.set(...state.rotation);
    }
    if (frame.football && actors.has('football')) {
      const football = actors.get('football').root;
      football.position.set(...frame.football.positionM); football.quaternion.set(...frame.football.rotation);
      football.visible = true;
    }
    clearDebug();
    if ($('debug').checked) {
      for (const actor of actors.values()) actor.root.traverse((node) => { if (node.userData.collider) node.visible = true; });
      for (const [id, state] of Object.entries(frame.players ?? {})) {
        const actor = actors.get(id); if (!actor) continue;
        const origin = new THREE.Vector3(...state.centerOfMassM).add(new THREE.Vector3(0, 0.12, 0));
        const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(actor.root.quaternion).normalize();
        debugGroup.add(new THREE.ArrowHelper(forward, origin, 0.55, '#f4f6ff', 0.13, 0.07));
      }
      for (const contact of [...(frame.contacts ?? []), ...(frame.ballContacts ?? []), ...(frame.groundContacts ?? [])]) for (const point of contact.pointsM ?? []) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe078' }));
        marker.position.set(...point); debugGroup.add(marker);
        if (contact.normalWorld && contact.contactForceEstimateN > 0) {
          const direction = new THREE.Vector3(...contact.normalWorld);
          const arrow = new THREE.ArrowHelper(direction, marker.position, Math.min(1.2, 0.1 + contact.contactForceEstimateN / 10000), '#f6b344', 0.1, 0.05);
          debugGroup.add(arrow);
        }
      }
      for (const [id, rows] of Object.entries(frame.forcesNByPlayer ?? {})) {
        const state = frame.players[id]; if (!state) continue;
        for (const row of rows) {
          const force = new THREE.Vector3(...row.forceN); if (force.length() < 1) continue;
          const start = new THREE.Vector3(...(row.applicationPointWorldM ?? state.centerOfMassM));
          const arrow = new THREE.ArrowHelper(force.clone().normalize(), start, Math.min(1.5, 0.18 + force.length() / 1500), '#f282d4', 0.12, 0.065);
          debugGroup.add(arrow);
        }
      }
      for (const grip of frame.grips ?? []) if (grip.runnerAnchorM && grip.holderAnchorM) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...grip.runnerAnchorM), new THREE.Vector3(...grip.holderAnchorM),
        ]), new THREE.LineBasicMaterial({ color: '#57e1ed' }));
        debugGroup.add(line);
      }
      for (const control of frame.possessionControls ?? []) for (const point of control.controlPoints ?? []) {
        if (!point.playerAnchorM || !point.ballAnchorM) continue;
        const playerPoint = new THREE.Vector3(...point.playerAnchorM);
        const ballPoint = new THREE.Vector3(...point.ballAnchorM);
        const left = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#76f4ad' }));
        const right = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd36e' }));
        left.position.copy(playerPoint); right.position.copy(ballPoint);
        debugGroup.add(left, right);
        debugGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([playerPoint, ballPoint]),
          new THREE.LineBasicMaterial({ color: '#82f0c2' })));
      }
    } else for (const actor of actors.values()) actor.root.traverse((node) => { if (node.userData.collider) node.visible = false; });
    setCamera(selectedCamera);
    renderer.render(scene, camera);
    return frame;
  };
  return { canvas, renderer, load, drawAt, getReplay: () => replay, resize };
}

rigs.left = makeRig('left-view'); rigs.right = makeRig('right-view');

function matchRecord(side) {
  const scenarioId = $('scenario').value, seed = Number($('seed').value);
  const engine = $(`${side}-engine`).value;
  const [simulationVersion, sourceCommit] = $(`${side}-version`).value.split('|');
  return records.find((row) => row.scenarioId === scenarioId && row.seed === seed && row.engine === engine
    && row.simulationVersion === simulationVersion && row.sourceCommit === sourceCommit);
}

async function loadRecord(record) {
  if (!record) throw new Error('No archived replay matches the selected scenario, seed, solver, and version.');
  if (!cache.has(record.path)) cache.set(record.path, fetch(record.path).then((response) => {
    if (!response.ok) throw new Error(`Replay returned ${response.status}: ${record.path}`);
    return response.arrayBuffer().then(async (buffer) => {
      if (record.path.endsWith('.gz')) {
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
      }
      return JSON.parse(new TextDecoder().decode(buffer));
    });
  }));
  return { record, payload: await cache.get(record.path) };
}

async function loadComparison() {
  $('load').disabled = true;
  try {
    const [left, right] = await Promise.all([loadRecord(matchRecord('left')), loadRecord(matchRecord('right'))]);
    leftReplay = left; rightReplay = right;
    rigs.left.load(left.record, left.payload); rigs.right.load(right.record, right.payload);
    const duration = Math.min(left.payload.replay.durationSeconds, right.payload.replay.durationSeconds);
    $('time').max = String(duration); $('time').value = '0'; currentTimeSeconds = 0;
    $('play').disabled = false; $('play').textContent = 'Play'; playing = false;
    $('left-title').textContent = `${left.record.engine} · ${left.record.simulationVersion}`;
    $('right-title').textContent = `${right.record.engine} · ${right.record.simulationVersion}`;
    $('left-commit').textContent = `${left.record.sourceCommit.slice(0, 10)} · seed ${left.record.seed}`;
    $('right-commit').textContent = `${right.record.sourceCommit.slice(0, 10)} · seed ${right.record.seed}`;
    $('provenance').textContent = JSON.stringify({ scenario: left.record.scenarioTitle, seed: left.record.seed,
      left: { engine: left.record.engine, version: left.record.simulationVersion, commit: left.record.sourceCommit, solverVersion: left.record.solverVersion },
      right: { engine: right.record.engine, version: right.record.simulationVersion, commit: right.record.sourceCommit, solverVersion: right.record.solverVersion },
      timestepSeconds: left.payload.replay.timestepSeconds, durationSeconds: duration,
      recoveryModel: left.payload.replay.outcome.football?.recovery ?? 'not applicable' }, null, 2);
    drawAt(currentTimeSeconds);
  } catch (error) {
    $('provenance').textContent = String(error?.stack ?? error);
    $('play').disabled = true;
  } finally { $('load').disabled = false; }
}

function updateEvents() {
  if (!leftReplay || !rightReplay) return;
  const events = [...leftReplay.payload.replay.events.map((event) => ({ ...event, side: 'left' })),
    ...rightReplay.payload.replay.events.map((event) => ({ ...event, side: 'right' }))]
    .filter((event) => event.timeSeconds <= currentTimeSeconds + 1e-6)
    .sort((a, b) => b.timeSeconds - a.timeSeconds).slice(0, 12).reverse();
  const list = $('events'); list.replaceChildren();
  for (const event of events) {
    const li = document.createElement('li');
    const detail = event.pair ? ` · ${event.pair.join(' ↔ ')}` : event.player ? ` · ${event.player}` : event.players ? ` · ${event.players.join(' / ')}` : '';
    li.textContent = `${event.side.toUpperCase()} ${event.timeSeconds.toFixed(3)} s · ${event.type.replaceAll('_', ' ')}${detail}`;
    list.append(li);
  }
  if (!events.length) { const li = document.createElement('li'); li.textContent = 'No physical events have occurred by this timestamp.'; list.append(li); }
}

function drawAt(time) {
  currentTimeSeconds = Math.max(0, Number(time) || 0);
  const leftFrame = rigs.left.drawAt(currentTimeSeconds);
  const rightFrame = rigs.right.drawAt(currentTimeSeconds);
  $('clock').value = `${currentTimeSeconds.toFixed(3)} s`;
  $('clock').textContent = `${currentTimeSeconds.toFixed(3)} s`;
  $('left-status').textContent = statusFor(leftReplay, leftFrame);
  $('right-status').textContent = statusFor(rightReplay, rightFrame);
  updateEvents();
  window.__m4bArchive.lastRendered = { timeSeconds: currentTimeSeconds, leftFrame: leftFrame?.tick, rightFrame: rightFrame?.tick,
    scenarioId: $('scenario').value, camera: $('camera').value };
  return { leftFrame, rightFrame };
}

function statusFor(replay, frame) {
  if (!replay || !frame) return 'No replay loaded.';
  const contactCount = frame.contacts?.length ?? 0;
  const grounded = frame.groundContacts?.length ?? 0;
  return `${replay.record.category} · ${replay.record.scenarioTitle}\n` +
    `${replay.record.engine} · ${replay.record.simulationVersion} · commit ${replay.record.sourceCommit.slice(0, 10)}\n` +
    `t=${frame.timeSeconds.toFixed(3)} s · ${Object.keys(frame.players).length} player proxies · ${contactCount} player contacts · ${grounded} ground contacts\n` +
    `football: ${frame.football?.status ?? 'absent'} · controlled by ${frame.football?.controlPlayers?.join(', ') || 'none'}`;
}

$('load').addEventListener('click', loadComparison);
$('scenario').addEventListener('change', () => {
  const options = unique(records.filter((row) => row.scenarioId === $('scenario').value).map((row) => row.seed));
  fillSelect($('seed'), options, String, String, String(options[0]));
  loadComparison();
});
$('seed').addEventListener('change', loadComparison);
for (const side of ['left', 'right']) for (const control of [`${side}-engine`, `${side}-version`]) $(control).addEventListener('change', loadComparison);
$('camera').addEventListener('change', () => drawAt(currentTimeSeconds));
$('debug').addEventListener('change', () => drawAt(currentTimeSeconds));
$('time').addEventListener('input', (event) => { playing = false; $('play').textContent = 'Play'; drawAt(event.target.value); });
$('step-back').addEventListener('click', () => { playing = false; $('play').textContent = 'Play'; drawAt(currentTimeSeconds - Number($('time').step)); $('time').value = String(currentTimeSeconds); });
$('step-forward').addEventListener('click', () => { playing = false; $('play').textContent = 'Play'; drawAt(currentTimeSeconds + Number($('time').step)); $('time').value = String(currentTimeSeconds); });
$('play').addEventListener('click', () => {
  playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; lastPlayMs = performance.now();
  if (playing) requestAnimationFrame(animate);
});
function animate(now) {
  if (!playing) return;
  const duration = Number($('time').max);
  currentTimeSeconds = Math.min(duration, currentTimeSeconds + (now - lastPlayMs) / 1000);
  lastPlayMs = now; $('time').value = String(currentTimeSeconds); drawAt(currentTimeSeconds);
  if (currentTimeSeconds >= duration) { playing = false; $('play').textContent = 'Play'; return; }
  requestAnimationFrame(animate);
}

window.__m4bArchive = { manifest, records, rigs, drawAt, loadComparison, async loadSelection(selection) {
  $('scenario').value = selection.scenarioId; $('seed').value = String(selection.seed);
  for (const side of ['left', 'right']) {
    $(`${side}-engine`).value = selection[`${side}Engine`];
    $(`${side}-version`).value = selection[`${side}Version`];
  }
  $('camera').value = selection.camera ?? 'sideline';
  await loadComparison();
}, get current() { return { leftReplay, rightReplay, timeSeconds: currentTimeSeconds }; },
setDebug(enabled) { $('debug').checked = enabled; drawAt(currentTimeSeconds); } };

if (!records.length) $('provenance').textContent = 'The archive manifest contains no replay records yet.';
else await loadComparison();
