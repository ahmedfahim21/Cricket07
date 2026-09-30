/**
 * Laws-of-cricket dimensions, in metres, and the coordinate convention every
 * other module in this project assumes.
 *
 * Everything here is a real measurement, not a game-feel number. Camera
 * framing, the field radar, fielder placement and the physics all derive from
 * these, so a wrong value here reads as "something is subtly off" in six
 * different places at once and is miserable to track down later.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE CONVENTION
 * ---------------------------------------------------------------------------
 *
 *   +Y   up
 *   +Z   down the pitch toward the BOWLER's end
 *   -Z   down the pitch toward the STRIKER's end
 *   +X   leg side   (for a right-handed batsman)
 *   -X   off side   (for a right-handed batsman)
 *
 * Origin is the centre of the pitch, at ground level.
 *
 * The ball therefore travels in -Z on its way to the striker. The broadcast
 * camera sits behind the bowler at +Z looking toward -Z, which puts the off
 * side on the left of the screen and the slip cordon with it — the framing
 * anyone who has watched cricket expects.
 *
 * For a LEFT-handed batsman the off/leg sides mirror. Nothing here changes;
 * modules take a handedness sign and multiply X by it. See `offSideSign`.
 */

/* ------------------------------------------------------------------ *
 * The pitch
 * ------------------------------------------------------------------ */

/** Stump to stump. 22 yards. */
export const PITCH_LENGTH = 20.12;

/** Full prepared strip width. 10 ft. */
export const PITCH_WIDTH = 3.05;

/** Half the pitch: |z| of each set of stumps. */
export const CREASE_Z = PITCH_LENGTH / 2; // 10.06

/** Striker's stumps sit at -Z, bowler's at +Z. */
export const STRIKER_STUMPS_Z = -CREASE_Z;
export const BOWLER_STUMPS_Z = CREASE_Z;

/* ------------------------------------------------------------------ *
 * Stumps and bails
 * ------------------------------------------------------------------ */

/** Top of the stumps above ground. 28 in. */
export const STUMP_HEIGHT = 0.71;

/** Overall width of the three stumps, outside to outside. 9 in. */
export const STUMP_SET_WIDTH = 0.229;

/** A single stump's diameter — between 1.375 and 1.5 in; take the middle. */
export const STUMP_DIAMETER = 0.036;

/** X offsets of the three stumps, centre of each. */
export const STUMP_X_OFFSETS = [
  -(STUMP_SET_WIDTH - STUMP_DIAMETER) / 2,
  0,
  (STUMP_SET_WIDTH - STUMP_DIAMETER) / 2,
] as const;

/** Bail length, sitting in the grooves across each adjacent pair. */
export const BAIL_LENGTH = 0.1109;
export const BAIL_DIAMETER = 0.0127;

/* ------------------------------------------------------------------ *
 * Creases
 * ------------------------------------------------------------------ */

/** Popping crease, 4 ft in FRONT of the stumps (toward the bowler for the striker). */
export const POPPING_CREASE_OFFSET = 1.22;

/** Return creases, 4 ft 4 in either side of the middle stump. */
export const RETURN_CREASE_OFFSET = 1.32;

/** The bowling crease runs through the stumps, 8 ft 8 in total. */
export const BOWLING_CREASE_HALF_WIDTH = 1.32;

/** Painted line width. 2 in — thin enough that it must be drawn, not extruded. */
export const CREASE_LINE_WIDTH = 0.05;

/* ------------------------------------------------------------------ *
 * The ground
 * ------------------------------------------------------------------ */

/**
 * Boundary is an ellipse, not a circle — grounds are longer straight than
 * square, which is why a straight six is a bigger hit than one over midwicket.
 * Semi-axis along the pitch (Z) and square of the wicket (X).
 */
export const BOUNDARY_STRAIGHT = 70; // +/- Z
export const BOUNDARY_SQUARE = 62; // +/- X

/** 30-yard circle, also an ellipse concentric with the boundary. */
export const INNER_CIRCLE_RADIUS = 27.43;

/** Radius of the mown/rolled square around the pitch, before outfield grass. */
export const SQUARE_HALF_WIDTH = 12;
export const SQUARE_HALF_LENGTH = 14;

/** Width of one mown stripe in the outfield. */
export const MOW_STRIPE_WIDTH = 4.5;

/** Boundary rope thickness. */
export const ROPE_RADIUS = 0.06;

/* ------------------------------------------------------------------ *
 * Ball
 * ------------------------------------------------------------------ */

/** Men's ball: 5.5 to 5.75 oz. In kg. */
export const BALL_MASS = 0.156;

/** Circumference 8 13/16 to 9 in => radius ~36 mm. */
export const BALL_RADIUS = 0.036;

/** Cross-sectional area, for the drag term. */
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;

/* ------------------------------------------------------------------ *
 * Bat
 * ------------------------------------------------------------------ */

/** Max blade width. 4.25 in. */
export const BAT_WIDTH = 0.108;

/** Blade length (excluding handle). */
export const BAT_BLADE_LENGTH = 0.6;

/** Blade thickness at the spine. */
export const BAT_DEPTH = 0.04;

/** Handle length. */
export const BAT_HANDLE_LENGTH = 0.3;

/** Bat mass, ~2 lb 9 oz. */
export const BAT_MASS = 1.16;

/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

export const PLAYER_HEIGHT = 1.8;

/** Where the striker stands: just inside the popping crease, on leg stump. */
export const STRIKER_STANCE_Z = STRIKER_STUMPS_Z + 0.55;

/** Bowler release point, roughly, above and just past the crease. */
export const RELEASE_HEIGHT = 2.15;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export type Handedness = "right" | "left";

/**
 * Multiplier that maps "off side" to a world X sign.
 *
 * Off side is -X for a right-hander and +X for a left-hander, so anything
 * expressed in off/leg terms multiplies by this instead of branching.
 */
export function offSideSign(hand: Handedness): number {
  return hand === "right" ? -1 : 1;
}

/** True if a point has crossed the elliptical boundary. */
export function isBeyondBoundary(x: number, z: number): boolean {
  const nx = x / BOUNDARY_SQUARE;
  const nz = z / BOUNDARY_STRAIGHT;
  return nx * nx + nz * nz >= 1;
}

/** Distance from the origin to the boundary along the bearing of (x, z). */
export function boundaryDistanceAlong(x: number, z: number): number {
  const len = Math.hypot(x, z);
  if (len === 0) return Math.min(BOUNDARY_SQUARE, BOUNDARY_STRAIGHT);
  const ux = x / len;
  const uz = z / len;
  // Solve for t where (t*ux/a)^2 + (t*uz/b)^2 = 1.
  const a = ux / BOUNDARY_SQUARE;
  const b = uz / BOUNDARY_STRAIGHT;
  return 1 / Math.sqrt(a * a + b * b);
}
