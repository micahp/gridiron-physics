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


# --------------------------------------------------------------------- locomotion
def walk():
    # Walk cycle (1.0 s, two steps): heel strike, passing, heel strike on the other leg, passing. Fills the gap
    # between standing and the jog clip, which at its slowest still shuffles and slides.
    def keyA(flip):
        spec = pose(
            torso(5, head=0),
            legs(cs(f=0.40, l=0.06, u=-0.91), cs(f=0.22, u=-0.97), cs(f=-0.38, l=-0.06, u=-0.92), cs(f=-0.62, u=-0.78)),
            hands_ik(pt(f=-0.10, l=0.30, u=0.85), pt(f=0.30, l=-0.30, u=0.88), pole_out=1.0, pole_back=0.4),
        )
        return mirror(spec) if flip else spec

    def keyP(flip):
        spec = pose(
            torso(5, head=0),
            legs(cs(f=0.04, l=0.06, u=-1.0), cs(f=-0.02, u=-1.0), cs(f=0.18, l=-0.06, u=-0.98), cs(f=-0.45, u=-0.89)),
            hands_ik(pt(f=0.10, l=0.30, u=0.83), pt(f=0.10, l=-0.30, u=0.83), pole_out=1.0, pole_back=0.4),
        )
        return mirror(spec) if flip else spec
    return {'loop': True, 'keys': [
        {'t': 0.0, 'hips': (0, 0, -0.015), 'spec': keyA(False)}, {'t': 0.25, 'hips': (0, 0, 0.0), 'spec': keyP(False)},
        {'t': 0.5, 'hips': (0, 0, -0.015), 'spec': keyA(True)}, {'t': 0.75, 'hips': (0, 0, 0.0), 'spec': keyP(True)}]}


# --------------------------------------------------------------------- default idle
def idle():
    # The default pose for anyone standing around: relaxed wide base, arms hanging at the sides and a
    # little forward with soft elbows and the hands visible beside the thighs (never clasped, never
    # behind the back), a slow weight shift and a small head turn so it never reads as frozen.
    def key(t, sway, reach, turn):
        return {'t': t, 'hips': (0.0, sway, -0.01), 'spec': pose(
            torso(5, head=0),
            {'spine.006': cs(f=0.05, l=turn, u=1.0)},
            legs(cs(l=0.12 + sway * 2, f=0.03, u=-0.99), cs(l=-0.05, f=-0.03, u=-1.0),
                 cs(l=-0.12 + sway * 2, f=0.03, u=-0.99), cs(l=0.05, f=-0.03, u=-1.0)),
            hands_ik(pt(f=0.14 + reach, l=0.29, u=0.80), pt(f=0.14 + reach, l=-0.29, u=0.80), pole_out=1.0, pole_back=0.5),
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0, 0.0, 0.0), key(1.2, 0.025, 0.02, 0.10), key(2.4, -0.02, 0.0, -0.06)]}


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


# --------------------------------------------------------------------- kicking
KICK_CONTACT = 0.42   # seconds into FB_Kick at which the foot meets the ball
PUNT_CONTACT = 0.40   # seconds into FB_Punt at which the foot meets the ball


