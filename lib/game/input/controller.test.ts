import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BattingController } from "./controller";
import { ADVANCE, moveAtCrease } from "./movement";

let events: EventTarget;
let controller: BattingController;
function key(type: string, code: string) {
  const event = new Event(type);
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
  events.dispatchEvent(event);
}
const down = (...codes: string[]) => codes.forEach((c) => key("keydown", c));
const up = (...codes: string[]) => codes.forEach((c) => key("keyup", c));

beforeEach(() => {
  events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("performance", { now: () => 0 });
  controller = new BattingController();
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });

describe("Cricket 07 batting controls", () => {
  it("makes the footwork key the shot press, and holds the stance too", () => {
    down("KeyS");
    // One press is both: the stance is held state, the stroke is the edge.
    expect(controller.peek().footwork).toBe("front");
    expect(controller.consume().intent.shot).toBe("ground");
    // Consumed once only; the stance survives because the key is still down.
    expect(controller.peek().shot).toBeNull();
    expect(controller.peek().footwork).toBe("front");

    up("KeyS");
    down("KeyW");
    expect(controller.peek().footwork).toBe("back");
    expect(controller.consume().intent.shot).toBe("ground");
  });

  it("reads the shot type off what is held at the instant of the press", () => {
    down("ArrowUp");
    expect(controller.consume().intent.shot).toBeNull();
    down("KeyS");
    expect(controller.consume().intent.shot).toBe("defensive");

    up("ArrowUp", "KeyS");
    down("ShiftLeft", "KeyW");
    expect(controller.consume().intent.shot).toBe("lofted");

    // Defend beats loft: the deliberate input must never become a slog.
    up("KeyW");
    down("ArrowUp", "KeyS");
    expect(controller.consume().intent.shot).toBe("defensive");
  });

  it("reports the armed stroke every frame, not only on the press", () => {
    // The whole point: a held modifier has to be visible before you commit, or
    // a working key is indistinguishable from an unbound one.
    expect(controller.peek().nextShot).toBe("ground");
    down("ShiftLeft");
    expect(controller.peek()).toMatchObject({ nextShot: "lofted", shot: null });
    down("ArrowUp");
    expect(controller.peek().nextShot).toBe("defensive");
    up("ArrowUp", "ShiftLeft");
    expect(controller.peek().nextShot).toBe("ground");

    // And it always agrees with what a press would actually queue.
    down("ShiftLeft");
    const armed = controller.peek().nextShot;
    down("KeyS");
    expect(controller.consume().intent.shot).toBe(armed);
  });

  it("holding the modifier AFTER the press cannot change the stroke", () => {
    down("KeyS");
    down("ShiftLeft");
    expect(controller.consume().intent.shot).toBe("ground");
  });

  it("aims on the arrows, and the down arrow straightens the stroke", () => {
    down("ArrowRight");
    expect(controller.peek()).toMatchObject({ aim: 1, square: true });
    down("ArrowDown");
    expect(controller.peek()).toMatchObject({ aim: 1, square: false });

    up("ArrowRight", "ArrowDown");
    down("ArrowLeft");
    expect(controller.peek()).toMatchObject({ aim: -1, square: true });
    // Straight down the ground: no lateral aim and nothing square about it.
    up("ArrowLeft");
    down("ArrowDown");
    expect(controller.peek()).toMatchObject({ aim: 0, square: false });
  });

  it("walks the crease on the same arrows that aim the stroke", () => {
    down("ArrowLeft", "ArrowUp");
    expect(controller.peek()).toMatchObject({ moveX: -1, moveForward: 1, aim: -1 });
    up("ArrowUp");
    down("ArrowDown");
    expect(controller.peek()).toMatchObject({ moveX: -1, moveForward: -1 });
  });

  it("reports leaving it and coming down the wicket", () => {
    down("KeyA");
    expect(controller.peek()).toMatchObject({ leave: true, advance: false });
    // Leaving queues no stroke of its own.
    expect(controller.consume().intent.shot).toBeNull();

    up("KeyA");
    down("KeyD");
    // Charging is a forward move, and overrides a held back arrow.
    expect(controller.peek()).toMatchObject({ leave: false, advance: true, moveForward: 1 });
    down("ArrowDown");
    expect(controller.peek().moveForward).toBe(1);
  });

  it("puts bowling on the same keys without ever queueing a stroke", () => {
    down("ArrowLeft", "ArrowUp", "KeyW", "KeyD");
    expect(controller.consumeBowling()).toEqual({ x: -1, forward: 1, pace: 1, swing: 1, lock: false });

    up("KeyW", "KeyD");
    down("KeyS", "KeyA");
    expect(controller.consumeBowling()).toMatchObject({ pace: -1, swing: -1 });

    // Space both starts a delivery and locks one; the engine picks by phase.
    down("Space");
    expect(controller.consumeBowling().lock).toBe(true);
    expect(controller.consumeBowling().lock).toBe(false);
    expect(controller.consumeRestart()).toBe(true);
    expect(controller.consumeRestart()).toBe(false);
  });

  it("toggles the camera and the ball line once per press", () => {
    down("KeyC", "KeyL");
    expect(controller.consumeCameraToggle()).toBe(true);
    expect(controller.consumeCameraToggle()).toBe(false);
    expect(controller.consumeBallLineToggle()).toBe(true);
    expect(controller.consumeBallLineToggle()).toBe(false);
  });

  it("clears everything on blur, so no key is left stuck down", () => {
    down("KeyD", "ArrowLeft", "KeyS", "Space", "KeyC");
    events.dispatchEvent(new Event("blur"));
    expect(controller.consume().intent).toMatchObject({
      moveX: 0, moveForward: 0, aim: 0, footwork: "none", shot: null, leave: false, advance: false,
    });
    expect(controller.consumeRestart()).toBe(false);
    expect(controller.consumeCameraToggle()).toBe(false);
    expect(controller.consumeBowling()).toEqual({ x: 0, forward: 0, pace: 0, swing: 0, lock: false });
  });
});

describe("crease movement", () => {
  it("normalizes diagonals, mirrors cameras and clamps a shuffle", () => {
    const diagonal = moveAtCrease({ x: 0, z: 0 }, 1, 1, 0.1, 1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(0.12);
    expect(moveAtCrease({ x: 0, z: 0 }, 1, 0, 0.1, -1).x).toBeCloseTo(-0.12);
    expect(moveAtCrease({ x: 0, z: 0 }, 1, 1, 10, 1)).toEqual({ x: 0.65, z: 0.6 });
    expect(moveAtCrease({ x: 0, z: 0 }, -1, -1, 10, 1)).toEqual({ x: -0.65, z: -0.3 });
  });

  it("charges further and faster down the wicket than a shuffle", () => {
    expect(moveAtCrease({ x: 0, z: 0 }, 0, 1, 0.1, 1, true).z).toBeCloseTo(0.26);
    expect(moveAtCrease({ x: 0, z: 0 }, 0, 1, 10, 1, true).z).toBeCloseTo(ADVANCE);
  });

  it("keeps the ground made when the charge key is let go", () => {
    const charged = moveAtCrease({ x: 0, z: 0 }, 0, 1, 10, 1, true);
    // Releasing D must not yank him back inside the crease.
    expect(moveAtCrease(charged, 0, 0, 1 / 60, 1).z).toBeCloseTo(ADVANCE);
    // Walking back is then his own input, and the normal limit applies again.
    const back = moveAtCrease(charged, 0, -1, 10, 1);
    expect(back.z).toBeCloseTo(-0.3);
    expect(moveAtCrease(back, 0, 1, 10, 1).z).toBeCloseTo(0.6);
  });
});
