import type { Footwork, ShotType } from "../input/bindings";
import type { Length } from "../physics/pitch";
import { effectiveFootwork } from "./shot";

export interface AiObservation {
  length: Length;
  line: number;
  height: number;
  speed: number;
  runsNeeded: number;
  ballsRemaining: number;
  batter: number;
  previousSpeed: number | null;
}
export interface AiDecision {
  shot: ShotType | null;
  footwork: Footwork;
  aim: number;
  square: boolean;
  timingError: number;
}

/**
 * Commit once after observing the released ball. The AI has the same shot,
 * timing, reach and footwork constraints as the player; it never awards runs
 * or dismissals. Pace changes and awkward lengths broaden its timing error.
 */
export function decideAiShot(o: AiObservation, random: () => number): AiDecision {
  const attack = random();
  const timingRoll = random();
  const mistake = random();
  const aimNoise = random();
  const badBall = o.length === "full-toss" || o.length === "full" || o.length === "short";
  const pressure = o.runsNeeded / Math.max(1, o.ballsRemaining);
  const awkward = o.length === "yorker" || o.length === "good" || o.length === "short-of-good";
  const paceChange = o.previousSpeed === null ? 0 : Math.min(0.09, Math.abs(o.speed - o.previousSpeed) * 0.008);
  const spread = (awkward ? 0.19 : 0.12) + paceChange + Math.min(0.045, o.batter * 0.012);
  let footwork = effectiveFootwork("none", o.length);
  if (mistake < (awkward ? 0.18 : 0.06)) footwork = footwork === "front" ? "back" : "front";
  const leave = Math.abs(o.line) > 1.15 || o.height > 1.9;
  const shot: ShotType | null = leave ? null : attack < (badBall ? 0.35 : 0.12) + (pressure > 3 ? 0.14 : 0) ? "lofted"
    : attack < (badBall ? 0.93 : 0.67) ? "ground" : "defensive";
  // Occasional genuine early swings create beatable batsmen without scripting wickets.
  const timingError = mistake > 0.91 ? -0.25 - aimNoise * 0.035 : (timingRoll * 2 - 1) * spread;
  return { shot, footwork, timingError,
    aim: Math.max(-1, Math.min(1, o.line * 0.7 + (aimNoise - 0.5) * 1.2)),
    square: o.length === "short" || o.length === "short-of-good" };
}
