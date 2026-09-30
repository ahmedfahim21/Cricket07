/**
 * The bowl around the ground: terraced stands, floodlights and sightscreens.
 *
 * The stand ring is the single biggest object in the scene, so it is built as
 * merged geometry rather than as thousands of small objects.
 *
 * Spectators use instanced silhouettes so boundary chases have a populated
 * backdrop without the geometry cost of full player models in every seat.
 */

import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BOUNDARY_SQUARE, BOUNDARY_STRAIGHT, CREASE_Z } from "../dimensions";
import type { MaterialLibrary } from "../materials";
import { buildCrowd } from "./crowd";

/** Gap between the rope and the front of the stands. */
const RUN_OFF = 9;

/** Terrace geometry. */
const TIERS = 22;
const TIER_RISE = 0.62;
const TIER_DEPTH = 0.95;

/** Number of segments around the bowl. More = rounder, and more triangles. */
const SEGMENTS = 96;

function mergeToMesh(geos: THREE.BufferGeometry[], mat: THREE.Material, name: string): THREE.Mesh {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = BufferGeometryUtils.mergeGeometries(flat, false);
  if (!merged) throw new Error(`mergeGeometries returned null for ${name}`);
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

/** Radius of the stand ring at angle t, following the boundary ellipse. */
function ringRadius(t: number, extra: number): { x: number; z: number } {
  return {
    x: (BOUNDARY_SQUARE + extra) * Math.cos(t),
    z: (BOUNDARY_STRAIGHT + extra) * Math.sin(t),
  };
}

/**
 * One terrace step as a quad strip between two angles and two radii.
 * Built directly as triangles rather than as boxes, because a box per seat row
 * per segment is 20x the geometry for the same silhouette.
 */
function terraceStep(
  t0: number,
  t1: number,
  inner: number,
  outer: number,
  yBottom: number,
  yTop: number,
  out: number[],
  uvOut: number[]
) {
  const a = ringRadius(t0, inner);
  const b = ringRadius(t1, inner);
  const c = ringRadius(t1, outer);
  const d = ringRadius(t0, outer);

  // Riser (vertical face toward the pitch).
  pushQuad(out, uvOut, [a.x, yBottom, a.z], [b.x, yBottom, b.z], [b.x, yTop, b.z], [a.x, yTop, a.z]);
  // Tread (horizontal surface).
  pushQuad(out, uvOut, [a.x, yTop, a.z], [b.x, yTop, b.z], [c.x, yTop, c.z], [d.x, yTop, d.z]);
}

function pushQuad(
  out: number[],
  uvOut: number[],
  p0: number[],
  p1: number[],
  p2: number[],
  p3: number[]
) {
  for (const p of [p0, p1, p2, p0, p2, p3]) out.push(p[0], p[1], p[2]);
  // Planar UVs from world XZ; the concrete texture tiles small enough that
  // seams between segments are invisible.
  for (const p of [p0, p1, p2, p0, p2, p3]) uvOut.push(p[0] * 0.25, p[2] * 0.25);
}

function geoFrom(pos: number[], uv: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ *
 * Floodlights
 * ------------------------------------------------------------------ */

function buildFloodlight(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const steel = mats.get("steel");
  const parts: THREE.BufferGeometry[] = [];

  const H = 46;
  // Tapered lattice mast: four legs that lean inward toward the top. The lean
  // comes from a shear rather than a rotation so the legs stay full height and
  // their feet stay on the intended footprint.
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const leg = new THREE.CylinderGeometry(0.16, 0.3, H, 6);
    leg.translate(sx * 1.8, H / 2, sz * 1.8);
    // Shear X and Z back toward the axis in proportion to height.
    leg.applyMatrix4(
      new THREE.Matrix4().set(
        1, -sx * 0.026, 0, 0,
        0, 1, 0, 0,
        0, -sz * 0.026, 1, 0,
        0, 0, 0, 1
      )
    );
    parts.push(leg.toNonIndexed());
  }
  // Cross bracing, as a few rings.
  for (let i = 1; i < 7; i++) {
    const ring = new THREE.TorusGeometry(2.1, 0.09, 4, 10);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, (i / 7) * H, 0);
    parts.push(ring.toNonIndexed());
  }
  const mast = BufferGeometryUtils.mergeGeometries(parts, false);
  if (!mast) throw new Error("floodlight mast merge failed");
  const mastMesh = new THREE.Mesh(mast, steel);
  mastMesh.castShadow = true;
  g.add(mastMesh);

  // Lamp bank: a grid of emissive quads on a backing panel.
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(9, 5.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 })
  );
  panel.position.set(0, H + 2.6, 0.4);
  panel.castShadow = true;
  g.add(panel);

  const lampGeo = new THREE.BoxGeometry(0.8, 0.8, 0.16);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfffbe8,
    emissive: 0xfff4d0,
    emissiveIntensity: 3.2,
    roughness: 0.3,
  });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 8 * 5);
  const d = new THREE.Object3D();
  let i = 0;
  for (let cx = 0; cx < 8; cx++) {
    for (let cy = 0; cy < 5; cy++) {
      d.position.set(-3.5 + cx, H + 0.7 + cy, 0.72);
      d.updateMatrix();
      lamps.setMatrixAt(i++, d.matrix);
    }
  }
  lamps.instanceMatrix.needsUpdate = true;
  g.add(lamps);

  g.name = "floodlight";
  return g;
}