def kick():
    # Right-footed placekick, 1.25 s: last stride, plant the left foot, cock the right leg back, swing through
    # at KICK_CONTACT, high follow-through leaning back, step down, back to a jog. The arms stay out for balance.
    run_a = pose(torso(10, head=4),
                 legs(cs(f=0.5, l=0.1, u=-0.85), cs(f=-0.4, u=-0.9), cs(f=-0.35, l=-0.1, u=-0.93), cs(f=-0.7, u=-0.7)),
                 hands_ik(pt(f=0.32, l=0.3, u=1.0), pt(f=-0.15, l=-0.3, u=1.0), pole_out=0.8))
    plant = pose(torso(2, head=8),
                 legs(cs(f=0.35, l=0.1, u=-0.93), cs(f=-0.3, u=-0.95), cs(f=-0.6, l=-0.1, u=-0.8), cs(f=-0.95, u=0.3)),
                 hands_ik(pt(f=0.35, l=0.58, u=1.08), pt(f=-0.05, l=-0.32, u=1.0), pole_out=1.0, pole_back=0.0))
    contact = pose(torso(-6, head=6),
                   legs(cs(f=0.3, l=0.1, u=-0.95), cs(f=-0.25, u=-0.97), cs(f=0.85, l=-0.05, u=-0.5), cs(f=0.9, u=-0.4)),
                   hands_ik(pt(f=0.28, l=0.62, u=1.0), pt(f=-0.12, l=-0.30, u=0.98), pole_out=1.0, pole_back=0.0))
    follow = pose(torso(-12, head=2),
                  legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.2, u=-0.98), cs(f=0.8, l=-0.05, u=0.45), cs(f=0.3, u=-0.9)),
                  hands_ik(pt(f=0.12, l=0.62, u=1.05), pt(f=0.15, l=-0.15, u=1.15), pole_out=1.0, pole_back=0.0))
    down = pose(torso(6, head=2),
                legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.2, u=-0.98), cs(f=0.3, l=-0.1, u=-0.95), cs(f=-0.2, u=-0.97)),
                hands_ik(pt(f=0.15, l=0.5, u=1.05), pt(f=0.1, l=-0.5, u=1.05), pole_out=0.9))
    jog = pose(torso(10, head=4), mirror(drive_legs(False, push=0.5)),
               hands_ik(pt(f=-0.15, l=0.3, u=1.0), pt(f=0.32, l=-0.3, u=1.0), pole_out=0.8))
    return {'loop': False, 'keys': [
        {'t': 0.0, 'spec': run_a}, {'t': 0.2, 'spec': plant, 'hips': (0.0, 0, -0.03)},
        {'t': KICK_CONTACT, 'spec': contact, 'hips': (-0.05, 0, -0.01)},
        {'t': 0.7, 'spec': follow, 'hips': (-0.1, 0, 0.0)}, {'t': 0.95, 'spec': down}, {'t': 1.25, 'spec': jog}]}


def punt():
    # Punter, 1.2 s: ball held out in both hands, step and drop it, swing the right leg up to nearly horizontal at
    # PUNT_CONTACT, high follow-through, recover.
    hold = pose(torso(6, head=6), legs(cs(f=0.35, l=0.1, u=-0.93), cs(f=-0.3, u=-0.95), cs(f=-0.2, l=-0.1, u=-0.97), cs(f=-0.35, u=-0.93)),
                hands_ik(pt(f=0.5, l=0.1, u=1.0), pt(f=0.5, l=-0.1, u=1.0), pole_out=0.5, pole_back=0.0))
    step = pose(torso(4, head=8), legs(cs(f=0.3, l=0.1, u=-0.94), cs(f=-0.25, u=-0.96), cs(f=-0.5, l=-0.1, u=-0.85), cs(f=-0.9, u=-0.2)),
                hands_ik(pt(f=0.55, l=0.12, u=0.85), pt(f=0.55, l=-0.12, u=0.85), pole_out=0.5, pole_back=0.0))
    contact = pose(torso(-10, head=4), legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.2, u=-0.98), cs(f=0.95, l=-0.05, u=0.2), cs(f=0.9, u=0.35)),
                   hands_ik(pt(f=0.25, l=0.58, u=1.05), pt(f=-0.05, l=-0.32, u=1.0), pole_out=1.0, pole_back=0.0))
    follow = pose(torso(-16, head=0), legs(cs(f=0.1, l=0.1, u=-0.99), cs(f=-0.1, u=-0.99), cs(f=0.7, l=-0.05, u=0.7), cs(f=0.6, u=0.4)),
                  hands_ik(pt(f=0.1, l=0.62, u=1.1), pt(f=0.2, l=-0.18, u=1.1), pole_out=1.0, pole_back=0.0))
    recover = pose(torso(6, head=2), legs(cs(f=0.2, l=0.1, u=-0.97), cs(f=-0.2, u=-0.98), cs(f=0.3, l=-0.1, u=-0.95), cs(f=-0.2, u=-0.97)),
                   hands_ik(pt(f=0.15, l=0.5, u=1.05), pt(f=0.1, l=-0.5, u=1.05), pole_out=0.9))
    return {'loop': False, 'keys': [
        {'t': 0.0, 'spec': hold}, {'t': 0.2, 'spec': step, 'hips': (0.0, 0, -0.03)},
        {'t': PUNT_CONTACT, 'spec': contact, 'hips': (-0.06, 0, -0.01)},
        {'t': 0.65, 'spec': follow, 'hips': (-0.12, 0, 0.0)}, {'t': 1.2, 'spec': recover}]}


