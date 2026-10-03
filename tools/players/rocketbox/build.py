"""
Builds players from Microsoft Rocketbox avatars (MIT): their faces, hair and
skin are photographic textures, which is the look a TV-era cricket game had.

    node tools/players/rocketbox/fetch.mjs     download the FBX + colour maps
    pnpm build:rocketbox                       this script, inside Blender

For each avatar in avatars.json:

  1. FIT. The Biped skeleton is stretched onto the game skeleton exactly as the
     MPFB bodies are (common.fit): same pivots, bind pose stored for the game.
  2. KIT. The avatar's street clothes keep their shape — a shirt modelled as a
     shirt reads as one — but not their colour: every clothed face becomes a
     kit slot (shirt, sleeve, trousers, boot) the game paints per side.
  3. SKIN. The head keeps its texture (face, hair), as do the hands and the
     alpha-cut hair and lash cards. The skin tone of anything painted flat
     (bare forearms under short sleeves) is sampled off the avatar's own hand
     texture, so it matches the face.
  4. Exported as GLB with 1024px JPEG/PNG textures, and added to the players
     manifest next to the MPFB builds.
"""

import bpy
import bmesh
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from common import ROOT, dominant, export, fit, merge_weights, reset, select_only  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", ".cache", "rocketbox")
OUT = os.path.join(ROOT, "public", "models", "players")
AVATARS = json.load(open(os.path.join(HERE, "avatars.json")))["avatars"]
TEXTURE = int(os.environ.get("PLAYER_TEXTURE", "1024"))

BIPED = {
    "pelvis": "Bip01 Pelvis",
    "spine": ["Bip01 Spine"],
    "chest": ["Bip01 Spine1", "Bip01 Spine2"],
    "neck": "Bip01 Neck",
    "head": "Bip01 Head",
    "clavicle": "Bip01 {s} Clavicle", "thigh": "Bip01 {s} Thigh", "calf": "Bip01 {s} Calf",
    "foot": "Bip01 {s} Foot", "toe": "Bip01 {s} Toe0",
    "upperarm": "Bip01 {s} UpperArm", "lowerarm": "Bip01 {s} Forearm", "hand": "Bip01 {s} Hand",
    "knuckle": "Bip01 {s} Finger2",
    "sides": ("L", "R"),
    "fingers": [
        (f"Bip01 {{s}} Finger{n}{seg}", amount * (0.7 if seg == "" else 1.0))
        for n, amount in ((1, 0.8), (2, 0.9), (3, 1.0), (4, 1.05), (0, 0.3))
        for seg in ("", "1", "2")
    ],
    "curl_axis": "Z",
}

LIMB = {
    "Clavicle": "chest", "UpperArm": "shoulder", "Forearm": "elbow", "Hand": "elbow",
    "Thigh": "hip", "Calf": "knee", "Foot": "ankle", "Toe0": "ankle",
}
TRUNK = {"Bip01 Pelvis": "pelvis", "Bip01 Spine": "spine", "Bip01 Spine1": "chest", "Bip01 Spine2": "chest"}


def joint_of(group):
    """A Biped bone's game joint. Face bones (jaw, lips, brows, eyes) ride on the head."""
    if group in TRUNK:
        return TRUNK[group]
    if group in ("Bip01 Neck", "Bip01 Head"):
        return "head"
    parts = group.split(" ")
    if len(parts) == 3 and parts[0] == "Bip01" and parts[1] in ("L", "R"):
        part = "Finger" if parts[2].startswith("Finger") else parts[2]
        joint = "elbow" if part == "Finger" else LIMB.get(part)
        if joint is None:
            return False
        return joint if joint in ("chest", "pelvis") else f"{joint}{parts[1]}"
    if group.startswith("Bip01 "):
        return "head"  # Bip01 LCheek, Bip01 MJaw, ...: the face rig
    return False


