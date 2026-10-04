/**
 * How a particular player moves.
 *
 * Every batsman and bowler shares one animation system — the same IK, the
 * same shot construction, the same bat-meets-ball fitting — and a style is a
 * handful of numbers that bend it: how wide he stands, how high he picks the
 * bat up, how he triggers, how far he runs in, how side-on he lands, where his
 * arm comes over. Because a style only shapes the poses AROUND the contact and
 * the release (contact is still fitted to the ball; release is still taken from
 * the hand), no style can make the bat miss or the ball leave from nowhere.
 *
 * Players get a preset by name, optionally with fields overridden, so a
 * roster can say "crouched" or "crouched, but a higher backlift".
 */

import type { Approach } from "./bowler";

export type Trigger = "none" | "back-across" | "forward-press" | "shuffle";

export interface BattingStyle {
  /** Feet apart in the stance, as a multiple of the default. 0.8 narrow .. 1.3 wide. */
  stanceWidth: number;
  /** 0 standing tall .. 1 deep crouch (knees bent, head low over the bat). */
  crouch: number;
  /** 0 side-on .. 1 open-chested (front foot toward leg, chest at the bowler). Closes on the trigger. */
  openStance: number;
  /** Bat grounded by the toe while waiting, or held up off the ground at the waist. */
  guard: "grounded" | "raised";
  /** How restless the bat is: 0 still .. 1.5 tapping hard and often. Grounded guard only. */
  tap: number;
  /** The small move as the bowler bounds. */
  trigger: Trigger;
  /** Size of the trigger: 0 .. 1.5. */
  triggerSize: number;
  /** Height of the backlift: 0.6 compact .. 1.3 high and flourishing. */
  backlift: number;
  /** Path of the backlift: -1 straight back at the keeper .. +1 wide from gully. */
  backliftArc: number;
  /** After the ball has gone: a full flowing finish, or checked and held. */
  finish: "high" | "checked";
}

export interface BowlingStyle {
  /** Run-up length, as a multiple of his bowling type's: 0.6 .. 1.4. */
  runLength: number;
  /** Run-up speed, as a multiple: 0.85 .. 1.15. */
  pace: number;
  /** Height of the leap into the stride: 0.5 low and skiddy .. 1.5 a big bound. */
  bound: number;
  /** 0 side-on, hips and shoulders closed at back-foot contact .. 1 front-on. */
  frontOn: number;
  /** How far the bowling arm comes over from vertical: 0 high .. 0.6 round-arm sling. */
  armAngle: number;
  /** Front arm: 0.6 tucked .. 1.3 reaching high and pulling hard. */
  frontArm: number;
  /** Follow-through length and fold: 0.7 checked .. 1.3 long. */
  followThrough: number;
  /** Line of the run-up across the crease: -0.3 wide of the crease .. +0.2 tight to the stumps. */
  crease: number;
}

export const DEFAULT_BATTING: BattingStyle = {
  stanceWidth: 1,
  crouch: 0.3,
  openStance: 0,
  guard: "grounded",
  tap: 0.6,
  trigger: "back-across",
  triggerSize: 1,
  backlift: 1,
  backliftArc: 0,
  finish: "high",
};

export const DEFAULT_BOWLING: BowlingStyle = {
  runLength: 1,
  pace: 1,
  bound: 1,
  frontOn: 0.2,
  armAngle: 0,
  frontArm: 1,
  followThrough: 1,
  crease: 0,
};

/** Batting archetypes. */
export const BATTING_STYLES = {
  classical: DEFAULT_BATTING,
  crouched: { ...DEFAULT_BATTING, stanceWidth: 1.15, crouch: 0.9, tap: 0.4, triggerSize: 0.8, backlift: 0.85, backliftArc: 0.2 },
  open: { ...DEFAULT_BATTING, stanceWidth: 1.05, crouch: 0.35, openStance: 0.9, tap: 0.3, triggerSize: 1.3, backlift: 1.1, backliftArc: 0.4 },
  upright: { ...DEFAULT_BATTING, stanceWidth: 0.85, crouch: 0, openStance: 0.15, guard: "raised", tap: 0, trigger: "forward-press", backlift: 1.25, backliftArc: -0.3 },
  compact: { ...DEFAULT_BATTING, stanceWidth: 0.95, crouch: 0.5, tap: 0.2, trigger: "none", triggerSize: 0, backlift: 0.7, backliftArc: -0.2, finish: "checked" },
  restless: { ...DEFAULT_BATTING, openStance: 0.2, tap: 1.4, trigger: "shuffle", triggerSize: 1.2, backlift: 1.15, backliftArc: 0.6 },
} satisfies Record<string, BattingStyle>;
export type BattingStyleName = keyof typeof BATTING_STYLES;

