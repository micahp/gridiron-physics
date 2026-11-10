"""Render contact sheets of the authored clips: blender -b --python scripts/preview_football_clips.py -- OUTDIR [clip ...]"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import football_rig as R
import football_clips as C

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[0]
only = set(argv[1:])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.environ.get('FB_SRC', 'web/assets/football-player-rigged-animated.glb'))
arm = R.armature()
if os.environ.get('FB_ARMS', '1') != '0':
    R.lengthen_arms(arm, 1.3)
for name, clip in C.all_clips().items():
    if only and name not in only:
        continue
    files = []
    keys = clip['keys']
    pick = keys if len(keys) <= 3 else [keys[0], keys[len(keys) // 2], keys[-1]]
    for i, k in enumerate(pick):
        base = os.path.join(out, f'{name}-k{i}')
        R.render_pose(arm, k['spec'], k.get('hips', (0, 0, 0)), k.get('ground', True), base, views=('side', 'threeq'), size=(300, 380))
        files += [f'{base}-side.png', f'{base}-threeq.png']
    R.contact_sheet(files, os.path.join(out, f'{name}.png'), cols=2)
    for f in files:
        os.remove(f)
    print('SHEET', name)
