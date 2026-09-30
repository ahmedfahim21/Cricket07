/**
 * Poses: a flat bank of numbers, blended and interpolated as plain arrays, and
 * one function that writes a pose onto a rig.
 *
 * Same shape as the city engine's `Pose` — pose generators fill a numeric
 * struct, blending is a lerp per channel, and `applyPose` is the only thing
 * that touches the scene graph — extended with IK CONTACTS. A channel pose can
 * say "left foot planted HERE", "bat gripped HERE at THIS angle", "bowling arm
 * pointing THIS way", "look at the ball", with a weight per contact, and the
 * solver meets them. Everything is in the player's ROOT space: rig-local,
 * unscaled, facing -Z with the player's right on +X.
 *
 * Angles use one sign convention throughout: positive flexion is positive,
 * whichever way the joint actually rotates. A knee channel of 1.2 is a knee
 * bent 1.2 rad, an elbow of 1.2 an elbow bent 1.2 rad.
 */

import * as THREE from "three";
import { SKELETON, type PlayerRig } from "../assets/kit";
import { BAT_BLADE_LENGTH, BAT_HANDLE_LENGTH } from "../dimensions";
import {
  aimBone,
  matrixToRoot,
  pointToRoot,
  quatToRoot,
  rootDirToParent,
  rootToParent,
  solveTwoBone,
} from "./ik";

export const CHANNELS = [
  // Pelvis offset from its standing position, and orientation. Pitch > 0
  // tips forward; yaw > 0 turns toward the player's left; roll > 0 leans left.
  "pelvisX", "pelvisY", "pelvisZ", "pelvisPitch", "pelvisYaw", "pelvisRoll",
  // Torso relative to the pelvis, shared between the spine and chest joints.
  // Pitch > 0 bends forward. Yaw is the hip-shoulder separation.
  "torsoPitch", "torsoYaw", "torsoRoll",
  // Head relative to the chest. Pitch > 0 is chin down.
  "headPitch", "headYaw",
  // FK legs: flexion (+ forward), abduction (+ outward), twist; knee and
  // ankle flexion (+ = knee bent, + = toe up).
  "hipLFlex", "hipLAbd", "hipLTwist", "kneeL", "ankleL",
  "hipRFlex", "hipRAbd", "hipRTwist", "kneeR", "ankleR",
  // FK arms: flexion (+ forward and up), abduction (+ outward), twist, elbow.
  "shLFlex", "shLAbd", "shLTwist", "elbowL",
  "shRFlex", "shRAbd", "shRTwist", "elbowR",
  // IK feet: ankle target in root space, foot yaw and pitch (toe up), weight.
  "footLX", "footLY", "footLZ", "footLYaw", "footLPitch", "footLW",
  "footRX", "footRY", "footRZ", "footRYaw", "footRPitch", "footRW",
  // IK bat, two-handed (right-hander: left hand on top). Grip is the top
  // hand; orientation is a quaternion (bat +Y runs toe to handle, the face is
  // -Z). A quaternion rather than angles because a pulled or cut ball is hit
  // with a horizontal bat, which is exactly where any yaw/tilt/pitch set
  // hits gimbal lock and interpolation spins the bat. Weight 0 hides the bat.
  "gripX", "gripY", "gripZ", "batQX", "batQY", "batQZ", "batQW", "batW",
  // 1 = carried in the right hand only (running between the wickets).
  "batOneHand",
  // IK arm aim, for straight-armed swings (bowling, throwing). Swing angle
  // runs round the delivery plane: 0 hanging down, PI/2 pointing back (+Z),
  // PI straight up, 3PI/2 forward (-Z). Side leans it out (+X). Elbow bend.
  "aimRSwing", "aimRSide", "aimRElbow", "aimRW",
  "aimLSwing", "aimLSide", "aimLElbow", "aimLW",
  // IK hand reach: put a fist on a point (picking up, catching).
  "handRX", "handRY", "handRZ", "handRW",
  "handLX", "handLY", "handLZ", "handLW",
  // Look target in root space, blended over the head FK channels.
  "lookX", "lookY", "lookZ", "lookW",
] as const;

export type Channel = (typeof CHANNELS)[number];
export type Pose = Float32Array;
export type PoseValues = Partial<Record<Channel, number>>;

/** Channel name -> index. */
export const C = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>;

