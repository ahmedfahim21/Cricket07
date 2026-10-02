/**
 * Keyboard -> batting intent, or the separate bowling aim/pace/swing/lock intent.
 *
 * Held state (footwork, aim, leave, advance) is polled; the shot press is EDGE
 * triggered and consumed exactly once, because it is the timing event and a
 * held key must not re-trigger a shot every frame.
 *
 * The one thing worth knowing before changing this file: in Cricket 07 the
 * front- and back-foot keys are BOTH the held stance and the shot press. S held
 * through the run-up commits the front foot; S going down as the ball arrives is
 * the stroke. So `frontFoot`/`backFoot` are read twice, once as held state for
 * `footwork` and once as an edge for `shot`, and the shot's TYPE is read off
 * whatever direction/modifier is held at that instant (see `bindings.ts`).
 *
 * A gamepad source lands here later and produces the same `BattingIntent`; no
 * consumer downstream needs to know which device it came from.
 */

import {
  BattingIntent,
  Bindings,
  DEFAULT_BINDINGS,
  Footwork,
  ShotType,
} from "./bindings";

export class BattingController {
  private held = new Set<string>();
  private pendingShot: ShotType | null = null;
  /** Performance.now() of the pending shot press, for timing measurement. */
  private pendingShotAt = 0;
  private bindings: Bindings;
  private disposed = false;
  private restartPressed = false;
  private cameraPressed = false;
  private ballLinePressed = false;
  private bowlingLockPressed = false;

  constructor(bindings: Bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /**
   * True when the player is typing. The controller listens on window, so
   * without this it swallows Space and the arrow keys whenever any text input
   * on the page has focus.
   */
  private static isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    const activatesControl = (tag === "BUTTON" || tag === "A") && (e.code === "Space" || e.code === "Enter");
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || activatesControl || t.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (BattingController.isTyping(e)) return;
    // Space and the arrows scroll the page; the game owns them while playing.
    if (this.isBound(e.code)) e.preventDefault();

    // Ignore auto-repeat: holding the shot key must not fire repeatedly.
    if (e.repeat) return;
    this.held.add(e.code);

    const b = this.bindings;
    // The footwork keys are the shot. Which stroke it is depends on what else
    // is down at this instant, so it has to be resolved here and not on poll.
    if (b.frontFoot.includes(e.code) || b.backFoot.includes(e.code)) this.queueShot(this.shotType());
    else if (b.bowl.includes(e.code)) {
      // The same key starts a delivery when idle and locks one mid-run-up; the
      // engine reads whichever is meaningful for the phase it is in.
      this.restartPressed = true;
      this.bowlingLockPressed = true;
    } else if (b.camera.includes(e.code)) this.cameraPressed = true;
    else if (b.ballLine.includes(e.code)) this.ballLinePressed = true;
  };

  /**
   * Always clears, even mid-typing. If a keyup is skipped because focus moved
   * into a text field, the key sticks down forever and the batsman walks at
   * the bowler until the page is reloaded.
   */
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  /** Alt-tabbing away with keys down otherwise leaves them held. */
  private onBlur = () => {
    this.held.clear();
    this.pendingShot = null;
    this.restartPressed = false;
    this.cameraPressed = false;
    this.ballLinePressed = false;
    this.bowlingLockPressed = false;
  };

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((list) => list.includes(code));
  }

  /**
   * Which stroke the press means.
   *
   * Defend wins over loft when both are held: up arrow is the deliberate, safe
   * input and should never silently turn into a slog.
   */
  private shotType(): ShotType {
    const b = this.bindings;
    if (this.anyHeld(b.defend)) return "defensive";
    if (this.anyHeld(b.loft)) return "lofted";
    return "ground";
  }

  private queueShot(type: ShotType) {
    this.pendingShot = type;
    this.pendingShotAt = performance.now();
  }

  private anyHeld(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** Held-state snapshot, without consuming the pending shot press. */
  peek(): BattingIntent {
    const b = this.bindings;
    // Front wins if both are somehow down: it is the default stance, and a
    // stuck key should not quietly leave the batsman on the back foot.
    let footwork: Footwork = "none";
    if (this.anyHeld(b.frontFoot)) footwork = "front";
    else if (this.anyHeld(b.backFoot)) footwork = "back";

    const off = this.anyHeld(b.aimOff);
    const leg = this.anyHeld(b.aimLeg);
    const straight = this.anyHeld(b.straight);
    const advance = this.anyHeld(b.advance);

    return {
      footwork,
      aim: Number(leg) - Number(off),
      shot: this.pendingShot,
      // Resolved the same way a press would resolve it, so what the HUD shows
      // and what the press plays can never disagree.
      nextShot: this.shotType(),
      // Left or right ALONE is square of the wicket; adding down straightens it.
      square: (off || leg) && !straight,
      leave: this.anyHeld(b.leave),
      advance,
      // Pre-delivery, the same arrows walk the batsman about his crease. Coming
      // down the wicket is a forward move too, and overrides the arrows.
      moveX: Number(leg) - Number(off),
      moveForward: advance ? 1 : Number(this.anyHeld(b.defend)) - Number(straight),
    };
  }

  /**
   * Take the current intent AND consume any pending shot press.
   * Returns the press timestamp so the caller can measure timing against the
   * ball rather than against the frame it happened to be read on — at 60fps a
   * frame is 16ms, which is a whole timing band.
   */
  consume(): { intent: BattingIntent; shotAt: number } {
    const intent = this.peek();
    const shotAt = this.pendingShotAt;
    this.pendingShot = null;
    return { intent, shotAt };
  }

  consumeRestart(): boolean {
    const was = this.restartPressed;
    this.restartPressed = false;
    return was;
  }

  consumeCameraToggle(): boolean {
    const was = this.cameraPressed;
    this.cameraPressed = false;
    return was;
  }

  consumeBallLineToggle(): boolean {
    const was = this.ballLinePressed;
    this.ballLinePressed = false;
    return was;
  }

  /**
   * Bowling uses its own intent so aiming/locking can never trigger the AI's bat.
   *
   * The original's bowling keys are the same four: the arrows move the landing
   * marker, W and S are the quicker and slower ball, and A and D are the swing
   * or spin either way.
   */
  consumeBowling() {
    const b = this.bindings;
    const lock = this.bowlingLockPressed;
    this.bowlingLockPressed = false;
    return {
      x: Number(this.anyHeld(b.aimLeg)) - Number(this.anyHeld(b.aimOff)),
      forward: Number(this.anyHeld(b.defend)) - Number(this.anyHeld(b.straight)),
      pace: Number(this.anyHeld(b.backFoot)) - Number(this.anyHeld(b.frontFoot)),
      swing: Number(this.anyHeld(b.advance)) - Number(this.anyHeld(b.leave)),
      lock,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.held.clear();
  }
}
