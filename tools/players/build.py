"""
Builds the players' bodies: MPFB humans fitted to the game's skeleton.

    pnpm build:players          (runs this inside Blender, headless)

For each entry in builds.json:

  1. MPFB makes a human from the macro sliders (heritage, physique, age), with
     its game-engine rig and that rig's hand-painted skin weights.
  2. FIT. The game skeleton (rig.json, generated from kit.ts) is posed to
     MPFB's own limb directions — the "bind pose" — and MPFB's bones are
     stretched so every pivot lands exactly on the game's. The mesh follows.
  3. KIT. Under the shirt and trousers the anatomy is smoothed out and given
     fabric thickness, so the kit reads as clothing and not a bodysuit.
  4. DETAIL. Decimated everywhere but the head and hands, which keep MPFB's
     full resolution for the face and the grip.
  5. SEAMS. Collar, waistband and sleeves are cut as clean planar edge loops
     and every face gets a material slot: kit, skin, hand, lips, brow, eye
     white and iris. The game colours each slot per player.
  6. HAIR. Every hair style and facial-hair style is grown as a shell off this
     head's own scalp and jaw, so each fits its face. The game shows one of
     each per player.
  7. Weights merged into the game's joints; exported as GLB in game space
     (Y up, facing -Z, player's right +X) with the bind pose in the extras.

Run with Blender 4.2+ and the MPFB extension installed and enabled.
"""

import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Quaternion, Vector

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public", "models", "players")

RIG = json.load(open(os.path.join(HERE, "rig.json")))
SPEC = json.load(open(os.path.join(HERE, "builds.json")))
BUILDS = SPEC["builds"]
HAIR_STYLES = SPEC["hairStyles"]
BEARD_STYLES = SPEC["beardStyles"]
JOINTS = {j["name"]: j for j in RIG["joints"]}
ORDER = [j["name"] for j in RIG["joints"]]

# Fraction of faces kept on the body (the head and hands are left whole).
DECIMATE = float(os.environ.get("PLAYER_DECIMATE", "0.5"))

# Hand joints in the game mark the centre of the fist and are never rotated,
# so the hand is weighted to the forearm and moves rigidly with it.
SKINNED = [n for n in ORDER if not n.startswith("hand")]

FINGERS = ("thumb", "index", "middle", "ring", "pinky")

# MPFB game-engine bone -> game joint, for weights.
WEIGHT_MAP = {
    "Root": "pelvis", "pelvis": "pelvis",
    "spine_01": "spine", "spine_02": "spine",
    "spine_03": "chest", "clavicle_l": "chest", "clavicle_r": "chest",
    "neck_01": "head", "head": "head",
}
for mp, g in (("l", "L"), ("r", "R")):
    WEIGHT_MAP.update({
        f"thigh_{mp}": f"hip{g}", f"calf_{mp}": f"knee{g}", f"foot_{mp}": f"ankle{g}", f"ball_{mp}": f"ankle{g}",
        f"upperarm_{mp}": f"shoulder{g}", f"lowerarm_{mp}": f"elbow{g}", f"hand_{mp}": f"elbow{g}",
    })
    for finger in FINGERS:
        for k in (1, 2, 3):
            WEIGHT_MAP[f"{finger}_0{k}_{mp}"] = f"elbow{g}"

# Which MPFB bones are under which garment.
SHIRT_BONES = {"spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r"}
TROUSER_BONES = {"Root", "pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r"}
HEAD_BONES = {"head", "neck_01"}
HAND_BONES = {f"hand_{s}" for s in "lr"} | {f"{f}_0{k}_{s}" for f in FINGERS for k in (1, 2, 3) for s in "lr"}

# Slots the game colours. "sleeve" is shirt or skin by role; "hand" is hidden
# under gloves.
SLOTS = ["skin", "shirt", "trousers", "sleeve", "hand", "boot", "lips", "brow", "eye", "iris"]

FORWARD = Vector((0, -1, 0))  # MPFB faces -Y
UP = Vector((0, 0, 1))


# --------------------------------------------------------------------------
# Coordinates. MPFB faces -Y with the player's left at +X; the game faces -Z
# with the player's right at +X.
# --------------------------------------------------------------------------

