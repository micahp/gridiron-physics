"""Football clip definitions for the player rig (poses are bone directions in character space).

Each clip is {'loop': bool, 'keys': [{t, spec, hips, ground}]}. See football_rig.py for the
conventions: cs(f, l, u) is a direction (forward, left, up) and pt(f, l, u) a point in metres
from the hips' rest spot on the ground. All clips are root-motion free; the physics engine owns
position. Names are prefixed FB_ so they can never collide with the stock mocap clip names.
"""
import math

from football_rig import cs, pt, ik, mirror


def _d(deg):
    a = math.radians(deg)
    return cs(f=math.sin(a), u=math.cos(a))


def torso(lean, head=None):
    """Spine chain leaning `lean` degrees from vertical toward forward; the head looks `head` degrees."""
    head = lean * 0.4 if head is None else head
    return {
        'spine': _d(lean * 0.4), 'spine.001': _d(lean * 0.75), 'spine.002': _d(lean * 0.95), 'spine.003': _d(lean),
        'Bone': _d(head * 1.2), 'spine.006': _d(head),
    }


def legs(thigh_l, shin_l, thigh_r, shin_r):
    return {'thigh.L': thigh_l, 'shin.L': shin_l, 'thigh.R': thigh_r, 'shin.R': shin_r}


def hands_ik(left, right, pole_out=0.8, pole_back=0.35):
    return {
        'ik.L': ik(left, cs(l=pole_out, f=-pole_back, u=-0.2)),
        'ik.R': ik(right, cs(l=-pole_out, f=-pole_back, u=-0.2)),
    }


def pose(*parts):
    out = {}
    for p in parts:
        out.update(p)
    return out


# --------------------------------------------------------------------- stances
def stance_3pt():
    # Right hand down, left forearm resting on the thigh, weight forward, tail up, head up.
    # Breathing: a slow shift of the hips over the planted hand.
    def key(t, shift):
        return {'t': t, 'hips': (0.14 + shift, 0, 0), 'spec': pose(
            torso(88, head=52),
            legs(cs(f=0.75, l=0.13, u=-0.66), cs(f=-0.5, l=-0.02, u=-0.86),
                 cs(f=0.60, l=-0.13, u=-0.80), cs(f=-0.3, l=0.02, u=-0.95)),
            {'ik.R': ik(pt(f=0.72, l=-0.20, u=0.04), cs(f=-0.5, l=-0.6, u=0.1)),
             'ik.L': ik(pt(f=0.36, l=0.27, u=0.46), cs(l=0.9, f=-0.3, u=0.0))},
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0), key(0.9, 0.025)]}


def stance_2pt():
    # Athletic ready stance: knees bent, hands loose over the knees, eyes up.
    def key(t, dip):
        return {'t': t, 'hips': (0.0, 0, -dip), 'spec': pose(
            torso(34, head=6),
            legs(cs(f=0.42, l=0.16, u=-0.89), cs(f=-0.3, l=-0.04, u=-0.95),
                 cs(f=0.36, l=-0.16, u=-0.92), cs(f=-0.25, l=0.04, u=-0.97)),
            hands_ik(pt(f=0.36, l=0.24, u=0.72), pt(f=0.36, l=-0.24, u=0.72)),
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0), key(0.8, 0.03)]}


def qb_ready():
    # Standing behind the snap, knees soft, hands out front at belt height waiting for the ball.
    def key(t, dip):
        return {'t': t, 'hips': (0.0, 0, -dip), 'spec': pose(
            torso(14, head=2),
            legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.16, u=-0.99), cs(f=0.17, l=-0.1, u=-0.98), cs(f=-0.14, u=-0.99)),
            hands_ik(pt(f=0.42, l=0.07, u=0.98), pt(f=0.42, l=-0.07, u=0.98), pole_out=0.5, pole_back=0.2),
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0), key(1.0, 0.015)]}


# --------------------------------------------------------------------- blocking
def block_pass():
    # Pass set: wide base, hips down, hands up and in front of the chest ready to punch.
    def key(t, dip, reach):
        return {'t': t, 'hips': (0.0, 0, -dip), 'spec': pose(
            torso(20, head=8),
            legs(cs(f=0.30, l=0.34, u=-0.89), cs(f=-0.22, l=-0.14, u=-0.96),
                 cs(f=0.26, l=-0.34, u=-0.9), cs(f=-0.2, l=0.14, u=-0.97)),
            hands_ik(pt(f=0.50 + reach, l=0.20, u=1.30), pt(f=0.50 + reach, l=-0.20, u=1.30), pole_out=1.0, pole_back=0.1),
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0, 0.0), key(0.35, 0.04, 0.10), key(0.7, 0.0, 0.0)][:-1] + [key(0.7, 0.0, 0.0)]}


