/**
 * Ball aerodynamics: drag, Magnus drift, and swing.
 *
 * Rapier is a rigid-body solver — it has no notion of air. Everything a
 * cricket ball does between the bowler's hand and the pitch comes from this
 * file, applied as an external force each physics step. Splitting it out as
 * pure functions (no Rapier, no three.js) is what makes swing and drift
 * testable without standing up a world.
 *
 * The three effects are genuinely different mechanisms and are modelled
 * separately rather than lumped into one fudge factor:
 *
 *   drag    — always opposes motion, scales with v^2
 *   Magnus  — from BACKSPIN/SIDESPIN, acts along (omega x v); this is what
 *             makes a spinner's delivery drift and dip in flight
 *   swing   — NOT a Magnus effect. It comes from the seam tripping the
 *             boundary layer on one side of the ball, so it depends on the
 *             seam's angle, not on the spin rate, and it acts sideways
 *
 * Conventions follow dimensions.ts: +X is leg side for a right-hander, and a
 * delivery to the striker travels in -Z.
 */

import { BALL_AREA, BALL_MASS } from "../dimensions";
import { UP, Vec3, cross, length, normalize, scale, v3 } from "./vec3";

export interface AeroParams {
  /** kg/m^3. Sea level, ~20C. Thinner air at altitude means less swing. */
  airDensity: number;
  /** Sphere drag coefficient in the cricket-ball Reynolds range. */
  dragCoefficient: number;
  /** Lift per unit spin parameter (S = omega*r/v). */
  magnusGain: number;
  /** Ceiling on the Magnus lift coefficient, so huge spin cannot go silly. */
  maxLiftCoefficient: number;
  /** Side-force coefficient at a full 20-degree seam angle, new ball. */
  swingCoefficient: number;
  /**
   * Speed below which conventional swing starts to bite harder — the late
   * swing every commentator talks about. Above this the boundary layer stays
   * turbulent on both sides and the ball holds its line.
   */
  lateSwingSpeed: number;
  /** How much extra side force is available at and below lateSwingSpeed. */
  lateSwingGain: number;
}

export const DEFAULT_AERO: AeroParams = {
  airDensity: 1.225,
  dragCoefficient: 0.4,
  magnusGain: 1.0,
  maxLiftCoefficient: 0.32,
  swingCoefficient: 0.16,
  lateSwingSpeed: 30,
  lateSwingGain: 0.6,
};

/** Ball radius, needed for the spin parameter. Derived from the ball area. */
const BALL_RADIUS = Math.sqrt(BALL_AREA / Math.PI);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Quadratic drag: F = -1/2 * rho * Cd * A * |v| * v.
 *
 * Always antiparallel to velocity, which is the property the tests pin.
 */
export function dragForce(velocity: Vec3, p: AeroParams = DEFAULT_AERO): Vec3 {
  const speed = length(velocity);
  if (speed < 1e-6) return v3();
  const k = 0.5 * p.airDensity * p.dragCoefficient * BALL_AREA * speed;
  return scale(velocity, -k);
}

/**
 * Magnus force: F = 1/2 * rho * Cl * A * |v|^2 * unit(omega x v).
 *
 * Cl rises with the spin parameter S = omega*r/|v| and is clamped, because the
 * linear relationship only holds for modest S and a fast bowler's 30 rev/s
 * would otherwise produce a banana.
 *
 * `spin` is in rad/s. Backspin (omega along -X for a ball travelling -Z) gives
 * an upward force, which is why a well-bowled seamer holds its height.
 */
export function magnusForce(
  velocity: Vec3,
  spin: Vec3,
  p: AeroParams = DEFAULT_AERO
): Vec3 {
  const speed = length(velocity);
  const spinRate = length(spin);
  if (speed < 1e-6 || spinRate < 1e-6) return v3();

  const S = (spinRate * BALL_RADIUS) / speed;
  const cl = Math.min(p.maxLiftCoefficient, p.magnusGain * S);
  const magnitude = 0.5 * p.airDensity * cl * BALL_AREA * speed * speed;

  return scale(normalize(cross(spin, velocity)), magnitude);
}

/**
 * Conventional swing.
 *
 * `seamAngle` is the seam's tilt away from vertical, in radians, measured
 * about the direction of travel. Positive tilts the seam toward +X, which for
 * a delivery heading -Z produces a force toward +X — the leg side for a
 * right-hander, i.e. an inswinger.
 *
 * `shine` in [0,1] is how much polish is left on one side. A scuffed ball on
 * both sides does not swing conventionally at all, which is why this scales
 * the whole term rather than being folded into the coefficient.
 *
 * The force is perpendicular to velocity and horizontal — a swinging ball
 * moves sideways, it does not climb.
 */
export function swingForce(
  velocity: Vec3,
  seamAngle: number,
  shine: number,
  p: AeroParams = DEFAULT_AERO
): Vec3 {
  const speed = length(velocity);
  if (speed < 1e-6 || shine <= 0) return v3();

  // Horizontal vector perpendicular to travel. For v = -Z this is +X.
  const lateral = normalize(cross(velocity, UP));
  if (length(lateral) < 1e-6) return v3();

  // Seam effect peaks near 20 degrees and falls back to nothing by 40, where
  // the seam no longer presents a clean edge to the airflow. Clamped at 2x
  // the peak so the curve never comes back up the far side and reverses the
  // swing direction.
  const PEAK = Math.PI / 9; // 20 degrees
  const a = Math.min(Math.abs(seamAngle), 2 * PEAK);
  const angled = Math.sign(seamAngle) * Math.sin((a / PEAK) * (Math.PI / 2));

  // Late swing: the side-force coefficient climbs as the ball slows toward
  // the critical Reynolds number and the boundary layer on the seam side
  // starts separating differently. Ramped smoothly across a band rather than
  // switched at a threshold — a step change would jolt the ball sideways
  // mid-flight, which looks like a bug and cannot be tuned out.
  //
  // Note this does NOT mean the side force grows as the ball slows: force
  // still scales with v^2, which falls faster than this coefficient rises.
  // What produces visible late swing is that lateral displacement goes as
  // t^2, so most of the deflection happens in the second half of the flight
  // regardless. This term sharpens an effect that is already there.
  const band = p.lateSwingSpeed * 0.27;
  const ramp = clamp01((p.lateSwingSpeed + band - speed) / (2 * band));
  const cs = p.swingCoefficient * (1 + p.lateSwingGain * ramp) * shine;

  const magnitude = 0.5 * p.airDensity * cs * BALL_AREA * speed * speed * angled;
  return scale(lateral, magnitude);
}

export interface BallAeroState {
  velocity: Vec3;
  spin: Vec3;
  seamAngle: number;
  shine: number;
}

/**
 * Total aerodynamic force on the ball, excluding gravity (Rapier applies
 * that). Returned in newtons, ready to hand to `addForce`.
 */
export function aeroForce(state: BallAeroState, p: AeroParams = DEFAULT_AERO): Vec3 {
  const d = dragForce(state.velocity, p);
  const m = magnusForce(state.velocity, state.spin, p);
  const s = swingForce(state.velocity, state.seamAngle, state.shine, p);
  return { x: d.x + m.x + s.x, y: d.y + m.y + s.y, z: d.z + m.z + s.z };
}

/** Convenience: the same total expressed as an acceleration, for integration tests. */
export function aeroAcceleration(state: BallAeroState, p: AeroParams = DEFAULT_AERO): Vec3 {
  return scale(aeroForce(state, p), 1 / BALL_MASS);
}