def b2g(v):
    return Vector((-v.x, v.z, v.y))


def g2b(v):
    return Vector((-v.x, v.z, v.y))


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# The game skeleton's bind pose
# --------------------------------------------------------------------------

def aim(local_from, parent_world_rot, world_dir):
    """Local rotation that turns `local_from` (in the joint's parent frame) to `world_dir`."""
    want = parent_world_rot.inverted() @ world_dir.normalized()
    return local_from.normalized().rotation_difference(want)


def bind_pose(dirs):
    """FK over rig.json with each joint aimed along MPFB's direction for it."""
    local, pos, rot = {}, {}, {}
    for name in ORDER:
        j = JOINTS[name]
        parent = j["parent"]
        prot = rot[parent] if parent else Quaternion()
        ppos = pos[parent] if parent else Vector((0, 0, 0))
        pos[name] = ppos + prot @ Vector(j["offset"])
        q = aim(dirs[name][0], prot, dirs[name][1]) if name in dirs else Quaternion()
        local[name] = q
        rot[name] = prot @ q
    return local, pos, rot


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def select_only(*objs):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def group_weights(obj):
    """Per vertex: {group name: weight}."""
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups} for v in obj.data.vertices]


def dominant(weights, among=None):
    best, bw = None, 0.0
    for n, w in weights.items():
        if (among is None or n in among) and w > bw:
            best, bw = n, w
    return best


def centroid(obj, group):
    gi = obj.vertex_groups[group].index
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    if not pts:
        raise RuntimeError(f"no vertices in {group}")
    return sum(pts, Vector()) / len(pts), pts


# --------------------------------------------------------------------------
# 1. The human
# --------------------------------------------------------------------------

def make_human(macros):
    m = TargetService.get_default_macro_info_dict()
    for k, v in macros.items():
        if k == "race":
            m["race"].update(v)
        else:
            m[k] = v
    human = HumanService.create_human(macro_detail_dict=m, scale=0.1)
    rig = HumanService.add_builtin_rig(human, "game_engine")
    # The sliders are shape keys; bake the mix into the mesh so it can be fitted.
    select_only(human)
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    return human, rig


# --------------------------------------------------------------------------
# 2. Fit
# --------------------------------------------------------------------------