/** Channels that are weights: clamped to [0,1] after interpolation. */
export const WEIGHT_CHANNELS: Channel[] = [
  "footLW", "footRW", "batW", "aimRW", "aimLW", "handRW", "handLW", "lookW",
];

export function makePose(values: PoseValues = {}): Pose {
  const p = new Float32Array(CHANNELS.length);
  return setPose(p, values);
}

export function setPose(p: Pose, values: PoseValues): Pose {
  for (const k in values) p[C[k as Channel]] = values[k as Channel] as number;
  return p;
}

export function copyPose(out: Pose, src: Pose): Pose {
  out.set(src);
  return out;
}

export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

export function clampWeights(p: Pose): Pose {
  for (const w of WEIGHT_CHANNELS) {
    const i = C[w];
    p[i] = p[i] < 0 ? 0 : p[i] > 1 ? 1 : p[i];
  }
  return p;
}

/* ------------------------------------------------------------------ *
 * Bat geometry used by the grip solver
 * ------------------------------------------------------------------ */

/** Distance from the bat's toe to the top hand. */
export const GRIP_TOP = BAT_BLADE_LENGTH + BAT_HANDLE_LENGTH * 0.84;
/** Top hand to bottom hand, along the handle. */
export const GRIP_GAP = 0.13;
/** Toe to the middle of the bat — where it is meant to meet the ball. */
export const SWEET_SPOT = 0.19;

const _qBat = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _ex = new THREE.Vector3(1, 0, 0);
const _ey = new THREE.Vector3(0, 1, 0);
const _ez = new THREE.Vector3(0, 0, 1);

/** The bat's orientation in root space for given yaw / tilt / pitch. */
export function batQuaternion(yaw: number, tilt: number, pitch: number, out = new THREE.Quaternion()) {
  _qA.setFromAxisAngle(_ey, yaw);
  _qB.setFromAxisAngle(_ez, tilt);
  _qC.setFromAxisAngle(_ex, pitch);
  return out.copy(_qA).multiply(_qB).multiply(_qC);
}

/**
 * Where the top hand has to be for the bat's middle to sit on `sweet`, at the
 * given orientation. Shot choreography works in terms of where the BALL is;
 * this turns that into where the HANDS go.
 */
export function gripForSweetSpot(
  sweet: THREE.Vector3,
  q: THREE.Quaternion,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const up = _ey.clone().applyQuaternion(q);
  return out.copy(sweet).addScaledVector(up, GRIP_TOP - SWEET_SPOT);
}

/**
 * A bat orientation from where its handle points (`up`, toe to handle) and
 * where its face should look. The face is made perpendicular to the handle,
 * so it points as nearly along `face` as the handle allows.
 */
