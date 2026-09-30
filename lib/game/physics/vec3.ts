/**
 * A tiny plain-object vector type.
 *
 * Deliberately not THREE.Vector3 and not a Rapier vector: the aerodynamics and
 * bounce modules must stay importable by the test suite without pulling in a
 * renderer or a WASM blob. The engine converts at the boundary.
 */

export type Vec3 = { x: number; y: number; z: number };

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < 1e-9 ? v3() : scale(a, 1 / l);
}

export const UP: Vec3 = { x: 0, y: 1, z: 0 };
