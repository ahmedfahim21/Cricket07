"""
What every player build shares, whatever the body came from (MPFB, Rocketbox):
coordinates, the game skeleton's bind pose, fitting a source rig onto it,
merging weights into the game's joints, and exporting.

A source skeleton is described by a SPEC: which of its bones play which part.

    pelvis      the pelvis bone (its head is at hip height)
    spine       bones from the game's spine pivot up to its chest pivot
    chest       bones from the chest pivot up to the neck
    neck, head  the neck and head bones
    clavicle, thigh, calf, foot, toe, upperarm, lowerarm, hand, knuckle
                per-side names, with "{s}" for the side tag
    sides       the side tags for the player's (left, right)
    fingers     per-side finger bone names to curl, with an amount each
    curl_axis   the local axis fingers curl about
"""

import bpy
import json
import os
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RIG = json.load(open(os.path.join(HERE, "rig.json")))
JOINTS = {j["name"]: j for j in RIG["joints"]}
ORDER = [j["name"] for j in RIG["joints"]]
S = RIG["skeleton"]

# Hand joints in the game mark the centre of the fist and are never rotated,
# so the hand is weighted to the forearm and moves rigidly with it.
SKINNED = [n for n in ORDER if not n.startswith("hand")]


# --------------------------------------------------------------------------
# Coordinates. Both sources face -Y with the player's left at +X; the game
# faces -Z with the player's right at +X.
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
# Blender helpers
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
# The game skeleton's bind pose
# --------------------------------------------------------------------------

def aim(local_from, parent_world_rot, world_dir):
    """Local rotation that turns `local_from` (in the joint's parent frame) to `world_dir`."""
    want = parent_world_rot.inverted() @ world_dir.normalized()
    return local_from.normalized().rotation_difference(want)


def bind_pose(dirs):
    """FK over rig.json with each joint aimed along the source's direction for it."""
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
# Fitting a source rig onto the game skeleton
# --------------------------------------------------------------------------

