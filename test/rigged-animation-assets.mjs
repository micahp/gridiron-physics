import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRiggedAnimationSelection, POSE } from '../web/rigged-player.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetPath = path.join(root, '../web/assets/football-player-rigged-animated.glb');
const required = [
  ...new Set([
    getRiggedAnimationSelection(POSE.STANCE).clipName,
    getRiggedAnimationSelection(POSE.RUN).clipName,
    getRiggedAnimationSelection(POSE.RUN, true).clipName,
    getRiggedAnimationSelection(POSE.BLOCK).clipName,
    getRiggedAnimationSelection(POSE.DOWN).clipName,
    getRiggedAnimationSelection(POSE.THROW).clipName,
    getRiggedAnimationSelection(POSE.CATCH).clipName,
    getRiggedAnimationSelection(POSE.KICK).clipName,
    getRiggedAnimationSelection(POSE.HOLD).clipName,
    getRiggedAnimationSelection(POSE.CELEBRATE).clipName,
    getRiggedAnimationSelection(POSE.BACKPEDAL).clipName,
    getRiggedAnimationSelection(POSE.WRAP).clipName,
    getRiggedAnimationSelection(POSE.KNEEL).clipName,
  ]),
];

function readGlbJson(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) return JSON.parse(bytes.toString('utf8', offset, offset + length));
    offset += length;
  }
  throw new Error('GLB has no JSON chunk');
}

test('animated player GLB preserves textured 56-bone rig and all 49 imported clips', () => {
  const gltf = readGlbJson(assetPath);
  assert.equal(gltf.skins?.[0]?.joints?.length, 56);
  assert.ok(gltf.images?.length >= 9, 'team-tintable player textures must survive export');
  assert.equal(gltf.animations?.length, 49);
  const names = new Set(gltf.animations.map((clip) => clip.name));
  for (const clipName of required) assert.ok(names.has(clipName), `missing runtime clip: ${clipName}`);
  assert.ok(gltf.animations.every((clip) => clip.channels.length > 0), 'every FBX must yield animation channels');
});

test('animated clips never animate the outer armature object transform', () => {
  const gltf = readGlbJson(assetPath);
  const nodes = gltf.nodes || [];
  const rootBoneNodes = new Set(nodes.flatMap((node, index) => node.name === 'spine' ? [index] : []));
  for (const clip of gltf.animations || []) {
    for (const channel of clip.channels) {
      const node = nodes[channel.target.node];
      assert.notEqual(node?.name, 'metarig', `${clip.name} must not displace the physics-controlled player root`);
      assert.notEqual(channel.target.path, 'weights', `${clip.name} must not add morph root-motion tracks`);
      if (rootBoneNodes.has(channel.target.node) && channel.target.path === 'translation') {
        const accessor = gltf.accessors[clip.samplers[channel.sampler].output];
        const spanX = (accessor.max?.[0] ?? 0) - (accessor.min?.[0] ?? 0);
        const spanZ = (accessor.max?.[2] ?? 0) - (accessor.min?.[2] ?? 0);
        assert.ok(Math.max(spanX, spanZ) <= 0.005, `${clip.name} must keep FBX root translation in-place`);
      }
    }
  }
});
