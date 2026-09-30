/**
 * Field placement, chasing, and how many runs the batsmen get for it.
 *
 * Pure — positions and timings only, no three.js. The engine reads these
 * positions to place the models and animates toward the chase target.
 *
 * Positions are given for a RIGHT-HANDED batsman in world coordinates
 * (dimensions.ts: -X off side, +X leg side, striker at -Z). For a left-hander
 * the whole field mirrors in X, which is what `fieldFor` does.
 */

import {
  BOUNDARY_SQUARE,
  BOUNDARY_STRAIGHT,
  Handedness,
  STRIKER_STUMPS_Z,
  boundaryDistanceAlong,
} from "../dimensions";

export interface FieldPosition {
  name: string;
  x: number;
  z: number;
  /** True for the keeper, who does not chase. */
  keeper?: boolean;
}

/** How fast a fielder runs, m/s. */
export const FIELDER_SPEED = 7.2;

/** How fast a returned throw travels, m/s. */
export const THROW_SPEED = 28;

/** Time a fielder loses picking the ball up. */
export const PICKUP_TIME = 0.45;

/**
 * Time to complete one run between the wickets.
 *
 * 17.68m between the popping creases, run at roughly 6 m/s with the turn, so
 * a shade over 3 seconds. This is the number that decides whether a push into
 * the covers is a single or a dot, so it matters more than it looks.
 */
export const RUN_TIME = 3.05;

/**
 * A standard one-day field: keeper, slip, and a ring with two out.
 * Deep positions sit just inside the rope rather than on it.
 */
const STANDARD_FIELD: FieldPosition[] = [
  { name: "Keeper", x: 0, z: STRIKER_STUMPS_Z - 9, keeper: true },
  { name: "Slip", x: -1.9, z: STRIKER_STUMPS_Z - 8.2 },
  { name: "Point", x: -20, z: STRIKER_STUMPS_Z + 1.5 },
  { name: "Cover", x: -19, z: 8 },
  { name: "Mid-off", x: -9, z: 20 },
  { name: "Mid-on", x: 9.5, z: 20 },
  { name: "Midwicket", x: 20, z: 7 },
  { name: "Square leg", x: 21, z: STRIKER_STUMPS_Z + 2 },
  { name: "Fine leg", x: 13, z: -BOUNDARY_STRAIGHT + 8 },
  { name: "Deep cover", x: -BOUNDARY_SQUARE + 7, z: 12 },
  { name: "Long on", x: 14, z: BOUNDARY_STRAIGHT - 9 },
];

/** The field, mirrored for a left-hander. */
export function fieldFor(hand: Handedness): FieldPosition[] {
  const mirror = hand === "left" ? -1 : 1;
  return STANDARD_FIELD.map((f) => ({ ...f, x: f.x * mirror }));
}

export interface ChaseResult {
  /** Index into the field array of whoever gets there first. */
  fielderIndex: number;
  /** Where the ball is gathered. */
  interceptX: number;
  interceptZ: number;
  /** Seconds from the shot until the ball is back at the stumps. */
  returnTime: number;
  /** True if the ball beat everyone to the rope. */
  boundary: boolean;
  /** True if it cleared the rope on the full. */
  six: boolean;
}

export interface BallTrack {
  /** Where the ball ends up, or crosses the rope. */
  endX: number;
  endZ: number;
  /** Time from the shot until the ball reaches that point. */
  travelTime: number;
  /** Highest point the ball reached. */
  apex: number;
  /** True if it crossed the rope without bouncing. */
  clearedOnFull: boolean;
}

/**
 * Work out who fields the ball and how long the batsmen have.
 *
 * The interception model is deliberately simple: each fielder runs straight at
 * where the ball will finish, and whoever can be there soonest gets it. Real
 * fielders cut the ball off on an angle, which mostly matters for whether a
 * shot is a two or a three — worth doing later, not worth doing first.
 */
export function resolveChase(
  track: BallTrack,
  field: FieldPosition[],
  strikerEndZ = STRIKER_STUMPS_Z
): ChaseResult {
  const distanceToRope = boundaryDistanceAlong(track.endX, track.endZ);
  const ballDistance = Math.hypot(track.endX, track.endZ);
  const boundary = ballDistance >= distanceToRope;

  let bestIndex = 0;
  let bestTime = Infinity;
  for (let i = 0; i < field.length; i++) {
    const f = field[i];
    if (f.keeper) continue;
    const run = Math.hypot(f.x - track.endX, f.z - track.endZ);
    // A fielder cannot gather before the ball arrives, however close they are.
    const t = Math.max(track.travelTime, run / FIELDER_SPEED);
    if (t < bestTime) {
      bestTime = t;
      bestIndex = i;
    }
  }

  const throwDistance = Math.hypot(track.endX, track.endZ - strikerEndZ);
  const returnTime = bestTime + PICKUP_TIME + throwDistance / THROW_SPEED;

  return {
    fielderIndex: bestIndex,
    interceptX: track.endX,
    interceptZ: track.endZ,
    returnTime,
    boundary,
    six: boundary && track.clearedOnFull,
  };
}

/**
 * How many runs the batsmen can safely take.
 *
 * They commit to another run only if they can complete it before the throw
 * arrives, with a margin — which is why a slightly misfielded ball turns a
 * comfortable two into a risky three.
 */
export function runsAvailable(returnTime: number, margin = 0.35): number {
  if (returnTime <= 0) return 0;
  const runs = Math.floor((returnTime - margin) / RUN_TIME);
  return Math.max(0, Math.min(4, runs));
}

/**
 * Whether a catch is taken.
 *
 * Deterministic given a random source, so a replay of the same seed produces
 * the same match. Only balls that carry to a fielder are candidates.
 */
export function catchTaken(
  chanceOfCatch: number,
  track: BallTrack,
  field: FieldPosition[],
  rand: () => number
): boolean {
  if (chanceOfCatch <= 0) return false;
  // A ball that never got above head height cannot be caught in the deep.
  if (track.apex < 1.6) return false;

  // Only in range if someone is near where it comes down.
  const nearest = field.reduce((best, f) => {
    const d = Math.hypot(f.x - track.endX, f.z - track.endZ);
    return Math.min(best, d);
  }, Infinity);

  // Time in the air is what lets a fielder cover ground to a skier.
  const reach = 2.5 + track.travelTime * FIELDER_SPEED * 0.55;
  if (nearest > reach) return false;

  return rand() < chanceOfCatch;
}
