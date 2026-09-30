import { BALL_RADIUS, STRIKER_STUMPS_Z } from "../dimensions";
import { predictPath, type BallSnapshot, type PathPoint, type PredictOptions } from "../physics/predict";
import { classifyLength, type Length } from "../physics/pitch";
import { idealPressLead } from "./shot";

/** First bounce before the striker, including lateral aerodynamic drift. */
export function predictBounce(ball: BallSnapshot, options: PredictOptions): PathPoint | null {
  let bounce: PathPoint | null = null;
  predictPath(ball, { ...options, maxTime: 3 }, (p) => {
    if (p.position.z < STRIKER_STUMPS_Z) return true;
    if (p.position.y <= BALL_RADIUS + 1e-4) { bounce = p; return true; }
    return false;
  });
  return bounce;
}

export interface ContactPrediction {
  hit: PathPoint;
  speed: number;
  timingError: number;
}

/** The HUD and shot press share this exact contact plane and ideal lead calculation. */
export function predictContact(ball: BallSnapshot, options: PredictOptions, zPlane: number): ContactPrediction | null {
  if (ball.position.z <= zPlane) return null;
  let hit: PathPoint | null = null;
  predictPath(ball, { ...options, maxTime: 2 }, (p) => {
    if (p.position.z <= zPlane) { hit = p; return true; }
    return false;
  });
  if (!hit) return null;
  const point = hit as PathPoint;
  const speed = Math.hypot(point.velocity.x, point.velocity.y, point.velocity.z);
  return { hit: point, speed, timingError: idealPressLead(speed) - point.t };
}

/** Moving down the pitch makes the same bounce relatively fuller. */
export function lengthForStance(bounceZ: number | null, forward: number): Length {
  return bounceZ === null ? "full-toss" : classifyLength(bounceZ - STRIKER_STUMPS_Z - forward);
}
