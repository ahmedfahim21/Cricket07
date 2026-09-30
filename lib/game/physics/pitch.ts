/**
 * What happens when the ball hits the pitch.
 *
 * This is handled analytically rather than by Rapier's restitution/friction,
 * for two reasons. First, a rigid-body solver bouncing a sphere off a plane
 * gives you a bounce; it does not give you spin gripping and turning, or seam
 * deviation, and those are the whole point. Second, the bounce is the single
 * most feel-critical moment in the game and it needs to be a pure function
 * that can be tuned and tested, not an emergent property of solver settings.
 *
 * Pure: no Rapier, no three.js. `world.ts` detects the contact and calls this.
 *
 * Coordinates per dimensions.ts — +X leg side (right-hander), -Z toward the
 * striker, +Y up.
 */

import { Vec3, cross, v3 } from "./vec3";

/** Ball radius, m. Local copy to keep this module dependency-free. */
const R = 0.036;

export interface PitchConditions {
  /**
   * 0 = a dead, slow, low pitch; 1 = hard and quick. Drives how much vertical
   * speed survives the bounce.
   */
  hardness: number;
  /**
   * 0 = skiddy, no grip; 1 = abrasive and gripping. Drives how much of the
   * ball's sidespin converts into lateral deviation, i.e. how much a spinner
   * turns it.
   */
  friction: number;
  /**
   * Deviation the seam produces when the ball lands on it, in radians of
   * direction change, signed. Seamers get this; it is roughly random ball to
   * ball, so the caller supplies it from a seeded source rather than this
   * module rolling dice.
   */
  seamDeviation: number;
}

export const DEFAULT_PITCH: PitchConditions = {
  hardness: 0.6,
  friction: 0.5,
  seamDeviation: 0,
};

/**
 * How strongly top/backspin changes the height of the bounce.
 *
 * This is a separate mechanism from the friction impulse below. At 33 m/s the
 * ball is always sliding on contact, so Coulomb friction saturates at mu*N and
 * its impulse depends only on the DIRECTION of slip — which means friction
 * alone makes a topspinner and a backspinner come off the pitch identically.
 * That is not what happens: backspin skids on low, topspin sits up. The
 * difference comes from how the spinning surface loads the pitch through the
 * contact, so it is modelled here as a direct modulation of restitution.
 */
const SPIN_BOUNCE_GAIN = 0.3;

/** How much pace topspin costs relative to backspin. */
const SPIN_PACE_GAIN = 0.12;

export interface BounceInput {
  velocity: Vec3;
  /** rad/s. */
  spin: Vec3;
  conditions: PitchConditions;
}

export interface BounceResult {
  velocity: Vec3;
  spin: Vec3;
  /** Lateral velocity change from grip + seam, m/s. Positive is toward +X. */
  deviation: number;
}

/** Restitution as a function of hardness. A cricket ball is not a superball. */
function restitution(hardness: number): number {
  return 0.22 + 0.26 * clamp01(hardness);
}