/* ------------------------------------------------------------------ *
 * Sightscreen
 * ------------------------------------------------------------------ */

/**
 * The sightscreen behind each bowler's arm. Functionally important, not just
 * decorative: it is the flat pale field the ball is seen against, so it has to
 * sit directly behind the bowler in line with the pitch.
 */
function buildSightscreen(): THREE.Group {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(11, 6.5, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 0.95 })
  );
  panel.position.y = 3.9;
  panel.castShadow = true;
  panel.receiveShadow = true;
  g.add(panel);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x5c6168,
    roughness: 0.6,
    metalness: 0.5,
  });
  for (const x of [-4.8, 4.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.6, 0.28), frameMat);
    leg.position.set(x, 3.8, 0.3);
    leg.castShadow = true;
    g.add(leg);
  }
  g.name = "sightscreen";
  return g;
}

/* ------------------------------------------------------------------ *
 * Public builder
 * ------------------------------------------------------------------ */

export type Stadium = {
  group: THREE.Group;
  crowd: ReturnType<typeof buildCrowd>;
};

export function buildStadium(lib: MaterialLibrary, seed = 7): Stadium {
  const group = new THREE.Group();
  group.name = "stadium";

  // Terracing: one merged mesh for the whole bowl.
  const pos: number[] = [];
  const uv: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const t0 = (s / SEGMENTS) * Math.PI * 2;
    const t1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
    for (let tier = 0; tier < TIERS; tier++) {
      const inner = RUN_OFF + tier * TIER_DEPTH;
      terraceStep(
        t0,
        t1,
        inner,
        inner + TIER_DEPTH,
        tier * TIER_RISE,
        (tier + 1) * TIER_RISE,
        pos,
        uv
      );
    }
  }
  const terrace = new THREE.Mesh(geoFrom(pos, uv), lib.tint("concrete", 0x8f9298, 1));
  terrace.receiveShadow = true;
  terrace.castShadow = true;
  terrace.name = "terracing";
  group.add(terrace);

  // Back wall, closing the bowl off against the skybox.
  const wallPos: number[] = [];
  const wallUv: number[] = [];
  const backExtra = RUN_OFF + TIERS * TIER_DEPTH;
  const topY = TIERS * TIER_RISE;
  for (let s = 0; s < SEGMENTS; s++) {
    const t0 = (s / SEGMENTS) * Math.PI * 2;
    const t1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
    const a = ringRadius(t0, backExtra);
    const b = ringRadius(t1, backExtra);
    pushQuad(
      wallPos,
      wallUv,
      [b.x, topY, b.z],
      [a.x, topY, a.z],
      [a.x, topY + 9, a.z],
      [b.x, topY + 9, b.z]
    );
  }
  const wall = new THREE.Mesh(geoFrom(wallPos, wallUv), lib.tint("concrete", 0x6d7076, 1));
  wall.receiveShadow = true;
  wall.name = "back-wall";
  group.add(wall);

  // Four floodlights at the corners of the ground, standing ON the back of
  // the stand ring. Placing them at box corners rather than on the ellipse
  // leaves them floating in space well outside the stadium.
  for (const k of [1, 3, 5, 7]) {
    const t = (k * Math.PI) / 4;
    const p = ringRadius(t, backExtra - TIER_DEPTH);
    const light = buildFloodlight(lib);
    light.position.set(p.x, topY, p.z);
    // Aim the lamp bank at the middle. rotation.y = θ sends local +Z to
    // (sin θ, cos θ), and the bank faces local +Z, so θ points straight at
    // the origin with no half-turn added.
    light.rotation.y = Math.atan2(-p.x, -p.z);
    group.add(light);
  }

  // A sightscreen straight behind each end, just beyond the rope.
  for (const s of [-1, 1]) {
    const screen = buildSightscreen();
    screen.position.set(0, 0, s * (BOUNDARY_STRAIGHT + 3.5));
    // Face the pitch.
    screen.rotation.y = s > 0 ? Math.PI : 0;
    group.add(screen);
  }
  void CREASE_Z;

  const crowd = buildCrowd(seed, TIERS, TIER_RISE, TIER_DEPTH, RUN_OFF);
  group.add(crowd.group);
  return { group, crowd };
}
