import { STRIKER_STUMPS_Z } from "../dimensions";
import type { MatchState } from "./state";
import { buildDelivery, planFor, previewBounce, type BowlerStyle, type DeliveryPlan } from "./bowling";
import type { Vec3 } from "../physics/vec3";
import type { PitchConditions } from "../physics/pitch";

export interface BowlerProfile {
  name: string;
  style: BowlerStyle;
  minKph: number;
  maxKph: number;
  description: string;
}

/** Fictional specialists: selection changes the action and stock ball, not just its label. */
export const BOWLERS: readonly BowlerProfile[] = [
  { name: "Mitchell", style: "fast", minKph: 118, maxKph: 150, description: "Express pace · subtle away seam" },
  { name: "Brennan", style: "fast-medium", minKph: 100, maxKph: 135, description: "Seam control · change of pace" },
  { name: "Silva", style: "off-spin", minKph: 66, maxKph: 90, description: "Off-break · turns into the right-hander" },
  { name: "Okafor", style: "leg-spin", minKph: 62, maxKph: 86, description: "Leg-break · turns away from the right-hander" },
];
export interface BowlingAim { line: number; length: number; pace: number }
export const DEFAULT_BOWLING_AIM: BowlingAim = { line: -0.12, length: 5, pace: 0.7 };
export const BOWLING_TARGET = 24;
export const BOWLING_OVERS = 2;
export const BOWLING_WICKETS = 3;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Up aims fuller, down shorter; left/right remain screen-relative in either camera. */
export function moveBowlingAim(aim: BowlingAim, x: number, forward: number, pace: number, dt: number, screenSign: number): BowlingAim {
  const divisor = Math.max(1, Math.hypot(x, forward));
  return {
    line: clamp(aim.line + x * screenSign * dt * 0.8 / divisor, -1.4, 1.4),
    length: clamp(aim.length - forward * dt * 3 / divisor, 1.2, 9),
    pace: clamp(aim.pace + pace * dt * 0.5, 0, 1),
  };
}

/** Pace stays within the chosen player's range; spin/seam belong to his stock action. */
export function playerDelivery(bowler: BowlerProfile, aim: BowlingAim): DeliveryPlan {
  return planFor(bowler.style, {
    targetLine: aim.line, targetLength: aim.length,
    maxElevation: 0.45,
    speed: (bowler.minKph + (bowler.maxKph - bowler.minKph) * clamp(aim.pace, 0, 1)) / 3.6,
    seamAngle: bowler.style === "fast" ? -0.08 : bowler.style === "fast-medium" ? 0.06 : 0,
  });
}

/** Correct aerodynamic drift and live-integrator error once on lock, not every rendered frame. */
export function lockPlayerDelivery(plan: DeliveryPlan, hand: Vec3, pitch: PitchConditions, outfield: PitchConditions) {
  let fitted = { ...plan, releaseX: hand.x, releaseHeight: hand.y, releaseZ: hand.z };
  let bounce: Vec3 | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    bounce = previewBounce(buildDelivery(fitted), pitch, outfield);
    if (!bounce) break;
    const dx = plan.targetLine - bounce.x;
    const dz = STRIKER_STUMPS_Z + plan.targetLength - bounce.z;
    if (Math.hypot(dx, dz) < 0.035 || attempt === 3) break;
    fitted = { ...fitted, targetLine: fitted.targetLine + dx, targetLength: fitted.targetLength + dz };
  }
  return { plan: fitted, bounce };
}

/** Bowling is a defence: reaching the target loses, wickets/expired overs below it win. */
export function bowlingStatus(match: MatchState) {
  const ballsRemaining = Math.max(0, BOWLING_OVERS * 6 - match.overs * 6 - match.ballsThisOver);
  const runsNeeded = Math.max(0, BOWLING_TARGET - match.runs);
  const wicketsRemaining = Math.max(0, BOWLING_WICKETS - match.wickets);
  const result = runsNeeded === 0 ? "lost" : ballsRemaining === 0 || wicketsRemaining === 0 || match.complete ? "won" : "playing";
  return { ballsRemaining, runsNeeded, wicketsRemaining, result } as const;
}

/** Prompt only on a newly completed legal over, and never instead of an innings result. */
export function shouldChangeBowler(before: MatchState, after: MatchState): boolean {
  return after.overs > before.overs && after.ballsThisOver === 0 && bowlingStatus(after).result === "playing";
}

/** Arcade wide corridor; an untouched unreachable ball cannot be used to farm dot balls. */
export function isBowlingWide(lineAtCrease: number, stanceOffset: number): boolean {
  return Math.abs(lineAtCrease - stanceOffset) > 1.2;
}