def fit(human, rig):
    """Stretch MPFB's bones onto the game skeleton's bind pose and bake the mesh into that shape."""
    bones = rig.data.bones

    def head(n):
        return b2g(rig.matrix_world @ bones[n].head_local)

    def tail(n):
        return b2g(rig.matrix_world @ bones[n].tail_local)

    def d(a, b):
        return (b - a).normalized()

    S = RIG["skeleton"]
    fist = {s: head(f"hand_{s}").lerp(head(f"middle_01_{s}"), 0.6) for s in "lr"}
    dirs = {
        "pelvis": (Vector((0, 1, 0)), d(head("pelvis"), head("spine_01"))),
        "spine": (Vector((0, 1, 0)), d(head("spine_01"), head("spine_03"))),
        "chest": (Vector((0, 1, 0)), d(head("spine_03"), head("neck_01"))),
        "head": (Vector((0, 1, 0)), d(head("neck_01"), tail("head"))),
    }
    for s, g in (("l", "L"), ("r", "R")):
        dirs[f"hip{g}"] = (Vector((0, -1, 0)), d(head(f"thigh_{s}"), tail(f"thigh_{s}")))
        dirs[f"knee{g}"] = (Vector((0, -1, 0)), d(head(f"calf_{s}"), tail(f"calf_{s}")))
        dirs[f"ankle{g}"] = (Vector((0, -0.06, -0.14)), d(head(f"foot_{s}"), tail(f"foot_{s}")))
        dirs[f"shoulder{g}"] = (Vector((0, -1, 0)), d(head(f"upperarm_{s}"), tail(f"upperarm_{s}")))
        dirs[f"elbow{g}"] = (Vector((0, -1, 0)), d(head(f"lowerarm_{s}"), fist[s]))
    local, pos, rot = bind_pose(dirs)

    # Natural lengths, scaled to the game body, for the parts the game skeleton
    # does not measure: the head above the neck, the foot, the clavicle.
    k = S["hipY"] / head("thigh_l").y
    targets = {}

    def put(bone, h, t):
        targets[bone] = (h, t)

    r1 = (head("spine_02") - head("spine_01")).length / (head("spine_03") - head("spine_01")).length
    r3 = (tail("spine_03") - head("spine_03")).length / (head("neck_01") - head("spine_03")).length
    put("pelvis", pos["pelvis"], pos["spine"])
    put("spine_01", pos["spine"], pos["spine"].lerp(pos["chest"], r1))
    put("spine_02", pos["spine"].lerp(pos["chest"], r1), pos["chest"])
    put("spine_03", pos["chest"], pos["chest"].lerp(pos["head"], r3))
    up = dirs["head"][1]
    neck_len = (head("head") - head("neck_01")).length * k
    head_len = (tail("head") - head("head")).length * k
    put("neck_01", pos["head"], pos["head"] + up * neck_len)
    put("head", pos["head"] + up * neck_len, pos["head"] + up * (neck_len + head_len))
    for s, g in (("l", "L"), ("r", "R")):
        clav = pos["chest"] + rot["chest"] @ ((head(f"clavicle_{s}") - head("spine_03")) * k)
        put(f"clavicle_{s}", clav, pos[f"shoulder{g}"])
        put(f"thigh_{s}", pos[f"hip{g}"], pos[f"knee{g}"])
        put(f"calf_{s}", pos[f"knee{g}"], pos[f"ankle{g}"])
        foot_dir = dirs[f"ankle{g}"][1]
        put(f"foot_{s}", pos[f"ankle{g}"], pos[f"ankle{g}"] + foot_dir * (tail(f"foot_{s}") - head(f"foot_{s}")).length * k)
        put(f"upperarm_{s}", pos[f"shoulder{g}"], pos[f"elbow{g}"])
        lower_dir = d(head(f"lowerarm_{s}"), tail(f"lowerarm_{s}"))
        put(f"lowerarm_{s}", pos[f"elbow{g}"], pos[f"elbow{g}"] + lower_dir * S["forearm"])

    # Free the targeted bones from their parents' stretch, so each one's length
    # is its own target and not compounded down the chain.
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in targets:
        eb = rig.data.edit_bones[name]
        eb.use_connect = False
        eb.inherit_scale = "NONE"
    bpy.ops.object.mode_set(mode="OBJECT")

    for name, (h, t) in targets.items():
        eh = bpy.data.objects.new(f"t.{name}.h", None)
        et = bpy.data.objects.new(f"t.{name}.t", None)
        for e, p in ((eh, h), (et, t)):
            bpy.context.collection.objects.link(e)
            e.location = g2b(p)
        pb = rig.pose.bones[name]
        c = pb.constraints.new("COPY_LOCATION")
        c.target = eh
        c = pb.constraints.new("STRETCH_TO")
        c.target = et
        c.volume = "NO_VOLUME"
        c.rest_length = rig.data.bones[name].length

    # A relaxed, half-closed hand rather than MPFB's flat open palm.
    curl = float(os.environ.get("PLAYER_CURL", "1.0"))
    for s in "lr":
        for finger, amount in (("index", 0.8), ("middle", 0.9), ("ring", 1.0), ("pinky", 1.05), ("thumb", 0.35)):
            for kk in (1, 2, 3):
                pb = rig.pose.bones[f"{finger}_0{kk}_{s}"]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (0, 0, curl * amount * (0.7 if kk == 1 else 1.0))
    bpy.context.view_layer.update()

    select_only(human)
    arm_mod = next(md for md in human.modifiers if md.type == "ARMATURE")
    bpy.ops.object.modifier_move_to_index(modifier=arm_mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=arm_mod.name)

    worst = 0.0
    for name, (h, t) in targets.items():
        got = b2g(rig.matrix_world @ rig.pose.bones[name].head)
        worst = max(worst, (got - h).length)

    # Bone positions after the fit, in Blender space, for the seams.
    posed = {pb.name: (rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail) for pb in rig.pose.bones}
    return local, pos, worst, posed


