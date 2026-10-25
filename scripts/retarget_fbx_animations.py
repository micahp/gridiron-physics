"""Retarget a folder of FBX clips onto the existing football-player GLB.

Run with Blender 4.2+:
  blender.exe -b --python scripts/retarget_fbx_animations.py -- \
    --input-dir <fbx-clips> --output web/assets/football-player-rigged-animated.glb
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

# Source rigs namespace their bones ("<prefix>:Hips"). Map by bare name and
# resolve the prefix from the imported armature, so no exporter namespace is
# baked into the script.
BONE_MAP = {
    'Hips': 'spine',
    'Spine': 'spine.001',
    'Spine1': 'spine.002',
    'Spine2': 'spine.003',
    'Neck': 'Bone',
    'Head': 'spine.006',
    'LeftShoulder': 'shoulder.L',
    'LeftArm': 'upper_arm.L',
    'LeftForeArm': 'forearm.L',
    'LeftHand': 'hand.L',
    'RightShoulder': 'shoulder.R',
    'RightArm': 'upper_arm.R',
    'RightForeArm': 'forearm.R',
    'RightHand': 'hand.R',
    'LeftUpLeg': 'thigh.L',
    'LeftLeg': 'shin.L',
    'LeftFoot': 'foot.L',
    'LeftToeBase': 'toe.L',
    'RightUpLeg': 'thigh.R',
    'RightLeg': 'shin.R',
    'RightFoot': 'foot.R',
    'RightToeBase': 'toe.R',
}
for mix_side, target_side in (('Left', 'L'), ('Right', 'R')):
    for finger, target_finger in (('Index', 'f_index'), ('Middle', 'f_middle'), ('Ring', 'f_ring'), ('Pinky', 'f_pinky'), ('Thumb', 'thumb')):
        for digit in (1, 2, 3):
            BONE_MAP[f'{mix_side}Hand{finger}{digit}'] = f'{target_finger}.{digit:02d}.{target_side}'


def resolve_source_bones(source_arm):
    """Map bare bone names to the armature's actual names, dropping any prefix."""
    actual = {bone.name.split(':')[-1]: bone.name for bone in source_arm.data.bones}
    return {bare: actual[bare] for bare in BONE_MAP if bare in actual}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target-glb', required=True)
    parser.add_argument('--input-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--manifest', default=None)
    parser.add_argument('--only', action='append', default=[], help='Optional exact input filenames or stems; repeat to select several.')
    args, _ = parser.parse_known_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    return args


def world_matrix(obj, matrix):
    return obj.matrix_world @ matrix