export function batFromAxes(up: THREE.Vector3, face: THREE.Vector3, out = new THREE.Quaternion()) {
  const y = up.clone().normalize();
  const f = face.clone().addScaledVector(y, -face.dot(y));
  if (f.lengthSq() < 1e-8) f.set(0, 0, -1).addScaledVector(y, y.z);
  const z = f.normalize().negate(); // the face is local -Z
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Pose channels for a bat held with the top hand at `grip`. */
export function batChannels(grip: THREE.Vector3, q: THREE.Quaternion, w = 1): PoseValues {
  return {
    gripX: grip.x, gripY: grip.y, gripZ: grip.z,
    batQX: q.x, batQY: q.y, batQZ: q.z, batQW: q.w,
    batW: w,
  };
}

/** Read the bat quaternion out of a pose, normalised. */
export function batOf(p: Pose, out = new THREE.Quaternion()): THREE.Quaternion {
  out.set(p[C.batQX], p[C.batQY], p[C.batQZ], p[C.batQW]);
  const l = out.length();
  return l < 1e-6 ? out.identity() : out.normalize();
}

/* ------------------------------------------------------------------ *
 * Applying a pose
 * ------------------------------------------------------------------ */

const S = SKELETON;
const ARM_L1 = S.upperArm;
const ARM_L2 = S.forearm + S.hand;
const LEG_L1 = S.thigh;
const LEG_L2 = S.shin;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qFK = new THREE.Quaternion();
const _qK = new THREE.Quaternion();
const _qFoot = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m4 = new THREE.Matrix4();

/** Poles for the two-handed grip, root space. Tuned against the harness. */
const POLE_TOP_ELBOW = new THREE.Vector3(-0.55, -0.35, 0.75);
const POLE_BOTTOM_ELBOW = new THREE.Vector3(0.45, -1, 0.35);

/**
 * Write `p` onto `rig`. FK first, then each IK contact blended in by its
 * weight, in the order a body actually settles: feet (which set how low the
 * pelvis can be), then hands, then the head.
 */
export function applyPose(rig: PlayerRig, p: Pose): void {
  const root = rig.root;

  /* ---- Trunk ------------------------------------------------------- */
  rig.pelvis.position.set(p[C.pelvisX], S.hipY + p[C.pelvisY], p[C.pelvisZ]);
  // rotation.x > 0 tips the top of an upright segment BACK (toward +Z), so
  // every "forward" pitch channel is negated on the way in.
  rig.pelvis.rotation.set(-p[C.pelvisPitch], p[C.pelvisYaw], p[C.pelvisRoll], "YXZ");
  const tp = -p[C.torsoPitch] * 0.5;
  const ty = p[C.torsoYaw] * 0.5;
  const tr = p[C.torsoRoll] * 0.5;
  rig.spine.rotation.set(tp, ty, tr, "YXZ");
  rig.chest.rotation.set(tp, ty, tr, "YXZ");
  rig.head.rotation.set(-p[C.headPitch], p[C.headYaw], 0, "YXZ");

  /* ---- FK limbs ---------------------------------------------------- */
  rig.hipL.rotation.set(p[C.hipLFlex], -p[C.hipLTwist], -p[C.hipLAbd], "XYZ");
  rig.hipR.rotation.set(p[C.hipRFlex], p[C.hipRTwist], p[C.hipRAbd], "XYZ");
  rig.kneeL.rotation.set(-p[C.kneeL], 0, 0);
  rig.kneeR.rotation.set(-p[C.kneeR], 0, 0);
  rig.ankleL.rotation.set(p[C.ankleL], 0, 0);
  rig.ankleR.rotation.set(p[C.ankleR], 0, 0);
  rig.shoulderL.rotation.set(p[C.shLFlex], -p[C.shLTwist], -p[C.shLAbd], "XYZ");
  rig.shoulderR.rotation.set(p[C.shRFlex], p[C.shRTwist], p[C.shRAbd], "XYZ");
  rig.elbowL.rotation.set(p[C.elbowL], 0, 0);
  rig.elbowR.rotation.set(p[C.elbowR], 0, 0);

  /* ---- Feet -------------------------------------------------------- */
  const wL = p[C.footLW];
  const wR = p[C.footRW];
  if (wL > 1e-3 || wR > 1e-3) {
    // Lower the pelvis until every planted foot is within reach — the
    // generalised form of "keep the lower foot on the floor". Iterated because
    // the hips are not directly above the feet.
    for (let iter = 0; iter < 4; iter++) {
      let excess = 0;
      for (const side of [-1, 1] as const) {
        const w = side < 0 ? wL : wR;
        if (w < 0.5) continue;
        // Only a foot actually on the turf holds the body up. A foot target in
        // the air (a trailing leg, a knee drive) must never drag the pelvis
        // down to reach it — that is what folded the bowler into a kneel.
        if ((side < 0 ? p[C.footLY] : p[C.footRY]) > S.ankleH + 0.12) continue;
        const hip = side < 0 ? rig.hipL : rig.hipR;
        pointToRoot(hip, root, _v.set(0, 0, 0), _a);
        footTarget(p, side, _t);
        excess = Math.max(excess, _a.distanceTo(_t) - (LEG_L1 + LEG_L2) * 0.998);
      }
      if (excess <= 1e-4) break;
      rig.pelvis.position.y -= excess;
    }
    solveFoot(rig, p, -1, wL);
    solveFoot(rig, p, 1, wR);
  }

  /* ---- Arms -------------------------------------------------------- */
  const batW = p[C.batW];
  if (rig.bat) rig.bat.visible = batW > 0.05;
  if (rig.bat && batW > 1e-3) solveBat(rig, p, batW);

  const aimR = p[C.aimRW];
  if (aimR > 1e-3) solveAim(rig, p, 1, aimR);
  const aimL = p[C.aimLW];
  if (aimL > 1e-3) solveAim(rig, p, -1, aimL);

  const reachR = p[C.handRW];
  if (reachR > 1e-3) {
    _t.set(p[C.handRX], p[C.handRY], p[C.handRZ]);
    solveArm(rig, 1, _t, _pole.set(0.4, -0.6, 0.7), reachR);
  }
  const reachL = p[C.handLW];
  if (reachL > 1e-3) {
    _t.set(p[C.handLX], p[C.handLY], p[C.handLZ]);
    solveArm(rig, -1, _t, _pole.set(-0.4, -0.6, 0.7), reachL);
  }

  /* ---- Head -------------------------------------------------------- */
  const lookW = p[C.lookW];
  if (lookW > 1e-3) {
    // Direction to the target in the chest's frame, as yaw/pitch for a head
    // that faces -Z. Clamped: a neck does not turn 180 degrees.
    pointToRoot(rig.head, root, _v.set(0, 0.15, 0), _a);
    _t.set(p[C.lookX], p[C.lookY], p[C.lookZ]).sub(_a);
    rootDirToParent(rig.head, root, _t, _v2);
    const yaw = THREE.MathUtils.clamp(Math.atan2(-_v2.x, -_v2.z), -1.35, 1.35);
    // Chin-down positive, like the headPitch channel it blends with.
    const down = THREE.MathUtils.clamp(
      Math.atan2(-_v2.y, Math.hypot(_v2.x, _v2.z)),
      -0.7,
      0.85
    );
    rig.head.rotation.set(
      -THREE.MathUtils.lerp(p[C.headPitch], down, lookW),
      THREE.MathUtils.lerp(p[C.headYaw], yaw, lookW),
      0,
      "YXZ"
    );
  }
}

function footTarget(p: Pose, side: -1 | 1, out: THREE.Vector3) {
  return side < 0
    ? out.set(p[C.footLX], p[C.footLY], p[C.footLZ])
    : out.set(p[C.footRX], p[C.footRY], p[C.footRZ]);
}

function solveFoot(rig: PlayerRig, p: Pose, side: -1 | 1, w: number) {
  if (w <= 1e-3) return;
  const root = rig.root;
  const hip = side < 0 ? rig.hipL : rig.hipR;
  const knee = side < 0 ? rig.kneeL : rig.kneeR;
  const ankle = side < 0 ? rig.ankleL : rig.ankleR;
  const yaw = side < 0 ? p[C.footLYaw] : p[C.footRYaw];
  const pitch = side < 0 ? p[C.footLPitch] : p[C.footRPitch];

  footTarget(p, side, _v);
  rootToParent(hip, root, _v, _t);
  // Knee points the way the foot does, and a touch outward.
  _pole.set(-Math.sin(yaw) + side * 0.12, 0, -Math.cos(yaw));
  rootDirToParent(hip, root, _pole, _v2);

  _qFK.copy(hip.quaternion);
  const kneeFK = knee.rotation.x;
  const bend = solveTwoBone(hip.position, _t, _v2, LEG_L1, LEG_L2, -1, _q);
  hip.quaternion.copy(_qFK).slerp(_q, w);
  knee.rotation.set(THREE.MathUtils.lerp(kneeFK, bend, w), 0, 0);

  // Foot orientation: flat (or pitched) in root space at the given yaw,
  // re-expressed relative to the shin, so the sole meets the turf whatever
  // the leg above it is doing.
  _qFoot.setFromEuler(_e.set(pitch, yaw, 0, "YXZ"));
  quatToRoot(knee, root, _qK);
  _q.copy(_qK).invert().multiply(_qFoot);
  _qFK.copy(ankle.quaternion);
  ankle.quaternion.copy(_qFK).slerp(_q, w);
}

/**
 * Solve one arm so its fist lands on `target` (root space), blended in by `w`.
 */
function solveArm(rig: PlayerRig, side: -1 | 1, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  const root = rig.root;
  const shoulder = side < 0 ? rig.shoulderL : rig.shoulderR;
  const elbow = side < 0 ? rig.elbowL : rig.elbowR;
  rootToParent(shoulder, root, target, _t);
  rootDirToParent(shoulder, root, pole, _v2);
  _qFK.copy(shoulder.quaternion);
  const elbowFK = elbow.rotation.x;
  const bend = solveTwoBone(shoulder.position, _t, _v2, ARM_L1, ARM_L2, 1, _q);
  shoulder.quaternion.copy(_qFK).slerp(_q, w);
  elbow.rotation.set(THREE.MathUtils.lerp(elbowFK, bend, w), 0, 0);
}

/**
 * Place the bat and put both hands on its handle.
 *
 * The grip is pulled toward the shoulders until both hands can reach the wood:
 * a keyframe authored without regard to arm length otherwise leaves a glove
 * hanging in the air beside the handle — the "floating bat" the batsman had.
 */
function solveBat(rig: PlayerRig, p: Pose, w: number) {
  const root = rig.root;
  const bat = rig.bat!;
  batOf(p, _qBat);
  // Its own vector: the lean and reach helpers below use the shared scratch
  // vectors, and a borrowed one here got overwritten mid-solve — the bat then
  // sat on the hands instead of hanging from them.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_qBat);

  const reach = (ARM_L1 + ARM_L2) * 0.985;
  const grip = new THREE.Vector3(p[C.gripX], p[C.gripY], p[C.gripZ]);
  const bottom = new THREE.Vector3();

  // A two-handed bat needs both shoulders within reach of the handle. If they
  // are not, the body bends toward it first, the way a batsman leans into a
  // drive — only if that runs out does the grip itself get pulled in.
  if (p[C.batOneHand] < 0.5) {
    bottom.copy(grip).addScaledVector(up, -GRIP_GAP);
    leanToward(rig, grip, bottom, reach, 0.75);
  }

  const sL = pointToRoot(rig.shoulderL, root, _a.set(0, 0, 0), new THREE.Vector3());
  const sR = pointToRoot(rig.shoulderR, root, _a.set(0, 0, 0), new THREE.Vector3());
  const mid = sL.clone().add(sR).multiplyScalar(0.5);

  if (p[C.batOneHand] > 0.5) {
    // Carried: the right fist on the handle, the left arm free to swing.
    bat.quaternion.copy(_qBat);
    bat.position.copy(grip).addScaledVector(up, -GRIP_TOP);
    solveArm(rig, 1, grip, POLE_BOTTOM_ELBOW, w);
    return;
  }

  for (let i = 0; i < 20; i++) {
    bottom.copy(grip).addScaledVector(up, -GRIP_GAP);
    if (sL.distanceTo(grip) <= reach && sR.distanceTo(bottom) <= reach) break;
    grip.lerp(mid, 0.08);
  }
  bottom.copy(grip).addScaledVector(up, -GRIP_GAP);

  bat.quaternion.copy(_qBat);
  bat.position.copy(grip).addScaledVector(up, -GRIP_TOP);

  solveArm(rig, -1, grip, POLE_TOP_ELBOW, w);
  solveArm(rig, 1, bottom, POLE_BOTTOM_ELBOW, w);
}

const _axis = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _mv = new THREE.Vector3();
const _gv = new THREE.Vector3();
const _qd = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/**
 * Bend the trunk at the waist, a little at a time, until both shoulders can
 * reach their points on the handle (or `maxAngle` is used up).
 */
function leanToward(rig: PlayerRig, top: THREE.Vector3, bottom: THREE.Vector3, reach: number, maxAngle: number) {
  const root = rig.root;
  let used = 0;
  for (let i = 0; i < 16 && used < maxAngle; i++) {
    const sL = pointToRoot(rig.shoulderL, root, _v.set(0, 0, 0), _a);
    const dL = sL.distanceTo(top);
    const sR = pointToRoot(rig.shoulderR, root, _v.set(0, 0, 0), _t);
    const dR = sR.distanceTo(bottom);
    const excess = Math.max(dL, dR) - reach;
    if (excess <= 0.002) return;

    pointToRoot(rig.spine, root, _v.set(0, 0, 0), _pv); // waist pivot
    _mv.copy(sL).add(sR).multiplyScalar(0.5).sub(_pv);
    _gv.copy(top).add(bottom).multiplyScalar(0.5).sub(_pv);
    _axis.crossVectors(_mv, _gv);
    if (_axis.lengthSq() < 1e-10) return;
    _axis.normalize();
    const step = Math.min(0.08, excess / Math.max(0.3, _mv.length()), maxAngle - used);
    used += step;

    // Rotate the spine about a ROOT-space axis: conjugate by the parent's
    // root rotation to express it in the spine's own parent frame.
    quatToRoot(rig.pelvis, root, _qp);
    _axis.applyQuaternion(_qp.clone().invert());
    _qd.setFromAxisAngle(_axis, step);
    rig.spine.quaternion.premultiply(_qd);
  }
}

/** Point an arm along a root-space direction, for a straight-armed swing. */
function solveAim(rig: PlayerRig, p: Pose, side: -1 | 1, w: number) {
  const root = rig.root;
  const shoulder = side < 0 ? rig.shoulderL : rig.shoulderR;
  const elbow = side < 0 ? rig.elbowL : rig.elbowR;
  const swing = side < 0 ? p[C.aimLSwing] : p[C.aimRSwing];
  const lean = side < 0 ? p[C.aimLSide] : p[C.aimRSide];
  const bend = side < 0 ? p[C.aimLElbow] : p[C.aimRElbow];

  _v.set(Math.sin(lean), -Math.cos(swing) * Math.cos(lean), Math.sin(swing) * Math.cos(lean));
  rootDirToParent(shoulder, root, _v, _t);
  // The windmill turns about the root's lateral axis, whatever the chest is
  // doing; that is what keeps the arm in the line of delivery.
  rootDirToParent(shoulder, root, _ex, _v2);
  aimBone(_t, _v2, _q);
  _qFK.copy(shoulder.quaternion);
  shoulder.quaternion.copy(_qFK).slerp(_q, w);
  elbow.rotation.set(THREE.MathUtils.lerp(elbow.rotation.x, bend, w), 0, 0);
}

/* ------------------------------------------------------------------ *
 * Measuring a posed rig
 * ------------------------------------------------------------------ */

/** Root-space position of a point on a joint. */
export function jointPoint(
  rig: PlayerRig,
  joint: THREE.Object3D,
  local = new THREE.Vector3(),
  out = new THREE.Vector3()
): THREE.Vector3 {
  return pointToRoot(joint, rig.root, local, out);
}

/** Root-space position of the bat's middle, where it is meant to hit the ball. */
export function sweetSpot(rig: PlayerRig, out = new THREE.Vector3()): THREE.Vector3 {
  if (!rig.bat) return out.set(0, 0, 0);
  return pointToRoot(rig.bat, rig.root, _v.set(0, SWEET_SPOT, 0), out);
}

/** Root-space position of the sole under a foot: the bit that touches grass. */
export function solePoint(rig: PlayerRig, side: -1 | 1, out = new THREE.Vector3()) {
  const ankle = side < 0 ? rig.ankleL : rig.ankleR;
  return pointToRoot(ankle, rig.root, _v.set(0, -S.ankleH, -0.03), out);
}

/**
 * Fill the IK target channels of a pose that does not use them with where
 * the FK pose actually puts those points.
 *
 * Needed for crossfades: blending a run cycle (feet by FK, weight 0) into a
 * delivery stride (feet by IK, weight 1) lerps the target channels too, and
 * an unset target sits at the origin — so without this the foot would sweep
 * in from the middle of the pitch during the fade.
 */
export function fillTargetsFromFK(rig: PlayerRig, p: Pose): Pose {
  applyPose(rig, p);
  if (p[C.footLW] < 1e-3) {
    jointPoint(rig, rig.ankleL, _v.set(0, 0, 0), _a);
    setPose(p, { footLX: _a.x, footLY: _a.y, footLZ: _a.z, footLYaw: p[C.pelvisYaw] });
  }
  if (p[C.footRW] < 1e-3) {
    jointPoint(rig, rig.ankleR, _v.set(0, 0, 0), _a);
    setPose(p, { footRX: _a.x, footRY: _a.y, footRZ: _a.z, footRYaw: p[C.pelvisYaw] });
  }
  if (p[C.handRW] < 1e-3) {
    jointPoint(rig, rig.handR, _v.set(0, 0, 0), _a);
    setPose(p, { handRX: _a.x, handRY: _a.y, handRZ: _a.z });
  }
  if (p[C.handLW] < 1e-3) {
    jointPoint(rig, rig.handL, _v.set(0, 0, 0), _a);
    setPose(p, { handLX: _a.x, handLY: _a.y, handLZ: _a.z });
  }
  return p;
}

/** Root-space matrix of a joint, for callers that need a full transform. */
export function jointMatrix(rig: PlayerRig, joint: THREE.Object3D, out = _m4) {
  return matrixToRoot(joint, rig.root, out);
}