def fit(mesh, rig, spec, crown=None):
    """
    Pose the game skeleton along the source's limb directions (the bind pose),
    stretch the source's bones so every pivot lands on the game's, curl the
    fingers, and bake the mesh into that shape.

    `crown`, in Blender space, is the top of the head where the source's head
    bone does not end there. Returns (bind rotations, bind positions, worst
    pivot error, posed bones in Blender space).
    """
    bones = rig.data.bones
    left, right = spec["sides"]

    def name(key, side=None):
        return spec[key].format(s=side) if side else spec[key]

    def head(n):
        return b2g(rig.matrix_world @ bones[n].head_local)

    def tail(n):
        return b2g(rig.matrix_world @ bones[n].tail_local)

    def d(a, b):
        return (b - a).normalized()

    top = b2g(crown) if crown is not None else tail(spec["head"])
    spine0, chest0 = spec["spine"][0], spec["chest"][0]
    fist = {s: head(name("hand", s)).lerp(head(name("knuckle", s)), 0.6) for s in (left, right)}
    dirs = {
        "pelvis": (Vector((0, 1, 0)), d(head(spec["pelvis"]), head(spine0))),
        "spine": (Vector((0, 1, 0)), d(head(spine0), head(chest0))),
        "chest": (Vector((0, 1, 0)), d(head(chest0), head(spec["neck"]))),
        "head": (Vector((0, 1, 0)), d(head(spec["neck"]), top)),
    }
    for s, g in ((left, "L"), (right, "R")):
        dirs[f"hip{g}"] = (Vector((0, -1, 0)), d(head(name("thigh", s)), head(name("calf", s))))
        dirs[f"knee{g}"] = (Vector((0, -1, 0)), d(head(name("calf", s)), head(name("foot", s))))
        dirs[f"ankle{g}"] = (Vector((0, -0.06, -0.14)), d(head(name("foot", s)), head(name("toe", s))))
        dirs[f"shoulder{g}"] = (Vector((0, -1, 0)), d(head(name("upperarm", s)), head(name("lowerarm", s))))
        dirs[f"elbow{g}"] = (Vector((0, -1, 0)), d(head(name("lowerarm", s)), fist[s]))
    local, pos, rot = bind_pose(dirs)

    # The source's own proportions, scaled to the game body, for what the game
    # skeleton does not measure: head above the neck, foot, clavicle.
    k = S["hipY"] / head(name("thigh", left)).y
    targets = {}
    # Where each fitted bone's rest tail should point: along its real limb.
    ends = {}

    def chain(bones_, start, end, a, b):
        """
        Spread a chain of bones over the game segment a-b, keeping their
        proportions. Each bone runs to the next one's head (the last to the
        chain's end): imported tails are not reliable — a Biped's can point
        anywhere.
        """
        u = end - start
        span = u.length
        u = u / span

        def frac(p):
            return clamp((p - start).dot(u) / span)

        heads = [frac(head(bn)) for bn in bones_] + [1.0]
        nexts = [head(bn) for bn in bones_[1:]] + [end]
        for i, bn in enumerate(bones_):
            targets[bn] = (a.lerp(b, heads[i]), a.lerp(b, heads[i + 1]))
            ends[bn] = nexts[i]

    targets[spec["pelvis"]] = (pos["pelvis"], pos["spine"])
    chain(spec["spine"], head(spine0), head(chest0), pos["spine"], pos["chest"])
    chain(spec["chest"], head(chest0), head(spec["neck"]), pos["chest"], pos["head"])
    up = dirs["head"][1]
    neck_len = (head(spec["head"]) - head(spec["neck"])).length * k
    head_len = (top - head(spec["head"])).length * k
    targets[spec["neck"]] = (pos["head"], pos["head"] + up * neck_len)
    targets[spec["head"]] = (pos["head"] + up * neck_len, pos["head"] + up * (neck_len + head_len))
    ends[spec["pelvis"]] = head(spine0)
    ends[spec["neck"]] = head(spec["head"])
    ends[spec["head"]] = top
    for s, g in ((left, "L"), (right, "R")):
        ends[name("clavicle", s)] = head(name("upperarm", s))
        ends[name("thigh", s)] = head(name("calf", s))
        ends[name("calf", s)] = head(name("foot", s))
        ends[name("foot", s)] = head(name("toe", s))
        ends[name("upperarm", s)] = head(name("lowerarm", s))
        ends[name("lowerarm", s)] = head(name("hand", s))
    for s, g in ((left, "L"), (right, "R")):
        clav = pos["chest"] + rot["chest"] @ ((head(name("clavicle", s)) - head(chest0)) * k)
        targets[name("clavicle", s)] = (clav, pos[f"shoulder{g}"])
        targets[name("thigh", s)] = (pos[f"hip{g}"], pos[f"knee{g}"])
        targets[name("calf", s)] = (pos[f"knee{g}"], pos[f"ankle{g}"])
        foot_len = (head(name("toe", s)) - head(name("foot", s))).length * k
        targets[name("foot", s)] = (pos[f"ankle{g}"], pos[f"ankle{g}"] + dirs[f"ankle{g}"][1] * foot_len)
        targets[name("upperarm", s)] = (pos[f"shoulder{g}"], pos[f"elbow{g}"])
        lower_dir = d(head(name("lowerarm", s)), head(name("hand", s)))
        targets[name("lowerarm", s)] = (pos[f"elbow{g}"], pos[f"elbow{g}"] + lower_dir * S["forearm"])

    # Free the targeted bones from their parents' stretch, so each one's length
    # is its own target and not compounded down the chain. And re-aim each
    # one's rest tail along its limb: Stretch To swings a bone so its REST
    # head-to-tail axis points at the target, and an imported tail can point
    # anywhere (a Biped head bone's points down into the jaw), which would
    # swing the head right back. Changing the rest bones does not move the
    # mesh; it deforms only by the pose relative to the rest.
    to_arm = rig.matrix_world.inverted()
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for n in targets:
        eb = rig.data.edit_bones[n]
        eb.use_connect = False
        eb.inherit_scale = "NONE"
        eb.tail = to_arm @ g2b(ends[n])
    bpy.ops.object.mode_set(mode="OBJECT")

    for n, (h, t) in targets.items():
        eh = bpy.data.objects.new(f"t.{n}.h", None)
        et = bpy.data.objects.new(f"t.{n}.t", None)
        for e, p in ((eh, h), (et, t)):
            bpy.context.collection.objects.link(e)
            e.location = g2b(p)
        pb = rig.pose.bones[n]
        c = pb.constraints.new("COPY_LOCATION")
        c.target = eh
        c = pb.constraints.new("STRETCH_TO")
        c.target = et
        c.volume = "NO_VOLUME"
        c.rest_length = rig.data.bones[n].length

    # A relaxed, half-closed hand rather than a flat open palm.
    curl = float(os.environ.get("PLAYER_CURL", "1.0"))
    axis = {"X": 0, "Y": 1, "Z": 2}[os.environ.get("PLAYER_CURL_AXIS", spec["curl_axis"])]
    for s in (left, right):
        for pattern, amount in spec["fingers"]:
            bn = pattern.format(s=s)
            pb = rig.pose.bones[bn]
            pb.rotation_mode = "XYZ"
            e = [0.0, 0.0, 0.0]
            e[axis] = curl * amount
            pb.rotation_euler = e
    bpy.context.view_layer.update()

    select_only(mesh)
    arm_mod = next(md for md in mesh.modifiers if md.type == "ARMATURE")
    bpy.ops.object.modifier_move_to_index(modifier=arm_mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=arm_mod.name)

    worst = 0.0
    for n, (h, t) in targets.items():
        got = b2g(rig.matrix_world @ rig.pose.bones[n].head)
        worst = max(worst, (got - h).length)
    posed = {pb.name: (rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail) for pb in rig.pose.bones}
    return local, pos, worst, posed