def holder():
    # Field-goal holder: down on the right knee, left foot forward, leaning over the spot, left hand pressing the
    # ball down in front of him and the right hand steadying it. A small settle so it never reads as frozen.
    def key(t, press):
        return {'t': t, 'hips': (0.0, 0, 0), 'ground': False, 'spec': pose(
            torso(22, head=30),
            legs(cs(f=0.8, l=0.1, u=-0.6), cs(f=-0.1, u=-1.0), cs(f=0.05, l=-0.12, u=-1.0), cs(f=-1.0, l=0.0, u=-0.05)),
            {'foot.R': cs(f=-1.0, u=-0.1)},
            {'ik.L': ik(pt(f=0.62 + press, l=0.04, u=0.16), cs(l=0.8, f=-0.2, u=-0.5)),
             'ik.R': ik(pt(f=0.50, l=-0.28, u=0.38), cs(l=-0.9, f=-0.3, u=-0.3))},
        )}
    return {'loop': True, 'keys': [key(0.0, 0.0), key(1.0, 0.03), key(2.0, 0.0)]}


# --------------------------------------------------------------------- ball carrier
def flat(direction, head_dir=None):
    """Whole spine chain along one direction (lying poses)."""
    h = head_dir if head_dir is not None else direction
    return {'spine': direction, 'spine.001': direction, 'spine.002': direction, 'spine.003': direction, 'Bone': h, 'spine.006': h}


def stiff_arm():
    # Defender on the carrier's LEFT: left arm shoots out to hold him off, ball tucked high on the right arm,
    # shoulders leaning slightly away. 0.7 s; the arm is straight from 0.18 to 0.45 s. Mirrored for the other side.
    def run(flip, arm):
        return pose(torso(14, head=2), drive_legs(flip, push=0.5),
                    {'ik.L': ik(arm, cs(l=1.0, f=-0.3, u=-0.4)), 'ik.R': ik(pt(f=0.18, l=-0.16, u=1.15), cs(l=-0.9, f=-0.2, u=-0.5))})

    def away(s):
        s['spine.002'] = cs(f=0.24, l=-0.12, u=0.96)
        s['spine.003'] = cs(f=0.26, l=-0.14, u=0.95)
        return s
    return {'loop': False, 'keys': [
        {'t': 0.0, 'hips': (0.0, 0, 0), 'spec': run(False, pt(f=0.30, l=0.30, u=1.05))},
        {'t': 0.18, 'hips': (0.0, 0, 0), 'spec': away(run(True, pt(f=0.55, l=0.60, u=1.33)))},
        {'t': 0.45, 'hips': (0.0, 0, 0), 'spec': away(run(False, pt(f=0.55, l=0.60, u=1.33)))},
        {'t': 0.7, 'hips': (0.0, 0, 0), 'spec': run(True, pt(f=0.30, l=0.30, u=1.05))}]}


# --------------------------------------------------------------------- pass rush
def _rush_run():
    return pose(torso(14, head=2), drive_legs(False, push=0.5), hands_ik(pt(f=0.3, l=0.3, u=1.0), pt(f=-0.1, l=-0.3, u=1.0)))


def swim():
    # Pass rusher's swim move, 0.9 s, escape at 0.45 s: hands on the blocker, right arm up and over, drive through.
    stance = pose(torso(35, head=10), drive_legs(False, push=0.45),
                  hands_ik(pt(f=0.6, l=0.2, u=1.2), pt(f=0.6, l=-0.2, u=1.2), pole_out=1.0, pole_back=0.0))
    lift = pose(torso(30, head=8), drive_legs(True, push=0.45),
                {'ik.L': ik(pt(f=0.45, l=0.30, u=1.0), cs(l=0.9, f=-0.2, u=-0.5)), 'ik.R': ik(pt(f=0.2, l=-0.25, u=1.85), cs(l=-0.9, f=-0.3, u=-0.2))})
    over = pose(torso(42, head=14), drive_legs(False, push=0.55),
                {'ik.L': ik(pt(f=0.35, l=0.35, u=0.9), cs(l=0.9, f=-0.3, u=-0.5)), 'ik.R': ik(pt(f=0.58, l=0.12, u=1.5), cs(l=-0.3, f=-0.2, u=0.6))})
    drive = pose(torso(25, head=6), drive_legs(True, push=0.6),
                 hands_ik(pt(f=0.1, l=0.35, u=1.0), pt(f=0.3, l=-0.3, u=1.15), pole_out=1.0, pole_back=0.3))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': stance, 'hips': (0.03, 0, 0)}, {'t': 0.25, 'spec': lift, 'hips': (0.05, 0, 0)},
                                     {'t': 0.45, 'spec': over, 'hips': (0.10, 0, 0)}, {'t': 0.7, 'spec': drive, 'hips': (0.05, 0, 0)},
                                     {'t': 0.9, 'spec': _rush_run()}]}


