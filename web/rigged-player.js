// Rigged free football player integration.
//
// Loads web/assets/football-player-rigged-animated.glb (CC BY 3.0, "American Football
// Player" by Hikky via BlendSwap, exported with Blender 4.2's official glTF 2.0
// and retargeted FBX clips to its existing 56-bone skeleton. The renderer
// maps the same 12 gameplay states to clips, with procedural posing as fallback.
//
// The rig's bind pose is already upright, Y-up, feet on the ground and facing
// +Z, so the module only spins it to the field's +X and scales it to the
// player's height. Posing happens in WORLD space (field axes) rather than in
// bone-local axes, because this rig's bone roll does not match the primitive
// player's joint frames: hip/knee swing and shoulder flexion rotate about the
// field's left-right axis (Z), abduction about the forward axis (X), and
// elbows/knees bend about the hinge axis captured from the bind pose.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkeleton } from './vendor/SkeletonUtils.js';
import { ensureController, isLocomotionClip } from './rigged-animation-controller.js';
import { teamLogoUrl } from './team-logo.js';

import { POSE } from './pose-codes.js';
export { POSE };

const POSE_ANIMATIONS = Object.freeze({
  [POSE.STANCE]: Object.freeze({ clipName: 'Football Stance', loop: false }),
  [POSE.RUN]: Object.freeze({ clipName: 'Running in place', loop: true }),
  [POSE.BLOCK]: Object.freeze({ clipName: 'Pushing In Place', loop: true }),
  [POSE.DOWN]: Object.freeze({ clipName: 'Stunned (Knocked Down)', loop: false }),
  [POSE.THROW]: Object.freeze({ clipName: 'Quarterback Pass', loop: false }),
  [POSE.CATCH]: Object.freeze({ clipName: 'Goalkeeper Catch', loop: false }),
  [POSE.KICK]: Object.freeze({ clipName: 'Goalkeeper Drop Kick', loop: false }),
  [POSE.HOLD]: Object.freeze({ clipName: 'Football Hike', loop: false }),
  [POSE.CELEBRATE]: Object.freeze({ clipName: 'Fist Pump', loop: false }),
  [POSE.BACKPEDAL]: Object.freeze({ clipName: 'Running Backward in place', loop: true }),
  [POSE.WRAP]: Object.freeze({ clipName: 'Running To Tackle', loop: false }),
  [POSE.KNEEL]: Object.freeze({ clipName: 'Kneel', loop: false }),
});
const CARRY_RUN_CLIP = Object.freeze({ clipName: 'Running While Holding Something', loop: true });

export function getRiggedAnimationSelection(pose, carrying = false) {
  if (pose === POSE.RUN && carrying) return { ...CARRY_RUN_CLIP };
  const selection = POSE_ANIMATIONS[pose];
  return selection ? { ...selection } : null;
}

const YD = 0.9144;
const ASSET_URL = 'web/assets/football-player-rigged-animated.glb';

// Field axes (world units are yards): +X downfield, +Y up, +Z across the field.
const AX_FWD = new THREE.Vector3(1, 0, 0);
const AX_SIDE = new THREE.Vector3(0, 0, 1);

