/**
 * Cricketers: the rig and the geometry. How they MOVE lives in `../anim/`.
 *
 * Built the way the city engine builds its pedestrians:
 *
 *   - Every limb is a LATHE profile — a thigh swells below the hip and pinches
 *     at the knee, a calf bulges then narrows to the ankle. Straight cylinders
 *     are what make a figure read as a stack of pipes.
 *   - Every joint carries a SPHERE, which fills the wedge a bent knee or elbow
 *     opens between two segments, so limbs fold without a gap.
 *   - Static parts merge within a limb (a thigh and its trouser leg merge; the
 *     two legs never do), so each limb stays a named pivot a pose can rotate.
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

/**
 * A lathe from a (y, radius) profile, bottom to top so the normals face out.
 * `sz` flattens it front-to-back: a thigh or a chest is not circular.
 */
function lathe(
  profile: [number, number][],
  segs = 14,
  sz = 1,
  x = 0,
  y = 0,
  z = 0
): THREE.BufferGeometry {
  const pts = profile
    .slice()
    .sort((a, b) => a[0] - b[0])
    .map(([py, r]) => new THREE.Vector2(r, py));
  return place(new THREE.LatheGeometry(pts, segs), x, y, z, 1, 1, sz);
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

/**
 * Skull-and-jaw head via a lathe (chin at y=0, crown at 0.185), scaled
 * separately in width and height so a head fitted to a chin-to-crown span
 * does not come out squat.
 */
function headLathe(widthScale: number, heightScale: number): THREE.BufferGeometry {
  const g = lathe(
    [
      [0.0, 0.015],
      [0.012, 0.055],
      [0.02, 0.07],
      [0.04, 0.08],
      [0.06, 0.085],
      [0.1, 0.09],
      [0.125, 0.087],
      [0.14, 0.082],
      [0.16, 0.07],
      [0.17, 0.055],
      [0.18, 0.03],
      [0.185, 0.0],
    ],
    20
  );
  g.scale(widthScale, heightScale, widthScale * 1.04);
  return g;
}

/* ------------------------------------------------------------------ *
 * Building a player
 * ------------------------------------------------------------------ */

export interface PlayerOptions {
  colours?: KitColours;
  role?: Role;
  materials?: AssetMaterialLib;
}

export function makePlayer(opts: PlayerOptions = {}): PlayerRig {
  const role = opts.role ?? "fielder";
  const c = opts.colours ?? FIELDING_KIT;
  const m = opts.materials;
  const S = SKELETON;

  const umpire = role === "umpire";
  const padded = role === "batsman" || role === "keeper";
  const longSleeves = role === "batsman" || role === "keeper" || umpire;

  const mat = (color: number, rough = 0.88) => stdMat(color, { roughness: rough }, m);
  const shirt = mat(umpire ? 0xd7e6f2 : c.shirt);
  const trousers = mat(umpire ? 0x25282d : c.trousers);
  const skin = mat(c.skin, 0.72);
  const hair = mat(c.hair, 0.6);
  const cap = mat(c.cap, 0.8);
  const gear = mat(c.gear, 0.7);
  const boot = mat(umpire ? 0x17171a : c.boot, 0.7);
  const sole = mat(0x2a2a2e, 0.9);
  const strap = mat(0x25252a, 0.85);
  const glove = mat(role === "keeper" ? 0xd8c27c : c.gear, 0.7);

  const root = new THREE.Group();
  root.name = `player-${role}`;

  /* ---- Pelvis ------------------------------------------------------ */
  const pelvis = group(
    "pelvis",
    [
      {
        geo: lathe([[-0.1, 0.105], [-0.05, 0.14], [0.02, 0.146], [0.1, 0.133]], 16, 0.72),
        mat: trousers,
      },
      // Seat, so the silhouette from side-on has a back to it.
      { geo: sphere(0.085, -0.055, -0.045, 0.045, 1, 0.9, 0.75), mat: trousers },
      { geo: sphere(0.085, 0.055, -0.045, 0.045, 1, 0.9, 0.75), mat: trousers },
    ],
    0,
    S.hipY,
    0
  );
  root.add(pelvis);

  /* ---- Spine (abdomen) and chest ----------------------------------- */
  const spineParts: Part[] = [
    {
      geo: lathe([[0, 0.13], [0.08, 0.132], [0.15, 0.142], [S.chest + 0.01, 0.15]], 16, 0.66),
      mat: shirt,
    },
  ];
  if (umpire) {
    spineParts.push({ geo: lathe([[0, 0.134], [0.035, 0.134]], 16, 0.68), mat: strap });
  }
  const spine = group("spine", spineParts, 0, S.waist, 0);
  pelvis.add(spine);

  const chestParts: Part[] = [
    {
      geo: lathe(
        [
          [0, 0.15],
          [0.06, 0.158],
          [0.13, 0.166],
          [0.2, 0.173],
          [0.245, 0.17],
          [0.28, 0.13],
          [0.305, 0.07],
          [0.315, 0.05],
        ],
        18,
        0.62
      ),
      mat: shirt,
    },
    // Trapezius, sloping from the neck out to the shoulders.
    { geo: sphere(0.16, 0, 0.268, 0.012, 1, 0.3, 0.55), mat: shirt },
    // Neck and collar.
    { geo: cyl(0.047, 0.054, 0.12, 0, 0.33, 0.005), mat: skin },
    {
      geo: place(new THREE.TorusGeometry(0.058, 0.013, 6, 18).rotateX(Math.PI / 2), 0, 0.29, 0.004),
      mat: shirt,
    },
  ];
  const chest = group("chest", chestParts, 0, S.chest, 0);
  spine.add(chest);

  /* ---- Legs --------------------------------------------------------- */
  const makeLeg = (side: 1 | -1) => {
    const thighParts: Part[] = [
      {
        geo: lathe(
          [
            [-S.thigh, 0.058],
            [-S.thigh + 0.05, 0.062],
            [-0.25, 0.079],
            [-0.12, 0.089],
            [-0.03, 0.09],
            [0, 0.086],
          ],
          14,
          0.94
        ),
        mat: trousers,
      },
      { geo: sphere(0.088, 0, 0, 0), mat: trousers },
    ];
    if (padded) {
      // Thigh flap of the pad, tied on above the knee.
      thighParts.push({ geo: box(0.13, 0.13, 0.04, 0, -S.thigh + 0.1, -0.075), mat: gear });
    }
    const hip = group(side < 0 ? "hipL" : "hipR", thighParts, side * S.hipX, 0, 0);

    const shinParts: Part[] = [
      {
        // Calf swells behind the shin bone, so the lathe sits a little back.
        geo: lathe(
          [
            [-S.shin, 0.036],
            [-S.shin + 0.06, 0.041],
            [-0.22, 0.056],
            [-0.12, 0.066],
            [-0.05, 0.063],
            [0, 0.058],
          ],
          14,
          1,
          0,
          0,
          0.006
        ),
        mat: trousers,
      },
      { geo: sphere(0.062, 0, 0, 0), mat: trousers },
    ];
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

    // Foot: the ankle is the pivot; the shoe runs forward to the toe (-Z).
    const footLen = S.toe + S.heel;
    const footMid = (S.heel - S.toe) / 2; // z of the shoe's centre
    const ankle = group(
      side < 0 ? "ankleL" : "ankleR",
      [
        { geo: sphere(0.042, 0, 0, 0), mat: boot },
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

  /* ---- Arms --------------------------------------------------------- */
  const makeArm = (side: 1 | -1) => {
    const shoulder = group(
      side < 0 ? "shoulderL" : "shoulderR",
      [
        {
          geo: lathe(
            [
              [-S.upperArm, 0.043],
              [-0.2, 0.05],
              [-0.08, 0.057],
              [-0.02, 0.06],
              [0, 0.058],
            ],
            12
          ),
          mat: shirt,
        },
        // Deltoid.
        { geo: sphere(0.064, 0, -0.012, 0, 1, 1.05, 1), mat: shirt },
      ],
      side * S.shoulderX,
      S.shoulderY,
      0
    );

    const foreParts: Part[] = [
      {
        geo: lathe(
          [
            [-S.forearm, 0.031],
            [-0.2, 0.034],
            [-0.1, 0.043],
            [-0.03, 0.046],
            [0, 0.044],
          ],
          12
        ),
        mat: longSleeves ? shirt : skin,
      },
      { geo: sphere(0.047, 0, 0, 0), mat: longSleeves ? shirt : skin },
    ];
    // The fist: palm plus a thumb, or a glove over it.
    const fistY = -S.forearm - S.hand;
    if (role === "batsman") {
      foreParts.push({ geo: sphere(0.058, 0, fistY, 0, 0.95, 1.2, 0.85), mat: glove });
      foreParts.push({ geo: cyl(0.05, 0.052, 0.05, 0, fistY + 0.055, 0), mat: glove });
    } else if (role === "keeper") {
      foreParts.push({ geo: sphere(0.08, 0, fistY, -0.01, 1.05, 1.15, 0.7), mat: glove });
    } else {
      foreParts.push({ geo: sphere(0.04, 0, fistY, 0, 0.85, 1.15, 0.72), mat: skin });
      foreParts.push({ geo: sphere(0.017, side * -0.03, fistY + 0.012, -0.02, 1, 1.6, 1), mat: skin });
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

  /* ---- Head --------------------------------------------------------- */
  // Head pivot is the top of the neck; the chin sits just above it.
  const chinLocal = 0.045;
  const headH = 0.235;
  const headScaleY = headH / 0.185;
  const headMid = chinLocal + headH * 0.52;
  const crown = chinLocal + headH;
  const headParts: Part[] = [
    { geo: place(headLathe(1, headScaleY), 0, chinLocal, 0), mat: skin },
    // Nose, ears, brow: a head needs a front and a side to have a facing.
    { geo: sphere(0.02, 0, headMid - 0.025, -0.09, 0.9, 1.25, 1.4, 6, 5), mat: skin },
    { geo: sphere(0.025, -0.091, headMid - 0.01, 0.004, 0.42, 1, 0.9, 6, 5), mat: skin },
    { geo: sphere(0.025, 0.091, headMid - 0.01, 0.004, 0.42, 1, 0.9, 6, 5), mat: skin },
    { geo: sphere(0.075, 0, headMid + 0.03, -0.035, 1.05, 0.4, 0.75, 10, 6), mat: skin },
  ];
  const head = group("head", headParts, 0, S.neckY, 0);
  chest.add(head);

  const skullR = 0.1;
  if (role === "batsman" || role === "keeper") {
    const dome = new THREE.SphereGeometry(skullR * 1.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const lid: Part[] = [
      { geo: place(dome, 0, headMid + 0.012, 0.008), mat: cap },
      // Peak over the eyes.
      { geo: sphere(0.1, 0, crown - 0.075, -0.1, 1, 0.12, 0.85, 12, 4), mat: cap },
      // Neck guard at the back.
      { geo: sphere(0.1, 0, headMid - 0.03, 0.06, 1, 0.45, 0.6, 10, 6), mat: cap },
    ];
    if (role === "batsman") {
      // Faceguard: a frame of bars in front of the face.
      for (const dy of [-0.018, -0.055, -0.09]) {
        lid.push({ geo: cylX(0.006, 0.17, 0, headMid + dy, -0.115 - dy * 0.12, 6), mat: strap });
      }
      for (const dx of [-0.055, 0.055]) {
        lid.push({ geo: cyl(0.006, 0.006, 0.1, dx, headMid - 0.05, -0.117, 6), mat: strap });
      }
    }
    head.add(mergeByMaterial(lid));
  } else if (umpire) {
    head.add(
      mergeByMaterial([
        // Wide brim and a low crown: the silhouette the reference umpire has.
        { geo: cyl(0.2, 0.2, 0.012, 0, crown - 0.055, 0, 20), mat: gear },
        { geo: cyl(0.1, 0.112, 0.08, 0, crown - 0.012, 0, 16), mat: gear },
        { geo: sphere(0.098, 0, headMid - 0.02, 0.015, 1, 0.55, 1), mat: hair },
      ])
    );
  } else {
    const dome = new THREE.SphereGeometry(skullR * 1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    head.add(
      mergeByMaterial([
        { geo: place(dome, 0, headMid + 0.016, 0.004), mat: cap },
        { geo: sphere(0.095, 0, crown - 0.075, -0.095, 1, 0.1, 0.9, 12, 4), mat: cap },
        { geo: sphere(0.095, 0, headMid - 0.028, 0.02, 1, 0.5, 1), mat: hair },
      ])
    );
  }

  const rig: PlayerRig = {
    root,
    pelvis,
    spine,
    chest,
    head,
    hipL: legL.hip,
    kneeL: legL.knee,
    ankleL: legL.ankle,
    hipR: legR.hip,
    kneeR: legR.knee,
    ankleR: legR.ankle,
    shoulderL: armL.shoulder,
    elbowL: armL.elbow,
    handL: armL.hand,
    shoulderR: armR.shoulder,
    elbowR: armR.elbow,
    handR: armR.hand,
    bat: null,
    role,
  };

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

  root.scale.setScalar(RIG_SCALE);
  root.userData.rig = rig;
  return rig;
}
