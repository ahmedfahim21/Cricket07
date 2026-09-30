/**
 * Delivery generation: turning "bowl a good-length outswinger on off stump"
 * into a release position, velocity and spin.
 *
 * The awkward part is the release ANGLE. Where a ball pitches depends on the
 * speed, the launch angle, drag, and how much the Magnus force from backspin
 * holds it up — a quick bowler's stock ball with heavy backspin flies visibly
 * flatter than the same ball without it. There is no clean closed form, so
 * this solves for the angle numerically against a predictor that uses the
 * exact same force model as the live world.
 *
 * The predictor is a plain semi-implicit Euler integrator at the physics rate,
 * which is what Rapier does for a body in free flight, so what it predicts and
 * what the world then does agree to within a couple of centimetres.
 */

import {
  BALL_MASS,
  BALL_RADIUS,
  CREASE_Z,
  RELEASE_HEIGHT,
  STRIKER_STUMPS_Z,
} from "../dimensions";
import { DEFAULT_AERO, aeroForce, type AeroParams } from "../physics/aero";
import { CricketWorld, PHYSICS_DT } from "../physics/world";
import type { DeliveryRelease } from "../physics/world";
import type { PitchConditions } from "../physics/pitch";
import { Vec3, v3 } from "../physics/vec3";

export type BowlerStyle = "fast" | "fast-medium" | "medium" | "off-spin" | "leg-spin";

export interface DeliveryPlan {
  style: BowlerStyle;
  /** Metres in front of the striker's stumps to pitch. */
  targetLength: number;
  /**
   * Where to aim across the pitch, in metres from middle stump. Negative is
   * the off side for a right-hander, matching the world X convention.
   */
  targetLine: number;
  /** Ball speed at release, m/s. */
  speed: number;
  /** Seam tilt from vertical, radians. Positive swings toward +X. */
  seamAngle: number;
  /**
   * Spin about the direction of travel, rad/s.
   *
   * Positive turns the ball toward +X off the pitch — the leg side for a
   * right-hander — which is what an OFF-break does. Leg spin is therefore
   * negative: it turns leg-to-off, away from a right-hander.
   */
  sideSpin: number;
  /** Back(+)/top(-) spin about the lateral axis, rad/s. */
  backSpin: number;
  /** How far to the side of the stumps the bowler releases from. */
  releaseX: number;
  releaseHeight: number;
  /**
   * Where along the pitch the ball leaves the hand. Defaults to a typical
   * point just short of the bowler's popping crease; the game passes the
   * bowler's actual hand position so the ball comes out of the hand.
   */
  releaseZ?: number;
}

/** Typical numbers per style, before any per-delivery variation. */
export const STYLE_DEFAULTS: Record<
  BowlerStyle,
  Pick<DeliveryPlan, "speed" | "backSpin" | "sideSpin" | "releaseHeight">
> = {
  fast: { speed: 40, backSpin: 150, sideSpin: 0, releaseHeight: 2.25 },
  "fast-medium": { speed: 35, backSpin: 130, sideSpin: 0, releaseHeight: 2.2 },
  medium: { speed: 30, backSpin: 100, sideSpin: 0, releaseHeight: 2.1 },
  "off-spin": { speed: 23, backSpin: -40, sideSpin: 200, releaseHeight: 2.0 },
  "leg-spin": { speed: 21, backSpin: -30, sideSpin: -220, releaseHeight: 2.0 },
};

export function planFor(style: BowlerStyle, over: Partial<DeliveryPlan> = {}): DeliveryPlan {
  return {
    style,
    targetLength: 5,
    targetLine: -0.1,
    seamAngle: 0,
    releaseX: 0.25,
    ...STYLE_DEFAULTS[style],
    ...over,
  };
}

/**
 * Predict the marker with an isolated physics world. Rapier's gravity integration
 * can shift a fast ball's first impact by one 240 Hz step versus the analytic
 * predictor; use the live integrator here so the locked ring never needs to jump.
 */
export function previewBounce(release: DeliveryRelease, pitch: PitchConditions, outfield: PitchConditions): Vec3 | null {
  const preview = new CricketWorld();
  preview.pitch = { ...pitch };
  preview.outfield = { ...outfield };
  try {
    preview.release(release);
    for (let step = 0; step < 720; step++) {
      preview.step(PHYSICS_DT);
      if (preview.ball.position.z < STRIKER_STUMPS_Z) return null;
      if (preview.lastBounce) return { ...preview.lastBounce.position };
    }
    return null;
  } finally { preview.dispose(); }
}

