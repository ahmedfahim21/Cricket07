/**
 * Cricketers: the rig, the kit, and dressing a rig as a player. How they MOVE
 * lives in `../anim/`.
 *
 * A rig is a hierarchy of joint groups. The bodies are skinned meshes built in
 * Blender (`bodies.ts`, `tools/players/`) and bound to these joints, so the
 * animation poses joints and never knows what is wearing them. On top go the
 * pieces of kit that are rigid — pads, boots, gloves, the bat, and headgear
 * sized to the skull of whoever is in the rig.
 *
 * Cricket needs three joints the city pedestrians did not:
 *
 *   - A SPINE/CHEST split. The hips and the shoulders turning by different
 *     amounts — hip-shoulder separation — is the whole engine of both a bowling
 *     action and a bat swing. One rigid torso cannot show either.
 *   - ANKLES, so a planted foot stays flat on the turf while the leg above it
 *     rotates, instead of pivoting on its toe like a compass.
 *   - A HAND point at the centre of each fist: where a ball is held, where a bat
 *     handle is gripped, and what the IK solver aims at.
 *
 * Conventions, in rig-local space BEFORE the root's uniform scale:
 *   the figure stands on y=0 facing -Z, and its RIGHT side is +X.
 *   For any limb hanging from its joint, rotation.x > 0 swings the free end
 *   FORWARD (toward -Z). So an elbow flexes with +x and a knee with -x.
 */

import * as THREE from "three";
import { PLAYER_HEIGHT } from "../dimensions";
import { AssetMaterialLib, Part, mergeByMaterial, stdMat } from "./shared";
import { makeBat } from "./equipment";
import { JOINTS, type JointName } from "./joints";
import { attachBody, type BodyTemplate, type HeadFit } from "./bodies";
import { bodyColours, isAvatar, type Appearance } from "../roster/appearance";

export { JOINTS, type JointName };

/* ------------------------------------------------------------------ *
 * Skeleton, in metres, rig-local and unscaled
 * ------------------------------------------------------------------ */

export const SKELETON = {
  /** Ankle pivot above the ground. */
  ankleH: 0.075,
  shin: 0.405,
  thigh: 0.425,
  /** Hip joints either side of the pelvis centre. */
  hipX: 0.092,
  /** Pelvis pivot height: ankle + shin + thigh. */
  hipY: 0.075 + 0.405 + 0.425,
  /** Spine pivot (waist) above the pelvis pivot. */
  waist: 0.1,
  /** Chest pivot above the spine pivot. */
  chest: 0.185,
  /** Shoulder joints in chest space. */
  shoulderX: 0.185,
  shoulderY: 0.245,
  /** Neck pivot in chest space. */
  neckY: 0.3,
  upperArm: 0.285,
  forearm: 0.255,
  /** Wrist to the centre of the fist. */
  hand: 0.06,
  /** Foot length ahead of the ankle, and heel behind it. */
  toe: 0.175,
  heel: 0.065,
} as const;

/** Nominal standing height, so the root can be scaled to PLAYER_HEIGHT. */
const NOMINAL_HEIGHT = 1.78;
export const RIG_SCALE = PLAYER_HEIGHT / NOMINAL_HEIGHT;

export type Role = "batsman" | "bowler" | "fielder" | "keeper" | "umpire";

export interface PlayerRig {
  root: THREE.Group;
  pelvis: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  ankleL: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
  ankleR: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  handL: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  handR: THREE.Group;
  /** Batsmen only. Parented to `root` while gripped in both hands. */
  bat: THREE.Group | null;
  role: Role;
  /** The kit this rig wears; kept so it can be re-dressed as someone else. */
  kit: KitColours;
  materials?: AssetMaterialLib;
}

export type KitColours = {
  shirt: number;
  trousers: number;
  skin: number;
  hair: number;
  cap: number;
  /** Pads, gloves. */
  gear: number;
  boot: number;
};

/** The batting side: light blue, as in the reference. */
export const BATTING_KIT: KitColours = {
  shirt: 0x86b8e0,
  trousers: 0x6f9fce,
  skin: 0xb98a63,
  hair: 0x1c1712,
  cap: 0x24457a,
  gear: 0xf1efe6,
  boot: 0xf4f2ea,
};

