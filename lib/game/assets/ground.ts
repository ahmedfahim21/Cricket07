/**
 * The playing surface: outfield, square, pitch, creases and boundary rope.
 *
 * Everything is built flat on y=0 and sized from `dimensions.ts`. The whole
 * ground is a handful of draw calls: the outfield is one merged mesh per mow
 * direction, the creases are all one merged mesh, and the rope is a single
 * tube. Nothing here is instanced per-blade or per-line.
 */

import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BOUNDARY_SQUARE,
  BOUNDARY_STRAIGHT,
  BOWLING_CREASE_HALF_WIDTH,
  CREASE_LINE_WIDTH,
  CREASE_Z,
  INNER_CIRCLE_RADIUS,
  MOW_STRIPE_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  POPPING_CREASE_OFFSET,
  RETURN_CREASE_OFFSET,
  ROPE_RADIUS,
  SQUARE_HALF_LENGTH,
  SQUARE_HALF_WIDTH,
} from "../dimensions";
import type { MaterialLibrary } from "../materials";

/** Height offsets, in mm, to keep coplanar surfaces from z-fighting. */
const Y_OUTFIELD = 0;
const Y_SQUARE = 0.004;
const Y_PITCH = 0.008;
const Y_CREASE = 0.012;

/** Two greens for the mown stripes: the same turf material, tinted. */
const STRIPE_A = 0x74a04a;
const STRIPE_B = 0x5d8a3c;
const SQUARE_GREEN = 0x8a9a52;
const PITCH_BUFF = 0xc2ab7e;

/**
 * A horizontal quad at height y, centred at (cx, cz).
 * Built as a rotated plane so its UVs run with the surface.
 */
function quad(w: number, d: number, cx: number, cz: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}

/**
 * Merge a list of geometries into one mesh.
 *
 * `mergeGeometries` silently returns null when the inputs mix indexed and
 * non-indexed geometry, so everything is forced non-indexed first. This bug
 * costs an afternoon every time it is rediscovered.
 */
