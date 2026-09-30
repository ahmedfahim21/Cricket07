/**
 * Keyboard -> BattingIntent.
 *
 * Held state (footwork, aim, square) is polled; the shot press is EDGE
 * triggered and consumed exactly once, because it is the timing event and a
 * held key must not re-trigger a shot every frame.
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
    if (b.defensive.includes(e.code)) this.queueShot("defensive");
    else if (b.ground.includes(e.code)) this.queueShot("ground");
    else if (b.lofted.includes(e.code)) this.queueShot("lofted");
    else if (b.restart.includes(e.code)) this.restartPressed = true;
    else if (b.camera.includes(e.code)) this.cameraPressed = true;
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
  };

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((list) => list.includes(code));
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
    let footwork: Footwork = "none";
    if (this.anyHeld(b.frontFoot)) footwork = "front";
    else if (this.anyHeld(b.backFoot)) footwork = "back";

    let aim = 0;
    if (this.anyHeld(b.aimOff)) aim -= 1;
    if (this.anyHeld(b.aimLeg)) aim += 1;

    return {
      footwork, aim, shot: this.pendingShot, square: this.anyHeld(b.square),
      moveX: Number(this.anyHeld(b.moveRight)) - Number(this.anyHeld(b.moveLeft)),
      moveForward: Number(this.anyHeld(b.moveForward)) - Number(this.anyHeld(b.moveBack)),
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.held.clear();
  }
}
