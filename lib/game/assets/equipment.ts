/**
 * Ball, bat and stumps.
 *
 * Every measurement here comes from `dimensions.ts` rather than being typed in
 * again, so these read correctly against the 1m grid in the preview harness.
 */

import * as THREE from "three";
import {
  BAIL_DIAMETER,
  BAIL_LENGTH,
  BALL_RADIUS,
  BAT_BLADE_LENGTH,
  BAT_DEPTH,
  BAT_HANDLE_LENGTH,
  BAT_WIDTH,
  STUMP_DIAMETER,
  STUMP_HEIGHT,
  STUMP_X_OFFSETS,
} from "../dimensions";
import {
  AssetMaterialLib,
  Part,
  bakedBox,
  bakedCyl,
  bakedTorus,
  mergeByMaterial,
  stdMat,
} from "./shared";

const LEATHER_RED = 0x8f1f1f;
const SEAM_WHITE = 0xe8e2d4;
const WILLOW = 0xdcc9a0;
const GRIP_BLACK = 0x1a1a1c;
const STUMP_WOOD = 0xd9c9a6;

/* ------------------------------------------------------------------ *
 * Ball
 * ------------------------------------------------------------------ */

/**
 * The ball, with its seam as real geometry rather than a painted line.
 *
 * The seam is the whole reason swing exists, so it has to be *orientable* at
 * runtime — the physics tilts the seam and the renderer must show the same
 * tilt or the ball visibly lies about which way it is going to move. The seam
 * ring is therefore a named child (`userData.seam`) that the engine rotates,
 * and it is NOT merged into the leather mesh.
 *
 * Returned group is centred on the ball's centre, so it can be dropped
 * straight onto a physics body translation.
 */
export function makeBall(mats?: AssetMaterialLib): THREE.Group {
  const g = new THREE.Group();

  const leather = stdMat(LEATHER_RED, { roughness: 0.34, metalness: 0.02 }, mats);
  const core = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 16), leather);
  core.castShadow = true;
  g.add(core);

  // Seam: a proud stitched ring. Sits a hair above the surface so it catches
  // light at grazing angles the way real stitching does.
  const seamMat = stdMat(SEAM_WHITE, { roughness: 0.75 }, mats);
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(BALL_RADIUS * 0.995, BALL_RADIUS * 0.1, 8, 32),
    seamMat
  );
  seam.castShadow = true;
  seam.name = "seam";
  g.add(seam);

  g.userData.seam = seam;
  g.name = "ball";
  return g;
}

/* ------------------------------------------------------------------ *
 * Bat
 * ------------------------------------------------------------------ */

/**
 * Bat, built pointing +Y with the origin at the bottom of the blade so the
 * swing rig can rotate it about the handle without fighting an offset pivot.
 *
 * The face is -Z. The spine ridge down the back is what makes a bat read as a
 * bat rather than as a plank from any distance.
 */