def retarget_clip(arm, source_arm, source_action, clip_name):
    scene = bpy.context.scene
    resolved = resolve_source_bones(source_arm)
    missing = [(bare, target) for bare, target in BONE_MAP.items()
               if bare not in resolved or not arm.data.bones.get(target)]
    if missing:
        raise RuntimeError(f'{clip_name}: missing retarget bones {missing}')
    mapping = {resolved[bare]: target for bare, target in BONE_MAP.items()}
    hips_name = resolved['Hips']
    frames = sorted({int(round(key.co.x)) for curve in source_action.fcurves for key in curve.keyframe_points})
    if len(frames) < 2:
        raise RuntimeError(f'{clip_name}: expected at least two keyed frames, got {frames}')
    source_to_target = {target: source for source, target in mapping.items()}
    target_bones = [bone for bone in arm.data.bones if bone.name in source_to_target]
    source_root_rest = world_matrix(source_arm, source_arm.data.bones[hips_name].matrix_local).translation.copy()
    target_rest_world = {bone.name: world_matrix(arm, bone.matrix_local) for bone in arm.data.bones}
    arm_inverse = arm.matrix_world.inverted()
    action = bpy.data.actions.new(clip_name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = None
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = 'QUATERNION'

    max_position_error = 0.0
    max_rotation_error = 0.0
    root_xy_span = 0.0
    root_z_span = 0.0
    root_deltas = []
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        # Bake from the target bind pose, independent of previously processed clips.
        for pose_bone in arm.pose.bones:
            pose_bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

        source_hips = source_arm.pose.bones[hips_name]
        source_hips_world = world_matrix(source_arm, source_hips.head)
        source_root_delta = source_hips_world - source_root_rest
        root_deltas.append(source_root_delta.copy())
        # The game simulation owns all horizontal travel. Keep only vertical
        # pelvis motion for squats/falls; this prevents double-translation.
        root_delta = Vector((0.0, 0.0, source_root_delta.z))

        desired_world_by_target = {}
        desired_arm_by_target = {}
        for target_bone in target_bones:
            source_name = source_to_target[target_bone.name]
            source_pose = source_arm.pose.bones[source_name]
            source_rest_world = world_matrix(source_arm, source_arm.data.bones[source_name].matrix_local)
            source_pose_world = world_matrix(source_arm, source_pose.matrix)
            world_delta = source_pose_world.to_quaternion() @ source_rest_world.to_quaternion().inverted()
            target_rest = target_rest_world[target_bone.name]
            desired_rotation = world_delta @ target_rest.to_quaternion()

            parent = target_bone.parent
            if parent and parent.name in desired_world_by_target:
                parent_rest = target_rest_world[parent.name]
                local_head = parent_rest.inverted() @ target_rest.translation
                desired_head = desired_world_by_target[parent.name] @ local_head
            elif target_bone.name == 'spine':
                desired_head = target_rest.translation + root_delta
            else:
                desired_head = target_rest.translation.copy()

            desired_world = Matrix.LocRotScale(desired_head, desired_rotation, Vector((1.0, 1.0, 1.0)))
            desired_arm = arm_inverse @ desired_world
            desired_world_by_target[target_bone.name] = desired_world
            desired_arm_by_target[target_bone.name] = desired_arm

            # Convert the desired armature-space pose matrix into Blender's
            # pose-basis channels without per-bone dependency-graph updates.
            if parent and parent.name in desired_arm_by_target:
                basis = (
                    target_bone.matrix_local.inverted()
                    @ parent.matrix_local
                    @ desired_arm_by_target[parent.name].inverted()
                    @ desired_arm
                )
            else:
                basis = target_bone.matrix_local.inverted() @ desired_arm
            arm.pose.bones[target_bone.name].matrix_basis = basis

        bpy.context.view_layer.update()
        for target_bone in target_bones:
            actual_world = world_matrix(arm, arm.pose.bones[target_bone.name].matrix)
            expected_world = desired_world_by_target[target_bone.name]
            max_position_error = max(max_position_error, (actual_world.translation - expected_world.translation).length)
            max_rotation_error = max(max_rotation_error, actual_world.to_quaternion().rotation_difference(expected_world.to_quaternion()).angle)
        if max_position_error > 0.002 or max_rotation_error > 0.002:
            raise RuntimeError(f'{clip_name}: retarget mismatch at frame {frame}: pos={max_position_error}, rot={max_rotation_error}')

        arm.animation_data.action = action
        for target_bone in target_bones:
            pose_bone = arm.pose.bones[target_bone.name]
            pose_bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=target_bone.name)
            pose_bone.keyframe_insert(data_path='location', frame=frame, group=target_bone.name)
        arm.animation_data.action = None

    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    if root_deltas:
        root_xy_span = max(
            max(delta.x for delta in root_deltas) - min(delta.x for delta in root_deltas),
            max(delta.y for delta in root_deltas) - min(delta.y for delta in root_deltas),
        )
        root_z_span = max(delta.z for delta in root_deltas) - min(delta.z for delta in root_deltas)
    return action, {
        'name': clip_name,
        'frames': [frames[0], frames[-1]],
        'frame_count': len(frames),
        'source_root_horizontal_span_removed': round(root_xy_span, 5),
        'source_root_vertical_span': round(root_z_span, 5),
        'max_retarget_position_error': round(max_position_error, 7),
        'max_retarget_rotation_error': round(max_rotation_error, 7),
        'keyframes': sum(len(curve.keyframe_points) for curve in action.fcurves),
    }