export function stablePhase(playerId, seed = '') {
  const input = `${seed}:${playerId}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0x100000000) * Math.PI * 2;
}

export function composeBindRelativeQuaternion(restQuat, restParentQuat, rotations) {
  const worldDelta = new THREE.Quaternion();
  const axisRotation = new THREE.Quaternion();
  for (const { axis, angle } of rotations) {
    axisRotation.setFromAxisAngle(axis, angle);
    worldDelta.premultiply(axisRotation);
  }
  return restParentQuat.clone().invert().multiply(worldDelta).multiply(restParentQuat).multiply(restQuat);
}

export function splitUniformGeometry(geometry, threshold = 0.9) {
  const position = geometry.getAttribute('position');
  if (!position || (!geometry.index && position.count % 3 !== 0)) throw new Error('Uniform geometry must contain triangle positions');
  const source = geometry.getIndex()?.array || Array.from({ length: position.count }, (_, i) => i);
  if (source.length % 3 !== 0) throw new Error('Uniform geometry index must contain complete triangles');
  const pants = [];
  const jersey = [];
  for (let i = 0; i < source.length; i += 3) {
    const triangle = [source[i], source[i + 1], source[i + 2]];
    const meanY = (position.getY(triangle[0]) + position.getY(triangle[1]) + position.getY(triangle[2])) / 3;
    (meanY < threshold ? pants : jersey).push(...triangle);
  }
  geometry.setIndex([...pants, ...jersey]);
  geometry.clearGroups();
  if (pants.length) geometry.addGroup(0, pants.length, 0);
  if (jersey.length) geometry.addGroup(pants.length, jersey.length, 1);
  return { geometry, pantsIndexCount: pants.length, jerseyIndexCount: jersey.length };
}


// ------------------------------------------------------------ kit atlas
//
// ROUPA_Color is a real UV atlas: jersey front/back and sleeves (dark with white
// side panels), collar and cuff pieces, pants, and four pad blobs, plus a baked
// "#21" on the front and back. Instead of throwing it away and colouring by height,
// repaint it per team: dark pixels take the jersey or pants colour (keeping the
// fabric shading), white pixels take the trim colour, and the baked number is
// covered and each player's real number is painted into the cloth itself, front and back, so it follows the
// jersey exactly (no floating decal). The team repaint is cached per kit; the number pass per team + number.
const ATLAS_PANTS = (x, y) => (x < 600 && y > 240) || (x < 260 && y < 250);
const ATLAS_NUMBER_BOXES = [[668, 380, 890, 545], [685, 740, 915, 895]]; // baked "21", front and back (1024 atlas)
// where the real number is painted: centre of the baked "21" on the front and on the back (1024 atlas)
const ATLAS_NUMBER_AT = [[775, 462], [795, 818]];
const atlasCache = new Map();
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function kitAtlasKey(kit) { return [kit.jersey, kit.pants, kit.trim, kit.number].join('|'); }

/** Pure pixel pass, exported for tests. `data` is RGBA over a size x size atlas. */
export function recolorKitAtlas(data, size, kit) {
  const jersey = new THREE.Color(kit.jersey), pants = new THREE.Color(kit.pants);
  const stripe = new THREE.Color(kit.trim);
  if (Math.abs(stripe.r - jersey.r) + Math.abs(stripe.g - jersey.g) + Math.abs(stripe.b - jersey.b) < 0.25) stripe.set(kit.number);
  const k = size / 1024;
  // mean fabric brightness, sampled from bare jersey cloth just above each baked number (not the whole
  // atlas, whose black background would drag it down), so the patch that covers the number is shaded
  // like the cloth around it instead of a flat, visibly different rectangle
  const SAMPLE = [[640, 290, 940, 372], [660, 628, 960, 690]];
  let sumL = 0, nL = 0;
  for (const [x0, y0, x1, y1] of SAMPLE) {
    for (let y = Math.floor(y0 * k); y < y1 * k; y++) {
      for (let x = Math.floor(x0 * k); x < x1 * k; x++) {
        const i = (y * size + x) * 4;
        const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (L > 12 && L < 70) { sumL += L; nL++; }
      }
    }
  }
  const meanShade = Math.max(0.62, Math.min(1.25, 0.8 + ((nL ? sumL / nL : 28) - 28) / 150));
  for (let i = 0; i < data.length; i += 4) {
    const px = (i / 4) % size, py = Math.floor(i / 4 / size);
    const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const base = ATLAS_PANTS(px / k, py / k) ? pants : jersey;
    const shade = Math.max(0.62, Math.min(1.25, 0.8 + (L - 28) / 150));
    const w = smooth(70, 150, L);
    const lit = L / 235;
    data[i] = 255 * ((base.r * shade) * (1 - w) + stripe.r * lit * w);
    data[i + 1] = 255 * ((base.g * shade) * (1 - w) + stripe.g * lit * w);
    data[i + 2] = 255 * ((base.b * shade) * (1 - w) + stripe.b * lit * w);
  }
  // cover the baked number with plain jersey fabric
  for (const [x0, y0, x1, y1] of ATLAS_NUMBER_BOXES) {
    for (let y = Math.floor(y0 * k); y < y1 * k; y++) {
      for (let x = Math.floor(x0 * k); x < x1 * k; x++) {
        const i = (y * size + x) * 4;
        data[i] = 255 * jersey.r * meanShade; data[i + 1] = 255 * jersey.g * meanShade; data[i + 2] = 255 * jersey.b * meanShade;
      }
    }
  }
  return data;
}

const baseCache = new Map();    // kit key -> repainted 1024 atlas canvas (no number)
const numberCache = new Map();  // kit key + number -> texture, oldest first
const NUMBER_TEX_SIZE = 1024;   // per-player atlas: full-res so the number stays sharp up close
const MAX_NUMBER_TEX = 32;      // ~170 MB of GPU memory at most; a miss costs one drawImage plus the text

function kitBaseCanvas(sourceMap, kit) {
  const key = kitAtlasKey(kit);
  if (baseCache.has(key)) return baseCache.get(key);
  const img = sourceMap.image;
  const size = Math.min(1024, img.width || 1024);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size);
  recolorKitAtlas(px.data, size, kit);
  g.putImageData(px, 0, 0);
  baseCache.set(key, canvas);
  return canvas;
}

/** Paint a jersey number onto the front and back panels of an atlas drawn at `size` px. */
export function paintJerseyNumber(g, size, number, kit) {
  const text = String(number ?? '').trim();
  if (!text) return;
  const k = size / 1024;
  g.save();
  g.font = `900 ${text.length > 2 ? 120 : 165}px "Saira Condensed", "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = kit.trim;
  g.fillStyle = kit.number;
  g.scale(k, k);
  g.lineWidth = 8;
  for (const [cx, cy] of ATLAS_NUMBER_AT) {
    g.strokeText(text, cx, cy + 6, 210);
    g.fillText(text, cx, cy + 6, 210);
  }
  g.restore();
}

function kitAtlasTexture(sourceMap, kit, number) {
  if (typeof document === 'undefined' || !sourceMap?.image) return null;
  const key = `${kitAtlasKey(kit)}#${String(number ?? '').trim()}`;
  if (numberCache.has(key)) {
    const tex = numberCache.get(key);
    numberCache.delete(key); numberCache.set(key, tex); // most recently used goes last
    return tex;
  }
  const base = kitBaseCanvas(sourceMap, kit);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = NUMBER_TEX_SIZE;
  const g = canvas.getContext('2d');
  g.drawImage(base, 0, 0, NUMBER_TEX_SIZE, NUMBER_TEX_SIZE);
  paintJerseyNumber(g, NUMBER_TEX_SIZE, number, kit);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.sharedKitAtlas = true; // cached and shared: never disposed per player
  numberCache.set(key, tex);
  while (numberCache.size > MAX_NUMBER_TEX) {
    const [oldKey, old] = numberCache.entries().next().value;
    numberCache.delete(oldKey);
    old.dispose();
  }
  return tex;
}

// ---------------------------------------------------------- uniform detail
//
// Beyond the jersey: team gloves, striped socks, team-colored cleats, a pants stripe and a helmet with a stripe
// and the team logo. The texture layouts were surveyed by painting every island a different colour and rendering.
// Skin atlas (CORPO_Color, 2048 px): two glove islands and the two calf islands (the two big pink islands are the
// arms); the calf islands are drawn with the knee at the top and the ankle notch at the bottom.
const SURVEY = 2048 / 1932;                       // the survey images were shown at 1932 px
const px = (v) => Math.round(v * SURVEY);
const SKIN_GLOVES = [[10, 740, 560, 1450], [540, 760, 1110, 1450]].map((b) => b.map(px));
const SKIN_CALVES = [[1125, 820, 1585, 1045], [1140, 1125, 1585, 1345]].map((b) => b.map(px));
const SOCK_STRIPES = [[0.18, 0.31], [0.43, 0.56]];  // fractions of the calf, knee (0) to ankle (1)
const colorDistance = (a, b) => {
  const x = new THREE.Color(a), y = new THREE.Color(b);
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
};

