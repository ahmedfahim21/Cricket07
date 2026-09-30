import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aimBone, matrixToRoot, solveTwoBone } from "./ik";

/** A shoulder -> elbow -> hand chain hanging along -Y, like the rig's arms. */
function chain(l1: number, l2: number) {
  const root = new THREE.Group();
  const a = new THREE.Group();
  a.position.set(0.2, 1.4, 0);
  const b = new THREE.Group();
  b.position.set(0, -l1, 0);
  const end = new THREE.Group();
  end.position.set(0, -l2, 0);
  root.add(a);
  a.add(b);
  b.add(end);
  return { root, a, b, end };
}

function endPos(c: ReturnType<typeof chain>) {
  c.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(c.end.matrixWorld);
}

function midPos(c: ReturnType<typeof chain>) {
  c.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(c.b.matrixWorld);
}

describe("solveTwoBone", () => {
  const L1 = 0.285;
  const L2 = 0.315;

  it("lands the end effector on every reachable target to within a millimetre", () => {
    const c = chain(L1, L2);
    const q = new THREE.Quaternion();
    const pole = new THREE.Vector3(0, -0.3, 1);
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // Random directions and reachable distances.
      const dir = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 2.3)).normalize();
      const dist = 0.08 + ((i * 37) % 100) / 100 * (L1 + L2 - 0.1);
      const target = c.a.position.clone().addScaledVector(dir, dist);
      const bend = solveTwoBone(c.a.position, target, pole, L1, L2, 1, q);
      c.a.quaternion.copy(q);
      c.b.rotation.set(bend, 0, 0);
      worst = Math.max(worst, endPos(c).distanceTo(target));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("bends the middle joint toward the pole", () => {
    const c = chain(L1, L2);
    const q = new THREE.Quaternion();
    const target = c.a.position.clone().add(new THREE.Vector3(0, -0.35, 0));
    for (const pole of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)]) {
      const bend = solveTwoBone(c.a.position, target, pole, L1, L2, 1, q);
      c.a.quaternion.copy(q);
      c.b.rotation.set(bend, 0, 0);
      const offset = midPos(c).sub(c.a.position);
      // The elbow sits on the pole's side of the reach line.
      expect(offset.dot(pole)).toBeGreaterThan(0.05);
    }
  });

  it("uses a positive hinge for an elbow and a negative one for a knee", () => {
    const q = new THREE.Quaternion();
    const a = new THREE.Vector3();
    const target = new THREE.Vector3(0, -0.4, 0);
    const pole = new THREE.Vector3(0, 0, -1);
    expect(solveTwoBone(a, target, pole, L1, L2, 1, q)).toBeGreaterThan(0);
    expect(solveTwoBone(a, target, pole, L1, L2, -1, q)).toBeLessThan(0);
  });

  it("also lands the target with a negative (knee) hinge", () => {
    const c = chain(0.425, 0.405);
    const q = new THREE.Quaternion();
    const target = c.a.position.clone().add(new THREE.Vector3(0.05, -0.7, -0.25));
    const bend = solveTwoBone(c.a.position, target, new THREE.Vector3(0, 0, -1), 0.425, 0.405, -1, q);
    c.a.quaternion.copy(q);
    c.b.rotation.set(bend, 0, 0);
    expect(endPos(c).distanceTo(target)).toBeLessThan(1e-3);
    // Knee forward of the hip-ankle line, i.e. toward -Z.
    expect(midPos(c).z).toBeLessThan(target.z * 0.5 - 0.02);
  });

  it("extends fully toward an unreachable target instead of producing NaNs", () => {
    const c = chain(L1, L2);
    const q = new THREE.Quaternion();
    const target = c.a.position.clone().add(new THREE.Vector3(3, 0, 0));
    const bend = solveTwoBone(c.a.position, target, new THREE.Vector3(0, 0, 1), L1, L2, 1, q);
    c.a.quaternion.copy(q);
    c.b.rotation.set(bend, 0, 0);
    const end = endPos(c);
    expect(Number.isFinite(end.x)).toBe(true);
    expect(Math.abs(bend)).toBeLessThan(0.05);
    expect(end.clone().sub(c.a.position).normalize().x).toBeGreaterThan(0.999);
  });
});

describe("aimBone", () => {
  it("points the bone along the requested direction", () => {
    const q = new THREE.Quaternion();
    const hinge = new THREE.Vector3(1, 0, 0);
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const dir = new THREE.Vector3(0, -Math.cos(a), Math.sin(a));
      aimBone(dir, hinge, q);
      const bone = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
      expect(bone.distanceTo(dir)).toBeLessThan(1e-6);
    }
  });

  it("stays continuous as the arm goes straight overhead", () => {
    // The bowling arm passes vertical at release; a shortest-arc solution
    // flips there. This one must not jump between neighbouring samples.
    const q = new THREE.Quaternion();
    const prev = new THREE.Quaternion();
    const hinge = new THREE.Vector3(1, 0, 0);
    let first = true;
    for (let a = Math.PI - 0.3; a < Math.PI + 0.3; a += 0.01) {
      aimBone(new THREE.Vector3(0, -Math.cos(a), Math.sin(a)), hinge, q);
      if (!first) expect(q.angleTo(prev)).toBeLessThan(0.02);
      prev.copy(q);
      first = false;
    }
  });
});

describe("matrixToRoot", () => {
  it("matches the world matrix when the root sits at the origin", () => {
    const c = chain(0.3, 0.3);
    c.a.rotation.set(0.4, 0.2, -0.3);
    c.b.rotation.set(0.9, 0, 0);
    const m = matrixToRoot(c.end, c.root, new THREE.Matrix4());
    c.root.updateMatrixWorld(true);
    const p1 = new THREE.Vector3().setFromMatrixPosition(m);
    const p2 = new THREE.Vector3().setFromMatrixPosition(c.end.matrixWorld);
    expect(p1.distanceTo(p2)).toBeLessThan(1e-9);
  });
});