def rip():
    # Rip move, 0.9 s, escape at 0.45 s: left arm swings up under the blocker's arm, right pushes down, drive past.
    stance = pose(torso(35, head=10), drive_legs(False, push=0.45),
                  hands_ik(pt(f=0.6, l=0.2, u=1.2), pt(f=0.6, l=-0.2, u=1.2), pole_out=1.0, pole_back=0.0))
    under = pose(torso(45, head=12), drive_legs(True, push=0.5),
                 {'ik.L': ik(pt(f=0.35, l=0.45, u=0.85), cs(l=0.9, f=-0.3, u=-0.6)), 'ik.R': ik(pt(f=0.45, l=-0.3, u=1.05), cs(l=-0.9, f=-0.2, u=-0.4))})
    up = pose(torso(38, head=10), drive_legs(False, push=0.55),
              {'ik.L': ik(pt(f=0.45, l=0.2, u=1.55), cs(l=0.8, f=-0.2, u=-0.3)), 'ik.R': ik(pt(f=0.4, l=-0.3, u=1.0), cs(l=-0.9, f=-0.2, u=-0.5))})
    drive = pose(torso(25, head=6), drive_legs(True, push=0.6),
                 hands_ik(pt(f=0.3, l=0.3, u=1.1), pt(f=0.1, l=-0.35, u=1.0), pole_out=1.0, pole_back=0.3))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': stance, 'hips': (0.03, 0, 0)}, {'t': 0.25, 'spec': under, 'hips': (0.05, 0, -0.04)},
                                     {'t': 0.45, 'spec': up, 'hips': (0.10, 0, 0)}, {'t': 0.7, 'spec': drive, 'hips': (0.05, 0, 0)},
                                     {'t': 0.9, 'spec': _rush_run()}]}


# --------------------------------------------------------------------- get up
def get_up():
    # From lying prone to standing, 1.3 s: push up on the hands, knees under, rise to a crouch, stand.
    prone = pose(flat(cs(f=1, u=0.1), cs(f=1, u=0.4)),
                 legs(cs(f=-1, l=0.12, u=-0.12), cs(f=-1, u=0.0), cs(f=-1, l=-0.12, u=-0.1), cs(f=-1, u=0.02)),
                 hands_ik(pt(f=0.55, l=0.38, u=0.14), pt(f=0.55, l=-0.38, u=0.14), pole_out=1.0, pole_back=-0.2))
    push = pose(flat(cs(f=1, u=0.35), cs(f=1, u=0.55)),
                legs(cs(f=-1, l=0.12, u=-0.15), cs(f=-1, u=0.0), cs(f=-1, l=-0.12, u=-0.1), cs(f=-1, u=0.02)),
                hands_ik(pt(f=0.45, l=0.30, u=0.05), pt(f=0.45, l=-0.30, u=0.05), pole_out=1.0, pole_back=0.0))
    knee = pose(torso(70, head=45),
                legs(cs(f=0.8, l=0.1, u=-0.6), cs(f=-0.1, u=-1.0), cs(f=0.1, l=-0.1, u=-1.0), cs(f=-1.0, u=-0.1)),
                {'foot.R': cs(f=-1.0, u=-0.1)},
                hands_ik(pt(f=0.55, l=0.25, u=0.1), pt(f=0.55, l=-0.25, u=0.1), pole_out=1.0, pole_back=0.0))
    crouch = pose(torso(40, head=12),
                  legs(cs(f=0.5, l=0.14, u=-0.85), cs(f=-0.4, u=-0.92), cs(f=0.4, l=-0.14, u=-0.9), cs(f=-0.3, u=-0.95)),
                  hands_ik(pt(f=0.34, l=0.26, u=0.62), pt(f=0.34, l=-0.26, u=0.62), pole_out=0.9, pole_back=0.3))
    stand = idle()['keys'][0]['spec']
    return {'loop': False, 'keys': [
        {'t': 0.0, 'spec': prone, 'hips': (0.45, 0, -0.67), 'ground': False},
        {'t': 0.35, 'spec': push, 'hips': (0.35, 0, -0.5), 'ground': False},
        {'t': 0.7, 'spec': knee, 'hips': (0.15, 0, 0.0), 'ground': False},
        {'t': 1.0, 'spec': crouch, 'hips': (0.0, 0, 0.0)},
        {'t': 1.3, 'spec': stand, 'hips': (0.0, 0, 0.0)}]}


