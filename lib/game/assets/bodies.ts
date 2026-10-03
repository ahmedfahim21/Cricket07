/**
 * Players' bodies: MPFB humans built in Blender by `tools/players/build.py`,
 * skinned onto the game's own rig.
 *
 * The animation never touches these meshes. It poses the rig's joints exactly
 * as before — FK, IK, the bat in both hands — and the skin follows. That is the
 * point of fitting the bodies to OUR skeleton rather than importing MPFB's:
 * the bat still meets the ball where the physics says it does.
 *
 * A body file holds one build (heritage x physique) with every hair style and
 * facial-hair style grown off that head; a player shows one of each. Colours
 * are not in the file at all: every surface is a named slot the game paints
 * per player, which is what lets a roster describe a player in a few words.
 *
 * Binding: each GLB is exported in MPFB's A-pose, with the rig rotation that
 * matches that pose (the "bind pose") stored in the armature's extras. To
 * bind, the rig is put into that pose, the inverse of every joint's matrix is
 * taken, and the rig goes back to whatever it was doing. Only the vertex
 * weights and joint names come from the file; the joints are the rig's own.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { JOINTS, type JointName } from "./joints";

/**
 * Material slots the build scripts write. Flat slots are painted per player;
 * textured slots ("face", "bare" skin, "hair-cards" — Rocketbox avatars'
 * photographic head, skin and hair) keep the map that came in the file, and
 * the kit slots around them are painted as for any body. "hand" can be
 * either: flat on an MPFB body, textured on an avatar.
 */
export const BODY_SLOTS = [
  "skin", "shirt", "trousers", "sleeve", "hand", "boot", "lips", "brow", "eye", "iris", "face", "bare", "hair-cards",
] as const;
export type BodySlot = (typeof BODY_SLOTS)[number];
export type BodyColours = Record<Exclude<BodySlot, "face" | "bare" | "hair-cards"> | "hair" | "beard", number>;

/** The skull, measured off the mesh in the head joint's frame (unscaled), so headgear fits it. */
export interface HeadFit {
  centre: THREE.Vector3;
  /** Top of the skull above the head pivot. */
  crown: number;
  /** Half-width of the skull, ear to ear. */
  radius: number;
}

export interface BodyTemplate {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Material slot per geometry group, in group order. */
  slots: BodySlot[];
  /** The texture a slot keeps from the file, where it has one. */
  maps: Map<BodySlot, THREE.Texture>;
  /** Hair and facial-hair shells, by style name. */
  hair: Map<string, THREE.BufferGeometry>;
  beard: Map<string, THREE.BufferGeometry>;
  /** The rig joint each skin index refers to (the same for the body and its shells). */
  joints: JointName[];
  /** Local rotation of every skinned joint in the pose the mesh was exported in. */
  bind: Map<JointName, THREE.Quaternion>;
}

export type BodyLibrary = Map<string, BodyTemplate>;

export interface Manifest {
  builds: { name: string; file: string; source: "mpfb" | "rocketbox"; skin: string; heritage?: string; physique?: string; avatar?: string }[];
  hairStyles: string[];
  beardStyles: string[];
}

export async function loadManifest(base = "/models/players"): Promise<Manifest> {
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`players manifest: ${res.status} ${res.statusText}`);
  return (await res.json()) as Manifest;
}

/**
 * Load the named builds (all of them by default). Fails loudly: a match with a
 * player who has no body is not one that should start.
 */
export async function loadBodies(names?: Iterable<string>, base = "/models/players"): Promise<BodyLibrary> {
  const manifest = await loadManifest(base);
  const wanted = names ? new Set(names) : new Set(manifest.builds.map((b) => b.name));
  for (const n of wanted) {
    if (!manifest.builds.some((b) => b.name === n)) throw new Error(`no body "${n}" in the players manifest`);
  }
  const loader = new GLTFLoader();
  const entries = await Promise.all(
    manifest.builds
      .filter((b) => wanted.has(b.name))
      .map(async (b) => templateFrom((await loader.loadAsync(`${base}/${b.file}`)).scene, b.name))
  );
  return new Map(entries.map((t) => [t.name, t]));
}

