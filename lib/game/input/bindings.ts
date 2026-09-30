/**
 * The control scheme, in one place.
 *
 * Cricket 07's batting is three simultaneous decisions, and the scheme has to
 * keep them separable:
 *
 *   1. FOOTWORK  — commit forward or back, before you know the length
 *   2. DIRECTION — where you are trying to hit it
 *   3. SHOT TYPE — defend, along the ground, or over the top
 *
 * and then the fourth thing, TIMING, which is not a binding at all: it is
 * *when* the shot key goes down relative to the ball. That is why shot type is
 * on its own keys rather than being a modifier — the press has to be the
 * timing event.
 *
 * Everything here is data. `controller.ts` turns key state into the same
 * `BattingIntent` shape a gamepad will later produce, so adding pad support
 * touches that file and nothing downstream.
 */

export type ShotType = "defensive" | "ground" | "lofted";
export type Footwork = "front" | "back" | "none";

export interface Bindings {
  frontFoot: string[];
  backFoot: string[];
  aimOff: string[];
  aimLeg: string[];
  defensive: string[];
  ground: string[];
  lofted: string[];
  /** Held to play the shot squarer; released, shots go straighter. */
  square: string[];
  restart: string[];
  camera: string[];
}

/**
 * Default keyboard layout.
 *
 * Footwork and aim sit on the arrow keys because they are held; shot type sits
 * under the left hand on Z/X/C so the timing press is a separate finger from
 * the direction hold and the two never fight for the same key.
 */
export const DEFAULT_BINDINGS: Bindings = {
  frontFoot: ["ArrowUp", "KeyW"],
  backFoot: ["ArrowDown", "KeyS"],
  aimOff: ["ArrowLeft", "KeyA"],
  aimLeg: ["ArrowRight", "KeyD"],
  defensive: ["KeyZ"],
  ground: ["KeyX", "Space"],
  lofted: ["KeyC"],
  square: ["ShiftLeft", "ShiftRight"],
  restart: ["KeyR"],
  camera: ["KeyV"],
};

/** What the batting logic consumes. A gamepad will produce this too. */
export interface BattingIntent {
  footwork: Footwork;
  /**
   * Aim across the ground, -1 (fully off side) to +1 (fully leg side), for a
   * right-hander. Handedness is applied downstream, not here.
   */
  aim: number;
  /** Set on the frame the shot key goes down; null on every other frame. */
  shot: ShotType | null;
  square: boolean;
}

export const NEUTRAL_INTENT: BattingIntent = {
  footwork: "none",
  aim: 0,
  shot: null,
  square: false,
};

/** Human-readable control list, for the on-screen help panel. */
export const CONTROL_HELP: { keys: string; action: string }[] = [
  { keys: "↑ / ↓", action: "Front foot / back foot" },
  { keys: "← / →", action: "Aim off side / leg side" },
  { keys: "Z", action: "Defend" },
  { keys: "X or Space", action: "Ground shot" },
  { keys: "C", action: "Loft" },
  { keys: "Shift", action: "Play squarer" },
  { keys: "R", action: "Next delivery" },
  { keys: "V", action: "Batting / TV camera" },
];