/**
 * Predict where a release pitches, by integrating the same forces the live
 * world uses. Returns the Z of the first ground contact, or null if the ball
 * never gets down before passing the striker.
 */
export function predictPitchZ(
  release: DeliveryRelease,
  aero: AeroParams = DEFAULT_AERO
): number | null {
  let p: Vec3 = { ...release.position };
  let v: Vec3 = { ...release.velocity };
  const spin = release.spin;

  for (let i = 0; i < 2400; i++) {
    const f = aeroForce(
      { velocity: v, spin, seamAngle: release.seamAngle, shine: 1 },
      aero
    );
    // Semi-implicit Euler, matching the solver: velocity first, then position.
    v = {
      x: v.x + (f.x / BALL_MASS) * PHYSICS_DT,
      y: v.y + (f.y / BALL_MASS - 9.81) * PHYSICS_DT,
      z: v.z + (f.z / BALL_MASS) * PHYSICS_DT,
    };
    const prevY = p.y;
    p = {
      x: p.x + v.x * PHYSICS_DT,
      y: p.y + v.y * PHYSICS_DT,
      z: p.z + v.z * PHYSICS_DT,
    };
    if (p.y <= BALL_RADIUS && prevY > BALL_RADIUS) return p.z;
    if (p.z < STRIKER_STUMPS_Z - 2) return null;
  }
  return null;
}

/**
 * Build a release that actually pitches where the plan asked.
 *
 * Bisects on the launch elevation. The relationship between angle and pitch
 * length is monotonic over any sane range, so bisection converges in ~20
 * iterations and cannot oscillate the way a Newton step can when the ball
 * stops pitching altogether and the derivative vanishes.
 */
export function buildDelivery(
  plan: DeliveryPlan,
  aero: AeroParams = DEFAULT_AERO
): DeliveryRelease {
  const from = v3(plan.releaseX, plan.releaseHeight, plan.releaseZ ?? CREASE_Z - 1.4);
  const targetZ = STRIKER_STUMPS_Z + plan.targetLength;

  // Aim the horizontal heading at the target line on the pitch.
  const dz = targetZ - from.z;
  const dx = plan.targetLine - from.x;
  const headingRun = Math.hypot(dx, dz);
  const ux = dx / headingRun;
  const uz = dz / headingRun;

  // Spin about the direction of travel, plus back/topspin about the lateral
  // axis. Positive sideSpin should turn the ball toward -X, and bounce() turns
  // toward +X for spin about -Z, so the sign is flipped here.
  const spin = v3(plan.backSpin, 0, -plan.sideSpin);

  const make = (elevation: number): DeliveryRelease => ({
    position: { ...from },
    velocity: v3(
      ux * plan.speed * Math.cos(elevation),
      plan.speed * Math.sin(elevation),
      uz * plan.speed * Math.cos(elevation)
    ),
    spin,
    seamAngle: plan.seamAngle,
  });

  // Steeper (more negative) elevation pitches shorter i.e. further from the
  // batsman, so bracket from steeply down to slightly up.
  let lo = -0.5; // radians, steeply down
  let hi = 0.12; // slightly up
  let best = make(hi);

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = make(mid);
    const z = predictPitchZ(candidate, aero);
    best = candidate;
    if (z === null) {
      // Never pitched — too flat. Steepen.
      hi = mid;
      continue;
    }
    if (z < targetZ) {
      // Pitched too close to the batsman (too full); steepen to pitch earlier.
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/**
 * A whole over's worth of variation around a plan, deterministic for a seed.
 * Real bowlers miss their length; a machine that hits 5.00m six times running
 * is the thing that makes a cricket game feel dead.
 */
export function varyDelivery(plan: DeliveryPlan, rand: () => number): DeliveryPlan {
  return {
    ...plan,
    targetLength: plan.targetLength + (rand() - 0.5) * 1.6,
    targetLine: plan.targetLine + (rand() - 0.5) * 0.34,
    speed: plan.speed * (1 + (rand() - 0.5) * 0.07),
    seamAngle: plan.seamAngle + (rand() - 0.5) * 0.12,
  };
}

export { RELEASE_HEIGHT };
