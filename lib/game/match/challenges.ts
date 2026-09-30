import type { MatchState } from "./state";
import { planFor, varyDelivery, type BowlerStyle, type DeliveryPlan } from "./bowling";

export interface Challenge {
  id: number;
  name: string;
  target: number;
  overs: number;
  wickets: number;
  styles: BowlerStyle[];
  lengths: number[];
}

export const CHALLENGES: Challenge[] = [
  { id: 0, name: "Find the gaps", target: 12, overs: 2, wickets: 3, styles: ["medium"], lengths: [3, 3, 4] },
  { id: 1, name: "Clear the rope", target: 20, overs: 2, wickets: 3, styles: ["medium", "fast-medium"], lengths: [3, 4, 5] },
  { id: 2, name: "Read the spin", target: 28, overs: 3, wickets: 3, styles: ["off-spin", "medium"], lengths: [3, 4, 5, 6] },
  { id: 3, name: "Handle the pace", target: 38, overs: 3, wickets: 3, styles: ["fast-medium", "fast"], lengths: [3, 5, 6, 8] },
  { id: 4, name: "Finish the chase", target: 48, overs: 3, wickets: 3, styles: ["medium", "fast-medium", "fast", "off-spin", "leg-spin"], lengths: [2, 3, 5, 6, 8] },
];

export type ChallengeResult = "playing" | "won" | "lost";
export interface Progress {
  version: 1;
  unlocked: number;
  best: Record<string, number>;
}
export const PROGRESS_KEY = "cricket07.challenges.v1";
export const freshProgress = (): Progress => ({ version: 1, unlocked: 0, best: {} });

/** Target takes precedence on the final ball; extras already belong to the scorebook. */
export function challengeStatus(level: Challenge, match: MatchState) {
  const ballsRemaining = Math.max(0, level.overs * 6 - match.overs * 6 - match.ballsThisOver);
  const runsNeeded = Math.max(0, level.target - match.runs);
  const wicketsRemaining = Math.max(0, level.wickets - match.wickets);
  const result: ChallengeResult = runsNeeded === 0 ? "won"
    : ballsRemaining === 0 || wicketsRemaining === 0 || match.complete ? "lost" : "playing";
  return { ballsRemaining, runsNeeded, wicketsRemaining, result };
}

/** Treat unavailable, stale or malformed browser storage as a new ladder. */
export function loadProgress(storage: Pick<Storage, "getItem">): Progress {
  try {
    const data = JSON.parse(storage.getItem(PROGRESS_KEY) ?? "null");
    if (data?.version !== 1 || !Number.isInteger(data.unlocked) || data.unlocked < 0 || data.unlocked >= CHALLENGES.length) return freshProgress();
    const best: Record<string, number> = {};
    for (const level of CHALLENGES) {
      const score = data.best?.[level.id];
      if (Number.isInteger(score) && score >= level.target) best[level.id] = score;
    }
    return { version: 1, unlocked: data.unlocked, best };
  } catch { return freshProgress(); }
}

/** Return new progress so telemetry snapshots never change underneath React. */
export function recordWin(progress: Progress, level: Challenge, runs: number): Progress {
  return {
    version: 1,
    unlocked: Math.max(progress.unlocked, Math.min(CHALLENGES.length - 1, level.id + 1)),
    best: { ...progress.best, [level.id]: Math.max(progress.best[level.id] ?? 0, runs) },
  };
}

/** Bowlers keep an over except in the final mixed challenge; variation is seeded. */
export function challengeDelivery(level: Challenge, over: number, rand: () => number): DeliveryPlan {
  const style = level.styles[level.id === 4 ? Math.floor(rand() * level.styles.length) : over % level.styles.length];
  const targetLength = level.lengths[Math.floor(rand() * level.lengths.length)];
  const targetLine = -0.15 + (rand() - 0.5) * (0.1 + level.id * 0.12);
  const plan = varyDelivery(planFor(style, { targetLength, targetLine }), rand);
  plan.seamAngle = (rand() - 0.5) * (0.08 + level.id * 0.09);
  return plan;
}
