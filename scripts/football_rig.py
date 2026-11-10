"""Shared helpers for authoring football clips on the existing 56-bone player rig.

Runs inside Blender (5.x). Character space: the model faces -Y, its left side is +X,
up is +Z. A pose is described by where each bone should POINT, in character terms
(forward, left, up), plus an optional hips offset. `pose_key` solves the bone rotations
and, unless told otherwise, lowers/raises the hips so the lowest foot point rests on
the turf, so no authored pose can float or sink.
"""
import bpy
from mathutils import Matrix, Vector

FWD = Vector((0, -1, 0))
LEFT = Vector((1, 0, 0))
UP = Vector((0, 0, 1))
GROUND_Z = 0.032          # rest height of the lowest foot point (sole of the cleat)
FOOT_POINTS = (('foot.L', 'head'), ('foot.R', 'head'), ('foot.L', 'tail'), ('foot.R', 'tail'), ('toe.L', 'tail'), ('toe.R', 'tail'))


def cs(f=0.0, l=0.0, u=0.0):
    """A direction in character terms: f forward, l toward the character's left, u up."""
    v = FWD * f + LEFT * l + UP * u
    return v.normalized()


ORIGIN = Vector((0.0, -0.033, 0.0))   # hips rest position on the ground plane


def pt(f=0.0, l=0.0, u=0.0):
    """A point in character space (metres from the hips' rest position on the ground): f forward, l left, u up."""
    return ORIGIN + FWD * f + LEFT * l + UP * u


def ik(target, pole=None):
    """Spec value for key 'ik.L' / 'ik.R': reach the hand to `target` (a pt) with the elbow bent toward `pole`."""
    return ('ik', target, pole if pole is not None else Vector((0, 0, -1)))


def _two_bone(shoulder, l1, l2, target, pole, flip=1.0):
    d = target - shoulder
    dist = max(1e-4, min(d.length, (l1 + l2) * 0.9995))
    dirn = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = max(0.0, l1 * l1 - a * a) ** 0.5
    p = pole - dirn * pole.dot(dirn)
    p = p.normalized() if p.length > 1e-6 else Vector((0, 0, -1))
    elbow = shoulder + dirn * a + p * h * flip
    return (elbow - shoulder), ((shoulder + dirn * dist) - elbow)


def _hinge_local(arm, side):
    """The elbow's natural flexion axis, expressed in the upper-arm bone's own frame.

    The rest pose has the forearm bent slightly forward of the upper arm, which is flexion; the axis that
    takes the upper arm onto the forearm is therefore the flexion hinge. Positive rotation about it = bend.
    """
    U = arm.data.bones['upper_arm.' + side]
    F = arm.data.bones['forearm.' + side]
    u = (U.tail_local - U.head_local).normalized()
    f = (F.tail_local - F.head_local).normalized()
    return U.matrix_local.to_3x3().inverted() @ u.cross(f).normalized()


def _arm_orientation(arm, side, c3, u_dir, f_dir, h_loc):
    """Upper-arm orientation (3x3, armature space) pointing along u_dir whose elbow hinge lies along u x f.

    Swing-twist: swing the bone's Y onto u_dir with the minimal rotation, then roll about u_dir until the
    hinge matches the bend plane. Returns (orientation, roll in radians). The bend is then always flexion
    about the real hinge, so the forearm cannot fold backward or candy-wrap at the elbow.
    """
    import math
    u = u_dir.normalized()
    cur_y = (c3 @ Vector((0, 1, 0))).normalized()
    o1 = cur_y.rotation_difference(u).to_matrix() @ c3
    n = u.cross(f_dir.normalized())
    if n.length < 1e-5:
        return o1, 0.0
    n.normalize()
    h1 = (o1 @ h_loc).normalized()
    phi = math.atan2(h1.cross(n).dot(u), h1.dot(n))
    return Matrix.Rotation(phi, 3, u) @ o1, phi


def mirror(spec):
    """Swap left/right bones and negate the lateral component of every direction."""
    out = {}
    for name, val in spec.items():
        if name.endswith('.L'):
            name = name[:-2] + '.R'
        elif name.endswith('.R'):
            name = name[:-2] + '.L'
        if isinstance(val, Vector):
            val = Vector((-val.x, val.y, val.z))
        elif isinstance(val, tuple) and val and val[0] == 'ik':
            val = ('ik', Vector((-val[1].x, val[1].y, val[1].z)), Vector((-val[2].x, val[2].y, val[2].z)))
        out[name] = val
    return out


def armature():
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    detach(arm)
    return arm


def detach(arm):
    """The importer leaves one of the imported actions assigned; it would override any pose we set."""
    if arm.animation_data:
        arm.animation_data.action = None
        for track in arm.animation_data.nla_tracks:
            track.mute = True


