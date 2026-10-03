/**
 * The control scheme: Cricket 07's own keyboard layout.
 *
 * ---------------------------------------------------------------------------
 * THE ORIGINAL LAYOUT
 * ---------------------------------------------------------------------------
 * Cricket 07 on PC puts batting on two groups of keys and nothing else:
 *
 *   S            play the shot off the FRONT foot
 *   W            play the shot off the BACK foot
 *   A            leave it / duck
 *   D            come down the wicket
 *   arrows       where you are hitting it
 *   Shift (hold) hit over the top
 *
 * The important and easily-missed part is that S and W are not modifiers: they
 * ARE the shot. One key press commits the footwork, the swing and the timing at
 * once, which is why the original feels like it does — you cannot pre-select a
 * stroke and then release it, you choose a foot and go.
 *
 * The arrows do double duty, exactly as the original's left stick does: before
 * the ball is bowled they walk the batsman about in his crease, and once it is
 * out of the hand they are the shot's direction. Nothing switches them over by
 * hand; the delivery's phase does it (see `engine.ts`, which reads movement in
 * `updateRunup` and aim in `updateFlight`).
 *
 * ---------------------------------------------------------------------------
 * HOW THE ORIGINAL'S KEYS MAP ONTO THIS GAME'S FOUR DECISIONS
 * ---------------------------------------------------------------------------
 * This engine resolves a shot from footwork, direction, shot type and timing
 * (`match/shot.ts`). The original has no dedicated shot-type keys, so type is
 * read off the direction held at the moment of the press, which is how the
 * original behaves too:
 *
 *   up arrow + S/W     DEFEND        — vertical bat, no power
 *   Shift   + S/W      LOFT          — over the infield
 *   anything else      GROUND        — along the turf
 *
 * and "squareness" — whether a stroke goes square of the wicket or straighter —
 * comes from whether the down arrow is held with the direction:
 *
 *   left/right alone        square of the wicket (cut, pull)
 *   left/right + down       straighter (cover drive, on drive)
 *   down alone              straight down the ground
 *
 * So all four decisions sit on the original's keys, with nothing invented.
 *
 * ---------------------------------------------------------------------------
 * KEYS THAT ARE OURS, NOT THE ORIGINAL'S
 * ---------------------------------------------------------------------------
 * Space / Enter bowl the next ball and lock a delivery, which is the original's
 * confirm. R and C are additions on keys the original leaves free: a restart
 * alias and the camera. They are listed apart in the help so it stays clear
 * which half is authentic.
 *
 * Everything here is data. `controller.ts` turns key state into the same
 * `BattingIntent` shape a gamepad will later produce, so adding pad support
 * touches that file and nothing downstream.
 */

export type ShotType = "defensive" | "ground" | "lofted";
export type Footwork = "front" | "back" | "none";

export interface Bindings {
  /** Walks across the crease during the run-up; aims off side after release. */
  aimOff: string[];
  /** Walks across the crease during the run-up; aims leg side after release. */
  aimLeg: string[];
  /** Walks down the wicket during the run-up; plays straighter after release. */
  straight: string[];
  /** Walks back toward the stumps during the run-up; defends after release. */
  defend: string[];
  /** Front-foot shot. Held it commits the stance, pressed it plays the stroke. */
  frontFoot: string[];
  /** Back-foot shot. Same: hold to commit, press to play. */
  backFoot: string[];
  /** Leave the ball alone. */
  leave: string[];
  /** Advance down the wicket to the bowler. */
  advance: string[];
  /** Held at the press, the stroke goes over the infield instead of along it. */
  loft: string[];
  /** Start the next delivery; while bowling, lock line, length and pace. */
  bowl: string[];
  camera: string[];
}

export const DEFAULT_BINDINGS: Bindings = {
  aimOff: ["ArrowLeft"],
  aimLeg: ["ArrowRight"],
  straight: ["ArrowDown"],
  defend: ["ArrowUp"],
  frontFoot: ["KeyS"],
  backFoot: ["KeyW"],
  leave: ["KeyA"],
  advance: ["KeyD"],
  loft: ["ShiftLeft", "ShiftRight"],
  bowl: ["Space", "Enter", "NumpadEnter", "KeyR"],
  camera: ["KeyC"],
};

/** What the batting logic consumes. A gamepad will produce this too. */
export interface BattingIntent {
  moveX: number;
  moveForward: number;
  footwork: Footwork;
  /**
   * Aim across the ground, -1 (fully off side) to +1 (fully leg side), for a
   * right-hander. Handedness is applied downstream, not here.
   */
  aim: number;
  /** Set on the frame the shot key goes down; null on every other frame. */
  shot: ShotType | null;
  /**
   * The stroke a press WOULD play right now, given what is held.
   *
   * Unlike `shot` this is set on every frame. It exists so the HUD can show the
   * player which stroke he has armed before he commits to it — without it, a
   * modifier like Shift is invisible until the ball is already in the air, and
   * a key that shows no sign of being read feels unbound.
   */
  nextShot: ShotType;
  square: boolean;
  /** True while the leave key is held: no stroke will be offered. */
  leave: boolean;
  /** True while charging down the wicket. */
  advance: boolean;
}

export const NEUTRAL_INTENT: BattingIntent = {
  moveX: 0,
  moveForward: 0,
  footwork: "none",
  aim: 0,
  shot: null,
  nextShot: "ground",
  square: false,
  leave: false,
  advance: false,
};

/** The original's keys. Shown first, and on their own. */
export const CONTROL_HELP: { keys: string; action: string }[] = [
  { keys: "S", action: "Front foot shot" },
  { keys: "W", action: "Back foot shot" },
  { keys: "↑ + S / W", action: "Defend" },
  { keys: "Shift + S / W", action: "Loft it" },
  { keys: "← / →", action: "Square of the wicket" },
  { keys: "↓ + ← / →", action: "Straighter" },
  { keys: "A", action: "Leave it" },
  { keys: "D", action: "Down the wicket (run-up)" },
  { keys: "← ↑ ↓ →", action: "Move in the crease (run-up)" },
];

export const BOWLING_CONTROL_HELP = [
  { keys: "← ↑ ↓ →", action: "Aim line and length" },
  { keys: "↑ / ↓", action: "Fuller / shorter" },
  { keys: "W / S", action: "Quicker / slower ball" },
  { keys: "A / D", action: "Swing it away / in" },
  { keys: "Space", action: "Lock the delivery" },
];

/** Ours, not the original's: listed apart so the distinction stays honest. */
export const EXTRA_CONTROL_HELP = [
  { keys: "Space / Enter", action: "Bowl the next ball" },
  { keys: "C", action: "Batting / TV camera" },
];
