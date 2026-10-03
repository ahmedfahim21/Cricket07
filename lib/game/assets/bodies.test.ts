import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { templateFrom, type BodyTemplate } from "./bodies";
import { JOINTS, makePlayer, type PlayerRig } from "./kit";
import type { Appearance } from "../roster/appearance";

const LOOK: Appearance = {
  heritage: "european", physique: "athletic", skin: "tan", hair: "short",
  hairColour: "black", facialHair: "full", eyes: "brown", cap: false,
};

const DIR = join(__dirname, "../../../public/models/players");
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  builds: { name: string; file: string; skin: string }[];
  hairStyles: string[];
  beardStyles: string[];
};

async function load(file: string, name: string): Promise<BodyTemplate> {
  const buf = readFileSync(join(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, "");
  return templateFrom(gltf.scene, name);
}

function bodyOf(rig: PlayerRig): THREE.SkinnedMesh {
  const m = rig.root.children.find((o) => o.name.startsWith("body-"));
  if (!m) throw new Error("no body on the rig");
  return m as THREE.SkinnedMesh;
}

/** World positions of every vertex, skinned as the renderer would. */
function skinned(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const pos = mesh.geometry.getAttribute("position");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    out.push(v.applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

/** Vertices weighted (almost) entirely to one joint. */
function rigidTo(mesh: THREE.SkinnedMesh, body: BodyTemplate, joint: string): number[] {
  const k = body.joints.indexOf(joint as never);
  const idx = mesh.geometry.getAttribute("skinIndex");
  const wgt = mesh.geometry.getAttribute("skinWeight");
  const out: number[] = [];
  for (let i = 0; i < idx.count; i++) {
    let w = 0;
    for (let c = 0; c < 4; c++) if (idx.getComponent(i, c) === k) w += wgt.getComponent(i, c);
    if (w > 0.98) out.push(i);
  }
  return out;
}

describe.each(manifest.builds)("body $name", ({ name, file }) => {
  let body: BodyTemplate;
  beforeAll(async () => {
    body = await load(file, name);
  });

  it("carries every hair and facial-hair style the manifest lists", () => {
    for (const h of manifest.hairStyles) if (h !== "bald") expect(body.hair.has(h), h).toBe(true);
    for (const b of manifest.beardStyles) if (b !== "none") expect(body.beard.has(b), b).toBe(true);
  });

  it("moves hair and beard rigidly with the head", () => {
    const rig = makePlayer({ role: "fielder", body, appearance: LOOK });
    const pieces = rig.root.children.filter((o) => /^(hair|beard)-/.test(o.name)) as THREE.SkinnedMesh[];
    expect(pieces.map((p) => p.name).sort()).toEqual(["beard-full", "hair-short"]);
    rig.head.rotation.set(0.4, 0.6, 0);
    rig.root.updateMatrixWorld(true);
    const head = rig.head.matrixWorld.clone();
    for (const piece of pieces) {
      const got = skinned(piece);
      // Every vertex keeps its place in the head's frame however the head turns.
      rig.head.rotation.set(0, 0, 0);
      rig.root.updateMatrixWorld(true);
      const rest = skinned(piece);
      const moved = rest.map((p) => p.clone().applyMatrix4(rig.head.matrixWorld.clone().invert()).applyMatrix4(head));
      const worst = Math.max(...got.map((p, i) => p.distanceTo(moved[i])));
      expect(worst).toBeLessThan(1e-4);
      rig.head.rotation.set(0.4, 0.6, 0);
      rig.root.updateMatrixWorld(true);
    }
  });

  it("binds to every skinned joint of the rig, by name", () => {
    // Every joint but the hands, which mark the fist and are never rotated.
    expect(body.joints.length).toBe(JOINTS.length - 2);
    for (const j of body.joints) expect(JOINTS).toContain(j);
    expect(body.joints).not.toContain("handL");
    expect(body.slots).toEqual(expect.arrayContaining(["skin", "shirt", "trousers", "sleeve", "hand", "boot", "lips", "brow", "eye", "iris"]));
  });

  it("is undeformed in its bind pose, so the binding is exact", () => {
    const rig = makePlayer({ role: "fielder", body, appearance: LOOK });
    const mesh = bodyOf(rig);
    for (const j of JOINTS) rig[j].quaternion.copy(body.bind.get(j) ?? new THREE.Quaternion());
    rig.root.updateMatrixWorld(true);
    const got = skinned(mesh);
    const pos = mesh.geometry.getAttribute("position");
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const want = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      worst = Math.max(worst, want.distanceTo(got[i]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("puts the fist on the hand joint, where the bat and the ball are held", () => {
    const rig = makePlayer({ role: "fielder", body, appearance: LOOK });
    const mesh = bodyOf(rig);
    const got = skinned(mesh);
    for (const side of ["L", "R"] as const) {
      const elbow = rig[`elbow${side}`].getWorldPosition(new THREE.Vector3());
      const hand = rig[`hand${side}`].getWorldPosition(new THREE.Vector3());
      // The fist: forearm-weighted vertices beyond the wrist.
      const reach = elbow.distanceTo(hand);
      const fist = rigidTo(mesh, body, `elbow${side}`)
        .map((i) => got[i])
        .filter((p) => p.distanceTo(elbow) > reach * 0.85);
      expect(fist.length).toBeGreaterThan(20);
      const centre = fist.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(fist.length);
      expect(centre.distanceTo(hand)).toBeLessThan(0.06);
    }
  });

  it("stands on the ground in the rest pose", () => {
    const rig = makePlayer({ role: "fielder", body, appearance: LOOK });
    const mesh = bodyOf(rig);
    const got = skinned(mesh);
    for (const side of ["L", "R"] as const) {
      const foot = rigidTo(mesh, body, `ankle${side}`).map((i) => got[i].y);
      expect(Math.min(...foot)).toBeGreaterThan(-0.02);
      expect(Math.min(...foot)).toBeLessThan(0.03);
    }
  });
});