export function makeBat(mats?: AssetMaterialLib): THREE.Group {
  const willow = stdMat(WILLOW, { roughness: 0.55 }, mats);
  const grip = stdMat(GRIP_BLACK, { roughness: 0.9 }, mats);
  const twine = stdMat(0xd8d2c0, { roughness: 0.8 }, mats);
  const parts: Part[] = [];

  /**
   * The blade is swept as thin horizontal slices with interpolated width and
   * depth rather than a few stacked boxes. Stacked boxes leave visible ledges
   * at every step, which is exactly what a bat does not have — the profile is
   * a continuous swell from a thin toe to the thickest point about a third up,
   * then back to the shoulders.
   */
  const SLICES = 26;
  const shoulderY = BAT_BLADE_LENGTH;

  // Face stays a flat plane at -Z; all the swell happens on the back.
  const faceZ = -BAT_DEPTH * 0.45;

  const widthAt = (t: number) => {
    // t = 0 at the toe, 1 at the shoulder. A bat's toe is nearly full width —
    // it is not a spade — so this reaches full width almost immediately and
    // only draws in at the shoulders.
    if (t < 0.07) return BAT_WIDTH * (0.93 + (t / 0.07) * 0.07);
    if (t < 0.78) return BAT_WIDTH;
    return BAT_WIDTH * (1 - ((t - 0.78) / 0.22) * 0.3);
  };
  const depthAt = (t: number) => {
    // Thickest around a third of the way up — the middle of the bat. The
    // swell is kept shallow because each slice is a flat-sided prism, and a
    // steep profile turns into visible stair-stepping down the spine.
    const swell = Math.exp(-((t - 0.34) ** 2) / 0.1);
    return BAT_DEPTH * (0.62 + swell * 0.58);
  };

  for (let i = 0; i < SLICES; i++) {
    const t = (i + 0.5) / SLICES;
    const h = shoulderY / SLICES;
    const d = depthAt(t);
    parts.push({
      geo: bakedBox(widthAt(t), h * 1.02, d, 0, t * shoulderY, faceZ + d / 2),
      mat: willow,
    });
  }

  // Shoulders into the handle.
  parts.push({ geo: bakedBox(BAT_WIDTH * 0.46, 0.05, BAT_DEPTH * 0.9, 0, shoulderY + 0.02, 0), mat: willow });

  // Handle + rubber grip.
  const handleY = shoulderY + BAT_HANDLE_LENGTH / 2;
  parts.push({ geo: bakedCyl(0.016, 0.018, BAT_HANDLE_LENGTH, 10, 0, handleY, 0), mat: grip });

  // Grip rings, the visual tell that it is a handle and not a stick.
  for (let i = 0; i < 5; i++) {
    const y = shoulderY + 0.04 + i * 0.05;
    parts.push({ geo: bakedCyl(0.019, 0.019, 0.008, 10, 0, y, 0), mat: twine });
  }

  const g = mergeByMaterial(parts);
  g.name = "bat";
  return g;
}

/* ------------------------------------------------------------------ *
 * Stumps
 * ------------------------------------------------------------------ */

/**
 * A set of three stumps with both bails.
 *
 * Bails are separate named children, not merged, because they have to be
 * knocked off — `userData.bails` is what the dismissal code animates. The
 * stumps themselves merge into one mesh.
 *
 * Origin is at ground level on the middle stump.
 */
export function makeStumps(mats?: AssetMaterialLib): THREE.Group {
  const g = new THREE.Group();
  const wood = stdMat(STUMP_WOOD, { roughness: 0.6 }, mats);
  const parts: Part[] = [];

  const r = STUMP_DIAMETER / 2;
  for (const x of STUMP_X_OFFSETS) {
    // Tapered very slightly toward the top, as a turned stump is.
    parts.push({
      geo: bakedCyl(r * 0.9, r, STUMP_HEIGHT, 10, x, STUMP_HEIGHT / 2, 0),
      mat: wood,
    });
  }
  const stumps = mergeByMaterial(parts);
  stumps.name = "stump-set";
  g.add(stumps);

  // Two bails, each spanning an adjacent pair, lying across the tops.
  const bails: THREE.Mesh[] = [];
  const bailMat = stdMat(0xe4d6b0, { roughness: 0.55 }, mats);
  for (let i = 0; i < 2; i++) {
    const x = (STUMP_X_OFFSETS[i] + STUMP_X_OFFSETS[i + 1]) / 2;
    const bail = new THREE.Mesh(
      new THREE.CylinderGeometry(BAIL_DIAMETER / 2, BAIL_DIAMETER / 2, BAIL_LENGTH, 8),
      bailMat
    );
    bail.rotation.z = Math.PI / 2; // lie along X
    bail.position.set(x, STUMP_HEIGHT + BAIL_DIAMETER / 2, 0);
    bail.castShadow = true;
    bail.name = `bail-${i}`;
    g.add(bail);
    bails.push(bail);
  }

  g.userData.bails = bails;
  g.name = "stumps";
  return g;
}

/* ------------------------------------------------------------------ *
 * Batting kit worn by the striker
 * ------------------------------------------------------------------ */