def main():
    args = parse_args()
    target_glb = Path(args.target_glb)
    input_dir = Path(args.input_dir)
    output_path = Path(args.output)
    if not target_glb.is_file():
        raise SystemExit(f'Target GLB not found: {target_glb}')
    inputs = sorted((path for path in input_dir.rglob('*.fbx') if path.is_file()), key=lambda path: path.name.lower())
    if args.only:
        only = {value.casefold() for value in args.only}
        inputs = [path for path in inputs if path.name.casefold() in only or path.stem.casefold() in only]
    if not inputs:
        raise SystemExit(f'No FBX inputs found in {input_dir} for selection {args.only}')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(target_glb))
    scene = bpy.context.scene
    arm = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE' and obj.name == 'metarig'), None)
    if arm is None or len(arm.data.bones) != 56:
        raise RuntimeError('Target GLB does not contain the expected 56-bone metarig')
    scene.render.fps = 30
    previous_action = None
    reports = []
    for index, path in enumerate(inputs, start=1):
        before_objects = set(bpy.data.objects)
        before_actions = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True)
        imported_objects = [obj for obj in bpy.data.objects if obj not in before_objects]
        source_arm = next((obj for obj in imported_objects if obj.type == 'ARMATURE'), None)
        if source_arm is None or source_arm.animation_data is None or source_arm.animation_data.action is None:
            raise RuntimeError(f'{path.name}: FBX has no animated armature action')
        source_action = source_arm.animation_data.action
        clip_name = path.stem.strip()
        if clip_name in bpy.data.actions:
            raise RuntimeError(f'Duplicate clip name: {clip_name}')
        action, report = retarget_clip(arm, source_arm, source_action, clip_name)
        reports.append({'source': path.relative_to(input_dir).as_posix(), **report})
        print(f'RETARGETED {index}/{len(inputs)} {path.name}: {report["frame_count"]} frames, root travel removed {report["source_root_horizontal_span_removed"]}', flush=True)
        for obj in imported_objects:
            if obj.name in bpy.data.objects:
                bpy.data.objects.remove(obj, do_unlink=True)
        for data_action in list(bpy.data.actions):
            if data_action in before_actions or data_action == action:
                continue
            bpy.data.actions.remove(data_action)
        arm.animation_data.action = None
        if previous_action is not None and previous_action.name in bpy.data.actions:
            # Leave the action datablock available for its NLA strip; no active action is set.
            previous_action.use_fake_user = True
        previous_action = action

    # Export each baked Action as a separately named glTF animation clip.
    arm.animation_data.action = None
    for action in [a for a in bpy.data.actions if a.name in {r['name'] for r in reports}]:
        track = arm.animation_data.nla_tracks.new()
        track.name = action.name
        start = int(round(action.frame_range[0]))
        end = int(round(action.frame_range[1]))
        strip = track.strips.new(action.name, start, action)
        strip.action_frame_start = start
        strip.action_frame_end = end
        strip.blend_type = 'REPLACE'
        strip.extrapolation = 'NOTHING'
    scene.frame_start = 1
    scene.frame_end = max(int(round(a.frame_range[1])) for a in bpy.data.actions if a.name in {r['name'] for r in reports})
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH' and any(mod.type == 'ARMATURE' and mod.object == arm for mod in obj.modifiers)]
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_result = bpy.ops.export_scene.gltf(
        filepath=str(output_path), export_format='GLB', use_selection=True,
        export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS',
        export_nla_strips=True, export_force_sampling=True, export_frame_range=True,
        export_apply=False, export_yup=True, export_optimize_animation_size=False,
    )
    if 'FINISHED' not in export_result:
        raise RuntimeError(f'glTF export did not finish successfully: {export_result}')
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError(f'glTF export did not create a non-empty asset: {output_path}')
    report_path = Path(args.manifest) if args.manifest else output_path.with_suffix('.manifest.json')
    report_path.write_text(json.dumps({
        'target_glb': target_glb.name, 'source_dir': input_dir.name, 'output_glb': output_path.name,
        'target_bones': len(arm.data.bones), 'mesh_objects': [obj.name for obj in meshes],
        'export_result': str(export_result), 'clip_count': len(reports), 'clips': reports,
    }, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output_path), 'bytes': output_path.stat().st_size if output_path.exists() else None,
                      'clip_count': len(reports), 'manifest': str(report_path), 'clips': [r['name'] for r in reports]}, indent=2))


if __name__ == '__main__':
    main()