# --------------------------------------------------------------------------
# Landmarks and helpers
# --------------------------------------------------------------------------

def landmarks(human):
    """Face landmarks off MPFB's joint markers and eye geometry, after the fit (Blender space)."""
    L = {}
    for name in ("joint-jaw", "joint-neck", "joint-head-2"):
        L[name], _ = centroid(human, name)
    # MPFB's "joint-mouth" is a skeleton joint inside the head, near eye
    # height; the mouth itself is where the lips are.
    L["mouth"], _ = centroid(human, "lips")
    for s in "lr":
        c, pts = centroid(human, f"helper-{s}-eye")
        L[f"eye-{s}"] = c
        L[f"eye-{s}-r"] = max((p - c).length for p in pts)
    L["eyes"] = (L["eye-l"] + L["eye-r"]) / 2
    # Skull centre: behind the eyes, at eye height.
    L["skull"] = L["eyes"] + Vector((0, 0.075, 0))
    return L


def strip_helpers(human):
    """Delete MPFB's helper geometry (tights, skirt, teeth, joint markers), keeping the eyeballs."""
    keep = {human.vertex_groups[n].index for n in ("body", "helper-l-eye", "helper-r-eye")}
    for md in list(human.modifiers):
        if md.type == "MASK":
            human.modifiers.remove(md)
    bm = bmesh.new()
    bm.from_mesh(human.data)
    deform = bm.verts.layers.deform.active
    gone = [v for v in bm.verts if not any(g in keep for g in v[deform].keys())]
    bmesh.ops.delete(bm, geom=gone, context="VERTS")
    bm.to_mesh(human.data)
    bm.free()


# --------------------------------------------------------------------------
# 3. Kit: clothing over the anatomy
# --------------------------------------------------------------------------

