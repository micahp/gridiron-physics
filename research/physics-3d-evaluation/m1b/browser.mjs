import * as THREE from '../../../web/vendor/three.module.js';
import { BODY_LAYOUT } from '../scenarios.js';
import { BALANCE_CASES, DEMOS, ENGINE_IDS, runBalanceScenario, runTackleScenario } from './simulation.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const scene = new THREE.Scene(); scene.background = new THREE.Color('#101c21');
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 180);
camera.position.set(4.5, 3.9, 6.2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.add(new THREE.HemisphereLight(0xd9f1ff, 0x35412f, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-4, 7, 5); scene.add(key);
const turf = new THREE.Mesh(new THREE.PlaneGeometry(70, 40), new THREE.MeshStandardMaterial({ color: '#21382f', roughness: 1 }));
turf.rotation.x = -Math.PI / 2; turf.position.y = -0.01; scene.add(turf);
const grid = new THREE.GridHelper(40, 40, '#64866e', '#354a40'); grid.position.y = 0.005; scene.add(grid);

const dynamic = new THREE.Group(); scene.add(dynamic);
let activeReplay = null, currentIndex = 0, playing = false, lastPlaybackTime = 0, previousFrameTime = 0;
const colors = { carrier: '#77c7ff', defender: '#ff8369' };
const eventLabels = {
  tackle_attempt: 'Defender begins a tackle attempt',
  meaningful_body_contact: 'Physical player contact registered',
  grip_established: 'Compliant grip attachment established',
  grip_broken: 'Grip attachment released under load',
  carrier_fall_started: 'Carrier loses upright balance',
  defender_fall_started: 'Defender loses upright balance',
  carrier_recovered_upright: 'Carrier recovers upright balance',
  defender_recovered_upright: 'Defender recovers upright balance',
  carrier_down: 'Carrier remains down with grip retained',
  runner_escaped: 'Runner escapes and continues forward',
  missed_tackle: 'Tackle missed; no hold established',
  runner_continued: 'Runner continues after the missed attempt',
  physical_contact: 'Glancing/player contact registered',
  balance_disturbance_started: 'Off-center disturbance causes a stumble',
  contact_policy_force_started: 'Players apply equal and opposite contact policy forces',
  upright_stabilized_after_disturbance: 'Balance controller stabilizes the player',
};

function resize() {
  const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
window.addEventListener('resize', resize);

function removeDynamic() {
  dynamic.traverse((child) => {
    if (child.geometry && child !== dynamic) child.geometry.dispose();
    if (child.material) Array.isArray(child.material) ? child.material.forEach((m) => m.dispose()) : child.material.dispose();
  });
  dynamic.clear();
}

function makePlayer(label) {
  const root = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({ color: colors[label] ?? '#d7dfe2', roughness: .74 });
  const helmet = new THREE.MeshStandardMaterial({ color: '#15232a', roughness: .6, metalness: .14 });
  for (const part of BODY_LAYOUT) {
    const geometry = part.shape === 'sphere'
      ? new THREE.SphereGeometry(part.radius, 16, 12)
      : new THREE.CapsuleGeometry(part.radius, part.halfHeight * 2, 5, 10);
    const mesh = new THREE.Mesh(geometry, part.part === 'head' ? helmet : base);
    mesh.position.set(...part.pos);
    if (part.axis === 'x') mesh.rotation.z = -Math.PI / 2;
    root.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#f1f6f7', transparent: true, opacity: .7 }));
    edges.position.copy(mesh.position); edges.rotation.copy(mesh.rotation); edges.userData.debugProxy = true; edges.visible = false; root.add(edges);
  }
  scene.add(root); dynamic.add(root);
  const com = new THREE.Mesh(new THREE.SphereGeometry(.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#b6ff62' }));
  scene.add(com); dynamic.add(com);
  return { label, root, com, base, helmet, line: null, arrow: null };
}

function vectorFrom(array) { return new THREE.Vector3(array[0], array[1], array[2]); }
function setVisibility() {
  const enabled = $('debug').checked;
  if (!activeReplay) return;
  for (const player of activeReplay.players.values()) {
    player.root.traverse((child) => { if (child.userData.debugProxy) child.visible = enabled; });
    player.com.visible = enabled;
    if (player.line) player.line.visible = enabled;
    if (player.arrow) player.arrow.visible = enabled;
  }
  if (activeReplay.debugGroup) activeReplay.debugGroup.visible = enabled;
  drawFrame(currentIndex);
}

function focusOnFrame(frame) {
  const positions = Object.values(frame.players).map((player) => player.positionM[0]);
  const min = positions.length ? Math.min(...positions) : 0, max = positions.length ? Math.max(...positions) : 0;
  const center = (min + max) / 2, span = Math.max(2.8, max - min + 2.2);
  camera.position.set(center + span * .6, Math.max(2.7, span * .45), span * .95 + 1.2);
  camera.lookAt(center, .8, 0);
}

function drawFrame(index) {
  if (!activeReplay?.frames?.length) return;
  currentIndex = Math.max(0, Math.min(activeReplay.frames.length - 1, index));
  const frame = activeReplay.frames[currentIndex];
  for (const [label, state] of Object.entries(frame.players)) {
    const player = activeReplay.players.get(label);
    if (!player) continue;
    player.root.position.set(...state.positionM);
    player.root.quaternion.set(...state.rotation);
    player.com.position.set(...state.centerOfMassM);
    if (!activeReplay.comHistory.has(label)) activeReplay.comHistory.set(label, []);
    const history = activeReplay.comHistory.get(label);
    history.push(vectorFrom(state.centerOfMassM));
    if (history.length > 100) history.shift();
    if (player.line) {
      const old = player.line.geometry;
      player.line.geometry = new THREE.BufferGeometry().setFromPoints(history);
      old.dispose();
    } else {
      player.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(history), new THREE.LineBasicMaterial({ color: '#b6ff62' }));
      scene.add(player.line); dynamic.add(player.line);
    }
    const torque = vectorFrom(state.appliedBalanceTorqueNm ?? [0, 0, 0]);
    if (torque.length() > 1e-3) {
      if (!player.arrow) { player.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), player.com.position, .5, '#ffae55', .12, .06); scene.add(player.arrow); dynamic.add(player.arrow); }
      player.arrow.position.copy(player.com.position);
      player.arrow.setDirection(torque.clone().normalize());
      player.arrow.setLength(Math.min(1.6, .18 + torque.length() * .00045), .13, .06);
      player.arrow.visible = $('debug').checked;
    } else if (player.arrow) player.arrow.visible = false;
  }

  const debugGroup = activeReplay.debugGroup;
  while (debugGroup.children.length) {
    const child = debugGroup.children.at(-1); debugGroup.remove(child);
    child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose();
  }
  const debug = $('debug').checked;
  if (debug) {
    for (const point of frame.contactPointsM ?? []) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(.085, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffdf57' }));
      marker.position.set(...point); debugGroup.add(marker);
    }
    if (frame.grip?.active && frame.grip.runnerAnchorM && frame.grip.defenderAnchorM) {
      const gripLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([vectorFrom(frame.grip.runnerAnchorM), vectorFrom(frame.grip.defenderAnchorM)]),
        new THREE.LineBasicMaterial({ color: '#51e4ed', linewidth: 2 }));
      debugGroup.add(gripLine);
    }
    if (frame.appliedContactForce) {
      const p = vectorFrom(frame.appliedContactForce.worldPointM), f = vectorFrom(frame.appliedContactForce.forceOnCarrierN);
      const arrow = new THREE.ArrowHelper(f.clone().normalize(), p, Math.min(1.5, .2 + f.length() * .00025), '#f17ce7', .13, .07);
      debugGroup.add(arrow);
    }
  }
  debugGroup.visible = debug;
  $('frame').value = String(currentIndex);
  $('clock').textContent = `${frame.timeSeconds.toFixed(3)} s · ${currentIndex + 1}/${activeReplay.frames.length}`;
  $('status').textContent = `${activeReplay.engine} · ${activeReplay.result.outcome ?? activeReplay.result.scenario} · ${frame.bodyContact ? 'contact' : 'no player contact'}`;
  focusOnFrame(frame);
  renderer.render(scene, camera);
  window.__m1bRendered = { engine: activeReplay.engine, frame: currentIndex, playerBodies: activeReplay.players.size,
    poses: Object.entries(frame.players).map(([label, state]) => {
      const mesh = activeReplay.players.get(label).root;
      return { label, position: state.positionM, quaternion: state.rotation,
        renderedPosition: mesh.position.toArray(), renderedQuaternion: mesh.quaternion.toArray() };
    }),
    bodyContact: frame.bodyContact, grip: frame.grip?.active ?? false, timeSeconds: frame.timeSeconds };
}

function setEvents(result) {
  const list = $('events'); list.replaceChildren();
  for (const event of result.events ?? []) {
    const li = document.createElement('li');
    const name = eventLabels[event.type] ?? event.type.replaceAll('_', ' ');
    li.textContent = `${event.timeSeconds.toFixed(3)} s — ${name}${event.requestedLoadN !== undefined ? ` (${event.requestedLoadN.toFixed(0)} N requested / ${event.capacityN} N capacity)` : ''}`;
    list.append(li);
  }
  if (!list.children.length) { const li = document.createElement('li'); li.textContent = 'No events recorded.'; list.append(li); }
}

function setReplay(engine, result) {
  playing = false; $('play').textContent = 'Play';
  previousFrameTime = 0;
  removeDynamic();
  const players = new Map();
  for (const label of Object.keys(result.frames[0]?.players ?? {})) players.set(label, makePlayer(label));
  const debugGroup = new THREE.Group(); scene.add(debugGroup); dynamic.add(debugGroup);
  activeReplay = { engine, result, frames: result.frames, players, debugGroup, comHistory: new Map() };
  $('frame').disabled = false; $('frame').min = '0'; $('frame').max = String(Math.max(0, result.frames.length - 1)); $('frame').value = '0';
  $('play').disabled = result.frames.length < 2; currentIndex = 0;
  drawFrame(0);
}

function selectedScenario() {
  const id = $('scenario').value;
  return DEMOS.find((s) => s.id === id) ?? BALANCE_CASES.find((s) => s.id === id);
}
function runOne(engine, scenario) {
  return scenario.kind === 'tackle' ? runTackleScenario(engine, scenario) : runBalanceScenario(engine, scenario);
}
function writeOutput(value) { $('output').textContent = JSON.stringify(value, null, 2); }

async function runSelected(compare) {
  const scenario = selectedScenario();
  const engines = compare ? ENGINE_IDS : [$('engine').value];
  $('run').disabled = true; $('compare').disabled = true; $('status').textContent = 'Simulating physical contacts…';
  try {
    const results = await Promise.all(engines.map(async (engine) => [engine, await runOne(engine, scenario)]));
    const loaded = Object.fromEntries(results);
    const visibleEngine = compare ? $('engine').value : engines[0];
    setReplay(visibleEngine, loaded[visibleEngine]);
    setEvents(loaded[visibleEngine]);
    writeOutput(compare
      ? Object.fromEntries(results.map(([engine, result]) => [engine, { outcome: result.outcome ?? null, events: result.events,
        contact: result.contact ?? { occurred: result.firstContactTick !== null }, grip: result.grip ?? null,
        players: result.players ?? result.results?.map((p) => ({ label: p.label, maxTiltDeg: p.maxTiltDeg, fellAtEnd: p.fellAtEnd, recoveredTick: p.recoveredTick })) }]))
      : loaded[visibleEngine]);
    activeReplayByEngine = loaded;
    document.body.dataset.demoReady = 'true';
  } catch (error) {
    $('status').textContent = `Simulation error: ${error.message}`; console.error(error); throw error;
  } finally { $('run').disabled = false; $('compare').disabled = false; }
}

let activeReplayByEngine = {};
$('run').addEventListener('click', () => runSelected(false));
$('compare').addEventListener('click', () => runSelected(true));
$('frame').addEventListener('input', () => drawFrame(Number($('frame').value)));
$('debug').addEventListener('change', setVisibility);
$('engine').addEventListener('change', () => {
  const engine = $('engine').value, result = activeReplayByEngine[engine];
  if (result) { setReplay(engine, result); setEvents(result); }
});
$('play').addEventListener('click', () => {
  playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
  if (playing) { lastPlaybackTime = performance.now(); requestAnimationFrame(animate); }
});
function animate(now) {
  if (!playing || !activeReplay) return;
  const elapsed = (now - lastPlaybackTime) / 1000; lastPlaybackTime = now;
  previousFrameTime += elapsed * Number($('speed').value);
  const next = Math.floor(previousFrameTime / (1 / 120));
  if (next >= activeReplay.frames.length) { playing = false; $('play').textContent = 'Play'; drawFrame(activeReplay.frames.length - 1); return; }
  if (next > currentIndex) drawFrame(next);
  requestAnimationFrame(animate);
}

for (const scenario of BALANCE_CASES) {
  const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.id.replaceAll('-', ' '); $('scenario').append(option);
}
window.__m1bRunScenario = async (id, engine = $('engine').value) => {
  $('scenario').value = id; $('engine').value = engine;
  await runSelected(false);
  return activeReplayByEngine[engine];
};
document.body.dataset.rendererReady = renderer.getContext() ? 'true' : 'false';
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