/**
 * A pair of batting pads as one merged group, origin at the ankles.
 *
 * The readable cue is the set of vertical bolsters running UP the shin with a
 * horizontal roll across the knee — get the axis of those cylinders wrong and
 * the whole thing reads as a pile of tubes rather than as legwear. Cylinders
 * default to the Y axis, which is what the shin rolls want; only the knee and
 * thigh rolls are rotated onto X.
 */
export function makePads(mats?: AssetMaterialLib): THREE.Group {
  const pad = stdMat(0xf2f0e6, { roughness: 0.7 }, mats);
  const strap = stdMat(0x2b2b30, { roughness: 0.85 }, mats);
  const parts: Part[] = [];

  const SHIN_BOTTOM = 0.04;
  const SHIN_TOP = 0.42;
  const KNEE_Y = 0.48;
  const shinH = SHIN_TOP - SHIN_BOTTOM;

  for (const x of [-0.115, 0.115]) {
    // Three vertical bolsters up the shin. Face is -Z (forward).
    for (let i = -1; i <= 1; i++) {
      const r = i === 0 ? 0.036 : 0.031;
      parts.push({
        geo: bakedCyl(r, r, shinH, 8, x + i * 0.055, SHIN_BOTTOM + shinH / 2, -0.03),
        mat: pad,
      });
    }

    // Knee roll: across the leg, so rotated onto X (rz = PI/2).
    parts.push({
      geo: bakedCyl(0.048, 0.048, 0.155, 8, x, KNEE_Y, -0.028, 0, Math.PI / 2),
      mat: pad,
    });

    // Two thigh rolls above the knee, narrowing upward.
    parts.push({
      geo: bakedCyl(0.04, 0.042, 0.145, 8, x, KNEE_Y + 0.085, -0.024, 0, Math.PI / 2),
      mat: pad,
    });
    parts.push({
      geo: bakedCyl(0.034, 0.038, 0.13, 8, x, KNEE_Y + 0.16, -0.02, 0, Math.PI / 2),
      mat: pad,
    });

    // Side wing on the outer edge only — pads are asymmetric, and the wing is
    // what stops them reading as a symmetric tube stack.
    const outer = Math.sign(x) * 0.075;
    parts.push({ geo: bakedBox(0.022, shinH * 0.92, 0.05, x + outer, SHIN_BOTTOM + shinH / 2, -0.012), mat: pad });

    // Thin straps round the back (+Z).
    for (const y of [0.12, 0.3, KNEE_Y + 0.13]) {
      parts.push({ geo: bakedBox(0.18, 0.016, 0.012, x, y, 0.022), mat: strap });
    }

    // Ankle flap at the bottom.
    parts.push({ geo: bakedBox(0.15, 0.05, 0.055, x, 0.025, -0.03), mat: pad });
  }

  const g = mergeByMaterial(parts);
  g.name = "pads";
  return g;
}

/** Helmet with a grille, origin at the neck. */
export function makeHelmet(shell = 0x1c2b4a, mats?: AssetMaterialLib): THREE.Group {
  const shellMat = stdMat(shell, { roughness: 0.4 }, mats);
  const grille = stdMat(0x8a8f96, { roughness: 0.35, metalness: 0.8 }, mats);
  const parts: Part[] = [];

  // Dome.
  const dome = new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  dome.translate(0, 0.06, 0);
  parts.push({ geo: dome, mat: shellMat });

  // Peak over the eyes (-Z is forward).
  parts.push({ geo: bakedBox(0.2, 0.014, 0.09, 0, 0.045, -0.12, -0.18), mat: shellMat });

  // Grille: three horizontal bars plus two uprights.
  for (let i = 0; i < 3; i++) {
    parts.push({
      geo: bakedCyl(0.005, 0.005, 0.2, 6, 0, -0.02 - i * 0.045, -0.115, 0, Math.PI / 2),
      mat: grille,
    });
  }
  for (const x of [-0.07, 0.07]) {
    parts.push({ geo: bakedCyl(0.005, 0.005, 0.14, 6, x, -0.06, -0.113), mat: grille });
  }

  const g = mergeByMaterial(parts);
  g.name = "helmet";
  return g;
}