# --------------------------------------------------------------------- QB
def dropback():
    # Quarterback backpedal with the ball held at the chest, 0.9 s cycle (two steps). Legs reach back and under,
    # eyes up, ball tight; the stride is matched to ground speed at runtime like the other gait clips.
    def keyA(flip):
        sp = pose(torso(10, head=0),
                  legs(cs(f=-0.45, l=0.05, u=-0.89), cs(f=-0.3, u=-0.95), cs(f=0.15, l=-0.05, u=-0.98), cs(f=-0.15, u=-0.99)),
                  hands_ik(pt(f=0.32, l=0.10, u=1.28), pt(f=0.32, l=-0.10, u=1.28), pole_out=0.5, pole_back=0.0))
        return mirror(sp) if flip else sp

    def keyP(flip):
        sp = pose(torso(10, head=0),
                  legs(cs(f=-0.12, l=0.05, u=-0.99), cs(f=-0.5, u=-0.85), cs(f=0.05, l=-0.05, u=-1.0), cs(f=-0.02, u=-1.0)),
                  hands_ik(pt(f=0.32, l=0.10, u=1.28), pt(f=0.32, l=-0.10, u=1.28), pole_out=0.5, pole_back=0.0))
        return mirror(sp) if flip else sp
    return {'loop': True, 'keys': [
        {'t': 0.0, 'hips': (0, 0, -0.03), 'spec': keyA(False)}, {'t': 0.225, 'hips': (0, 0, -0.01), 'spec': keyP(False)},
        {'t': 0.45, 'hips': (0, 0, -0.03), 'spec': keyA(True)}, {'t': 0.675, 'hips': (0, 0, -0.01), 'spec': keyP(True)}]}


# --------------------------------------------------------------------- catches
CATCH_REACH = 0.35   # seconds into each catch variant at which the hands meet the ball


def _ready():
    return pose(torso(14, head=4), legs(cs(f=0.25, l=0.12, u=-0.96), cs(f=-0.2, u=-0.98), cs(f=0.2, l=-0.12, u=-0.97), cs(f=-0.18, u=-0.98)),
                hands_ik(pt(f=0.4, l=0.2, u=1.2), pt(f=0.4, l=-0.2, u=1.2), pole_out=0.6, pole_back=0.0))


def catch_high():
    reach = pose(torso(-4, head=-6), legs(cs(f=0.0, l=0.08, u=-1.0), cs(f=0.0, u=-1.0), cs(f=0.0, l=-0.08, u=-1.0), cs(f=0.0, u=-1.0)),
                 hands_ik(pt(f=0.22, l=0.13, u=2.0), pt(f=0.22, l=-0.13, u=2.0), pole_out=0.3, pole_back=-0.2))
    secure = pose(torso(10, head=4), legs(cs(f=0.3, l=0.12, u=-0.94), cs(f=-0.25, u=-0.97), cs(f=0.25, l=-0.12, u=-0.95), cs(f=-0.22, u=-0.97)),
                  hands_ik(pt(f=0.28, l=0.10, u=1.35), pt(f=0.28, l=-0.10, u=1.35), pole_out=0.6, pole_back=0.0))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': _ready()}, {'t': CATCH_REACH, 'spec': reach, 'hips': (0, 0, 0.03)},
                                     {'t': 0.65, 'spec': secure, 'hips': (0, 0, -0.03)}, {'t': 0.95, 'spec': _ready()}]}