/** Parse a loaded body scene into a template. Exported for tests, which load the GLB from disk. */
export function templateFrom(scene: THREE.Object3D, name: string): BodyTemplate {
  const meshes: THREE.SkinnedMesh[] = [];
  let bindJson: string | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    if (typeof o.userData?.bind === "string") bindJson = o.userData.bind;
  });
  if (!meshes.length) throw new Error(`body ${name}: no skinned mesh`);
  if (!bindJson) throw new Error(`body ${name}: no bind pose in the armature's extras`);
  const skeleton = meshes[0].skeleton;
  for (const m of meshes) {
    if (m.skeleton.bones.length !== skeleton.bones.length || m.skeleton.bones.some((b, i) => b.name !== skeleton.bones[i].name)) {
      throw new Error(`body ${name}: its parts are skinned to different skeletons`);
    }
    if (Array.isArray(m.material)) throw new Error(`body ${name}: a part has more than one material`);
  }

  const joints = skeleton.bones.map((b) => {
    if (!(JOINTS as readonly string[]).includes(b.name)) throw new Error(`body ${name}: unknown joint "${b.name}"`);
    return b.name as JointName;
  });
  const raw = JSON.parse(bindJson) as Record<string, [number, number, number, number]>;
  const bind = new Map<JointName, THREE.Quaternion>();
  for (const j of joints) {
    const q = raw[j];
    if (!q) throw new Error(`body ${name}: no bind rotation for ${j}`);
    bind.set(j, new THREE.Quaternion(q[0], q[1], q[2], q[3]));
  }

  // GLTFLoader splits a multi-material mesh into one skinned mesh per
  // material, all on one skin. The body's parts are merged back into one
  // geometry with a group per slot; hair and beard shells stay separate,
  // keyed by style.
  const parts: THREE.SkinnedMesh[] = [];
  const hair = new Map<string, THREE.BufferGeometry>();
  const beard = new Map<string, THREE.BufferGeometry>();
  for (const m of meshes) {
    const slot = (m.material as THREE.Material).name;
    if (slot === "hair" || slot === "beard") {
      const style = m.name.replace(/^(hair|beard)-/, "");
      (slot === "hair" ? hair : beard).set(style, m.geometry);
    } else if ((BODY_SLOTS as readonly string[]).includes(slot)) {
      parts.push(m);
    } else {
      throw new Error(`body ${name}: unknown material slot "${slot}"`);
    }
  }
  const slots = parts.map((m) => (m.material as THREE.Material).name as BodySlot);
  const maps = new Map<BodySlot, THREE.Texture>();
  parts.forEach((m, i) => {
    const map = (m.material as THREE.MeshStandardMaterial).map;
    if (map) maps.set(slots[i], map);
  });
  for (const s of ["face", "bare", "hair-cards"] as const) {
    if (slots.includes(s) && !maps.has(s)) throw new Error(`body ${name}: textured slot "${s}" has no texture`);
  }
  const geometry = mergeGeometries(parts.map((m) => m.geometry), true);
  if (!geometry) throw new Error(`body ${name}: its parts could not be merged`);
  return { name, geometry, slots, maps, hair, beard, joints, bind };
}

/** The joints a body binds to, as the rig provides them. */
export type JointSet = Record<JointName, THREE.Object3D> & { root: THREE.Object3D };

/** What to show and how to paint it. */
export interface BodyLook {
  colours: BodyColours;
  /** Hair style, or "bald". */
  hair: string;
  /** Facial-hair style, or "none". */
  beard: string;
  /** Under gloves, the hands are not drawn. */
  hideHands: boolean;
}

const IDENTITY = new THREE.Quaternion();
const heads = new WeakMap<BodyTemplate, HeadFit>();

function material(name: string, color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness });
  // Bands, but smooth normals: see the cel converter.
  m.userData.smoothShading = true;
  return m;
}

/**
 * Skin a rig with `body` and the chosen hair and facial hair. The rig may be
 * in any pose; it is put into the bind pose and back. Every mesh is parented
 * to the root and tagged `userData.dress` so it can be taken off again. Also
 * returns the head fit, measured once per body, for sizing the headgear.
 */
