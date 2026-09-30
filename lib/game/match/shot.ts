/**
 * Shot resolution: what the bat does to the ball.
 *
 * Pure — no three.js, no Rapier. Everything the batting feel depends on lives
 * here so it can be tuned and tested without standing up a scene, and so the
 * question "why did that go to short cover?" always has an answer you can read.
 *
 * The model is deliberately about DECISIONS rather than about a swing
 * animation. A shot is judged on four things, in roughly this order of impact:
 *
 *   1. TIMING     — when the key went down relative to the ideal contact
 *   2. FOOTWORK   — forward to a full ball, back to a short one
 *   3. SHOT TYPE  — defend / along the ground / over the top
 *   4. AIM        — where you were trying to hit it
 *
 * Get the timing right and a wrong-footed shot still goes somewhere. Get the
 * timing wrong and the best-chosen shot in the world edges to slip.
 */

import { Handedness, offSideSign } from "../dimensions";
import type { Length } from "../physics/pitch";
import type { Footwork, ShotType } from "../input/bindings";

export type TimingBand = "missed" | "edged" | "mistimed" | "good" | "perfect";

/** Absolute timing error, in seconds, at or below which each band applies. */
export const TIMING_BANDS: { band: TimingBand; within: number }[] = [
  { band: "perfect", within: 0.060 },
  { band: "good", within: 0.120 },
  { band: "mistimed", within: 0.180 },
  { band: "edged", within: 0.230 },
];

export interface DeliveryContext {
  length: Length;
  /** Ball's lateral line relative to the guard position; zero is the bat's normal line. */
  lineAtCrease: number;
  /** Ball's height at the moment it reaches the striker, metres. */
  heightAtCrease: number;
  /** Ball speed at the crease, m/s. */
  speed: number;
  hand: Handedness;
}

export interface ShotAttempt {
  type: ShotType;
  footwork: Footwork;
  /** -1 fully off side .. +1 fully leg side, before handedness is applied. */
  aim: number;
  square: boolean;
  /**
   * Seconds between the shot press and the ideal contact moment.
   * Negative = too early, positive = too late.
   */
  timingError: number;
}

export interface ShotOutcome {
  band: TimingBand;
  /** True if the bat missed entirely. */
  missed: boolean;
  /** Exit speed of the ball, m/s. Zero on a miss. */
  exitSpeed: number;
  /**
   * Direction the ball leaves in, radians, measured in the XZ plane.
   * 0 is straight down the ground (-Z); positive rotates toward +X.
   */
  exitDirection: number;
  /** Launch elevation above the horizontal, radians. */
  exitElevation: number;
  /** Distance from the middle of the blade to the contact point, metres. */
  contactOffset: number;
  /** 0..1 probability this carries as a catchable chance. */
  chanceOfCatch: number;
  /** True when the shot was played so poorly it could bowl the batsman. */
  playedOn: boolean;
}

/** Footwork that suits each length. Anything else is a compromise. */
const IDEAL_FOOTWORK: Record<Length, Footwork> = {
  "full-toss": "front",
  yorker: "front",
  full: "front",
  good: "front",
  "short-of-good": "back",
  short: "back",
};

/** Neutral input means assistance; an explicit arrow always wins. */
export function effectiveFootwork(footwork: Footwork, length: Length): Footwork {
  return footwork === "none" ? IDEAL_FOOTWORK[length] : footwork;
}

/** Arcade stroke authority: attacking shots can clear the rope even against spin. */
const TYPE_POWER: Record<ShotType, number> = {
  defensive: 0.22,
  ground: 1.20,
  lofted: 1.65,
};

/**
 * How much of the BALL's own pace each shot type returns.
 *
 * This is not the same as bat power and must not be folded into it. A block is
 * played with soft hands precisely to absorb pace so the ball drops dead at
 * the batsman's feet; if the ball's pace were returned at the same rate as for
 * a drive, a defensive shot off a fast bowler would race away for four, which
 * is the opposite of what defending means.
 */
const TYPE_BALL_RETENTION: Record<ShotType, number> = {
  defensive: 0.12,
  ground: 0.42,
  lofted: 0.45,
};

/**
 * Launch elevation each type wants, radians, before mistiming.
 *
 * The lofted figure is 33 degrees, not the 24 it started at. Measured carry
 * off a middled loft at 24 degrees was 74m with a 4.4m apex — a flat skimmer
 * that pulled up short of a 70m straight boundary. A real lofted drive leaves
 * the bat around 30-35 degrees and gets properly up in the air.
 */
const TYPE_ELEVATION: Record<ShotType, number> = {
  defensive: -0.05,
  ground: 0.05,
  lofted: 0.58,
};

/**
 * Peak bat speed at the point of contact, m/s.
 *
 * Stroke authority above adds the arcade power boost; defence still uses
 * soft hands. Keep this base speed for physical contact-offset calculations.
 */
const BAT_SPEED = 25;