def drive_legs(flip, push=0.55):
    """Alternating leg drive: one leg planted forward and bent, the other extended behind pushing."""
    front = (cs(f=push, l=0.12, u=-0.82), cs(f=-0.45, l=-0.02, u=-0.89))
    back = (cs(f=0.05, l=-0.12, u=-0.99), cs(f=-0.5, l=0.02, u=-0.86))
    if not flip:
        return {'thigh.L': front[0], 'shin.L': front[1], 'thigh.R': back[0], 'shin.R': back[1]}
    return {'thigh.R': mirror({'thigh.L': front[0]})['thigh.R'], 'shin.R': mirror({'shin.L': front[1]})['shin.R'],
            'thigh.L': mirror({'thigh.R': back[0]})['thigh.L'], 'shin.L': mirror({'shin.R': back[1]})['shin.L']}


def block_run():
    # Drive block: low, hips driving, hands on the defender's chest, legs churning.
    def key(t, flip):
        return {'t': t, 'hips': (0.05, 0, 0), 'spec': pose(
            torso(42, head=14), drive_legs(flip),
            hands_ik(pt(f=0.78, l=0.2, u=1.18), pt(f=0.78, l=-0.2, u=1.18), pole_out=1.0, pole_back=0.0),
        )}
    return {'loop': True, 'keys': [key(0.0, False), key(0.28, True)]}


# --------------------------------------------------------------------- tackling
def tackle_wrap():
    # Arms wrapped around the ball carrier at the thighs/waist, head up, driving through.
    def key(t, flip):
        return {'t': t, 'hips': (0.12, 0, 0), 'spec': pose(
            torso(55, head=18), drive_legs(flip, push=0.6),
            {'ik.L': ik(pt(f=0.80, l=-0.14, u=0.92), cs(l=0.9, f=-0.2, u=-0.1)),
             'ik.R': ik(pt(f=0.80, l=0.14, u=0.92), cs(l=-0.9, f=-0.2, u=-0.1))},
        )}
    return {'loop': True, 'keys': [key(0.0, False), key(0.25, True)]}


def carry_struggle():
    # Ball carrier gripped by a tackler: ball high and tight on the left arm, right arm fending, legs churning.
    def key(t, flip):
        return {'t': t, 'hips': (-0.02, 0, 0), 'spec': pose(
            torso(18, head=2), drive_legs(flip, push=0.5),
            {'ik.L': ik(pt(f=0.20, l=0.16, u=1.18), cs(l=1.0, f=-0.3, u=-0.3)),
             'ik.R': ik(pt(f=0.66, l=-0.30, u=1.20), cs(l=-0.8, f=-0.2, u=-0.4))},
        )}
    return {'loop': True, 'keys': [key(0.0, False), key(0.22, True)]}


def tackled_fall():
    # One-shot: caught mid-stride, tipped forward, hands out, lands prone. The last key holds.
    run = pose(torso(22, head=6),
               legs(cs(f=0.55, l=0.1, u=-0.83), cs(f=-0.5, u=-0.87), cs(f=-0.2, l=-0.1, u=-0.98), cs(f=-0.6, u=-0.8)),
               hands_ik(pt(f=0.25, l=0.2, u=1.0), pt(f=0.25, l=-0.2, u=0.9)))
    tip = pose(torso(62, head=30),
               legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.7, u=-0.7), cs(f=-0.5, l=-0.1, u=-0.85), cs(f=-0.9, u=-0.4)),
               hands_ik(pt(f=0.72, l=0.28, u=0.55), pt(f=0.70, l=-0.28, u=0.55)))
    land = pose(torso(88, head=55),
                legs(cs(f=-0.6, l=0.1, u=-0.8), cs(f=-0.95, u=-0.3), cs(f=-0.85, l=-0.1, u=-0.5), cs(f=-1.0, u=-0.1)),
                hands_ik(pt(f=0.80, l=0.34, u=0.20), pt(f=0.82, l=-0.34, u=0.20)))
    prone = pose({'spine': cs(f=1, u=0.1), 'spine.001': cs(f=1, u=0.08), 'spine.002': cs(f=1, u=0.05), 'spine.003': cs(f=1, u=0.05),
                  'Bone': cs(f=1, u=0.35), 'spine.006': cs(f=1, u=0.4)},
                 legs(cs(f=-1, l=0.12, u=-0.12), cs(f=-1, u=0.0), cs(f=-1, l=-0.12, u=-0.1), cs(f=-1, u=0.02)),
                 hands_ik(pt(f=0.55, l=0.38, u=0.14), pt(f=0.55, l=-0.38, u=0.14), pole_out=1.0, pole_back=-0.2))
    return {'loop': False, 'keys': [
        {'t': 0.0, 'spec': run},
        {'t': 0.22, 'spec': tip, 'hips': (0.12, 0, -0.05)},
        {'t': 0.50, 'spec': land, 'hips': (0.45, 0, -0.45), 'ground': False},
        {'t': 0.80, 'spec': prone, 'hips': (0.45, 0, -0.67), 'ground': False},
        {'t': 1.10, 'spec': prone, 'hips': (0.45, 0, -0.67), 'ground': False},
    ]}