function mergeToMesh(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = flat.length > 1 ? BufferGeometryUtils.mergeGeometries(flat, false) : flat[0];
  if (!merged) throw new Error("mergeGeometries returned null — mismatched attributes");
  const mesh = new THREE.Mesh(merged, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** An ellipse ring as a flat band, used for the rope shadow and inner circle. */
function ellipseBand(
  a: number,
  b: number,
  width: number,
  y: number,
  segments = 128
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const half = width / 2;
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    for (const [ta, tb] of [[t0, t1]]) {
      const ax = Math.cos(ta);
      const az = Math.sin(ta);
      const bx = Math.cos(tb);
      const bz = Math.sin(tb);
      // Wound to face +Y, same reasoning as ellipseDisc.
      const p = [
        [(a + half) * bx, (b + half) * bz],
        [(a + half) * ax, (b + half) * az],
        [(a - half) * ax, (b - half) * az],
        [(a - half) * bx, (b - half) * bz],
        [(a + half) * bx, (b + half) * bz],
        [(a - half) * ax, (b - half) * az],
      ];
      for (const [x, z] of p) {
        pos.push(x, y, z);
        uv.push((x + a) / (2 * a), (z + b) / (2 * b));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A filled ellipse, as a triangle fan, for the outfield base.
 *
 * Winding matters: increasing t traces CLOCKWISE when the XZ plane is viewed
 * from above, so the fan is emitted t1-before-t0 to put the face normal on +Y.
 * Emitted the other way the disc is lit from underneath and renders black,
 * which looks exactly like a missing texture and is not obvious to diagnose.
 */
function ellipseDisc(a: number, b: number, y: number, segments = 160): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const tri = [
      [0, 0],
      [a * Math.cos(t1), b * Math.sin(t1)],
      [a * Math.cos(t0), b * Math.sin(t0)],
    ];
    for (const [x, z] of tri) {
      pos.push(x, y, z);
      uv.push(x / 8, z / 8);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Mown stripes.
 *
 * Real stripes are not a texture, they are the same grass bent in alternating
 * directions, so they are built as alternating bands of the SAME turf material
 * at two tints. Each band is clipped to the boundary ellipse by shortening it
 * to the chord at that x — otherwise the stripes overhang the rope.
 */
function mowStripes(mat: THREE.Material, y: number): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];
  const n = Math.ceil((BOUNDARY_SQUARE * 2) / MOW_STRIPE_WIDTH);
  for (let i = 0; i < n; i++) {
    const x0 = -BOUNDARY_SQUARE + i * MOW_STRIPE_WIDTH;
    const xc = x0 + MOW_STRIPE_WIDTH / 2;
    if (Math.abs(xc) >= BOUNDARY_SQUARE) continue;
    // Half-chord at the stripe's OUTERMOST edge, not its centre. Measured at
    // the centre, every stripe overhangs the ellipse by a few metres at its
    // far corner and the boundary reads as a staircase.
    const xEdge = Math.abs(xc) + MOW_STRIPE_WIDTH / 2;
    const halfLen =
      BOUNDARY_STRAIGHT * Math.sqrt(Math.max(0, 1 - Math.min(1, xEdge / BOUNDARY_SQUARE) ** 2));
    if (halfLen < 0.5) continue;
    geos.push(quad(MOW_STRIPE_WIDTH * 0.995, halfLen * 2, xc, 0, y));
  }
  return geos;
}

/* ------------------------------------------------------------------ *
 * Creases
 * ------------------------------------------------------------------ */

/**
 * Creases at one end. `dir` is +1 for the bowler's end and -1 for the
 * striker's end; the popping crease is always in FRONT of the stumps, meaning
 * toward the middle of the pitch.
 */
function creasesAtEnd(stumpZ: number, dir: number): THREE.BufferGeometry[] {
  const w = CREASE_LINE_WIDTH;
  const geos: THREE.BufferGeometry[] = [];

  // Bowling crease: through the stumps, across the pitch.
  geos.push(quad(BOWLING_CREASE_HALF_WIDTH * 2, w, 0, stumpZ, Y_CREASE));

  // Popping crease: 4ft in front, and drawn long as it is in practice.
  const popZ = stumpZ + dir * POPPING_CREASE_OFFSET;
  geos.push(quad(BOWLING_CREASE_HALF_WIDTH * 2.1, w, 0, popZ, Y_CREASE));

  // Return creases: run back from the popping crease, parallel to the pitch.
  const retLen = 2.44;
  for (const s of [-1, 1]) {
    geos.push(
      quad(w, retLen, s * RETURN_CREASE_OFFSET, popZ - dir * (retLen / 2 - 0.02), Y_CREASE)
    );
  }
  return geos;
}

/* ------------------------------------------------------------------ *
 * Public builder
 * ------------------------------------------------------------------ */

export type Ground = {
  group: THREE.Group;
  /** Y of the playing surface, for anything that needs to sit on it. */
  surfaceY: number;
};

export function buildGround(lib: MaterialLibrary): Ground {
  const group = new THREE.Group();
  group.name = "ground";

  // Base disc, so there is never a gap showing through between stripes.
  const base = new THREE.Mesh(
    ellipseDisc(BOUNDARY_SQUARE + 6, BOUNDARY_STRAIGHT + 6, Y_OUTFIELD - 0.002),
    lib.tint("turf", STRIPE_B, 6)
  );
  base.receiveShadow = true;
  group.add(base);

  // Mown stripes: alternate tints of the same turf material.
  const stripes = mowStripes(lib.get("turf"), Y_OUTFIELD);
  const evens: THREE.BufferGeometry[] = [];
  const odds: THREE.BufferGeometry[] = [];
  stripes.forEach((g, i) => (i % 2 === 0 ? evens : odds).push(g));
  group.add(mergeToMesh(evens, lib.tint("turf", STRIPE_A, 4)));
  group.add(mergeToMesh(odds, lib.tint("turf", STRIPE_B, 4)));

  // The square: closer-mown, browner grass around the pitch.
  const square = new THREE.Mesh(
    quad(SQUARE_HALF_WIDTH * 2, SQUARE_HALF_LENGTH * 2, 0, 0, Y_SQUARE),
    lib.tint("turf", SQUARE_GREEN, 2.4)
  );
  square.receiveShadow = true;
  group.add(square);

  // The pitch itself. Runs a little past the stumps at each end, as a
  // prepared strip does.
  const pitch = new THREE.Mesh(
    quad(PITCH_WIDTH, PITCH_LENGTH + 3.2, 0, 0, Y_PITCH),
    // Tiled tightly: at 1:1 the craze-crack cells come out 30cm across and the
    // strip reads as dried riverbed rather than as a rolled pitch.
    lib.tint("pitch_soil", PITCH_BUFF, 3)
  );
  pitch.receiveShadow = true;
  pitch.name = "pitch";
  group.add(pitch);

  // Creases at both ends, all one merged mesh.
  const creaseMat = new THREE.MeshStandardMaterial({
    color: 0xf4f2ea,
    roughness: 0.85,
    metalness: 0,
  });
  creaseMat.name = "crease-paint";
  group.add(
    mergeToMesh(
      [...creasesAtEnd(-CREASE_Z, +1), ...creasesAtEnd(CREASE_Z, -1)],
      creaseMat
    )
  );

  // 30-yard circle, painted as a dashed ring in practice; a solid thin band
  // reads correctly at broadcast distance and costs one mesh.
  const circleMat = new THREE.MeshStandardMaterial({
    color: 0xe8efe0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.5,
  });
  const circle = new THREE.Mesh(
    ellipseBand(INNER_CIRCLE_RADIUS, INNER_CIRCLE_RADIUS, 0.1, Y_CREASE),
    circleMat
  );
  group.add(circle);

  // Boundary rope: a real tube, because it casts the shadow that makes the
  // edge of the field read as an edge rather than as a painted line.
  const ropeCurve = new THREE.CurvePath<THREE.Vector3>();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        BOUNDARY_SQUARE * Math.cos(t),
        ROPE_RADIUS,
        BOUNDARY_STRAIGHT * Math.sin(t)
      )
    );
  }
  ropeCurve.add(new THREE.CatmullRomCurve3(pts, true));
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(ropeCurve, 200, ROPE_RADIUS, 6, true),
    new THREE.MeshStandardMaterial({ color: 0xe4e4e0, roughness: 0.8 })
  );
  rope.castShadow = true;
  rope.receiveShadow = true;
  rope.name = "boundary-rope";
  group.add(rope);

  return { group, surfaceY: Y_PITCH };
}