def catch_low():
    scoop = pose(torso(48, head=10), legs(cs(f=0.55, l=0.14, u=-0.83), cs(f=-0.4, u=-0.92), cs(f=0.45, l=-0.14, u=-0.89), cs(f=-0.35, u=-0.94)),
                 hands_ik(pt(f=0.55, l=0.12, u=0.55), pt(f=0.55, l=-0.12, u=0.55), pole_out=0.7, pole_back=0.0))
    secure = pose(torso(30, head=8), legs(cs(f=0.4, l=0.12, u=-0.91), cs(f=-0.3, u=-0.95), cs(f=0.35, l=-0.12, u=-0.93), cs(f=-0.28, u=-0.96)),
                  hands_ik(pt(f=0.3, l=0.10, u=1.0), pt(f=0.3, l=-0.10, u=1.0), pole_out=0.6, pole_back=0.0))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': _ready()}, {'t': CATCH_REACH, 'spec': scoop, 'hips': (0.05, 0, -0.05)},
                                     {'t': 0.65, 'spec': secure}, {'t': 0.95, 'spec': _ready()}]}


def catch_run():
    # Receiver catching in stride: arms extended forward at the ball, then pulled in, still running.
    run = pose(torso(12, head=-4), drive_legs(False, push=0.5), hands_ik(pt(f=0.32, l=0.3, u=1.0), pt(f=-0.15, l=-0.3, u=1.0), pole_out=0.8))
    reach = pose(torso(10, head=-8), drive_legs(True, push=0.5), hands_ik(pt(f=0.62, l=0.14, u=1.42), pt(f=0.62, l=-0.14, u=1.42), pole_out=0.4, pole_back=-0.2))
    tuck = pose(torso(14, head=2), drive_legs(False, push=0.5),
                {'ik.L': ik(pt(f=0.2, l=0.15, u=1.15), cs(l=1.0, f=-0.3, u=-0.4)), 'ik.R': ik(pt(f=0.3, l=-0.3, u=1.0), cs(l=-0.9, f=-0.2, u=-0.4))})
    last = pose(torso(12, head=2), drive_legs(True, push=0.5), hands_ik(pt(f=0.2, l=0.15, u=1.1), pt(f=0.3, l=-0.3, u=1.0)))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': run}, {'t': CATCH_REACH, 'spec': reach}, {'t': 0.6, 'spec': tuck}, {'t': 0.85, 'spec': last}]}


# --------------------------------------------------------------------- tackles
TACKLE_CONTACT = 0.3   # seconds into FB_Tackle_Dive / FB_Tackle_Form at which the arms close on the carrier


def tackle_dive():
    # Diving tackle, 1.0 s: launch from a run, body goes horizontal, arms reach and wrap at TACKLE_CONTACT, lands on top.
    run = pose(torso(22, head=6), drive_legs(False, push=0.55), hands_ik(pt(f=0.4, l=0.3, u=1.1), pt(f=0.3, l=-0.3, u=1.1), pole_out=0.8))
    launch = pose(flat(cs(f=1, u=0.18), cs(f=1, u=0.4)),
                  legs(cs(f=-0.9, l=0.1, u=-0.3), cs(f=-1.0, u=-0.1), cs(f=-0.95, l=-0.1, u=-0.2), cs(f=-1.0, u=0.0)),
                  hands_ik(pt(f=0.95, l=0.28, u=0.60), pt(f=0.95, l=-0.28, u=0.60), pole_out=0.8, pole_back=0.0))
    wrap = pose(flat(cs(f=1, u=0.08), cs(f=1, u=0.35)),
                legs(cs(f=-1, l=0.12, u=-0.12), cs(f=-1, u=0.0), cs(f=-1, l=-0.12, u=-0.1), cs(f=-1, u=0.02)),
                hands_ik(pt(f=0.80, l=-0.12, u=0.18), pt(f=0.80, l=0.12, u=0.18), pole_out=0.6, pole_back=0.0))
    return {'loop': False, 'keys': [
        {'t': 0.0, 'spec': run}, {'t': 0.15, 'spec': launch, 'hips': (0.35, 0, -0.1), 'ground': False},
        {'t': TACKLE_CONTACT, 'spec': launch, 'hips': (0.5, 0, -0.35), 'ground': False},
        {'t': 0.6, 'spec': wrap, 'hips': (0.55, 0, -0.62), 'ground': False}, {'t': 1.0, 'spec': wrap, 'hips': (0.55, 0, -0.67), 'ground': False}]}