def _order(arm):
    seen, out = set(), []

    def visit(bone):
        if bone.name in seen:
            return
        if bone.parent:
            visit(bone.parent)
        seen.add(bone.name)
        out.append(bone.name)

    for b in arm.data.bones:
        visit(b)
    return out


def _update():
    bpy.context.view_layer.update()


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def _solve(arm, spec, hips, dz, default_feet_flat):
    """Forward kinematics done here with mathutils (reading pb.matrix back is unreliable headless).

    pose(child) = pose(parent) @ (rest(parent)^-1 @ rest(child)) @ basis(child). To aim a bone we pick the
    basis that turns that inherited orientation minimally onto the target, then store it on the pose bone.
    Returns {bone: 4x4 pose matrix in armature space}.
    """
    pose = {}
    dyn = {}
    dynO = {}
    for name in _order(arm):
        bone = arm.data.bones[name]
        rest = bone.matrix_local.copy()
        if bone.parent:
            link = bone.parent.matrix_local.inverted() @ rest
            cur = pose[bone.parent.name] @ link
        else:
            cur = rest.copy()
        if name.startswith('upper_arm.') and spec.get('ik.' + name[-1]):
            _, tgt, pole = spec['ik.' + name[-1]]
            side = name[-1]
            h_loc = _hinge_local(arm, side)
            best = None
            for flip in (1.0, -1.0):   # elbow on either side of the shoulder-hand line; keep the one needing least roll
                up_dir, fore_dir = _two_bone(cur.translation, bone.length, arm.data.bones['forearm.' + side].length, tgt, pole, flip)
                o3, phi = _arm_orientation(arm, side, cur.to_3x3(), up_dir, fore_dir, h_loc)
                elbow_dir = (up_dir.normalized() - fore_dir.normalized())
                like = elbow_dir.normalized().dot(pole.normalized()) if elbow_dir.length > 1e-6 else 0.0
                score = abs(phi) + 0.35 * (1.0 - like)      # roll is the cost; the hint breaks ties
                if best is None or score < best[0]:
                    best = (score, up_dir, fore_dir, o3)
            _, up_dir, fore_dir, o3 = best
            dyn['forearm.' + side] = fore_dir
            dynO['upper_arm.' + side] = o3
        target = dyn.get(name, spec.get(name))
        if target is None and default_feet_flat and name in ('foot.L', 'foot.R'):
            target = bone.tail_local - bone.head_local
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        basis3 = Matrix.Identity(3)
        if name in dynO:
            basis3 = cur.to_3x3().inverted() @ dynO[name]
        elif target is not None:
            c3 = cur.to_3x3()
            cur_dir = (c3 @ Vector((0, 1, 0))).normalized()
            rot = cur_dir.rotation_difference(target.normalized())
            basis3 = c3.inverted() @ rot.to_matrix() @ c3
        pb.rotation_quaternion = basis3.to_quaternion()
        loc = Vector((0, 0, 0))
        if not bone.parent:
            off = FWD * hips[0] + LEFT * hips[1] + UP * (hips[2] + dz)
            loc = rest.to_3x3().inverted() @ off
        pb.location = loc
        pose[name] = cur @ (basis3.to_4x4() @ Matrix.Identity(4)) if not loc.length else Matrix.Translation(cur.translation + (rest.to_3x3() @ loc)) @ (cur.to_3x3() @ basis3).to_4x4()
    return pose


def _foot_min_z(arm, pose):
    z = 1e9
    for name, end in FOOT_POINTS:
        m = pose[name]
        p = m.translation if end == 'head' else m @ Vector((0, arm.data.bones[name].length, 0))
        z = min(z, p.z)
    return z


def solve_pose(arm, spec, hips=(0.0, 0.0, 0.0), ground=True, default_feet_flat=True):
    """Pose the rig from `spec` (bone -> direction Vector) and hips=(f, l, u) metres; returns the hips z offset used."""
    pose = _solve(arm, spec, hips, 0.0, default_feet_flat)
    dz = 0.0
    if ground:
        for _ in range(3):  # the offset barely changes any bone's orientation, so this settles at once
            dz += GROUND_Z - _foot_min_z(arm, pose)
            pose = _solve(arm, spec, hips, dz, default_feet_flat)
    solve_pose.last = pose
    return dz


def key_pose(arm, frame):
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)


def _hips_loc_matrix_fix(arm):
    """glTF export reads pose-bone local transforms; nothing to fix, kept for clarity."""


def new_action(arm, name):
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    return act