# --------------------------------------------------------------------------
# Weights, armature, export
# --------------------------------------------------------------------------

def merge_weights(obj, joint_of):
    """
    Collapse the source's bone weights into the game's joints. `joint_of(group)`
    names the joint a group belongs to, or None for a group that carries no
    deformation. A weighted group it does not know is an error, not a guess.
    """
    gname = {g.index: g.name for g in obj.vertex_groups}
    per_vertex = []
    unknown = set()
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            if g.weight <= 0:
                continue
            n = gname[g.group]
            target = joint_of(n)
            if target is False:
                unknown.add(n)
            elif target:
                acc[target] = acc.get(target, 0.0) + g.weight
        per_vertex.append(acc)
    if unknown:
        raise RuntimeError(f"weighted groups with no game joint: {sorted(unknown)}")
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {n: obj.vertex_groups.new(name=n) for n in SKINNED}
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
    for n in ORDER:
        if n not in SKINNED:
            continue
        b = arm.edit_bones.new(n)
        b.head = g2b(pos[n])
        child = next((c["name"] for c in RIG["joints"] if c["parent"] == n and c["name"] in pos), None)
        tip = pos[child] if child else pos[n] + Vector((0, 0.1, 0))
        if (tip - pos[n]).length < 1e-3:
            tip = pos[n] + Vector((0, 0.1, 0))
        b.tail = g2b(tip)
        parent = JOINTS[n]["parent"]
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def export(name, meshes, pos, local, path, image_format="NONE"):
    """
    Parent `meshes` to a game armature, turn everything into game space (a
    half turn about Blender Z, so glTF's Y-up conversion lands the body facing
    -Z with the player's right at +X), and write a GLB with the bind pose in
    the armature's extras.
    """
    import math
    arm = game_armature(pos)
    for o in meshes:
        o.parent = arm
        for md in list(o.modifiers):
            o.modifiers.remove(md)
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    arm.rotation_euler = (0, 0, math.pi)
    select_only(arm, *meshes)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    arm["bind"] = json.dumps({n: [q.x, q.y, q.z, q.w] for n, q in local.items() if n in SKINNED})
    arm["build"] = name
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_only(arm, *meshes)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_skins=True,
        export_animations=False, export_extras=True, export_yup=True, export_morph=False,
        export_materials="EXPORT", export_image_format=image_format,
        export_texcoords=image_format != "NONE",
    )
    return arm