/** Pure pixel pass over an RGBA skin atlas: team gloves (swoosh in the number colour) and striped socks on the calves. */
export function recolorSkinAtlas(data, size, kit) {
  const k = size / 2048;
  const glove = new THREE.Color(kit.glove ?? kit.trim), swoosh = new THREE.Color(kit.number ?? '#ffffff');
  const sockBase = new THREE.Color(kit.sock ?? kit.pants), sockStripe = new THREE.Color(kit.sockStripe ?? kit.trim);
  for (const [x0, y0, x1, y1] of SKIN_GLOVES) {
    for (let y = Math.floor(y0 * k); y < Math.min(size, Math.ceil(y1 * k)); y++) {
      for (let x = Math.floor(x0 * k); x < Math.min(size, Math.ceil(x1 * k)); x++) {
        const i = (y * size + x) * 4;
        const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (L > 12 && L < 95) {          // dark glove cloth (the atlas background is pure black)
          const sh = Math.max(0.6, Math.min(1.25, 0.55 + L / 70));
          data[i] = 255 * glove.r * sh; data[i + 1] = 255 * glove.g * sh; data[i + 2] = 255 * glove.b * sh;
        } else if (L >= 150) {           // the white grip swoosh
          const lit = L / 235;
          data[i] = 255 * swoosh.r * lit; data[i + 1] = 255 * swoosh.g * lit; data[i + 2] = 255 * swoosh.b * lit;
        }
      }
    }
  }
  for (const [x0, y0, x1, y1] of SKIN_CALVES) {
    const ya = Math.floor(y0 * k), yb = Math.ceil(y1 * k);
    for (let y = ya; y < Math.min(size, yb); y++) {
      const t = (y - ya) / Math.max(1, yb - ya);
      const stripe = SOCK_STRIPES.some(([a, b]) => t >= a && t <= b);
      const c = stripe ? sockStripe : sockBase;
      for (let x = Math.floor(x0 * k); x < Math.min(size, Math.ceil(x1 * k)); x++) {
        const i = (y * size + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 150 && g > 105 && b > 85 && r > b + 10) {       // skin-coloured pixel of the calf island
          data[i] = 255 * c.r; data[i + 1] = 255 * c.g; data[i + 2] = 255 * c.b;
        }
      }
    }
  }
  return data;
}

/** Pure pixel pass over the cleat atlas: dark leather takes the team colour, keeping its shading; stud holes stay dark. */
export function recolorCleatAtlas(data, size, color) {
  const c = new THREE.Color(color);
  for (let i = 0; i < data.length; i += 4) {
    const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (L < 6) continue;
    const sh = Math.max(0.55, Math.min(1.2, 0.5 + L / 70));
    data[i] = 255 * c.r * sh; data[i + 1] = 255 * c.g * sh; data[i + 2] = 255 * c.b * sh;
  }
  return data;
}