def author_clip(arm, name, keys, fps=24, loop=False):
    """keys: list of dicts {t, spec, hips, ground}. Builds action `name`; loop=True repeats key 0 at the end."""
    act = new_action(arm, name)
    seq = list(keys)
    if loop and seq:
        seq.append({**seq[0], 't': seq[-1]['t'] + (seq[-1]['t'] - seq[-2]['t'] if len(seq) > 1 else 0.5)})
    for k in seq:
        solve_pose(arm, k['spec'], k.get('hips', (0, 0, 0)), k.get('ground', True))
        key_pose(arm, 1 + round(k['t'] * fps))
    detach(arm)
    return act


def render_pose(arm, spec, hips, ground, path, views=('side', 'front'), size=(420, 520)):
    """Workbench render of one pose from the side and front, for eyeballing."""
    solve_pose(arm, spec, hips, ground)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = size
    cam_data = bpy.data.cameras.new('prevcam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.5
    cam = bpy.data.objects.new('prevcam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for view in views:
        if view == 'side':   # looking from the character's left (+X) toward -X
            cam.location = (6, -0.2, 1.0)
            cam.rotation_euler = (1.5708, 0, 1.5708)
        elif view == 'front':
            cam.location = (0, -6, 1.0)
            cam.rotation_euler = (1.5708, 0, 0)
        elif view == 'threeq':
            cam.location = (3.6, -3.6, 1.3)
            cam.rotation_euler = (1.40, 0, 0.785)
        scene.render.filepath = f'{path}-{view}.png'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def lengthen_arms(arm, k=1.3):
    """Scale the upper arm and forearm by k along their length and bake it into the mesh and rest pose.

    The stock model's arms (0.52 m on a 1.83 m player) are too short to reach the ground in a
    three-point stance or to reach a handoff. The existing clips only rotate bones, so they keep working.
    """
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers)]
    reset_pose(arm)
    for side in ('L', 'R'):
        for n in (f'forearm.{side}', f'hand.{side}'):
            arm.data.bones[n].inherit_scale = 'NONE'  # so the forearm does not inherit the upper arm's stretch
        for n in (f'upper_arm.{side}', f'forearm.{side}'):
            arm.pose.bones[n].scale = (1, k, 1)
    bpy.context.view_layer.update()
    # bake the deformation into each mesh, then restore its armature modifier
    for o in meshes:
        with bpy.context.temp_override(active_object=o, object=o, selected_objects=[o]):
            name = next(m.name for m in o.modifiers if m.type == 'ARMATURE')
            bpy.ops.object.modifier_apply(modifier=name)
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
    # make the stretched pose the new rest pose
    with bpy.context.temp_override(active_object=arm, object=arm, selected_objects=[arm]):
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.pose.select_all(action='SELECT')
        bpy.ops.pose.armature_apply(selected=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for side in ('L', 'R'):
        for n in (f'forearm.{side}', f'hand.{side}'):
            arm.data.bones[n].inherit_scale = 'FULL'
    reset_pose(arm)
    bpy.context.view_layer.update()


def contact_sheet(paths, out, cols=4):
    """Tile PNGs into one image using Blender's bundled numpy (no extra dependencies)."""
    import numpy as np
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        imgs.append((np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4), w, h))
        bpy.data.images.remove(im)
    w, h = imgs[0][1], imgs[0][2]
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for i, (a, _, _) in enumerate(imgs):
        r_, c_ = divmod(i, cols)
        y0 = (rows - 1 - r_) * h  # Blender images are bottom-up
        sheet[y0:y0 + h, c_ * w:(c_ + 1) * w] = a
    im = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    im.pixels = sheet.ravel().tolist()
    im.filepath_raw = out
    im.file_format = 'PNG'
    im.save()


def _fk_bases(arm, bases):
    """Pose matrices (armature space) for explicit per-bone (quaternion, location) bases."""
    pose = {}
    for name in _order(arm):
        bone = arm.data.bones[name]
        q, loc = bases[name]
        basis = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
        cur = bone.matrix_local.copy() if not bone.parent else pose[bone.parent.name] @ (bone.parent.matrix_local.inverted() @ bone.matrix_local)
        pose[name] = cur @ basis
    return pose


def _mean_quat(qs):
    """Average of rotations, flipping to one hemisphere first (good for the small oscillations of a gait cycle)."""
    from mathutils import Quaternion
    ref = qs[0]
    w = x = y = z = 0.0
    for q in qs:
        sgn = 1.0 if q.dot(ref) >= 0 else -1.0
        w += sgn * q.w; x += sgn * q.x; y += sgn * q.y; z += sgn * q.z
    m = Quaternion((w, x, y, z))
    m.normalize()
    return m


