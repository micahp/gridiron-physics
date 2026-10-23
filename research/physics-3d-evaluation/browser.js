import * as THREE from '../../web/vendor/three.module.js';
import { PASS_DEFLECTION_SCENARIO, TACKLE_SCENARIOS, BODY_LAYOUT } from './scenarios.js';
import { runRapierTackle, runRapierPass, runRapier22PlayerBenchmark } from './rapier-sim.js';
import { runJoltTackle, runJoltPass, runJolt22PlayerBenchmark } from './jolt-sim.js';

const engines = {
  rapier: { tackle: runRapierTackle, pass: runRapierPass, bench: runRapier22PlayerBenchmark },
  jolt: { tackle: runJoltTackle, pass: runJoltPass, bench: runJolt22PlayerBenchmark },
};
const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101b21');
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(5.5, 4.2, 6.4);
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.add(new THREE.HemisphereLight(0xdbefff, 0x34432a, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(-3, 8, 6); scene.add(keyLight);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#21372f', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; scene.add(ground);
const grid = new THREE.GridHelper(50, 50, '#63856d', '#32493f'); grid.position.y = 0.005; scene.add(grid);
function resize() { const r = $('view').getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); renderer.render(scene, camera); }
window.addEventListener('resize', resize); resize();

const dynamicObjects = [];
function clearDynamic() { for (const object of dynamicObjects) { scene.remove(object); object.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); }); } dynamicObjects.length = 0; }
function buildPlayer(state, color) {
  const root = new THREE.Group(); root.position.set(...state.position); root.quaternion.set(...state.rotation.slice(0, 3), state.rotation[3]);
  const material = new THREE.MeshStandardMaterial({ color, roughness: .78 });
  const dark = new THREE.MeshStandardMaterial({ color: '#17212a', roughness: .9 });
  for (const part of BODY_LAYOUT) {
    let geometry;
    if (part.shape === 'sphere') geometry = new THREE.SphereGeometry(part.radius, 16, 12);
    else geometry = new THREE.CapsuleGeometry(part.radius, part.halfHeight * 2, 5, 10);
    const mesh = new THREE.Mesh(geometry, part.part === 'head' ? dark : material);
    mesh.position.set(...part.pos);
    if (part.axis === 'x') mesh.rotation.z = -Math.PI / 2;
    root.add(mesh);
  }
  scene.add(root); dynamicObjects.push(root); return root;
}
function buildBall(position) {
  const ball = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .38, 5, 12), new THREE.MeshStandardMaterial({ color: '#7b4a27', roughness: .75 }));
  ball.position.set(...position); ball.rotation.z = Math.PI / 2; scene.add(ball); dynamicObjects.push(ball);
}
function buildTrajectory(points) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#f2d463', linewidth: 2 }));
  scene.add(line); dynamicObjects.push(line);
}
function frameFor(players, ballPos) {
  const xs = players.map((p) => p.position[0]);
  if (ballPos) xs.push(ballPos[0]);
  const center = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const spread = xs.length ? Math.max(2, Math.max(...xs) - Math.min(...xs)) : 3;
  camera.position.set(center + spread * .35, Math.max(3.1, spread * .25), spread * .82 + 2.2);
  camera.lookAt(center, .85, 0); camera.updateProjectionMatrix(); renderer.render(scene, camera);
}
function showTackle(result) {
  clearDynamic();
  const players = [result.players.carrier, result.players.defender];
  buildPlayer(players[0], '#6fc5ff'); buildPlayer(players[1], '#ff8066');
  frameFor(players);
  window.__physicsRendered = { playerBodies: players.length, ball: false, poses: players.map((p) => ({ position: p.position, quaternion: p.rotation })) };
  $('caption').textContent = `${result.engine} · ${result.scenario} · ${result.contact.occurred ? `contact at ${result.contact.timeSeconds.toFixed(3)} s` : 'no contact'} · falling flags are tilt > 55°`;
}
function showPass(result) {
  clearDynamic();
  const players = [result.players?.quarterback, result.players?.receiver, result.players?.defender].filter(Boolean);
  if (result.trajectoryWorldXYZ?.length) buildTrajectory(result.trajectoryWorldXYZ);
  buildBall(result.ballFinal.position);
  frameFor(players, result.ballFinal.position);
  window.__physicsRendered = { playerBodies: players.length, ball: true, ballPosition: result.ballFinal.position, poses: players.map((p) => ({ position: p.position, quaternion: p.rotation })) };
  $('caption').textContent = `${result.engine} · physical contacts: ${result.physicalContacts.join(', ') || 'none'} · contact feasibility only`;
}
function fillScenarios() { for (const scenario of TACKLE_SCENARIOS) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.id; $('scenario').append(option); } }
fillScenarios();
const selectedScenario = () => TACKLE_SCENARIOS.find((s) => s.id === $('scenario').value);
const selectedSeed = () => Number($('seed').value) || 1;
function write(value) { $('output').textContent = JSON.stringify(value, null, 2); }

$('run').addEventListener('click', async () => { const engine = engines[$('engine').value]; const result = await engine.tackle(selectedScenario(), selectedSeed()); showTackle(result); write(result); });
$('pass').addEventListener('click', async () => { const engine = engines[$('engine').value]; const result = await engine.pass(selectedSeed()); showPass(result); write(result); });
$('compare').addEventListener('click', async () => {
  const scenario = selectedScenario(), seed = selectedSeed();
  const results = await Promise.all([engines.rapier.tackle(scenario, seed), engines.jolt.tackle(scenario, seed)]);
  showTackle(results[0]); write(results);
});

window.runEvaluationHarness = async ({ simulations = 5, stepsPerSimulation = 12 } = {}) => {
  const results = { tackles: [], passes: [], benchmarks: [] };
  for (const scenario of TACKLE_SCENARIOS) {
    results.tackles.push(await runRapierTackle(scenario, 777), await runJoltTackle(scenario, 777));
  }
  results.passes.push(
    await runRapierPass(777), await runJoltPass(777),
    await runRapierPass(777, PASS_DEFLECTION_SCENARIO), await runJoltPass(777, PASS_DEFLECTION_SCENARIO),
  );
  results.benchmarks.push(
    await runRapier22PlayerBenchmark({ simulations, stepsPerSimulation }),
    await runJolt22PlayerBenchmark({ simulations, stepsPerSimulation }),
  );
  window.__physicsEvalResult = results;
  document.body.dataset.evalReady = 'true';
  return results;
};
document.body.dataset.rendererReady = renderer.getContext() ? 'true' : 'false';