const detailCache = new Map();
function recolored(key, sourceMap, size, pass, { flipY = false, anisotropy = 4 } = {}) {
  if (typeof document === 'undefined' || !sourceMap?.image) return null;
  if (detailCache.has(key)) return detailCache.get(key);
  const img = sourceMap.image;
  const n = Math.min(size, img.width || size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const px_ = g.getImageData(0, 0, n, n);
  pass(px_.data, n);
  g.putImageData(px_, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = flipY; // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.userData.sharedKitAtlas = true;
  detailCache.set(key, tex);
  return tex;
}

const skinTexture = (map, kit) => recolored(
  `skin|${kit.glove ?? kit.trim}|${kit.number}|${kit.sock ?? kit.pants}|${kit.sockStripe ?? kit.trim}`, map, 2048, (d, n) => recolorSkinAtlas(d, n, kit));
const cleatTexture = (map, kit) => {
  const color = kit.cleat ?? kit.trim;
  return recolored(`cleat|${color}`, map, 1024, (d, n) => recolorCleatAtlas(d, n, color));
};

// Helmet atlas (2048 px): the visible shell is the lower half. The crown's centre seam is x = 1000; the two sides are
// mirror images about it (left side at x ~ 1450, right at x ~ 550, around y ~ 1500).
const helmetCache = new Map();
function helmetTexture(kit) {
  if (typeof document === 'undefined') return null;
  const logo = kit.logo ?? (kit.team ? teamLogoUrl(kit.team) : '');
  const key = `${kit.helmet}|${kit.trim}|${logo}`;
  if (helmetCache.has(key)) return helmetCache.get(key);
  const N = 1024, k = N / 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d');
  const paint = (img) => {
    g.fillStyle = kit.helmet;
    g.fillRect(0, 0, N, N);
    if (colorDistance(kit.trim, kit.helmet) > 0.3) {       // centre stripe, front to back
      g.fillStyle = kit.trim;
      g.fillRect(962 * k, 1000 * k, 76 * k, 800 * k);
    }
    if (img) {                                             // team logo on both sides (the right side is mirrored)
      const s = 300 * k;
      g.drawImage(img, 1450 * k - s / 2, 1480 * k - s / 2, s, s);
      g.save(); g.translate(550 * k, 0); g.scale(-1, 1); g.drawImage(img, -s / 2, 1480 * k - s / 2, s, s); g.restore();
    }
  };
  paint(null);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.sharedKitAtlas = true;
  helmetCache.set(key, tex);
  if (logo && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => { paint(img); tex.needsUpdate = true; };
    img.src = logo;
  }
  return tex;
}

/**
 * A stripe down the outside of each thigh, computed per pixel from the vertex's bind-pose position, so it is smooth
 * on a mesh that is far too coarse for a per-vertex mask and does not depend on the (curved) UV layout.
 * The outermost thigh sits at |x| ~ 0.20 m; the band is the outer ~6 cm, between the knee pad and the hip.
 */
function addPantsStripe(material, color) {
  const stripeColor = { value: new THREE.Color(color) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.stripeColor = stripeColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 stripeColor;\nvarying vec3 vBindPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // outer thigh: the lateral surface (|x| past 0.178), cut to a fixed ~7 cm band about the leg's mid-depth (z ~ 0.045)
        float stripeSide = smoothstep(0.172, 0.182, abs(vBindPos.x)) * (1.0 - smoothstep(0.030, 0.040, abs(vBindPos.z - 0.045)));
        float stripeY = smoothstep(0.50, 0.545, vBindPos.y) * (1.0 - smoothstep(0.895, 0.93, vBindPos.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, stripeColor, stripeSide * stripeY);`);
  };
  material.customProgramCacheKey = () => 'pants-stripe';
  material.userData.pantsStripe = true;
}

function fabricMaterial(source, color) {
  const material = source.clone();
  material.map = null; // discard the dark atlas with its baked #21 uniform
  material.color.set(color);
  material.roughness = 0.78;
  material.userData.riggedPlayerOwned = true;
  material.needsUpdate = true;
  return material;
}

function helmetMaterial(source, kit) {
  const material = source.clone();
  const map = helmetTexture(kit);
  material.map = map;                                     // the texture carries the colour, stripe and logo
  material.color.set(map ? '#ffffff' : kit.helmet);
  material.roughness = 0.3;
  material.metalness = 0.18;
  material.userData.riggedPlayerOwned = true;
  material.needsUpdate = true;
  return material;
}

function applyRiggedKit(clone, kit, info) {
  if (!kit) return;
  clone.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const uniformIndex = sources.findIndex((material) => String(material.name || '').toUpperCase() === 'ROUPA_MAT');
    if (uniformIndex >= 0) {
      if (sources.length !== 1) throw new Error('Expected the apparel primitive to have its own material group');
      const atlas = kitAtlasTexture(sources[uniformIndex].map, kit, info?.jersey);
      if (atlas) {
        const material = sources[uniformIndex].clone();
        material.map = atlas;
        material.color.set('#ffffff'); // the atlas already carries the colours
        material.roughness = 0.78;
        material.userData.riggedPlayerOwned = true;
        const stripe = kit.stripe ?? kit.trim;
        if (stripe && colorDistance(stripe, kit.pants) > 0.3) addPantsStripe(material, stripe);
        material.needsUpdate = true;
        object.material = material;
        return;
      }
      const split = splitUniformGeometry(object.geometry.clone());
      split.geometry.userData.riggedPlayerOwned = true;
      object.geometry = split.geometry;
      object.material = [fabricMaterial(sources[uniformIndex], kit.pants), fabricMaterial(sources[uniformIndex], kit.jersey)];
      return;
    }
    const apply = (source) => {
      const name = String(source.name || '').toUpperCase();
      if (name === 'HELMET.001') return helmetMaterial(source, kit);
      const detail = name === 'CORPO_MAT' || name === 'LUVA_PARTE_BRILHANTE' ? skinTexture(source.map, kit)
        : name === 'CHUTEIRA_MAT' ? cleatTexture(source.map, kit) : null;
      if (detail) {
        const material = source.clone();
        material.map = detail;
        material.userData.riggedPlayerOwned = true;
        material.needsUpdate = true;
        return material;
      }
      return source; // face mask, straps, eyes, studs and other gear stay intact
    };
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
  });
}

export const BUILD_ID = 'footlock-2026-11-10d';
let loaderPromise = null;
export function loadRiggedPlayer() {
  if (!loaderPromise) {
    loaderPromise = new GLTFLoader().loadAsync(ASSET_URL).then((gltf) => {
      // visible build stamp: which viewer build and model this page is really running
      if (typeof document !== 'undefined' && document.body && !document.getElementById('gp-build-stamp')) {
        const el = document.createElement('div');
        el.id = 'gp-build-stamp';
        el.textContent = `build ${BUILD_ID} · ${(gltf.animations || []).length} clips`;
        el.style.cssText = 'position:fixed;right:6px;bottom:4px;z-index:9999;font:11px/1.2 monospace;color:#fff;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:3px;pointer-events:none';
        document.body.appendChild(el);
      }
      return gltf;
    }).catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

// three.js sanitises glTF node names ('thigh.L' -> 'thighL'), so the map holds
// the sanitised names and the builder also aliases the dot-stripped variants.
const BONE = {
  hip: 'spine', chest: 'spine001', chest2: 'spine002', neck: 'spine003', head: 'Bone',
  upL: 'upper_armL', foreL: 'forearmL', handL: 'handL',
  upR: 'upper_armR', foreR: 'forearmR', handR: 'handR',
  thighL: 'thighL', shinL: 'shinL', footL: 'footL', toeL: 'toeL',
  thighR: 'thighR', shinR: 'shinR', footR: 'footR', toeR: 'toeR',
};

// Neutral mode: skip all procedural posing so the imported bind pose can be
// checked on its own (Test 1: does the model stand upright, feet on the ground).
let neutralMode = false;
export function setNeutralMode(on) { neutralMode = !!on; }
export function isNeutralMode() { return neutralMode; }

export function buildRiggedPlayer(gltf, info, kit) {
  const root = new THREE.Group(); // positioned & yawed on the field (yards)
  const body = new THREE.Group(); // tipped over when down
  root.add(body);

  const clone = cloneSkeleton(gltf.scene);
  applyRiggedKit(clone, kit, info);
  const clips = new Map((gltf.animations || []).map((clip) => [clip.name, clip]));
  const mixer = clips.size ? new THREE.AnimationMixer(clone) : null;
  const bones = {};
  clone.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    if (o.isSkinnedMesh) {
      o.skeleton.bones.forEach((b) => {
        bones[b.name] = b;
        bones[b.name.replace(/\./g, '')] = b; // alias for dotted source names
      });
    }
  });
  const rig = new THREE.Group(); // orientation + scale wrapper
  body.add(rig);
  rig.add(clone);

  // Official Blender export: the model is already glTF Y-up and standing
  // (body spans y 0.09..1.83, helmet to 1.86 in metres) and faces +Z. Spin it
  // to the field's +X, then scale to the player height and ground the feet.
  clone.rotation.y = Math.PI / 2; // +Z forward -> +X forward
  rig.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(rig);
  const heightU = Math.max(1e-3, bb.max.y - bb.min.y); // authored units (~1.86)
  const s = (info.physics?.height || 1.88) / 1.88;
  const fit = (1.88 * s) / heightU;
  const S = fit / YD; // metres -> yards (same convention as the primitive body)
  rig.scale.setScalar(S);
  rig.position.y = -bb.min.y * S; // ground the feet
  // height of the ball of the foot when it stands on the turf (yards), for the foot lock
  root.updateMatrixWorld(true);
  const toeBone = bones.toeL || bones['toe.L'];
  const toeRest = toeBone ? toeBone.getWorldPosition(new THREE.Vector3()).y : undefined;

  // Capture the bind pose so posing can be expressed as an offset from rest.
  const dir = (from, to) => {
    const a = bones[from], b = bones[to];
    if (!a || !b) return null;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    a.getWorldPosition(pa); b.getWorldPosition(pb);
    return pb.sub(pa).normalize();
  };
  const hinge = (from, to) => {
    const d1 = dir(from, to);
    const child = bones[to];
    const grand = child && child.children.length ? dir(to, child.children[0].name) : null;
    if (!d1 || !grand) return null;
    return new THREE.Vector3().crossVectors(d1, grand).normalize();
  };
  for (const b of Object.values(bones)) {
    if (!b || !b.isBone) continue;
    b.userData.restQuat = b.quaternion.clone();
    b.userData.restPosition = b.position.clone();
    const pq = new THREE.Quaternion();
    if (b.parent) b.parent.getWorldQuaternion(pq);
    b.userData.restParentQuat = pq;
  }
  // semantic aliases (upL, hip, chest, ...) so the poser can use stable names
  for (const [key, name] of Object.entries(BONE)) {
    const b = bones[name] || bones[name.replace(/\./g, '')];
    if (b) bones[key] = b;
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.05, 32),
    new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.userData = {
    rigged: true, id: info.id, jerseyNumber: String(info.jersey ?? ''), body, ring, bones, toeRest,
    animation: { mixer, clips, activeAction: null, activeClipName: null },
    phase: stablePhase(info.id, info.animationSeed ?? info.seed ?? kit?.seed ?? ''), lie: 0,
    hinge: {
      shinL: hinge('thighL', 'shinL'), shinR: hinge('thighR', 'shinR'),
      foreL: hinge('upper_armL', 'forearmL'), foreR: hinge('upper_armR', 'forearmR'),
    },
    dispose() {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(clone);
      }
      const geometries = new Set([ring.geometry]);
      const materials = new Set([ring.material]);
      const textures = new Set();
      root.traverse((object) => {
        if (object.geometry?.userData?.riggedPlayerOwned) geometries.add(object.geometry);
        if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material?.userData?.riggedPlayerOwned) continue;
          materials.add(material);
          if (material.map?.userData?.riggedPlayerOwned && !material.map.userData.sharedKitAtlas) textures.add(material.map);
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
  return root;
}

// ------------------------------------------------- hips follow travel direction
//
// The engine's heading is where the player is looking (often the ball), which is
// not always where he is going. The run clips only sweep the feet straight back,
// so moving at an angle to the body slid the feet sideways. Locomotion turns the
// hips toward the direction of travel (or directly away from it for a backpedal)
// and twists the upper body back toward the engine's heading, like a real player
// running while watching the ball.
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TRAVEL_POSES = new Set([POSE.RUN, POSE.BACKPEDAL, POSE.STANCE, POSE.BLOCK]);
const MAX_TWIST = 0.45;      // radians the torso can stay turned from the hips
const HIP_TURN_RATE = 10;    // 1/s, exponential smoothing of the hip yaw

/**
 * Hip yaw offset from the engine heading, in radians (field-angle convention:
 * the body is drawn at heading + offset).
 * @param dir travel direction relative to heading in radians, or null when still
 */
export function travelYawOffset(root, { pose, speed, dir, dt }) {
  const u = root.userData;
  const st = (u.travelYaw ??= { offset: 0, moving: false, back: false });
  const enter = pose === POSE.BLOCK ? 1.6 : 1.2;
  st.moving = TRAVEL_POSES.has(pose) && dir !== null && speed > (st.moving ? 0.8 : enter);
  let target = 0;
  if (st.moving) {
    const a = Math.abs(dir);
    // ~115 degrees off the heading reads as a backpedal; leave it below ~100
    st.back = a > (st.back ? 1.75 : 2.0) || (pose === POSE.BACKPEDAL && a > Math.PI / 2);
    target = st.back ? wrapAngle(dir - Math.PI) : dir;
  } else {
    st.back = false;
  }
  const k = 1 - Math.exp(-Math.max(0, dt) * HIP_TURN_RATE);
  st.offset = wrapAngle(st.offset + wrapAngle(target - st.offset) * k);
  return st.offset;
}

const _UP = new THREE.Vector3(0, 1, 0);
/** Turn the chest back toward the heading after the clip has posed the body. */
function twistSpine(bones, angle) {
  if (!angle) return;
  for (const bone of [bones.chest, bones.chest2]) {
    if (!bone?.parent) continue;
    // Idempotent: if the mixer did not rewrite this bone since our last twist (paused
    // playback), re-twisting would stack every frame and spin the torso.
    const done = (bone.userData.twistOut ??= new THREE.Quaternion());
    if (bone.userData.twistApplied && bone.quaternion.equals(done)) continue;
    bone.parent.getWorldQuaternion(_pq);
    _axisRotation.setFromAxisAngle(_UP, angle * 0.5);
    _q.copy(_pq).invert().multiply(_axisRotation).multiply(_pq);
    bone.quaternion.premultiply(_q);
    done.copy(bone.quaternion);
    bone.userData.twistApplied = true;
  }
}

// Compose world-space deltas first, then express the result relative to the bind
// pose. A later shoulder axis must not replace an earlier flexion rotation.
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _parentInverse = new THREE.Quaternion();
const _worldDelta = new THREE.Quaternion();
const _axisRotation = new THREE.Quaternion();
function rotWorld(bone, axis, angle, k) {
  return rotWorldComposed(bone, [{ axis, angle }], k);
}
function rotWorldComposed(bone, rotations, k) {
  if (!bone || !rotations?.length || !bone.userData.restQuat || !bone.userData.restParentQuat) return;
  _pq.copy(bone.userData.restParentQuat);
  _parentInverse.copy(_pq).invert();
  _worldDelta.identity();
  for (const { axis, angle } of rotations) {
    if (!axis || !Number.isFinite(angle)) continue;
    _axisRotation.setFromAxisAngle(axis, angle);
    _worldDelta.premultiply(_axisRotation);
  }
  _q.copy(_parentInverse).multiply(_worldDelta).multiply(_pq).multiply(bone.userData.restQuat);
  bone.quaternion.slerp(_q, k);
}

// ---------------------------------------------------------------- lean
//
// A runner leans into acceleration (the body tips forward to push the ground back) and into a turn (roll
// toward the inside, by centripetal acceleration), and rocks back when he brakes. The clips are cycles with
// no sense of that, which is why a player who starts running looked like he was standing straight and
// sliding. This tips the whole body about the feet from the recorded velocity, whatever clip is playing.
const G_ACC = 9.81;
// the run clips already carry their own forward lean, so this is the extra tip from acceleration, not all of it
const LEAN_MAX_FWD = 0.26, LEAN_MAX_BACK = 0.2, LEAN_MAX_ROLL = 0.28;
/**
 * @param state per-player state object, mutated ({ vx, vy, t, pitch, roll })
 * @param vx, vy world velocity in m/s on the field plane; yaw: where the body faces on that plane; time: playback s
 * @returns { pitch, roll } radians; pitch > 0 leans forward, roll > 0 leans to the player's left
 */
export function bodyLean(state, { vx, vy, yaw, time }) {
  if (state.t === undefined || time - state.t > 0.5 || time < state.t - 1e-6) {
    // first sample, a seek or a new play: no history, no lean
    Object.assign(state, { vx, vy, t: time, pitch: 0, roll: 0 });
    return { pitch: 0, roll: 0 };
  }
  const dt = time - state.t;
  if (dt < 1 / 120) return { pitch: state.pitch, roll: state.roll };   // paused: hold the pose
  const ax = (vx - state.vx) / dt, ay = (vy - state.vy) / dt;
  const fwd = ax * Math.cos(yaw) + ay * Math.sin(yaw);
  const left = ax * Math.sin(yaw) - ay * Math.cos(yaw);
  // lateral acceleration of a turn is v * omega; the velocity change already carries it
  const tp = Math.max(-LEAN_MAX_BACK, Math.min(LEAN_MAX_FWD, Math.atan(fwd / G_ACC) * 0.55));
  const tr = Math.max(-LEAN_MAX_ROLL, Math.min(LEAN_MAX_ROLL, Math.atan(left / G_ACC) * 0.7));
  const k = 1 - Math.exp(-dt * 7);
  state.pitch += (tp - state.pitch) * k;
  state.roll += (tr - state.roll) * k;
  Object.assign(state, { vx, vy, t: time });
  return { pitch: state.pitch, roll: state.roll };
}

// ---------------------------------------------------------------- foot lock
//
// The clips are cycles played in place; the engine moves the body at its own speed. Whenever the two disagree
// the foot on the ground slides over the turf ("skating"). This pins the ball of the planted foot to the spot
// where it touched down and solves the leg (thigh + shin) to reach it, until the clip lifts the foot or the leg
// runs out of reach; then the foot is picked up and carried through the air back to the clip's pose.
const FOOT_PLANT_M = 0.03, FOOT_LIFT_M = 0.07, FOOT_RECOVER_M = 0.15;
const _fh = new THREE.Vector3(), _fk = new THREE.Vector3(), _fa = new THREE.Vector3(), _ftoe = new THREE.Vector3();
const _ft = new THREE.Vector3(), _fn = new THREE.Vector3(), _fv1 = new THREE.Vector3(), _fv2 = new THREE.Vector3();
const _ffq = new THREE.Quaternion(), _fdq = new THREE.Quaternion(), _fpw = new THREE.Quaternion(), _flq = new THREE.Quaternion();
const wpos = (bone, out) => out.setFromMatrixPosition(bone.matrixWorld);
function rotateBoneWorld(bone, dq) {
  bone.parent.getWorldQuaternion(_fpw);
  _flq.copy(_fpw).invert().multiply(dq).multiply(_fpw);
  bone.quaternion.premultiply(_flq);
  bone.updateWorldMatrix(false, true);
}
function solveLeg(root, thigh, shin, foot, target) {
  foot.getWorldQuaternion(_ffq);
  wpos(thigh, _fh); wpos(shin, _fk); wpos(foot, _fa);
  const l1 = _fh.distanceTo(_fk), l2 = _fk.distanceTo(_fa);
  if (l1 < 1e-6 || l2 < 1e-6) return;
  const d = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min((l1 + l2) * 0.999, _fh.distanceTo(target)));
  const interior = (len) => Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - len * len) / (2 * l1 * l2))));
  const cur = interior(_fh.distanceTo(_fa)), des = interior(d);
  _fv1.subVectors(_fk, _fh).normalize(); _fv2.subVectors(_fa, _fk).normalize();
  _fn.crossVectors(_fv1, _fv2);
  if (_fn.lengthSq() < 1e-6) {   // straight leg: the knee folds the shin backward
    root.getWorldQuaternion(_fpw);
    _fv2.set(-1, 0, 0).applyQuaternion(_fpw);
    _fn.crossVectors(_fv1, _fv2);
    if (_fn.lengthSq() < 1e-6) return;
  }
  _fn.normalize();
  rotateBoneWorld(shin, _fdq.setFromAxisAngle(_fn, cur - des));
  wpos(foot, _fa);
  _fv1.subVectors(_fa, _fh).normalize(); _fv2.subVectors(target, _fh).normalize();
  rotateBoneWorld(thigh, _fdq.setFromUnitVectors(_fv1, _fv2));
  // the foot keeps the clip's own orientation (heel rises over the pinned toe)
  foot.parent.getWorldQuaternion(_fpw);
  foot.quaternion.copy(_fpw.invert()).multiply(_ffq);
  foot.updateWorldMatrix(false, true);
}
function lockFeet(root, time, active) {
  const u = root.userData, b = u.bones;
  const st = (u.feet ??= { t: time, L: {}, R: {} });
  const dt = time - st.t;
  const reset = dt < -1e-6 || dt > 0.25;
  st.t = time;
  // if the mixer did not rewrite a leg bone since our last pass (paused, or a held key), put the clip's own
  // value back first so the correction never stacks on itself
  for (const side of ['L', 'R']) {
    const f = st[side];
    for (const key of ['thigh', 'shin', 'foot']) {
      const bone = b[key + side], s = f[key];
      if (bone && s?.dirty && bone.quaternion.equals(s.out)) bone.quaternion.copy(s.clip);
      if (s) s.dirty = false;
    }
    if (reset || !active) { f.on = false; f.w = 0; f.wait = false; f.lift = 0; f.in = 0; f.py = undefined; }
  }
  const step = Math.max(0, Math.min(0.1, dt));
  // the run clips carry the stance foot several centimetres above the turf; st.drop lowers the body by that much
  if (reset) { st.drop = 0; st.floor = undefined; st.want = 0; }
  if (!active || u.toeRest === undefined) {
    st.floor = undefined; st.want = 0;
    if (st.drop) { st.drop = Math.max(0, st.drop - step * 0.6 / YD); u.body.position.y = -st.drop; }
    return;
  }
  const drop = st.drop ?? 0;
  u.body.position.y = -drop;
  root.updateWorldMatrix(true, true);
  // toe heights as the clip has them (before the drop), and a floor that follows the lower toe
  const h = {};
  for (const side of ['L', 'R']) h[side] = b['toe' + side] ? wpos(b['toe' + side], _ftoe).y - root.position.y + drop : Infinity;
  const lowest = Math.min(h.L, h.R);
  st.floor = st.floor === undefined ? lowest : Math.min(st.floor + step * 0.6 / YD, lowest);
  let pinnedToe = Infinity;
  for (const side of ['L', 'R']) {
    const f = st[side];
    const thigh = b['thigh' + side], shin = b['shin' + side], foot = b['foot' + side], toe = b['toe' + side];
    if (!thigh || !shin || !foot || !toe) continue;
    wpos(thigh, _fh); wpos(shin, _fk); wpos(foot, _fa); wpos(toe, _ftoe);
    const toeClip = h[side];
    const vy = f.py === undefined || step <= 0 ? (f.vy ?? 0) : ((toeClip - f.py) / step) * YD;   // m/s, + = rising
    f.py = toeClip; f.vy = vy;
    const above = (toeClip - st.floor) * YD;                // metres above this clip's stance height
    const lower = toeClip <= lowest + 1e-9;
    // down: at stance height, or the lower foot that has stopped descending; stays down until it clearly lifts
    const low = f.on
      ? above < FOOT_LIFT_M || (lower && above < 0.12 && vy < 0.5)
      : above < FOOT_PLANT_M || (lower && above < 0.10 && Math.abs(vy) < 0.3);
    const release = (wait) => {
      f.on = false; f.w = 1; f.wait = wait; f.in = 0;
      f.ox = (f.tx ?? _fa.x) - _fa.x; f.oy = (f.ty ?? _fa.y) - _fa.y; f.oz = (f.tz ?? _fa.z) - _fa.z;
    };
    if (!low) { f.wait = false; if (f.on) release(false); }
    else if (!f.on && !f.wait) { f.on = true; f.w = 0; f.in = 0; f.x = _ftoe.x; f.z = _ftoe.z; }
    if (f.on) {
      f.in = Math.min(1, (f.in ?? 0) + step / 0.05);
      const reach = (_fh.distanceTo(_fk) + _fk.distanceTo(_fa)) * 0.985;
      f.tx = f.x + (_fa.x - _ftoe.x); f.tz = f.z + (_fa.z - _ftoe.z);
      // press the ball of the foot onto the turf (the body drop follows), as far as the leg reaches
      f.ty = Math.max(_fa.y - (_ftoe.y - root.position.y - u.toeRest) * f.in, _fh.y - reach * 0.98);
      _ft.set(f.tx, f.ty, f.tz);
      if (_fh.distanceTo(_ft) > reach) release(true);   // toe-off: the leg cannot stay on that spot any longer
      else pinnedToe = Math.min(pinnedToe, toeClip);
    }
    f.lift = Math.max(0, Math.min(1, (f.lift ?? 0) + (f.wait && !f.on ? step / 0.03 : -step / 0.1)));
    if (!f.on) {
      f.w = Math.max(0, (f.w ?? 0) - step / 0.09);
      if (f.w <= 0 && f.lift <= 0) continue;
      const e = f.w * f.w * (3 - 2 * f.w);
      _ft.set(_fa.x + (f.ox ?? 0) * e, _fa.y + (f.oy ?? 0) * e + f.lift * FOOT_RECOVER_M / YD, _fa.z + (f.oz ?? 0) * e);
    }
    const keep = {};
    for (const [key, bone] of [['thigh', thigh], ['shin', shin], ['foot', foot]]) {
      keep[key] = (f[key] ??= { clip: new THREE.Quaternion(), out: new THREE.Quaternion(), dirty: false });
      keep[key].clip.copy(bone.quaternion);
    }
    solveLeg(root, thigh, shin, foot, _ft);
    keep.thigh.out.copy(thigh.quaternion); keep.shin.out.copy(shin.quaternion); keep.foot.out.copy(foot.quaternion);
    keep.thigh.dirty = keep.shin.dirty = keep.foot.dirty = true;
  }
  if (pinnedToe < Infinity) st.want = Math.max(0, Math.min(0.2 / YD, pinnedToe - u.toeRest));
  st.drop = drop + ((st.want ?? 0) - drop) * (1 - Math.exp(-step * 12));
}

// The stock run cycles rock the shoulders side to side far more than a runner does (about 13 degrees against
// 3 to 5). This takes most of that roll out at the chest, measured from the shoulder joints each frame.
const SHOULDER_LEVEL = 0.65;
// Undo last frame's levelling if the mixer left the chest alone (paused, or a clip that holds the chest still).
// Must run before twistSpine, whose own "already applied" check compares against the value it wrote.
function unlevelShoulders(root) {
  const st = root.userData.level, chest = root.userData.bones.chest;
  if (chest && st?.dirty && chest.quaternion.equals(st.out)) chest.quaternion.copy(st.clip);
  if (st) st.dirty = false;
}
function levelShoulders(root, active) {
  const u = root.userData, b = u.bones, chest = b.chest;
  const st = (u.level ??= { clip: new THREE.Quaternion(), out: new THREE.Quaternion(), dirty: false });
  if (!active || !chest?.parent || !b.upL || !b.upR) return;
  root.updateWorldMatrix(true, true);
  wpos(b.upL, _fv1).sub(wpos(b.upR, _fv2));                 // right shoulder -> left shoulder
  root.getWorldQuaternion(_fpw);
  _fn.set(1, 0, 0).applyQuaternion(_fpw); _fn.y = 0;
  if (_fn.lengthSq() < 1e-6) return;
  _fn.normalize();
  const lift = _ft.crossVectors(_fn, _fv1).y;                // how fast the shoulder line tips per radian about forward
  if (Math.abs(lift) < 1e-6) return;
  const angle = Math.max(-0.5, Math.min(0.5, -SHOULDER_LEVEL * _fv1.y / lift));
  st.clip.copy(chest.quaternion);
  rotateBoneWorld(chest, _fdq.setFromAxisAngle(_fn, angle));
  st.out.copy(chest.quaternion); st.dirty = true;
}

export function animateRigged(root, pose, speed, dt, carrying, playbackTime = null, cues = null, travel = null, contact = null) {
  if (neutralMode) return; // Test 1: leave the imported bind pose untouched
  const u = root.userData;
  const b = u.bones;
  if (!b.hip && !b.thighL) return;
  // With a mixer, the controller owns the body: it advances on playback time,
  // anchors throw/catch clips to the recorded ball and arbitrates pose changes.
  // Procedural posing below stays the fallback when no clip covers the pose.
  if (u.animation?.mixer) {
    const controller = ensureController(root);
    if (controller) {
      // null is a real value here: it means "this play has no anchored clips"
      if (controller.cuesRaw !== (cues ?? null)) controller.setCues(cues);
      const time = playbackTime ?? (u.animTime = (u.animTime ?? 0) + dt);
      if (controller.tick({ time, pose, speed, carrying, travel, contact })) {
        // lean into acceleration and turns while he is moving under a locomotion clip; contact and set-piece clips
        // own their own posture
        // globalThis.__audit switches (scripts/audit-motion-live.mjs) turn a layer off to measure what each one contributes
        if (contact && contact.vx !== undefined && isLocomotionClip(controller.clipName) && !globalThis.__audit?.noLean) {
          const L = bodyLean((u.lean ??= {}), { vx: contact.vx, vy: contact.vy, yaw: contact.bodyYaw ?? 0, time });
          u.body.rotation.z = -L.pitch;
          u.body.rotation.x = -L.roll;
        } else if (u.lean) {
          u.body.rotation.z = 0; u.body.rotation.x = 0; u.lean = null;
        }
        unlevelShoulders(root);
        const offset = u.travelYaw?.offset ?? 0;
        if (!globalThis.__audit?.noTwist) twistSpine(b, Math.max(-MAX_TWIST, Math.min(MAX_TWIST, offset)));
        levelShoulders(root, isLocomotionClip(controller.clipName) && !globalThis.__audit?.noLevel);
        lockFeet(root, time, isLocomotionClip(controller.clipName) && speed > 0.5 && !globalThis.__audit?.noFootLock);
        return;
      }
    }
  }
  u.phase += dt * (2.2 + speed * 0.9);
  const swing = Math.min(0.95, speed * 0.11);
  let lean = Math.min(0.38, speed * 0.04);
  let crouch = 0;
  const armF = [-Math.sin(u.phase) * swing * 0.8, Math.sin(u.phase) * swing * 0.8];
  let armOut = 0.12;
  const legA = [Math.sin(u.phase) * swing, -Math.sin(u.phase) * swing];
  const kneeB = [Math.max(0, -Math.cos(u.phase)) * swing * 1.4, Math.max(0, Math.cos(u.phase)) * swing * 1.4];
  let lieT = 0, lift = 0, elbow = 0.55;
  switch (pose) {
    case POSE.STANCE:
      crouch = 0.3; lean = 0.42; legA[0] = 0.35; legA[1] = 0.2; kneeB[0] = 0.72; kneeB[1] = 0.62;
      armF[0] = 0.38; armF[1] = 0.16; armOut = 0.12; elbow = 0.78; break;
    case POSE.BLOCK:
      lean = 0.4; crouch = 0.12; armF[0] = armF[1] = 0.6; armOut = 0.05; elbow = 1.1;
      legA[0] = 0.35 + Math.sin(u.phase) * 0.2; legA[1] = -0.15 - Math.sin(u.phase) * 0.2;
      kneeB[0] = 0.6; kneeB[1] = 0.45; break;
    case POSE.WRAP:
      lean = 0.5; crouch = 0.15; armF[0] = armF[1] = 0.7; armOut = -0.1; elbow = 1.3; break;
    case POSE.DOWN:
      lieT = Math.PI / 2; armF[0] = 1.4; armF[1] = 1.2; legA[0] = 0.1; legA[1] = -0.1;
      kneeB[0] = 0.3; kneeB[1] = 0.3; elbow = 0.3; break;
    case POSE.THROW:
      armF[0] = -1.2; armF[1] = 0.5; lean = 0.15; elbow = 1.4; break;
    case POSE.CATCH:
      armF[0] = armF[1] = 1.1; armOut = 0.2; lean = 0.05; elbow = 0.5; break;
    case POSE.KICK:
      legA[0] = -0.9; legA[1] = 0.2; kneeB[0] = 0.1; kneeB[1] = 0.3; lean = -0.15;
      armF[0] = 0.4; armF[1] = -0.5; armOut = 0.45; elbow = 0.6; break;
    case POSE.HOLD:
      crouch = 0.12; legA[0] = 0.12; legA[1] = -0.08; kneeB[0] = 0.42; kneeB[1] = 0.32; lean = 0.08;
      armF[0] = 0.45; armF[1] = 0.78; elbow = 1.0; break;
    case POSE.KNEEL:
      crouch = 0.48; legA[0] = 0.82; legA[1] = -0.28; kneeB[0] = 1.35; kneeB[1] = 1.8; lean = 0.12;
      armF[0] = armF[1] = 0.52; elbow = 1.1; break;
    case POSE.CELEBRATE:
      armF[0] = armF[1] = 2.2; armOut = 0.4; lift = Math.abs(Math.sin(u.phase * 1.3)) * 0.18; elbow = 0.3; break;
    case POSE.BACKPEDAL:
      lean = 0.25; crouch = 0.1; break;
  }
  if (carrying && pose !== POSE.DOWN) { armF[1] = 1.0; elbow = 1.3; }
  const k = 1 - Math.exp(-dt * 14);

  // legs: hip swing about the field's left-right axis, knee about its hinge
  rotWorld(b.thighL, AX_SIDE, legA[0], k);
  rotWorld(b.thighR, AX_SIDE, legA[1], k);
  rotWorld(b.shinL, u.hinge.shinL, kneeB[0], k);
  rotWorld(b.shinR, u.hinge.shinR, kneeB[1], k);
  // arms: flexion and abduction are one bind-relative transform per shoulder.
  rotWorldComposed(b.upL, [{ axis: AX_SIDE, angle: armF[0] }, { axis: AX_FWD, angle: armOut }], k);
  rotWorldComposed(b.upR, [{ axis: AX_SIDE, angle: armF[1] }, { axis: AX_FWD, angle: -armOut }], k);
  rotWorld(b.foreL, u.hinge.foreL, elbow, k);
  rotWorld(b.foreR, u.hinge.foreR, elbow, k);
  // torso lean and crouch. Lower the pelvis/spine, not the entire character root,
  // so stance transitions do not push the cleats through the field.
  rotWorld(b.hip, AX_SIDE, -lean * 0.5, k);
  rotWorld(b.chest, AX_SIDE, -lean * 0.5, k);
  for (const [bone, amount] of [[b.hip, 0.16], [b.chest, 0.12]]) {
    if (!bone?.userData.restPosition) continue;
    const targetY = bone.userData.restPosition.y - crouch * amount;
    bone.position.y += (targetY - bone.position.y) * k;
  }

  u.lie += (lieT - u.lie) * (1 - Math.exp(-dt * 8));
  u.body.rotation.z = -u.lie;
  u.body.position.y = lift + (u.lie > 0.1 ? 0.24 : 0);
}
