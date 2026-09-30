import { applyBall, type BatsmanState, type Dismissal, type MatchState } from "../match/state";

export type MomentKind = "wicket" | "four" | "six";
export type MomentShot = "fielders" | "walkoff" | "batsmen" | "bowler";
export interface MatchMoment {
  kind: MomentKind;
  bowlerVariant: number;
  batterVariant: number;
  dismissed: BatsmanState | null;
}
export const WICKET_WALKOFF_TIME = 3;
export const WICKET_HOLD_TIME = 5.2;
export const BOUNDARY_REACTION_TIME = 2.6;

/** Player cutaways are reserved for wickets; boundaries stay with the umpire. */
export function momentShot(moment: MatchMoment | null, time: number): MomentShot | null {
  if (moment?.kind !== "wicket") return null;
  return time < WICKET_WALKOFF_TIME ? "fielders" : "walkoff";
}

/** Preview the scorer's result without advancing the innings or replacing the striker. */
export function dismissedBatsman(match: MatchState, dismissal: Dismissal): BatsmanState {
  return { ...applyBall(match, { runs: 0, dismissal }).batsmen[match.striker] };
}

/** Pick a different reaction each time, using a cosmetic-only random source. */
export function nextReaction(previous: number, random: () => number): number {
  return previous < 0 ? Math.floor(random() * 3) : (previous + 1 + Math.floor(random() * 2)) % 3;
}