def dress(human):
    """
    Smooth the anatomy out from under the shirt and trousers and give them
    thickness. Laplacian smoothing is what removes the pectorals, nipples and
    abdominals a tight cel band would otherwise draw; the inflation puts back
    the volume smoothing takes away, plus a little for the cloth.
    """
    weights = group_weights(human)
    shirt = [sum(w.get(b, 0) for b in SHIRT_BONES) for w in weights]
    trousers = [sum(w.get(b, 0) for b in TROUSER_BONES) for w in weights]
    covered = [max(a, b) for a, b in zip(shirt, trousers)]
    # Smoothing flattens anything convex, so it is kept to the trunk and
    # thighs, where the anatomy to hide is; shoulders and arms keep their
    # shape under the cloth and only get its thickness.
    trunk = [sum(w.get(b, 0) for b in ("spine_01", "spine_02", "spine_03", "pelvis", "Root", "thigh_l", "thigh_r")) for w in weights]
    bm = bmesh.new()
    bm.from_mesh(human.data)
    bm.verts.ensure_lookup_table()
    core = [v for v in bm.verts if trunk[v.index] > 0.95]
    edge = [v for v in bm.verts if 0.6 < trunk[v.index] <= 0.95]
    for _ in range(5):
        bmesh.ops.smooth_vert(bm, verts=core, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=edge, factor=0.3, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in bm.verts:
        c = covered[v.index]
        if c > 0.6:
            thick = 0.007 * shirt[v.index] + 0.005 * trousers[v.index]
            v.co += v.normal * thick * smoothstep(0.6, 0.95, c)
    bm.to_mesh(human.data)
    bm.free()


# --------------------------------------------------------------------------
# 4. Detail
# --------------------------------------------------------------------------

def decimate(human):
    """Thin the body; leave the head (the face) and the hands (the grip) whole."""
    weights = group_weights(human)
    vg = human.vertex_groups.new(name="_decimate")
    for i, w in enumerate(weights):
        keep = sum(w.get(b, 0) for b in HEAD_BONES | HAND_BONES) + w.get("helper-l-eye", 0) + w.get("helper-r-eye", 0)
        vg.add([i], 1.0 - clamp(keep), "REPLACE")
    md = human.modifiers.new("decimate", "DECIMATE")
    md.ratio = DECIMATE
    md.vertex_group = vg.name
    select_only(human)
    bpy.ops.object.modifier_apply(modifier="decimate")
    human.vertex_groups.remove(human.vertex_groups["_decimate"])


# --------------------------------------------------------------------------
# 5. Seams and slots
# --------------------------------------------------------------------------

def seams(human, posed, L):
    """
    Cut the collar, waistband and sleeve hems as planar edge loops, then give
    every face its slot. Planes, not bone weights, decide the kit edges: a
    weight boundary zig-zags across triangles, a plane cuts a clean line.
    """
    # Pivot on the middle of the neck, not its front: tilted about the front,
    # the line climbs halfway up the back of the neck.
    collar_co = Vector((0, L["skull"].y - 0.012, L["joint-neck"].z - 0.022))
    collar_no = Vector((0, -0.3, 1)).normalized()  # a little lower at the front
    waist_co = posed["pelvis"][0] + Vector((0, 0, 0.075))
    waist_no = Vector((0, -0.2, 1)).normalized()
    sleeve = {}
    for s in "lr":
        h, t = posed[f"upperarm_{s}"]
        sleeve[s] = (h.lerp(t, 0.55), (t - h).normalized())

    bm = bmesh.new()
    bm.from_mesh(human.data)
    deform = bm.verts.layers.deform.active
    gname = {g.index: g.name for g in human.vertex_groups}

    def face_bone(f):
        acc = {}
        for v in f.verts:
            for gi, w in v[deform].items():
                n = gname[gi]
                acc[n] = acc.get(n, 0) + w
        return acc

    def cut(faces, co, no):
        faces = list(set(faces))
        if not faces:
            return
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=co, plane_no=no)

    def faces_of(bones_set):
        return [f for f in bm.faces if dominant(face_bone(f), WEIGHT_BONES) in bones_set]

    cut(faces_of({"neck_01", "spine_03", "clavicle_l", "clavicle_r"}), collar_co, collar_no)
    cut(faces_of({"Root", "pelvis", "spine_01", "spine_02"}), waist_co, waist_no)
    for s in "lr":
        cut(faces_of({f"upperarm_{s}"}), *sleeve[s])

    eye_groups = {human.vertex_groups[f"helper-{s}-eye"].index: s for s in "lr"}
    lips = human.vertex_groups["lips"].index
    nails = human.vertex_groups["fingernails"].index

    def slot(f):
        c = f.calc_center_median()
        acc = face_bone(f)
        for gi, s in eye_groups.items():
            if all(gi in v[deform] for v in f.verts):
                e, r = L[f"eye-{s}"], L[f"eye-{s}-r"]
                return "iris" if (c - e).dot(FORWARD) > 0.72 * r else "eye"
        if sum(v[deform].get(lips, 0) for v in f.verts) / len(f.verts) > 0.5:
            return "lips"
        if sum(v[deform].get(nails, 0) for v in f.verts) / len(f.verts) > 0.5:
            return "hand"
        bone = dominant(acc, WEIGHT_BONES)
        if bone in HAND_BONES:
            return "hand"
        if bone in ("foot_l", "foot_r", "ball_l", "ball_r"):
            return "boot"
        if bone in ("calf_l", "calf_r", "thigh_l", "thigh_r"):
            return "trousers"
        if bone in ("lowerarm_l", "lowerarm_r"):
            return "sleeve"
        if bone in ("upperarm_l", "upperarm_r"):
            co, no = sleeve[bone[-1]]
            return "shirt" if (c - co).dot(no) < 0 else "sleeve"
        if bone in HEAD_BONES:
            if (c - collar_co).dot(collar_no) > 0:
                return "brow" if is_brow(c, f.normal, L) else "skin"
            return "shirt"
        if bone in ("spine_03", "clavicle_l", "clavicle_r"):
            return "shirt"
        if bone in ("Root", "pelvis", "spine_01", "spine_02"):
            return "shirt" if (c - waist_co).dot(waist_no) > 0 else "trousers"
        return "skin"

    for name in SLOTS:
        human.data.materials.append(bpy.data.materials.get(name) or bpy.data.materials.new(name))
    for f in bm.faces:
        f.material_index = SLOTS.index(slot(f))
    bm.to_mesh(human.data)
    bm.free()