/** The fielding side: gold shirts, green trousers. */
export const FIELDING_KIT: KitColours = {
  shirt: 0xe0b83a,
  trousers: 0x1f6b47,
  skin: 0x8d5f3f,
  hair: 0x14100c,
  cap: 0x1f6b47,
  gear: 0xf1efe6,
  boot: 0x1b1b1e,
};

/* ------------------------------------------------------------------ *
 * Geometry helpers — transforms baked in so parts can merge
 * ------------------------------------------------------------------ */

function place(
  g: THREE.BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  sx = 1,
  sy = 1,
  sz = 1
): THREE.BufferGeometry {
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function sphere(
  r: number,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  w = 12,
  h = 8
): THREE.BufferGeometry {
  return place(new THREE.SphereGeometry(r, w, h), x, y, z, sx, sy, sz);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return place(new THREE.BoxGeometry(w, h, d), x, y, z);
}

/** Vertical cylinder centred at (x, y, z). */
function cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, segs = 10) {
  return place(new THREE.CylinderGeometry(rTop, rBot, h, segs), x, y, z);
}

/** Cylinder lying along X, for rolls and bars. */
function cylX(r: number, len: number, x: number, y: number, z: number, segs = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  g.rotateZ(Math.PI / 2);
  return place(g, x, y, z);
}

function group(name: string, parts: Part[], x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (parts.length) g.add(mergeByMaterial(parts));
  g.position.set(x, y, z);
  return g;
}

/* ------------------------------------------------------------------ *
 * Building a player
 * ------------------------------------------------------------------ */

export interface PlayerOptions {
  colours?: KitColours;
  role?: Role;
  materials?: AssetMaterialLib;
  /**
   * The body to skin the rig with (see `bodies.ts`) and who is wearing it.
   * Without them the rig is a bare skeleton carrying only its equipment —
   * what the unit tests use, since they measure joints, not meshes.
   */
  body?: BodyTemplate;
  appearance?: Appearance;
}

/** A skull of typical size, for headgear on a rig with no body. */
const DEFAULT_HEAD: HeadFit = { centre: new THREE.Vector3(0, 0.165, -0.01), crown: 0.245, radius: 0.078 };

