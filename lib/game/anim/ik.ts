/**
 * Inverse kinematics for the player rig.
 *
 * Why IK at all: a cricket shot is defined by CONTACTS — the front foot planted
 * where the ball pitched, both hands on one bat handle, the bat's middle on the
 * ball. Hand-authoring joint angles and hoping they happen to produce those
 * contacts is what gave a bat that floated beside the batsman and feet that
 * skated. Here the contacts are specified and the joints are solved to meet
 * them.
 *
 * Everything works in the PARENT space of the chain's first joint, so callers
 * convert their targets once and the solver stays free of scene-graph walks.
 * Bones hang along local -Y at rest, matching the rig in `assets/kit.ts`.
 */

import * as THREE from "three";

const _d = new THREE.Vector3();
const _dh = new THREE.Vector3();
const _b = new THREE.Vector3();
const _u = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Solve a two-bone chain (shoulder-elbow-hand, hip-knee-ankle).
 *
 * @param a      position of the first joint, in its parent's space
 * @param target where the end of the second bone should land, same space
 * @param pole   direction the middle joint should bulge toward (elbow back,
 *               knee forward), same space
 * @param l1     first bone length
 * @param l2     second bone length
 * @param hinge  +1 if the middle joint flexes with +rotation.x (elbow),
 *               -1 if it flexes with -rotation.x (knee)
 * @param outQ   receives the first joint's quaternion, in parent space
 * @returns      the middle joint's rotation.x
 *
 * An unreachable target leaves the chain fully extended toward it rather than
 * producing NaNs — a batsman stretching for a wide ball should look stretched,
 * not explode.
 */
export function solveTwoBone(
  a: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
  hinge: 1 | -1,
  outQ: THREE.Quaternion
): number {
  _d.subVectors(target, a);
  const len = _d.length();
  const L = THREE.MathUtils.clamp(len, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  if (len < 1e-6) _dh.set(0, -1, 0);
  else _dh.copy(_d).multiplyScalar(1 / len);

  // Law of cosines: interior angle at the middle joint, and the offset of the
  // first bone from the straight line to the target.
  const cosMid = (l1 * l1 + l2 * l2 - L * L) / (2 * l1 * l2);
  const bend = Math.PI - Math.acos(THREE.MathUtils.clamp(cosMid, -1, 1));
  const cosA = (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L);
  const alpha = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));

  // Bend plane: the pole made perpendicular to the reach line. A pole that is
  // parallel to the reach line has no preferred side; fall back to any
  // perpendicular so the result is at least continuous.
  _b.copy(pole).addScaledVector(_dh, -pole.dot(_dh));
  if (_b.lengthSq() < 1e-8) {
    _b.set(0, 0, 1).addScaledVector(_dh, -_dh.z);
    if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0).addScaledVector(_dh, -_dh.x);
  }
  _b.normalize();

  // First bone direction: rotated off the reach line toward the pole.
  _u.copy(_dh).multiplyScalar(Math.cos(alpha)).addScaledVector(_b, Math.sin(alpha));

  // Frame for the first joint: local -Y runs down the bone, and local -Z
  // points from the bone toward the target, so a positive (elbow) hinge folds
  // the second bone back onto it; a knee folds the other way, so its Z flips.
  //
  // That target-ward direction is taken straight from the triangle as
  // (b cos a - dh sin a). Projecting the pole onto the bone's normal plane
  // instead carries a hidden factor of cos(a), which changes sign once the
  // first bone swings more than 90 degrees off the reach line — a tightly
  // folded arm then comes out mirrored, with the hand on the wrong side.
  _y.copy(_u).negate();
  _z.copy(_b).multiplyScalar(Math.cos(alpha)).addScaledVector(_dh, -Math.sin(alpha)).normalize();
  if (hinge < 0) _z.negate();
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  outQ.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  return hinge * bend;
}

/**
 * Point a single bone (local -Y) along `dir`, with its hinge axis (local X)
 * kept as close as possible to `hingeAxis`. Both in the bone's parent space.
 *
 * This is for a straight-armed windmill — the bowling arm — where the arm
 * passes straight overhead. The shortest-arc rotation from "hanging down" is
 * undefined pointing straight up and flips at that instant, which is exactly
 * the release point; building the frame off a hinge axis instead keeps it
 * continuous all the way round.
 */
export function aimBone(
  dir: THREE.Vector3,
  hingeAxis: THREE.Vector3,
  outQ: THREE.Quaternion
): void {
  _y.copy(dir).normalize().negate();
  _x.copy(hingeAxis).addScaledVector(_y, -hingeAxis.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  outQ.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/**
 * Matrix taking `obj`'s local space to `root`'s local space.
 *
 * Walks the parents explicitly and refreshes each local matrix, so it is valid
 * mid-pose — after some joints have been rotated this frame but before the
 * renderer's own world-matrix pass.
 */
export function matrixToRoot(obj: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4) {
  out.identity();
  let o: THREE.Object3D | null = obj;
  while (o && o !== root) {
    o.updateMatrix();
    out.premultiply(o.matrix);
    o = o.parent;
  }
  return out;
}

const _mr = new THREE.Matrix4();
const _mq = new THREE.Quaternion();
const _ms = new THREE.Vector3();

/** An object's rotation relative to `root`. */
export function quatToRoot(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  out: THREE.Quaternion
): THREE.Quaternion {
  matrixToRoot(obj, root, _mr).decompose(_ms, out, _ms);
  return out;
}

/** A point given in `obj`'s local space, expressed in `root`'s. */
export function pointToRoot(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  local: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 {
  return out.copy(local).applyMatrix4(matrixToRoot(obj, root, _mr));
}

/** A root-space point expressed in the local space of `obj`'s PARENT. */
export function rootToParent(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  p: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 {
  if (!obj.parent || obj.parent === root) return out.copy(p);
  matrixToRoot(obj.parent, root, _mr).invert();
  return out.copy(p).applyMatrix4(_mr);
}

/** A root-space direction expressed in `obj`'s PARENT space. */
export function rootDirToParent(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  d: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 {
  if (!obj.parent || obj.parent === root) return out.copy(d);
  matrixToRoot(obj.parent, root, _mr).decompose(_ms, _mq, _ms);
  return out.copy(d).applyQuaternion(_mq.invert());
}