/** Bowling archetypes. Each works for any bowling type: the multiples are of that type's run. */
export const BOWLING_STYLES = {
  classical: DEFAULT_BOWLING,
  express: { ...DEFAULT_BOWLING, runLength: 1.2, pace: 1.08, bound: 1.35, frontOn: 0.1, armAngle: 0.05, frontArm: 1.2, followThrough: 1.25 },
  slingy: { ...DEFAULT_BOWLING, runLength: 0.8, bound: 0.8, frontOn: 0.5, armAngle: 0.55, frontArm: 0.8, crease: -0.25 },
  skiddy: { ...DEFAULT_BOWLING, runLength: 0.9, pace: 0.96, bound: 0.55, frontOn: 0.85, armAngle: 0.15, frontArm: 0.9, followThrough: 0.9 },
  economical: { ...DEFAULT_BOWLING, runLength: 0.75, pace: 0.92, bound: 0.8, frontOn: 0.3, frontArm: 1, followThrough: 0.8, crease: 0.12 },
  loopy: { ...DEFAULT_BOWLING, runLength: 0.9, pace: 0.95, bound: 1.25, frontOn: 0, frontArm: 1.15, followThrough: 1.1, crease: 0.1 },
  darting: { ...DEFAULT_BOWLING, runLength: 1.1, pace: 1.1, bound: 0.7, frontOn: 0.45, armAngle: 0.2, frontArm: 0.9, followThrough: 0.9 },
} satisfies Record<string, BowlingStyle>;
export type BowlingStyleName = keyof typeof BOWLING_STYLES;

/** A preset by name, or a preset with some fields changed. */
export type StyleChoice<N extends string, S> = N | ({ preset: N } & Partial<S>);

export function battingStyle(choice: StyleChoice<BattingStyleName, BattingStyle> | undefined): BattingStyle {
  if (choice === undefined) return DEFAULT_BATTING;
  if (typeof choice === "string") return BATTING_STYLES[choice];
  const { preset, ...over } = choice;
  return { ...BATTING_STYLES[preset], ...over };
}

export function bowlingStyle(choice: StyleChoice<BowlingStyleName, BowlingStyle> | undefined): BowlingStyle {
  if (choice === undefined) return DEFAULT_BOWLING;
  if (typeof choice === "string") return BOWLING_STYLES[choice];
  const { preset, ...over } = choice;
  return { ...BOWLING_STYLES[preset], ...over };
}

/** A bowling type's approach, bent by a bowler's style. */
export function styledApproach(base: Approach, s: BowlingStyle): Approach {
  return { runLength: base.runLength * s.runLength, vMax: base.vMax * s.pace, accel: base.accel * s.pace };
}

/** Problems with a style's numbers, for validating rosters. */
export function checkBatting(s: BattingStyle): string[] {
  const out: string[] = [];
  const range = (k: keyof BattingStyle, lo: number, hi: number) => {
    const v = s[k] as number;
    if (!(v >= lo && v <= hi)) out.push(`${k} ${v} outside ${lo}..${hi}`);
  };
  range("stanceWidth", 0.8, 1.3);
  range("crouch", 0, 1);
  range("openStance", 0, 1);
  range("tap", 0, 1.5);
  range("triggerSize", 0, 1.5);
  range("backlift", 0.6, 1.3);
  range("backliftArc", -1, 1);
  return out;
}

export function checkBowling(s: BowlingStyle): string[] {
  const out: string[] = [];
  const range = (k: keyof BowlingStyle, lo: number, hi: number) => {
    const v = s[k];
    if (!(v >= lo && v <= hi)) out.push(`${k} ${v} outside ${lo}..${hi}`);
  };
  range("runLength", 0.6, 1.4);
  range("pace", 0.85, 1.15);
  range("bound", 0.5, 1.5);
  range("frontOn", 0, 1);
  range("armAngle", 0, 0.6);
  range("frontArm", 0.6, 1.3);
  range("followThrough", 0.7, 1.3);
  range("crease", -0.3, 0.2);
  return out;
}