export function makePlayer(opts: PlayerOptions = {}): PlayerRig {
  const role = opts.role ?? "fielder";
  const c = opts.colours ?? FIELDING_KIT;
  const m = opts.materials;
  const S = SKELETON;

  const umpire = role === "umpire";
  const padded = role === "batsman" || role === "keeper";
  const longSleeves = role === "batsman" || role === "keeper" || umpire;

  const mat = (color: number, rough = 0.88) => stdMat(color, { roughness: rough }, m);
  const gear = mat(c.gear, 0.7);
  const boot = mat(umpire ? 0x17171a : c.boot, 0.7);
  const sole = mat(0x2a2a2e, 0.9);
  const strap = mat(0x25252a, 0.85);
  const glove = mat(role === "keeper" ? 0xd8c27c : c.gear, 0.7);

  const root = new THREE.Group();
  root.name = `player-${role}`;

  /* ---- Joints ------------------------------------------------------- */
  const pelvis = group("pelvis", [], 0, S.hipY, 0);
  root.add(pelvis);
  const spine = group("spine", [], 0, S.waist, 0);
  pelvis.add(spine);
  const chest = group("chest", [], 0, S.chest, 0);
  spine.add(chest);
  const head = group("head", [], 0, S.neckY, 0);
  chest.add(head);

  const makeLeg = (side: 1 | -1) => {
    const thighParts: Part[] = [];
    // Thigh flap of the pad, tied on above the knee.
    if (padded) thighParts.push({ geo: box(0.13, 0.13, 0.04, 0, -S.thigh + 0.1, -0.075), mat: gear });
    const hip = group(side < 0 ? "hipL" : "hipR", thighParts, side * S.hipX, 0, 0);

    const shinParts: Part[] = [];
    if (padded) {
      // Pad: a front shield with three vertical rolls, a knee roll, and two
      // straps round the back of the calf.
      shinParts.push({ geo: box(0.145, S.shin * 0.95, 0.045, 0, -S.shin * 0.5, -0.058), mat: gear });
      for (const dx of [-0.045, 0, 0.045]) {
        shinParts.push({ geo: cyl(0.024, 0.024, S.shin * 0.9, dx, -S.shin * 0.5, -0.082, 8), mat: gear });
      }
      shinParts.push({ geo: cylX(0.05, 0.15, 0, -0.01, -0.062, 10), mat: gear });
      shinParts.push({ geo: box(0.15, 0.022, 0.012, 0, -S.shin * 0.3, 0.066), mat: strap });
      shinParts.push({ geo: box(0.15, 0.022, 0.012, 0, -S.shin * 0.72, 0.056), mat: strap });
    }
    const knee = group(side < 0 ? "kneeL" : "kneeR", shinParts, 0, -S.thigh, 0);
    hip.add(knee);

    // Boot over the foot: the ankle is the pivot; the shoe runs forward to the toe (-Z).
    const footLen = S.toe + S.heel;
    const footMid = (S.heel - S.toe) / 2;
    const ankle = group(
      side < 0 ? "ankleL" : "ankleR",
      [
        { geo: sphere(0.058, 0, -0.035, footMid, 0.85, 0.62, footLen / 0.116), mat: boot },
        { geo: box(0.09, 0.016, footLen, 0, -S.ankleH + 0.008, footMid), mat: sole },
      ],
      0,
      -S.shin,
      0
    );
    knee.add(ankle);
    pelvis.add(hip);
    return { hip, knee, ankle };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  const makeArm = (side: 1 | -1) => {
    const shoulder = group(side < 0 ? "shoulderL" : "shoulderR", [], side * S.shoulderX, S.shoulderY, 0);
    // The fist is the hand joint; gloves are worn over it.
    const fistY = -S.forearm - S.hand;
    const foreParts: Part[] = [];
    if (role === "batsman") {
      foreParts.push({ geo: sphere(0.058, 0, fistY, 0, 0.95, 1.2, 0.85), mat: glove });
      foreParts.push({ geo: cyl(0.05, 0.052, 0.05, 0, fistY + 0.055, 0), mat: glove });
    } else if (role === "keeper") {
      foreParts.push({ geo: sphere(0.08, 0, fistY, -0.01, 1.05, 1.15, 0.7), mat: glove });
    }
    const elbow = group(side < 0 ? "elbowL" : "elbowR", foreParts, 0, -S.upperArm, 0);
    const hand = new THREE.Group();
    hand.name = side < 0 ? "handL" : "handR";
    hand.position.set(0, fistY, 0);
    elbow.add(hand);
    shoulder.add(elbow);
    chest.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const joints = {
    root, pelvis, spine, chest, head,
    hipL: legL.hip, kneeL: legL.knee, ankleL: legL.ankle,
    hipR: legR.hip, kneeR: legR.knee, ankleR: legR.ankle,
    shoulderL: armL.shoulder, elbowL: armL.elbow, handL: armL.hand,
    shoulderR: armR.shoulder, elbowR: armR.elbow, handR: armR.hand,
  };

  root.scale.setScalar(RIG_SCALE);
  const rig: PlayerRig = { ...joints, bat: null, role, kit: c, materials: m };
  if (opts.body || opts.appearance) {
    if (!opts.body || !opts.appearance) throw new Error("makePlayer: a body needs an appearance, and an appearance a body");
    dressPlayer(rig, opts.body, opts.appearance);
  } else {
    headgear(rig, DEFAULT_HEAD, 0, false);
  }

  if (role === "batsman") {
    const bat = makeBat(m);
    bat.name = "bat";
    root.add(bat);
    rig.bat = bat;
  }

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  root.userData.rig = rig;
  return rig;
}

/**
 * Put a person in the rig: their body, hair and facial hair, painted with
 * their skin and the rig's kit, and headgear fitted to their skull. Takes off
 * whoever was in it before, so a rig can be re-used when a new batsman walks
 * in or the bowling changes.
 */
export function dressPlayer(rig: PlayerRig, body: BodyTemplate, appearance: Appearance): void {
  for (const o of [...rig.root.children, ...rig.head.children]) {
    if (o.userData.dress || o.userData.headgear) o.removeFromParent();
  }
  const c = rig.kit;
  const umpire = rig.role === "umpire";
  const gloved = rig.role === "batsman" || rig.role === "keeper";
  const colours = bodyColours(appearance, {
    shirt: umpire ? 0xd7e6f2 : c.shirt,
    trousers: umpire ? 0x25282d : c.trousers,
    boot: umpire ? 0x17171a : c.boot,
    longSleeves: gloved || umpire,
  });
  const capped = gloved || umpire || appearance.cap;
  const avatar = isAvatar(appearance);
  const { head, hairLift } = attachBody(rig, body, {
    colours,
    // Under a helmet, cap or hat only the hair below the brim shows; a style
    // that would stand proud of it is worn flattened, as the short one. An
    // avatar's hair is its own and part of its head.
    hair: avatar ? "bald" : capped && (appearance.hair === "curly" || appearance.hair === "neat") ? "short" : appearance.hair,
    beard: avatar ? "none" : appearance.facialHair,
    hideHands: gloved,
  });
  headgear(rig, head, hairLift, appearance.cap);
}

/**
 * Helmet for batsmen and keepers, a wide-brimmed hat for the umpire, a cap for
 * a fielder who wears one. Sized to the skull plus whatever hair is under it.
 */
function headgear(rig: PlayerRig, fit: HeadFit, hairLift: number, cap: boolean): void {
  const c = rig.kit;
  const mat = (color: number, rough = 0.85) => stdMat(color, { roughness: rough }, rig.materials);
  const shell = mat(c.cap, 0.8);
  const strap = mat(0x25252a, 0.85);
  const gear = mat(c.gear, 0.7);
  const hc = fit.centre;
  const r = fit.radius + hairLift;
  let parts: Part[] | null = null;
  if (rig.role === "batsman" || rig.role === "keeper") {
    const dome = new THREE.SphereGeometry(r + 0.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    parts = [
      { geo: place(dome, hc.x, hc.y + 0.01, hc.z + 0.008), mat: shell },
      // Peak over the eyes.
      { geo: sphere(0.1, hc.x, hc.y + 0.035, hc.z - r - 0.02, 1, 0.12, 0.85, 12, 4), mat: shell },
      // Neck guard at the back.
      { geo: sphere(0.1, hc.x, hc.y - 0.03, hc.z + r * 0.7, 1, 0.45, 0.6, 10, 6), mat: shell },
    ];
    if (rig.role === "batsman") {
      // Faceguard: a frame of bars in front of the face.
      for (const dy of [-0.018, -0.055, -0.09]) {
        parts.push({ geo: cylX(0.006, 0.17, hc.x, hc.y + dy, hc.z - fit.radius - 0.035 - dy * 0.12, 6), mat: strap });
      }
      for (const dx of [-0.055, 0.055]) {
        parts.push({ geo: cyl(0.006, 0.006, 0.1, hc.x + dx, hc.y - 0.05, hc.z - fit.radius - 0.037, 6), mat: strap });
      }
    }
  } else if (rig.role === "umpire") {
    // Wide brim and a low crown: the silhouette the reference umpire has.
    parts = [
      { geo: cyl(0.2, 0.2, 0.012, hc.x, hc.y + 0.045, hc.z, 20), mat: gear },
      { geo: cyl(r + 0.022, r + 0.034, 0.08, hc.x, fit.crown + hairLift - 0.008, hc.z, 16), mat: gear },
    ];
  } else if (cap) {
    const dome = new THREE.SphereGeometry(r + 0.014, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    parts = [
      { geo: place(dome, hc.x, hc.y + 0.012, hc.z + 0.004), mat: shell },
      { geo: sphere(0.095, hc.x, hc.y + 0.03, hc.z - r - 0.012, 1, 0.1, 0.9, 12, 4), mat: shell },
    ];
  }
  if (!parts) return;
  const g = mergeByMaterial(parts);
  g.userData.headgear = true;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  rig.head.add(g);
}