def tackle_form():
    # Form tackle, 0.7 s: drop the hips, shoulder into the carrier at TACKLE_CONTACT, arms wrap, legs drive.
    run = pose(torso(22, head=6), drive_legs(False, push=0.55), hands_ik(pt(f=0.4, l=0.3, u=1.1), pt(f=0.3, l=-0.3, u=1.1), pole_out=0.8))
    hit = pose(torso(62, head=22), drive_legs(True, push=0.62),
               {'ik.L': ik(pt(f=0.75, l=-0.16, u=0.9), cs(l=0.9, f=-0.2, u=-0.2)), 'ik.R': ik(pt(f=0.75, l=0.16, u=0.9), cs(l=-0.9, f=-0.2, u=-0.2))})
    drive = tackle_wrap()['keys'][0]['spec']
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': run}, {'t': 0.15, 'spec': hit, 'hips': (0.2, 0, -0.08)},
                                     {'t': TACKLE_CONTACT, 'spec': hit, 'hips': (0.2, 0, -0.1)}, {'t': 0.7, 'spec': drive, 'hips': (0.12, 0, 0)}]}


def tackled_back():
    # Carrier hit from the front: stopped, rocked back, and driven onto his back. The last key holds.
    run = pose(torso(16, head=2), drive_legs(False, push=0.5),
               {'ik.L': ik(pt(f=0.20, l=0.16, u=1.18), cs(l=1.0, f=-0.3, u=-0.3)), 'ik.R': ik(pt(f=0.4, l=-0.3, u=1.0), cs(l=-0.9, f=-0.2, u=-0.4))})
    hit = pose(torso(-12, head=-8), legs(cs(f=0.25, l=0.1, u=-0.96), cs(f=-0.1, u=-1.0), cs(f=0.5, l=-0.1, u=-0.85), cs(f=0.0, u=-1.0)),
               {'ik.L': ik(pt(f=0.15, l=0.2, u=1.2), cs(l=1.0, f=-0.3, u=-0.3)), 'ik.R': ik(pt(f=0.1, l=-0.55, u=1.3), cs(l=-1.0, f=-0.3, u=-0.2))})
    falling = pose(flat(cs(f=-0.7, u=0.7), cs(f=-0.8, u=0.6)),
                   legs(cs(f=0.7, l=0.1, u=-0.7), cs(f=0.5, u=-0.85), cs(f=0.85, l=-0.1, u=-0.5), cs(f=0.6, u=-0.8)),
                   hands_ik(pt(f=-0.3, l=0.6, u=1.0), pt(f=-0.3, l=-0.6, u=1.0), pole_out=1.0, pole_back=0.0))
    down = pose(flat(cs(f=-1, u=0.06), cs(f=-1, u=0.3)),
                legs(cs(f=0.97, l=0.1, u=-0.1), cs(f=0.97, u=0.05), cs(f=0.97, l=-0.1, u=-0.1), cs(f=0.97, u=0.05)),
                hands_ik(pt(f=-0.45, l=0.5, u=0.12), pt(f=-0.45, l=-0.5, u=0.12), pole_out=1.0, pole_back=0.0))
    return {'loop': False, 'keys': [{'t': 0.0, 'spec': run}, {'t': 0.2, 'spec': hit, 'hips': (-0.08, 0, -0.02)},
                                     {'t': 0.5, 'spec': falling, 'hips': (-0.4, 0, -0.45), 'ground': False},
                                     {'t': 0.8, 'spec': down, 'hips': (-0.55, 0, -0.68), 'ground': False},
                                     {'t': 1.1, 'spec': down, 'hips': (-0.55, 0, -0.68), 'ground': False}]}


def all_clips():
    clips = {
        'FB_Idle': idle(),
        'FB_Walk': walk(),
        'FB_Dropback': dropback(),
        'FB_StiffArm_L': stiff_arm(),
        'FB_Swim': swim(),
        'FB_Rip': rip(),
        'FB_GetUp': get_up(),
        'FB_Catch_High': catch_high(),
        'FB_Catch_Low': catch_low(),
        'FB_Catch_Run': catch_run(),
        'FB_Tackle_Dive': tackle_dive(),
        'FB_Tackle_Form': tackle_form(),
        'FB_Tackled_Back': tackled_back(),
        'FB_Kick': kick(),
        'FB_Punt': punt(),
        'FB_Holder': holder(),
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
    for name in ('FB_Handoff_Give', 'FB_Handoff_Take', 'FB_StiffArm'):
        src = clips[name + '_L']
        clips[name + '_R'] = {'loop': src['loop'], 'keys': [{**k, 'spec': mirror(k['spec']), 'hips': (k.get('hips', (0, 0, 0))[0], -k.get('hips', (0, 0, 0))[1], k.get('hips', (0, 0, 0))[2])} for k in src['keys']]}
    return clips