/** Sliding friction coefficient between ball and pitch. */
function frictionCoefficient(f: number): number {
  return 0.28 + 0.34 * clamp01(f);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampTo1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Resolve one bounce.
 *
 * The lateral deviation is the physically interesting part. At the contact
 * point the ball's surface velocity is `v + omega x r` with `r = (0, -R, 0)`,
 * which works out to an extra `(omega_z * R, 0, -omega_x * R)`. So:
 *
 *   - spin about X (the lateral axis) is back/topspin and changes how much
 *     the ball skids ON down the pitch
 *   - spin about Z (the direction of travel) is what slips SIDEWAYS at the
 *     contact point, and friction opposing that slip is what turns the ball
 *
 * That is why an off-spinner tilts the seam and spins about an axis with a
 * component down the pitch, and why a ball spinning purely about the vertical
 * axis does nothing off the surface — the contact point is its pivot.
 */
export function bounce(input: BounceInput): BounceResult {
  const { velocity: v, spin, conditions } = input;

  // Only resolve a downward impact.
  if (v.y >= 0) {
    return { velocity: { ...v }, spin: { ...spin }, deviation: 0 };
  }

  const e = restitution(conditions.hardness);
  const mu = frictionCoefficient(conditions.friction);

  // Normal impulse per unit mass.
  const jn = -(1 + e) * v.y;

  // Surface velocity of the contact point: v + omega x r, r = (0,-R,0).
  const r = v3(0, -R, 0);
  const spinAtContact = cross(spin, r);
  const slipX = v.x + spinAtContact.x; // omega_z * R
  const slipZ = v.z + spinAtContact.z; // -omega_x * R

  const slipMag = Math.hypot(slipX, slipZ);

  let outX = v.x;
  let outZ = v.z;
  let deviation = 0;

  if (slipMag > 1e-6) {
    // Coulomb friction impulse opposing the slip, capped by mu * jn.
    const jtMax = mu * jn;
    // Cap so friction can arrest the slip but never reverse it — otherwise a
    // heavily spun ball squirts backwards off the pitch.
    const jt = Math.min(jtMax, slipMag);
    const dx = (-slipX / slipMag) * jt;
    const dz = (-slipZ / slipMag) * jt;
    outX += dx;
    outZ += dz;
    deviation += dx;

    // Friction that changed the linear velocity also bleeds the spin that
    // produced the slip; without this the ball keeps turning every bounce.
    const bleed = jt / slipMag;
    spinAtContact.x *= 1 - bleed;
    spinAtContact.z *= 1 - bleed;
  }

  // Seam deviation: an extra lateral kick, independent of spin, from landing
  // on the seam. Expressed as a fraction of the ball's forward speed so it
  // scales with pace the way a real seam movement does.
  const seamKick = conditions.seamDeviation * Math.abs(v.z);
  outX += seamKick;
  deviation += seamKick;

  const outSpin = {
    // Retain most of the spin — a bounce scrubs some off but not all.
    x: spin.x * 0.75,
    y: spin.y * 0.9,
    z: spin.z * 0.75,
  };

  // Top/backspin about the lateral axis changes the height and pace off the
  // pitch. For a delivery travelling -Z, backspin is +X (see the surface
  // velocity derivation above), so normalise against the travel direction to
  // get a signed "how much topspin" ratio that works at either end.
  const travelSign = Math.sign(v.z) || -1;
  const topspinRatio = clampTo1(
    (spin.x * travelSign * R) / Math.max(1, Math.abs(v.z))
  );

  const bounceScale = 1 + SPIN_BOUNCE_GAIN * topspinRatio;
  const paceScale = 1 - SPIN_PACE_GAIN * topspinRatio;

  return {
    velocity: { x: outX, y: -e * v.y * bounceScale, z: outZ * paceScale },
    spin: outSpin,
    deviation,
  };
}

/* ------------------------------------------------------------------ *
 * Length classification — used by the HUD, the shot logic and the AI.
 * ------------------------------------------------------------------ */

export type Length = "full-toss" | "yorker" | "full" | "good" | "short-of-good" | "short";

/**
 * Classify a delivery by where it pitches, measured as distance in FRONT of
 * the striker's stumps (so bigger = further from the batsman).
 *
 * These bands are the ones commentary uses and the ones the shot logic keys
 * off: a good length is the one that leaves the batsman unsure whether to
 * come forward or go back.
 */
export function classifyLength(distanceFromStumps: number): Length {
  if (distanceFromStumps < 0) return "full-toss";
  if (distanceFromStumps < 1.0) return "yorker";
  if (distanceFromStumps < 3.0) return "full";
  if (distanceFromStumps < 6.0) return "good";
  if (distanceFromStumps < 9.0) return "short-of-good";
  return "short";
}

/**
 * Approximate height the ball reaches at the stumps, given how far in front
 * of them it pitched and how much vertical speed it retained. Used to drive
 * the bounce cue on the HUD before the ball actually gets there.
 */
export function bounceHeightAtStumps(
  distanceFromStumps: number,
  upwardSpeed: number,
  forwardSpeed: number
): number {
  if (forwardSpeed <= 0) return 0;
  const t = distanceFromStumps / forwardSpeed;
  return Math.max(0, upwardSpeed * t - 0.5 * 9.81 * t * t);
}
