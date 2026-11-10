"""Build the football player GLB: longer arms, football clips, arms held off the body in locomotion clips.

  blender -b --python scripts/build_football_player.py -- --src <animated.glb> --out <animated.glb> [--manifest <json>]

Starts from the existing animated GLB (rig, mesh, 49 mocap clips), so it is repeatable without the
FBX folder. Everything here is deterministic; run it again and you get the same file.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import football_rig as R
import football_clips as C

LOCOMOTION = ['Jogging In Place', 'run-in-place', 'Running in place', 'Sprint In Place', 'Running Backward in place',
              'running-backward-in-place', 'Standing Idle', 'Idle', 'Breathing Idle']
ARM_LENGTH = 1.3


def parse():
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--manifest', default=None)
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:])


def main():
    args = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.src)
    scene = bpy.context.scene
    assert scene.render.fps == 24, scene.render.fps
    arm = R.armature()
    stock = sorted(a.name for a in bpy.data.actions)
    if any(n.startswith('FB_') for n in stock):
        raise SystemExit('--src already contains FB_ clips: build from the original animated GLB '
                         '(git show 417855f:web/assets/football-player-rigged-animated.glb), not from the output of this script')
    R.lengthen_arms(arm, ARM_LENGTH)

    baked = []
    for name in LOCOMOTION:
        if name in bpy.data.actions:
            R.bake_relaxed_arms(arm, name, flex=0.40, abduct=0.28, elbow=0.55)
            baked.append(name)

    authored = {}
    for name, clip in C.all_clips().items():
        act = R.author_clip(arm, name, clip['keys'], fps=scene.render.fps, loop=clip['loop'])
        authored[name] = {'loop': clip['loop'], 'duration': round((act.frame_range[1] - act.frame_range[0]) / scene.render.fps, 3)}

    R.detach(arm)
    for act in bpy.data.actions:
        act.use_fake_user = True
    scene.frame_start, scene.frame_end = 1, 2
    bpy.ops.export_scene.gltf(
        filepath=args.out, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
        export_skins=True, export_def_bones=False, export_apply=False,
    )
    if args.manifest:
        json.dump({
            'source': os.path.basename(args.src), 'output': os.path.basename(args.out), 'arm_length_scale': ARM_LENGTH,
            'stock_clips': stock, 'arms_baked': baked, 'authored_clips': authored,
            'clip_count': len(bpy.data.actions),
        }, open(args.manifest, 'w'), indent=2)
    print('BUILD_OK', len(bpy.data.actions), 'actions;', len(authored), 'authored;', len(baked), 'baked')


main()
