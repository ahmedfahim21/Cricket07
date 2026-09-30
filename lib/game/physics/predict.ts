/**
 * Looking ahead: where the ball WILL be.
 *
 * Players cannot react to where the ball is; they move to where it is going.
 * The batsman has to put the bat where the ball will be when the bat arrives,
 * a fielder runs to cut the ball off rather than chasing its current position,
 * and a throw has to be aimed so that drag and gravity bring it down in the
 * keeper's gloves.
 *
 * This integrates the SAME forces as the Rapier world (drag, Magnus, swing,
 * gravity) and resolves ground contact with the same `bounce()`, at the same
 * rate, so its answers match what the world will then do. Pure: no Rapier.
 */

import { BALL_MASS, BALL_RADIUS, CREASE_Z, PITCH_WIDTH } from "../dimensions";
import { DEFAULT_AERO, aeroForce, type AeroParams } from "./aero";
import { bounce, type PitchConditions } from "./pitch";
import { Vec3, length, v3 } from "./vec3";

export const PREDICT_DT = 1 / 240;

export interface BallSnapshot {
  position: Vec3;
  velocity: Vec3;
  spin: Vec3;
  seamAngle: number;
  shine: number;
}

export interface PredictOptions {
  pitch: PitchConditions;
  outfield: PitchConditions;
  aero?: AeroParams;
  /** Stop after this many seconds. */
  maxTime?: number;
}

export interface PathPoint {
  t: number;
  position: Vec3;
  velocity: Vec3;
}

/**
 * Step the ball forward, calling `visit` after each step; stop when it
 * returns true, when the ball has come to rest, or at `maxTime`.
 * Returns every step taken.
 */
export function predictPath(
  start: BallSnapshot,
  opts: PredictOptions,
  visit?: (p: PathPoint) => boolean
): PathPoint[] {
  const aero = opts.aero ?? DEFAULT_AERO;
  const maxTime = opts.maxTime ?? 8;
  let p = { ...start.position };
  let v = { ...start.velocity };
  let spin = { ...start.spin };
  const out: PathPoint[] = [];
  const dt = PREDICT_DT;

  for (let t = dt; t <= maxTime + 1e-9; t += dt) {
    const f = aeroForce({ velocity: v, spin, seamAngle: start.seamAngle, shine: start.shine }, aero);
    // Semi-implicit Euler, the same order the solver integrates in.
    v = {
      x: v.x + (f.x / BALL_MASS) * dt,
      y: v.y + (f.y / BALL_MASS - 9.81) * dt,
      z: v.z + (f.z / BALL_MASS) * dt,
    };
    p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };

    if (p.y <= BALL_RADIUS && v.y < 0) {
      const onPitch = Math.abs(p.x) < PITCH_WIDTH / 2 && Math.abs(p.z) < CREASE_Z + 1.6;
      const r = bounce({ velocity: v, spin, conditions: onPitch ? opts.pitch : opts.outfield });
      v = r.velocity;
      spin = r.spin;
      p = { x: p.x, y: BALL_RADIUS, z: p.z };
    }

    const point = { t, position: p, velocity: v };
    out.push(point);
    if (visit?.(point)) break;
    if (p.y <= BALL_RADIUS * 1.5 && Math.hypot(v.x, v.z) < 0.4 && Math.abs(v.y) < 0.5) break;
  }
  return out;
}

/** Linear interpolation of a path at time t (clamped to its ends). */
export function pathAt(path: PathPoint[], t: number): Vec3 {
  if (path.length === 0) return v3();
  if (t <= path[0].t) return { ...path[0].position };
  const last = path[path.length - 1];
  if (t >= last.t) return { ...last.position };
  const i = Math.min(path.length - 2, Math.max(0, Math.floor(t / PREDICT_DT) - 1));
  let k = i;
  while (k < path.length - 2 && path[k + 1].t < t) k++;
  const a = path[k];
  const b = path[k + 1];
  const u = (t - a.t) / (b.t - a.t);
  return {
    x: a.position.x + (b.position.x - a.position.x) * u,
    y: a.position.y + (b.position.y - a.position.y) * u,
    z: a.position.z + (b.position.z - a.position.z) * u,
  };
}

/**
 * The velocity to throw a ball from `from` so it arrives at `to` in about
 * `flightTime` seconds, with drag. Starts from the vacuum answer and corrects
 * against the predictor a few times — drag takes a metre or more off a long
 * throw, which is the difference between a direct hit and one on the bounce.
 */
export function solveThrow(from: Vec3, to: Vec3, flightTime: number, opts: PredictOptions): Vec3 {
  const T = Math.max(0.2, flightTime);
  let v = {
    x: (to.x - from.x) / T,
    y: (to.y - from.y + 0.5 * 9.81 * T * T) / T,
    z: (to.z - from.z) / T,
  };
  for (let iter = 0; iter < 6; iter++) {
    const path = predictPath(
      { position: from, velocity: v, spin: v3(), seamAngle: 0, shine: 0 },
      { ...opts, maxTime: T + 0.05 }
    );
    const at = pathAt(path, T);
    const ex = to.x - at.x;
    const ey = to.y - at.y;
    const ez = to.z - at.z;
    if (Math.hypot(ex, ey, ez) < 0.03) break;
    v = { x: v.x + ex / T, y: v.y + ey / T, z: v.z + ez / T };
  }
  return v;
}

/** Straight-line speed of a velocity. */
export function speedOf(v: Vec3): number {
  return length(v);
}