WEIGHT_BONES = set(WEIGHT_MAP.keys())


def is_brow(c, normal, L):
    """An eyebrow: a band above each eye, arching, on the front of the face."""
    if normal.dot(FORWARD) < 0.15:
        return False
    for s in "lr":
        e, r = L[f"eye-{s}"], L[f"eye-{s}-r"]
        dx = c.x - e.x
        outward = dx if s == "l" else -dx  # +X is the player's left
        if outward < -0.019 or outward > 0.03:
            continue
        span = (outward + 0.019) / 0.049  # 0 at the nose end, 1 at the tail
        arch = 0.0065 * math.sin(math.pi * clamp(span * 1.15))
        low = e.z + r * 1.2 + arch - 0.006 * span * span
        thick = 0.0072 - 0.0042 * span
        if low <= c.z <= low + thick and c.y < e.y + 0.012:
            return True
    return False


# --------------------------------------------------------------------------
# 6. Hair and facial hair
# --------------------------------------------------------------------------

def frontness(p, L):
    """1 straight ahead of the skull, 0 at the ears, -1 at the back."""
    d = Vector((p.x - L["skull"].x, p.y - L["skull"].y, 0))
    return d.normalized().dot(FORWARD) if d.length > 1e-6 else 0.0


def is_beard(p, L, ears, lips):
    if ears or lips:
        return False
    f = frontness(p, L)
    m = L["mouth"]
    if f > 0.78:
        top = m.z + 0.016  # the upper lip, under the nose
    elif f > 0.3:
        top = m.z + 0.032  # the cheek line
    elif f > -0.12:
        top = L["eyes"].z - 0.022  # sideburns down to the jaw
    else:
        return False
    bottom = m.z - 0.088  # under the chin, onto the top of the neck
    if not bottom < p.z < top:
        return False
    # Keep the mouth open.
    if abs(p.x - m.x) < 0.024 and abs(p.z - m.z) < 0.009 and f > 0.7:
        return False
    return True


