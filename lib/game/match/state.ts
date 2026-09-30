/**
 * The over state machine: balls, runs, wickets, extras and strike.
 *
 * Pure and immutable — every transition takes a state and a ball outcome and
 * returns a new state. Scoring is the part of a cricket game that is easiest
 * to get subtly wrong (a wide does not count as a ball; a bye does not go to
 * the batsman; strike rotates on odd runs AND at the end of an over, so five
 * off the last ball leaves the same man on strike), so it lives here on its
 * own where the tests can pin each rule separately.
 */

export type Dismissal = "bowled" | "caught" | "lbw" | "run-out" | "stumped" | "hit-wicket";

export type ExtraKind = "wide" | "no-ball" | "bye" | "leg-bye";

export interface BallOutcome {
  /** Runs off the bat. Zero for extras and dot balls. */
  runs: number;
  /** Extra conceded on this delivery, if any. */
  extra?: { kind: ExtraKind; runs: number };
  /** How the batsman was out, if they were. */
  dismissal?: Dismissal;
  /** True if the ball reached the boundary along the ground. */
  four?: boolean;
  /** True if it cleared the rope. */
  six?: boolean;
}

export interface BatsmanState {
  name: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal?: Dismissal;
}

export interface MatchState {
  runs: number;
  wickets: number;
  /** Legal balls bowled in the current over, 0..6. */
  ballsThisOver: number;
  /** Completed overs. */
  overs: number;
  /** Index into `batsmen` of the player on strike. */
  striker: number;
  nonStriker: number;
  batsmen: BatsmanState[];
  /** Index of the next batsman to come in. */
  nextIn: number;
  extras: number;
  /** Set once the innings cannot continue. */
  complete: boolean;
  /** Ball-by-ball log, newest last. */
  timeline: string[];
}

export const BALLS_PER_OVER = 6;

export function newBatsman(name: string): BatsmanState {
  return { name, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, out: false };
}

export function newInnings(names: string[], oversLimit = 1): MatchState {
  void oversLimit;
  return {
    runs: 0,
    wickets: 0,
    ballsThisOver: 0,
    overs: 0,
    striker: 0,
    nonStriker: 1,
    batsmen: names.map(newBatsman),
    nextIn: 2,
    extras: 0,
    complete: false,
    timeline: [],
  };
}

/** Overs in the conventional "4.3" form. */
export function oversText(s: MatchState): string {
  return `${s.overs}.${s.ballsThisOver}`;
}

export function scoreText(s: MatchState): string {
  return `${s.runs}/${s.wickets}`;
}

/** A wide or a no-ball does not count toward the over. */
function isLegalDelivery(o: BallOutcome): boolean {
  return o.extra?.kind !== "wide" && o.extra?.kind !== "no-ball";
}

/** Byes and leg-byes go to the team, not to the batsman. */
function creditsBatsman(o: BallOutcome): boolean {
  return !o.extra || o.extra.kind === "no-ball";
}

function describe(o: BallOutcome): string {
  if (o.dismissal) return `W (${o.dismissal})`;
  if (o.extra) {
    const total = o.extra.runs + o.runs;
    return `${o.extra.kind}${total > 1 ? ` +${total}` : ""}`;
  }
  if (o.six) return "6";
  if (o.four) return "4";
  return String(o.runs);
}

/**
 * Apply one delivery.
 *
 * Returns a NEW state; the input is never mutated, so the caller can keep the
 * previous state for an undo or a replay without defensive copying.
 */
export function applyBall(state: MatchState, outcome: BallOutcome): MatchState {
  if (state.complete) return state;

  const batsmen = state.batsmen.map((b) => ({ ...b }));
  const striker = batsmen[state.striker];

  const extraRuns = outcome.extra?.runs ?? 0;
  const batRuns = outcome.runs;
  const legal = isLegalDelivery(outcome);

  let runs = state.runs + batRuns + extraRuns;
  let extras = state.extras + extraRuns;
  let wickets = state.wickets;

  if (creditsBatsman(outcome)) {
    striker.runs += batRuns;
    if (outcome.four) striker.fours += 1;
    if (outcome.six) striker.sixes += 1;
  }
  // A batsman faces the ball even off a no-ball, but not off a wide.
  if (outcome.extra?.kind !== "wide") {
    striker.ballsFaced += 1;
  }

  if (outcome.dismissal) {
    striker.out = true;
    striker.dismissal = outcome.dismissal;
    wickets += 1;
  }

  let ballsThisOver = state.ballsThisOver + (legal ? 1 : 0);
  let overs = state.overs;

  // Strike rotates on odd runs off the bat, and on odd byes/leg-byes too,
  // because the batsmen physically ran them.
  const ranRuns = batRuns + (outcome.extra?.kind === "bye" || outcome.extra?.kind === "leg-bye"
    ? outcome.extra.runs
    : 0);
  let strikerIdx = state.striker;
  let nonStrikerIdx = state.nonStriker;
  if (ranRuns % 2 === 1) {
    [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
  }

  // New batsman replaces whoever was dismissed.
  let nextIn = state.nextIn;
  if (outcome.dismissal) {
    if (nextIn < batsmen.length) {
      // Run-outs can dismiss the non-striker, but iteration 1 only dismisses
      // the striker; the replacement takes the dismissed player's position.
      if (strikerIdx === state.striker) strikerIdx = nextIn;
      else nonStrikerIdx = nextIn;
      nextIn += 1;
    }
  }

  // End of the over: strike rotates again, and the count resets.
  if (ballsThisOver >= BALLS_PER_OVER) {
    ballsThisOver = 0;
    overs += 1;
    [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
  }

  // All out when only one batsman is left standing.
  const complete = wickets >= batsmen.length - 1;

  return {
    runs,
    wickets,
    ballsThisOver,
    overs,
    striker: strikerIdx,
    nonStriker: nonStrikerIdx,
    batsmen,
    nextIn,
    extras,
    complete,
    timeline: [...state.timeline, describe(outcome)],
  };
}

/**
 * Turn a ball's physical result into a scoring outcome.
 *
 * Kept separate from `applyBall` so the physics can say what happened without
 * knowing the laws, and the laws can be tested without the physics.
 */
export interface BallResultInput {
  clearedRope: boolean;
  reachedRope: boolean;
  ranRuns: number;
  dismissal?: Dismissal;
  wide?: boolean;
  noBall?: boolean;
  offTheBat: boolean;
}

export function toOutcome(r: BallResultInput): BallOutcome {
  if (r.wide) return { runs: 0, extra: { kind: "wide", runs: 1 + r.ranRuns } };
  if (r.noBall) {
    return {
      runs: r.clearedRope ? 6 : r.reachedRope ? 4 : r.ranRuns,
      extra: { kind: "no-ball", runs: 1 },
      four: r.reachedRope && !r.clearedRope,
      six: r.clearedRope,
    };
  }
  if (r.dismissal) return { runs: 0, dismissal: r.dismissal };

  const boundaryRuns = r.clearedRope ? 6 : r.reachedRope ? 4 : 0;
  const runs = boundaryRuns || r.ranRuns;

  if (!r.offTheBat && runs > 0) {
    return { runs: 0, extra: { kind: "bye", runs } };
  }

  return {
    runs,
    four: r.reachedRope && !r.clearedRope,
    six: r.clearedRope,
  };
}