def _scale_about(mean, q, factor):
    """Scale how far q swings away from `mean` (factor > 1 exaggerates the oscillation, < 1 calms it)."""
    from mathutils import Quaternion
    axis, angle = (mean.inverted() @ q).to_axis_angle()
    return mean @ Quaternion(axis, angle * factor)


# bones whose oscillation is rescaled in the run clips: longer stride, calmer shoulders, bigger arm pump
RUN_SCALE = {
    'thigh.L': 'legs', 'thigh.R': 'legs', 'shin.L': 'shins', 'shin.R': 'shins',
    'spine': 'spine', 'spine.001': 'spine', 'spine.002': 'spine', 'spine.003': 'spine', 'Bone': 'spine', 'spine.006': 'spine',
    'upper_arm.L': 'arms', 'upper_arm.R': 'arms',
}


def _lock_feet(arm, bases):
    """Lower or raise the hips so the lowest foot point rests exactly on the turf (no sinking, no floating)."""
    pose = _fk_bases(arm, bases)
    low = 1e9
    for name, end in FOOT_POINTS:
        m = pose[name]
        p = m.translation if end == 'head' else m @ Vector((0, arm.data.bones[name].length, 0))
        low = min(low, p.z)
    dz = GROUND_Z - low
    root = arm.data.bones['spine']
    q, loc = bases['spine']
    bases['spine'] = (q, loc + root.matrix_local.to_3x3().inverted() @ (UP * dz))


def bake_relaxed_arms(arm, src_name, flex=0.45, abduct=0.30, elbow=0.7, elbow_axis=0,
                      legs=1.0, shins=1.0, spine=1.0, arms=1.0, lock_feet=False):
    """Replace action `src_name` with a baked copy: arms held off the body, and (for run clips) a better gait.

    Arms: the retargeted clips hang the arms straight down at the belt, so the hands meet at the hips and read as
    hands behind the back; every frame the upper arm is pushed out and forward in world space and the elbow bent.

    Gait (legs, shins, spine, arms are factors on each bone's swing about its own cycle mean; 1.0 leaves it alone):
    the stock sprint's stride is far too short for the engine's 8 to 10 m/s (natural ground speed 4.2 m/s against a
    playback rate capped at 1.6), so the feet skate; its torso rocks about +/-12 degrees while the arms barely
    pump. legs > 1 lengthens the stride, spine < 1 calms the shoulders, arms > 1 pumps harder, and lock_feet
    keeps the lowest foot on the turf every frame.
    """
    import math
    from mathutils import Quaternion
    scene = bpy.context.scene
    src = bpy.data.actions[src_name]
    start, end = src.frame_range
    frames = []
    f = start
    while f <= end + 1e-4:
        frames.append(f)
        f += 1.0
    if frames[-1] < end - 0.3:
        frames.append(end)
    samples = []
    arm.animation_data_create()
    arm.animation_data.action = src
    for f in frames:
        scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
        samples.append({pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones})
    factor = {'legs': legs, 'shins': shins, 'spine': spine, 'arms': arms}
    means = {}
    if any(v != 1.0 for v in factor.values()):
        for bone, group in RUN_SCALE.items():
            if factor[group] != 1.0:
                means[bone] = _mean_quat([smp[bone][0] for smp in samples])
    dst_name = src_name
    src.name = src_name + '__orig'
    dst = new_action(arm, dst_name)
    for f, bases in zip(frames, samples):
        bases = {n: (q.copy(), l.copy()) for n, (q, l) in bases.items()}
        for bone, mean in means.items():
            q, loc = bases[bone]
            bases[bone] = (_scale_about(mean, q, factor[RUN_SCALE[bone]]), loc)
        pose = _fk_bases(arm, bases)
        for side, sgn in (('L', 1.0), ('R', -1.0)):
            up, fore = f'upper_arm.{side}', f'forearm.{side}'
            bone = arm.data.bones[up]
            inh = pose[bone.parent.name] @ (bone.parent.matrix_local.inverted() @ bone.matrix_local)
            o = pose[up].to_3x3()
            rw = Quaternion(FWD, sgn * abduct).to_matrix() @ Quaternion(LEFT, -flex).to_matrix()
            new_o = rw @ o
            bases[up] = ((inh.to_3x3().inverted() @ new_o).to_quaternion(), bases[up][1])
            pose = _fk_bases(arm, bases)
            axis = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))][elbow_axis]
            q, loc = bases[fore]
            bases[fore] = (q @ Quaternion(axis, elbow), loc)
            pose = _fk_bases(arm, bases)
        if lock_feet:
            _lock_feet(arm, bases)
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion, pb.location = bases[pb.name]
        key_pose(arm, f)
    detach(arm)
    bpy.data.actions.remove(src)
    return dst