export function classifyTiming(timingError: number): TimingBand {
  const e = Math.abs(timingError);
  for (const { band, within } of TIMING_BANDS) {
    if (e <= within) return band;
  }
  return "missed";
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * How well the chosen footwork suits the length, 0 (wrong) to 1 (right).
 *
 * Not binary: going back to a good-length ball is a compromise, not a
 * disaster, and playing off the wrong foot to a full toss barely matters.
 */
function footworkFit(footwork: Footwork, length: Length): number {
  if (footwork === "none") return 0.55; // stuck in the crease
  const ideal = IDEAL_FOOTWORK[length];
  if (footwork === ideal) return 1;
  // Good length is the one that genuinely leaves you in two minds, so the
  // penalty for choosing the other foot there is mild.
  if (length === "good" || length === "short-of-good") return 0.82;
  if (length === "full-toss") return 0.95;
  return 0.6;
}

/**
 * The base direction a shot goes, before aim, from where the ball is.
 *
 * A ball outside off is naturally hit to the off side, one on the pads to the
 * leg side. This is what stops the aim input from being a free "hit it
 * anywhere" dial: you are nudging a natural angle, not choosing one.
 */
function naturalDirection(ctx: DeliveryContext): number {
  // +/- 35 degrees at the extremes of a playable line.
  return clamp(ctx.lineAtCrease / 0.9, -1, 1) * 0.61;
}

/**
 * Resolve a shot.
 *
 * Every field of the result is derived here rather than being filled in by the
 * caller, so the tests can pin the whole outcome and a change to one term
 * cannot quietly alter another.
 */
export function resolveShot(ctx: DeliveryContext, attempt: ShotAttempt): ShotOutcome {
  const band = classifyTiming(attempt.timingError);
  const absError = Math.abs(attempt.timingError);

  if (band === "missed") {
    return {
      band,
      missed: true,
      exitSpeed: 0,
      exitDirection: 0,
      exitElevation: 0,
      contactOffset: 0,
      chanceOfCatch: 0,
      playedOn: false,
    };
  }

  const fit = footworkFit(attempt.footwork, ctx.length);

  // Contact offset from the middle of the blade. Late contact meets the ball
  // nearer the toe and the outside edge; early contact nearer the splice.
  const contactOffset = attempt.timingError * BAT_SPEED * 0.5;

  // Middling factor: 1 at perfect contact, falling away with both the timing
  // error and the footwork mismatch.
  // Good timing retains boundary power; outside that window contact falls off sharply.
  const timingQuality = absError <= 0.12 ? 1 - absError * 0.9 : 0.892 - (absError - 0.12) * 6;
  const middling = clamp(timingQuality, 0, 1) * (0.55 + 0.45 * fit);

  // Exit speed. The ball's own pace contributes — that is why a genuinely
  // quick bowler goes to the boundary faster off the same shot.
  const batContribution = BAT_SPEED * TYPE_POWER[attempt.type] * middling;
  const ballContribution = ctx.speed * TYPE_BALL_RETENTION[attempt.type] * middling;
  const exitSpeed = Math.max(0.5, batContribution + ballContribution);

  // Direction: the natural angle off the line, plus what the player aimed,
  // plus the deflection an off-centre contact produces.
  const sign = offSideSign(ctx.hand) * -1; // +1 maps "aim +1" to the leg side
  const aimRange = attempt.square ? 1.25 : 0.7;
  const aimed = clamp(attempt.aim, -1, 1) * aimRange * sign;
  // A late shot goes squarer on the leg side, an early one squarer on the off.
  const deflection = attempt.timingError * 3.4;
  const authority = 0.35 + 0.65 * middling; // mistimed shots ignore your aim
  const exitDirection = naturalDirection(ctx) + aimed * authority + deflection;

  // Elevation. Mistiming lifts the ball whatever you intended, which is what
  // turns a mistimed drive into a catch to mid-off.
  const lift = (1 - middling) * 0.55;
  const heightBonus = clamp((ctx.heightAtCrease - 0.7) * 0.25, -0.1, 0.25);
  const exitElevation = attempt.type === "ground" && (band === "perfect" || band === "good")
    ? 0.025 : TYPE_ELEVATION[attempt.type] + lift + heightBonus;

  // Catching chance. An edge is the most likely of all to carry; a lofted
  // shot that was not middled is next.
  let chanceOfCatch = 0;
  if (band === "edged") chanceOfCatch = 0.62;
  else if (band === "mistimed") chanceOfCatch = attempt.type === "lofted" ? 0.5 : 0.24;
  else if (band === "good") chanceOfCatch = attempt.type === "lofted" ? 0.16 : 0.05;
  else chanceOfCatch = attempt.type === "lofted" ? 0.07 : 0.01;
  chanceOfCatch *= 1.3 - 0.3 * fit;
  chanceOfCatch = clamp(chanceOfCatch, 0, 0.95);

  // Playing on: a thick inside edge from a poorly-footworked shot to a ball
  // close to the stumps.
  const playedOn =
    band === "edged" && Math.abs(ctx.lineAtCrease) < 0.35 && attempt.timingError > 0;

  return {
    band,
    missed: false,
    exitSpeed,
    exitDirection,
    exitElevation,
    contactOffset,
    chanceOfCatch,
    playedOn,
  };
}

/**
 * The ideal moment to press, as a time-to-crease.
 *
 * The batsman does not swing when the ball arrives — the bat has to be moving
 * already. This is the lead time the timing error is measured against, and it
 * is longer for a slower ball because there is more time to play with.
 */
export function idealPressLead(speedAtCrease: number): number {
  return clamp(0.16 + (30 - speedAtCrease) * 0.004, 0.1, 0.26);
}