# --------------------------------------------------------------------- handoff
def handoff_give():
    # QB turns and presents the ball at the running back's belly, then pulls his hands away.
    def at(t, ball, lean_l, hips_l=0.0):
        s = pose(torso(16, head=4), legs(cs(f=0.22, l=0.1, u=-0.97), cs(f=-0.18, u=-0.99), cs(f=0.18, l=-0.1, u=-0.98), cs(f=-0.15, u=-0.99)))
        s['spine.002'] = cs(f=0.28, l=lean_l, u=0.9)
        s['spine.003'] = cs(f=0.30, l=lean_l, u=0.9)
        s.update(hands_ik(pt(f=ball[0], l=ball[1] + 0.09, u=ball[2]), pt(f=ball[0], l=ball[1] - 0.09, u=ball[2]), pole_out=0.5, pole_back=0.0))
        return {'t': t, 'spec': s, 'hips': (0, hips_l, 0)}
    return {'loop': False, 'keys': [
        at(0.0, (0.34, 0.0, 1.18), 0.0),
        at(0.28, (0.50, 0.38, 1.02), 0.22, 0.03),
        at(0.55, (0.52, 0.46, 1.00), 0.25, 0.04),
        at(0.85, (0.30, 0.12, 1.12), 0.05),
    ]}


def handoff_take():
    # Running back forms a pocket: near arm high, far arm low across the belly, then closes on the ball.
    def at(t, closed):
        gap = 0.0 if closed else 0.08
        s = pose(torso(24, head=4),
                 legs(cs(f=0.40, l=0.12, u=-0.9), cs(f=-0.3, u=-0.95), cs(f=0.05, l=-0.12, u=-0.99), cs(f=-0.35, u=-0.9)))
        s['ik.L'] = ik(pt(f=0.38, l=0.22 - gap, u=1.08), cs(l=1.0, f=-0.3, u=-0.3))
        s['ik.R'] = ik(pt(f=0.40, l=-0.06 + gap, u=0.92), cs(l=-0.6, f=-0.2, u=-0.6))
        return {'t': t, 'spec': s, 'hips': (0.02, 0, 0)}
    return {'loop': False, 'keys': [at(0.0, False), at(0.35, False), at(0.7, True), at(0.9, True)]}


def all_clips():
    clips = {
        'FB_Stance_3pt': stance_3pt(),
        'FB_Stance_2pt': stance_2pt(),
        'FB_QB_Ready': qb_ready(),
        'FB_Block_Pass': block_pass(),
        'FB_Block_Run': block_run(),
        'FB_Tackle_Wrap': tackle_wrap(),
        'FB_Carry_Struggle': carry_struggle(),
        'FB_Tackled_Fall': tackled_fall(),
        'FB_Handoff_Give_L': handoff_give(),
        'FB_Handoff_Take_L': handoff_take(),
    }
    for name in ('FB_Handoff_Give', 'FB_Handoff_Take'):
        src = clips[name + '_L']
        clips[name + '_R'] = {'loop': src['loop'], 'keys': [{**k, 'spec': mirror(k['spec']), 'hips': (k.get('hips', (0, 0, 0))[0], -k.get('hips', (0, 0, 0))[1], k.get('hips', (0, 0, 0))[2])} for k in src['keys']]}
    return clips
