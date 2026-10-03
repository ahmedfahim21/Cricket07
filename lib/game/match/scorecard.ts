/**
 * The numbers a broadcast puts on screen but a scorebook does not store.
 *
 * `state.ts` accumulates only what a delivery actually changes. Everything a
 * viewer reads off the strip — run rate, what is required, a bowler's figures
 * in O-M-R-W form, how the over has gone — is DERIVED, and derived here, so
 * there is one place to check when a displayed number looks wrong and no risk
 * of a cached total drifting away from the balls that produced it.
 *
 * Pure, and formatting-only where it formats: no state is reachable from here.
 */

import { BALLS_PER_OVER, type BowlingFigures, type MatchState } from "./state";

/** Balls bowled in the innings so far, wides and no-balls excluded. */
export function legalBalls(s: MatchState): number {
  return s.overs * BALLS_PER_OVER + s.ballsThisOver;
}

/** Overs in the conventional "4.3" form, from a raw ball count. */
export function oversFromBalls(balls: number): string {
  return `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;
}

/**
 * Runs per over so far, or null before a ball has been bowled.
 *
 * Null rather than zero: a side that has not faced a ball has no run rate, and
 * showing "0.00" before the first delivery reads as a side going nowhere.
 */
export function runRate(s: MatchState): number | null {
  const balls = legalBalls(s);
  return balls === 0 ? null : (s.runs * BALLS_PER_OVER) / balls;
}

/**
 * Runs per over still needed.
 *
 * Null when there is nothing left to ask for — the target is already reached,
 * or there are no balls left to get it in, and in both cases a required rate is
 * meaningless rather than infinite.
 */
export function requiredRate(runsNeeded: number, ballsRemaining: number): number | null {
  if (runsNeeded <= 0 || ballsRemaining <= 0) return null;
  return (runsNeeded * BALLS_PER_OVER) / ballsRemaining;
}

/** Two decimals, as every scoreboard shows a rate. */
export function rateText(rate: number | null): string {
  return rate === null ? "—" : rate.toFixed(2);
}

/** Whoever is bowling now, or null before anyone has been named. */
export function currentBowler(s: MatchState): BowlingFigures | null {
  return s.bowlers[s.bowlerIndex] ?? null;
}

/**
 * A bowler's figures as a scorecard writes them: "4-0-23-2", "3.4-0-19-1".
 *
 * Note the completed over is written bare. A scorecard says a man has bowled 4
 * overs, not 4.0 — the decimal is only ever there to say how far into an
 * unfinished over he is. The innings total is the other way round and always
 * carries it ("12.0 OV"), which is why this does not just reuse `oversText`.
 */
export function figuresText(f: BowlingFigures): string {
  const overs = f.balls % BALLS_PER_OVER === 0
    ? String(f.balls / BALLS_PER_OVER)
    : oversFromBalls(f.balls);
  return `${overs}-${f.maidens}-${f.runs}-${f.wickets}`;
}

/** Economy, runs per over, or null before he has bowled a legal ball. */
export function economy(f: BowlingFigures): number | null {
  return f.balls === 0 ? null : (f.runs * BALLS_PER_OVER) / f.balls;
}

/** Scorebook shorthand for the extras. */
const EXTRA_SYMBOL: Record<string, string> = {
  wide: "wd",
  "no-ball": "nb",
  bye: "b",
  "leg-bye": "lb",
};

/**
 * One ball of the over, in scorebook shorthand.
 *
 * The ball-by-ball log in `state.timeline` is written long, for reading back
 * ("W (caught)", "leg-bye +3"); the strip has room for about six characters a
 * ball and gets the scorebook's own abbreviations instead. A dot ball is a dot,
 * which is the substitution most worth making: a "0" in a row of digits cannot
 * be scanned, and the symbol is why it is called a dot ball.
 */
export function overSymbol(ball: string): string {
  if (ball === "0") return "•";
  // How he was out belongs in the log, not on the strip. A wicket is a W.
  if (ball.startsWith("W")) return "W";
  const extra = /^([a-z-]+)(?: \+(\d+))?$/.exec(ball);
  if (!extra) return ball;
  const short = EXTRA_SYMBOL[extra[1]] ?? extra[1];
  // Runs lead the symbol, as a scorer writes them: 2wd, 4b, 1lb.
  return extra[2] ? `${extra[2]}${short}` : short;
}

/** The over so far, as a commentator reads it out: "1 • 4 W 2wd". */
export function overText(s: MatchState): string {
  return s.thisOver.map(overSymbol).join(" ");
}

/** "48 (31)" — the current pair's runs and the balls they have taken. */
export function partnershipText(s: MatchState): string {
  return `${s.partnership.runs} (${s.partnership.balls})`;
}

/**
 * How many runs the striker needs to bring up his next milestone, and which.
 *
 * Fifties and hundreds only; a broadcast does not announce a 30. Null when he
 * is not close enough for it to be worth saying.
 */
export function approachingMilestone(runs: number, within = 10): { at: number; away: number } | null {
  if (runs < 0) return null;
  const at = runs < 50 ? 50 : (Math.floor(runs / 100) + 1) * 100;
  const away = at - runs;
  return away > 0 && away <= within ? { at, away } : null;
}