export function attachBody(
  rig: JointSet,
  body: BodyTemplate,
  look: BodyLook
): { meshes: THREE.SkinnedMesh[]; head: HeadFit; hairLift: number } {
  const hairGeo = look.hair === "bald" ? null : body.hair.get(look.hair);
  if (look.hair !== "bald" && !hairGeo) throw new Error(`body ${body.name}: no hair style "${look.hair}"`);
  const beardGeo = look.beard === "none" ? null : body.beard.get(look.beard);
  if (look.beard !== "none" && !beardGeo) throw new Error(`body ${body.name}: no facial-hair style "${look.beard}"`);

  const c = look.colours;
  const mats = body.slots.map((slot) => {
    const map = body.maps.get(slot);
    const m = map
      ? Object.assign(material(slot, 0xffffff, 0.8), { map })
      : material(slot, c[slot as keyof BodyColours], slot === "eye" || slot === "iris" ? 0.3 : 0.85);
    // A photographic face already carries its own shading; hard bands on top
    // of it cut it into dark patches. Textured skin takes the soft ramp.
    if (map) m.userData.celRamp = "soft";
    if (slot === "hair-cards") {
      // Strands and lashes are cut out of cards by their alpha.
      m.alphaTest = 0.45;
      m.side = THREE.DoubleSide;
    }
    if (slot === "hand" && look.hideHands) m.visible = false;
    return m;
  });
  const meshes: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>[] = [
    new THREE.SkinnedMesh(body.geometry, mats),
  ];
  meshes[0].name = `body-${body.name}`;
  if (hairGeo) meshes.push(Object.assign(new THREE.SkinnedMesh(hairGeo, material("hair", c.hair, 0.95)), { name: `hair-${look.hair}` }));
  if (beardGeo) meshes.push(Object.assign(new THREE.SkinnedMesh(beardGeo, material("beard", c.beard, 0.95)), { name: `beard-${look.beard}` }));

  // Into the bind pose, at the origin, keeping the rig's scale.
  const saved = JOINTS.map((j) => rig[j].quaternion.clone());
  const pos = rig.root.position.clone();
  const rot = rig.root.quaternion.clone();
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  for (const j of JOINTS) rig[j].quaternion.copy(body.bind.get(j) ?? IDENTITY);
  for (const mesh of meshes) {
    mesh.castShadow = true;
    // Not self-shadowed: at the sun's grazing angles the shadow map's texels
    // land across a curved body as triangular acne that the cel bands then
    // turn into hard-edged patches. The bands do the shading.
    mesh.receiveShadow = false;
    // The bounds are the A-pose's; a bowler's arm or a diving fielder leaves them.
    mesh.frustumCulled = false;
    mesh.userData.dress = true;
    rig.root.add(mesh);
  }
  rig.root.updateMatrixWorld(true);

  // three only reads `matrixWorld` off a skeleton's bones, so the rig's own
  // joint groups serve as bones directly. One skeleton for every piece.
  const skeleton = new THREE.Skeleton(body.joints.map((j) => rig[j] as THREE.Bone));
  for (const mesh of meshes) mesh.bind(skeleton, mesh.matrixWorld);

  let head = heads.get(body);
  if (!head) {
    head = measureHead(meshes[0], body, rig.head);
    heads.set(body, head);
  }
  // How far the hair stands off the skull, so headgear can clear it.
  let hairLift = 0;
  if (hairGeo) {
    const toHead = rig.head.matrixWorld.clone().invert().multiply(meshes[1].matrixWorld);
    const p = hairGeo.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(toHead);
      if (v.y > head.centre.y) hairLift = Math.max(hairLift, v.distanceTo(head.centre) - head.radius);
    }
    hairLift = Math.max(0, hairLift - 0.012);
  }

  JOINTS.forEach((j, i) => rig[j].quaternion.copy(saved[i]));
  rig.root.position.copy(pos);
  rig.root.quaternion.copy(rot);
  rig.root.updateMatrixWorld(true);
  return { meshes, head, hairLift };
}

/** Skull centre and size in the head joint's frame, with the rig in the bind pose. */
function measureHead(mesh: THREE.SkinnedMesh, body: BodyTemplate, headJoint: THREE.Object3D): HeadFit {
  const headIndex = body.joints.indexOf("head");
  if (headIndex < 0) throw new Error(`body ${body.name}: no head joint`);
  const toHead = headJoint.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const g = body.geometry;
  const pos = g.getAttribute("position");
  const idx = g.getAttribute("skinIndex");
  const wgt = g.getAttribute("skinWeight");
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === headIndex) w += wgt.getComponent(i, k);
    if (w > 0.98) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toHead));
  }
  if (!pts.length) throw new Error(`body ${body.name}: no vertices on the head`);
  const crown = Math.max(...pts.map((p) => p.y));
  const low = Math.min(...pts.map((p) => p.y));
  // The skull is the top part of the head-weighted span; below it are the jaw and neck.
  const skullBottom = crown - (crown - low) * 0.55;
  const skull = new THREE.Box3().setFromPoints(pts.filter((p) => p.y >= skullBottom));
  const centre = skull.getCenter(new THREE.Vector3());
  const radius = (skull.max.x - skull.min.x) / 2;
  // The skull is a sphere sitting under the crown. Taking its centre from the
  // middle of the head-weighted span instead puts it too high on a body whose
  // neck is weighted to the head too, and every cap floats.
  centre.y = crown - radius;
  return { centre, crown, radius };
}