def import_avatar(a):
    path = os.path.join(CACHE, a["id"], f"{a['id']}.fbx")
    if not os.path.exists(path):
        raise RuntimeError(f"{a['id']}: not downloaded; run tools/players/rocketbox/fetch.mjs")
    bpy.ops.import_scene.fbx(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{a['id']}: expected one mesh, found {len(meshes)}")
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    return meshes[0], rig


def texture(mat):
    """The colour map of an imported Rocketbox material."""
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and n.image.filepath.endswith("_color.tga"):
            return n.image
    raise RuntimeError(f"{mat.name}: no colour texture")


def save_small(img, name, fmt, size=None):
    """Downscale a texture and save it beside the cache, so the exporter keeps its format."""
    small = img.copy()
    small.scale(size or TEXTURE, size or TEXTURE)
    ext = "png" if fmt == "PNG" else "jpg"
    path = os.path.join(CACHE, "_out", f"{name}.{ext}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    small.filepath_raw = path
    small.file_format = fmt
    small.save()
    return bpy.data.images.load(path, check_existing=False)


def textured(name, img, alpha=False):
    """A material carrying one colour map (and its alpha for cut-out cards)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.blend_method = "CLIP" if hasattr(m, "blend_method") else m.blend_method
    return m


def flat(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def skin_tone(mesh, body_img, hand_faces):
    """Average texture colour over the hands: the avatar's skin, for painted skin."""
    w, h = body_img.size
    px = body_img.pixels[:]
    uv = mesh.data.uv_layers.active.data
    acc = [0.0, 0.0, 0.0]
    n = 0
    for poly in hand_faces:
        for li in poly.loop_indices:
            u, v = uv[li].uv
            x = min(w - 1, max(0, int(u * w)))
            y = min(h - 1, max(0, int(v * h)))
            i = (y * w + x) * 4
            for c in range(3):
                acc[c] += px[i + c]
            n += 1
    if not n:
        raise RuntimeError("no hand faces to sample skin from")

    # An 8-bit image's pixels come back as stored: already sRGB.
    r, g, b = (round(max(0.0, min(1.0, c / n)) * 255) for c in acc)
    return f"{r:02x}{g:02x}{b:02x}"


def classify(mesh, body_img, kind, bone_of, hip_z):
    """
    Which garment every body-map face is.

    The body is one welded mesh — shirt, trousers, shoes and skin — but each
    garment is unwrapped to its own islands in the texture, so the UV islands
    are the garments. Each island is decided as a whole: skin if most of it is
    skin-coloured, otherwise by a vote of where on the body its faces are
    (faces at the hips vote by height, since a hem and a waistband are both
    there). Deciding per face instead breaks on a two-tone top.
    """
    import numpy as np
    from bpy_extras.mesh_utils import mesh_linked_uv_islands

    w, h = body_img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    body_img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    uv = mesh.data.uv_layers.active.data
    polys = mesh.data.polygons
    mw = mesh.matrix_world

    def colour(poly):
        us = [uv[li].uv for li in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        x = min(w - 1, max(0, int(cu * w)))
        y = min(h - 1, max(0, int(cv * h)))
        return px[y, x]

    def warm(c):
        # Skin, however dark, is warm: clearly redder than it is blue. Grey,
        # white and black cloth are neutral.
        return (c[0] - c[2]) / max(float(c[0]), 1e-3) > 0.18 and c[0] >= c[1]

    belt = hip_z + 0.08

    def region_vote(poly):
        b = bone_of(poly) or ""
        part = b.replace("Bip01 ", "")
        bits = part.split(" ")
        limb = bits[-1] if len(bits) == 2 and bits[0] in ("L", "R") else part
        if limb in ("Foot", "Toe0"):
            return "boot"
        if limb in ("Thigh", "Calf"):
            return "trousers"
        if part in ("Pelvis", "Spine"):
            return "shirt" if (mw @ poly.center).z > belt else "trousers"
        if limb in ("Hand",) or limb.startswith("Finger"):
            return "hand"
        return "shirt"

    # This avatar's own skin: the fingers are never covered.
    fingers = [colour(p) for p in polys if kind[p.material_index] == "body" and " Finger" in (bone_of(p) or "")]
    if not fingers:
        raise RuntimeError("no finger faces to take the skin colour from")
    skin_ref = np.median(np.array(fingers), axis=0)

    torso_bones = ("Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 Pelvis", "Bip01 Neck")

    islands = []
    for island in mesh_linked_uv_islands(mesh.data):
        faces = [polys[i] for i in island if kind[polys[i].material_index] == "body"]
        if not faces:
            continue
        cols = np.array([colour(f) for f in faces])
        votes = {}
        for f in faces:
            g = region_vote(f)
            votes[g] = votes.get(g, 0) + 1
        bones = [bone_of(f) or "" for f in faces]
        islands.append({
            "faces": faces,
            "median": np.median(cols, axis=0),
            "warmth": sum(1 for c in cols if warm(c)) / len(faces),
            "votes": votes,
            "legs": votes.get("trousers", 0) + votes.get("boot", 0) > len(faces) / 2,
            "torso": sum(1 for b in bones if b in torso_bones or "Clavicle" in b) > len(faces) / 2,
        })

    def fabric(isl):
        votes = dict(isl["votes"])
        votes.pop("hand", None)  # a cuff island over the wrist is still the shirt
        return max(votes, key=votes.get) if votes else "shirt"

    def d2(a, b):
        return float(np.sum((a - b) ** 2))

    # Skin is warm AND the colour of this avatar's skin: warmth alone takes in
    # red jackets and khaki trousers. The torso first, where a bare chest is
    # rare and a beige jumper is not, so only a very close match counts.
    out = {}
    shirt_cols = []
    for isl in islands:
        if not isl["torso"]:
            continue
        skin = isl["warmth"] > 0.6 and d2(isl["median"], skin_ref) < 0.004
        g = "skin" if skin else fabric(isl)
        if g == "shirt":
            shirt_cols.append(isl["median"])
        for f in isl["faces"]:
            out[f.index] = g
    shirt_ref = np.median(np.array(shirt_cols), axis=0) if shirt_cols else None

    # Then the rest. Sleeves match their shirt: an arm is bare only if it is
    # nearer the skin than the shirt. Legs, where brown cloth is common and
    # bare skin is not, need a close match too.
    for isl in islands:
        if isl["torso"]:
            continue
        m = isl["median"]
        limit = 0.012 if isl["legs"] else 0.03
        skin = isl["warmth"] > 0.6 and d2(m, skin_ref) < limit
        if skin and shirt_ref is not None and not isl["legs"]:
            skin = d2(m, skin_ref) < d2(m, shirt_ref)
        g = "skin" if skin else fabric(isl)
        for f in isl["faces"]:
            out[f.index] = g
    return out


def slots(mesh, a, hip_z):
    """Give every face its slot; return the textures to keep and the sampled skin tone."""
    mats = list(mesh.data.materials)
    kind = {}
    for i, m in enumerate(mats):
        n = m.name.lower()
        kind[i] = "head" if n.endswith("_head") else "cards" if "opacity" in n else "body" if n.endswith("_body") else None
        if kind[i] is None:
            raise RuntimeError(f"{a['id']}: unknown material {m.name}")
    head_img = texture(next(m for i, m in enumerate(mats) if kind[i] == "head"))
    body_img = texture(next(m for i, m in enumerate(mats) if kind[i] == "body"))
    cards = [m for i, m in enumerate(mats) if kind[i] == "cards"]
    cards_img = texture(cards[0]) if cards else None

    names = {g.index: g.name for g in mesh.vertex_groups}
    weights = [{names[g.group]: g.weight for g in v.groups} for v in mesh.data.vertices]

    def bone_of(poly):
        acc = {}
        for vi in poly.vertices:
            for n, w in weights[vi].items():
                acc[n] = acc.get(n, 0) + w
        return dominant(acc)

    garment = classify(mesh, body_img, kind, bone_of, hip_z)
    slot_of = {}
    hands = []
    for poly in mesh.data.polygons:
        k = kind[poly.material_index]
        if k == "head":
            slot_of[poly.index] = "face"
        elif k == "cards":
            slot_of[poly.index] = "hair-cards"
        else:
            g = garment[poly.index]
            bone = bone_of(poly)
            if g == "skin":
                hand = " Hand" in bone or " Finger" in bone
                slot_of[poly.index] = "hand" if hand else "bare"
                if hand:
                    hands.append(poly)
            elif g == "shirt":
                slot_of[poly.index] = "sleeve" if " Forearm" in bone else "shirt"
            else:
                slot_of[poly.index] = g
    skin = skin_tone(mesh, body_img, hands)

    order = ["face", "bare", "hand", "hair-cards", "shirt", "sleeve", "trousers", "boot"]
    used = [s for s in order if s in slot_of.values()]
    new = {}
    for s in used:
        if s == "face":
            new[s] = textured("face", save_small(head_img, f"{a['id']}-head", "JPEG"))
        elif s in ("hand", "bare"):
            if "body" not in new:
                new["body"] = save_small(body_img, f"{a['id']}-body", "JPEG")
            new[s] = textured(s, new["body"])
        elif s == "hair-cards":
            # Strands and lashes: thin, and only ever seen small. Half the
            # resolution of the face is plenty, and PNG (for the alpha) is
            # the heaviest thing in the file.
            new[s] = textured("hair-cards", save_small(cards_img, f"{a['id']}-cards", "PNG", TEXTURE // 2), alpha=True)
        else:
            new[s] = flat(s)
    mesh.data.materials.clear()
    for s in used:
        mesh.data.materials.append(new[s])
    for poly in mesh.data.polygons:
        poly.material_index = used.index(slot_of[poly.index])
    return skin


def seat_feet(mesh):
    """
    Lift the shoes onto the ground. A Rocketbox ankle sits ~10 cm up inside a
    thick-soled shoe; the game's sits 7.5 cm up, so after the fit the soles are
    a few centimetres under the turf. Foot-weighted vertices rise by the
    overlap, in proportion to how much they belong to the foot, so the ankle
    stays joined to the leg.
    """
    names = {g.index: g.name for g in mesh.vertex_groups}
    mw = mesh.matrix_world
    inv = mw.inverted()
    feet = []
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if names[g.group].endswith((" Foot", " Toe0")))
        if w > 0:
            feet.append((v, min(1.0, w)))
    lowest = min((mw @ v.co).z for v, w in feet if w > 0.9)
    if lowest >= -0.002:
        return 0.0
    lift = -lowest + 0.003
    for v, w in feet:
        world = mw @ v.co
        world.z += lift * w
        v.co = inv @ world
    return lift


def build(a):
    reset()
    mesh, rig = import_avatar(a)
    crown = Vector((0, 0, max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)))
    crown.y = (rig.matrix_world @ rig.data.bones[BIPED["head"]].head_local).y
    local, pos, worst, posed = fit(mesh, rig, BIPED, crown=crown)
    if worst > 0.002:
        raise RuntimeError(f"{a['id']}: bones missed their pivots by {worst * 1000:.1f} mm")
    lift = seat_feet(mesh)
    skin = slots(mesh, a, posed[BIPED["pelvis"]][0].z)
    merge_weights(mesh, joint_of)
    for o in list(bpy.data.objects):
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    world = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = world
    select_only(mesh)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    name = f"rb-{a['id'].lower().replace('_', '-')}"
    mesh.name = name
    path = os.path.join(OUT, f"{name}.glb")
    export(name, [mesh], pos, local, path, image_format="AUTO")
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print(f"PLAYER {name}: {tris} tris, skin #{skin}, fit {worst * 1000:.2f} mm, feet +{lift * 100:.1f} cm, {os.path.getsize(path) // 1024} KB")
    return {"name": name, "file": f"{name}.glb", "source": "rocketbox", "avatar": a["id"], "skin": skin}


def main():
    only = os.environ.get("PLAYER_ONLY")
    done = [build(a) for a in AVATARS if not only or a["id"] == only]
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path))
    names = {d["name"] for d in done}
    manifest["builds"] = [b for b in manifest["builds"] if b["name"] not in names] + done
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