def shell(human, name, material, faces_test, offset_of, noise=0.0, extra_smooth=2):
    """
    Grow a shell off the faces `faces_test` accepts: each vertex pushed out
    along its normal by `offset_of(p)`, the rim closed back to the skin, and
    optionally roughened. A new object, weighted wholly to the head.
    """
    src = bmesh.new()
    src.from_mesh(human.data)
    src.normal_update()
    deform = src.verts.layers.deform.active
    picked = [f for f in src.faces if faces_test(f, deform)]
    if not picked:
        raise RuntimeError(f"{name}: no faces matched")
    out = bmesh.new()
    vmap = {}
    for f in picked:
        for v in f.verts:
            if v not in vmap:
                vmap[v] = out.verts.new(v.co + v.normal * offset_of(v.co))
    for f in picked:
        out.faces.new([vmap[v] for v in f.verts])
    src.free()
    inner = [v for v in out.verts if not v.is_boundary]
    for _ in range(extra_smooth):
        bmesh.ops.smooth_vert(out, verts=inner, factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # The edge follows face boundaries, so it is a staircase; relax it along
    # itself (each boundary vertex toward its two boundary neighbours), which
    # turns a stepped hairline into a line without shrinking the shell.
    for _ in range(6):
        moved = {}
        for v in out.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moved[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in moved.items():
            v.co = co
    me = bpy.data.meshes.new(name)
    out.to_mesh(me)
    out.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    me.materials.append(bpy.data.materials.get(material) or bpy.data.materials.new(material))
    select_only(obj)
    if noise > 0:
        tex = bpy.data.textures.new(f"{name}-noise", "CLOUDS")
        tex.noise_scale = 0.008
        disp = obj.modifiers.new("rough", "DISPLACE")
        disp.texture = tex
        disp.strength = noise
        disp.mid_level = 0.5
        bpy.ops.object.modifier_apply(modifier="rough")
    sol = obj.modifiers.new("rim", "SOLIDIFY")
    sol.thickness = 0.004
    sol.offset = -1
    sol.use_rim = True
    sol.use_rim_only = True  # the inside is never seen; skip a second surface
    bpy.ops.object.modifier_apply(modifier="rim")
    bpy.ops.object.shade_smooth()
    vg = obj.vertex_groups.new(name="head")
    vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    return obj


def hair_styles(human, L):
    """One shell per hair style off the scalp; see builds.json for the list."""
    scalp = human.vertex_groups["scalp"].index
    ears = human.vertex_groups["ears"].index
    top = L["joint-head-2"].z
    eyes = L["eyes"]
    neck = L["joint-neck"]
    hn = {g.index: g.name for g in human.vertex_groups}

    def on_scalp(f, deform, receding=False, nape=False):
        if any(v[deform].get(ears, 0) > 0.3 for v in f.verts):
            return False
        c = f.calc_center_median()
        if sum(v[deform].get(scalp, 0) for v in f.verts) / len(f.verts) > 0.5:
            if receding and frontness(c, L) > 0.35 and c.z > eyes.z + 0.04:
                return False
            return True
        if nape:
            # Long hair: on down the back of the neck to the collar.
            head = sum(w for v in f.verts for gi, w in v[deform].items() if hn[gi] in HEAD_BONES) / len(f.verts)
            return head > 0.5 and frontness(c, L) < -0.35 and c.z > neck.z + 0.02
        return False

    def height(p):
        return clamp((p.z - eyes.z) / (top - eyes.z))

    objs = []
    for style in HAIR_STYLES:
        name = style["name"]
        if name == "bald":
            continue
        base, crown, front, noise = style["offset"], style.get("crown", 0), style.get("front", 0), style.get("noise", 0)
        receding, nape = style.get("receding", False), style.get("nape", False)

        def test(f, deform, receding=receding, nape=nape):
            return on_scalp(f, deform, receding, nape)

        def offset(p, base=base, crown=crown, front=front):
            return base + crown * height(p) + front * height(p) * clamp(frontness(p, L))

        objs.append(shell(human, f"hair-{name}", "hair", test, offset, noise))
    return objs


def beard_styles(human, L):
    ears = human.vertex_groups["ears"].index
    lips = human.vertex_groups["lips"].index
    hn = {g.index: g.name for g in human.vertex_groups}
    m = L["mouth"]

    def region(f, deform):
        head = sum(w for v in f.verts for gi, w in v[deform].items() if hn[gi] in HEAD_BONES) / len(f.verts)
        if head < 0.5:
            return False
        c = f.calc_center_median()
        if f.normal.dot(UP) < -0.9:  # the very underside of the jaw, edge-on to everything
            pass
        e = any(v[deform].get(ears, 0) > 0.2 for v in f.verts)
        lp = any(v[deform].get(lips, 0) > 0.2 for v in f.verts)
        return is_beard(c, L, e, lp)

    def chin(c):
        return abs(c.x - m.x) < 0.028 and frontness(c, L) > 0.68 and c.z < m.z + 0.002

    def lip(c):
        return abs(c.x - m.x) < 0.031 and frontness(c, L) > 0.62 and m.z + 0.008 < c.z < m.z + 0.024

    shapes = {
        "full": lambda c: True,
        "short": lambda c: True,
        "stubble": lambda c: True,
        "goatee": chin,
        "moustache": lip,
        "goatee-moustache": lambda c: chin(c) or lip(c),
    }
    objs = []
    for style in BEARD_STYLES:
        name = style["name"]
        if name == "none":
            continue
        keep = shapes[style.get("shape", name)]

        def test(f, deform, keep=keep):
            return region(f, deform) and keep(f.calc_center_median())

        objs.append(shell(human, f"beard-{name}", "beard", test, lambda p, o=style["offset"]: o, style.get("noise", 0), 1))
    return objs


# --------------------------------------------------------------------------
# 7. Weights, armature, export
# --------------------------------------------------------------------------

def merge_weights(human):
    """Collapse MPFB's bones' weights into the game's joints."""
    me = human.data
    gname = {g.index: g.name for g in human.vertex_groups}
    per_vertex = []
    for v in me.vertices:
        acc = {}
        for g in v.groups:
            target = WEIGHT_MAP.get(gname[g.group])
            if target is None and gname[g.group] in ("helper-l-eye", "helper-r-eye"):
                target = "head"
            if target and g.weight > 0:
                acc[target] = acc.get(target, 0.0) + g.weight
        per_vertex.append(acc)
    for g in list(human.vertex_groups):
        human.vertex_groups.remove(g)
    groups = {n: human.vertex_groups.new(name=n) for n in SKINNED}
    unweighted = 0
    for i, acc in enumerate(per_vertex):
        if not acc:
            unweighted += 1
            continue
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top)
        for n, w in top:
            groups[n].add([i], w / total, "REPLACE")
    if unweighted:
        raise RuntimeError(f"{unweighted} vertices have no weight on any game joint")


def game_armature(pos):
    """An armature with one bone per skinned game joint, at the bind pivots, to carry the skin."""
    arm = bpy.data.armatures.new("rig")
    obj = bpy.data.objects.new("rig", arm)
    bpy.context.collection.objects.link(obj)
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in ORDER:
        if name not in SKINNED:
            continue
        b = arm.edit_bones.new(name)
        b.head = g2b(pos[name])
        child = next((c["name"] for c in RIG["joints"] if c["parent"] == name and c["name"] in pos), None)
        tip = pos[child] if child else pos[name] + Vector((0, 0.1, 0))
        if (tip - pos[name]).length < 1e-3:
            tip = pos[name] + Vector((0, 0.1, 0))
        b.tail = g2b(tip)
        parent = JOINTS[name]["parent"]
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def build(entry):
    reset()
    human, rig = make_human(entry["macros"])
    local, pos, worst, posed = fit(human, rig)
    if worst > 0.002:
        raise RuntimeError(f"{entry['name']}: bones missed their pivots by {worst * 1000:.1f} mm")
    L = landmarks(human)
    if os.environ.get("PLAYER_DEBUG"):
        for key in ("lips", "scalp", "ears"):
            L[f"debug-{key}"], _ = centroid(human, key)
        for key, v in L.items():
            print("LANDMARK", key, [round(x, 3) for x in v] if hasattr(v, "x") else round(v, 4))
    strip_helpers(human)
    dress(human)
    decimate(human)
    seams(human, posed, L)
    accessories = hair_styles(human, L) + beard_styles(human, L)
    merge_weights(human)

    keep = {human.name} | {a.name for a in accessories}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for md in list(human.modifiers):
        human.modifiers.remove(md)
    select_only(human)
    bpy.ops.object.shade_smooth()

    arm = game_armature(pos)
    human.name = entry["name"]
    for o in [human] + accessories:
        o.parent = arm
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = arm

    # Into game space: a half turn about Blender Z, so glTF's Y-up conversion
    # lands the body facing -Z with the player's right at +X.
    arm.rotation_euler = (0, 0, math.pi)
    select_only(arm, human, *accessories)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    arm["bind"] = json.dumps({n: [q.x, q.y, q.z, q.w] for n, q in local.items() if n in SKINNED})
    arm["build"] = entry["name"]

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{entry['name']}.glb")
    select_only(arm, human, *accessories)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_skins=True,
        export_animations=False, export_extras=True, export_yup=True, export_morph=False,
        export_materials="EXPORT", export_image_format="NONE", export_texcoords=False,
    )
    tris = sum(len(p.vertices) - 2 for p in human.data.polygons)
    extra = sum(sum(len(p.vertices) - 2 for p in a.data.polygons) for a in accessories)
    print(f"PLAYER {entry['name']}: {tris} body tris + {extra} hair, {os.path.getsize(path) // 1024} KB")
    return {"name": entry["name"], "file": f"{entry['name']}.glb", "heritage": entry["heritage"],
            "physique": entry["physique"], "skin": entry["skin"]}


def main():
    only = os.environ.get("PLAYER_ONLY")
    done = [build(b) for b in BUILDS if not only or b["name"] == only]
    if not only:
        with open(os.path.join(OUT, "manifest.json"), "w") as f:
            json.dump({
                "builds": done,
                "hairStyles": [h["name"] for h in HAIR_STYLES],
                "beardStyles": [b["name"] for b in BEARD_STYLES],
            }, f, indent=2)
            f.write("\n")


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
