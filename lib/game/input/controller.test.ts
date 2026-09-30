import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BattingController } from "./controller";
import { moveAtCrease } from "./movement";

let events: EventTarget;
let controller: BattingController;
function key(type: string, code: string) {
  const event = new Event(type);
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
  events.dispatchEvent(event);
}
beforeEach(() => {
  events = new EventTarget();
  vi.stubGlobal("window", events);
  controller = new BattingController();
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });

describe("movement input", () => {
  it("keeps WASD independent of shot aim and footwork", () => {
    key("keydown", "KeyA"); key("keydown", "KeyW");
    expect(controller.peek()).toMatchObject({ moveX: -1, moveForward: 1, aim: 0, footwork: "none" });
    key("keydown", "ArrowRight"); key("keydown", "ArrowDown");
    expect(controller.peek()).toMatchObject({ moveX: -1, moveForward: 1, aim: 1, footwork: "back" });
  });
  it("clears movement and queued shots on blur", () => {
    key("keydown", "KeyD"); key("keydown", "KeyC");
    events.dispatchEvent(new Event("blur"));
    expect(controller.consume().intent).toMatchObject({ moveX: 0, shot: null });
  });
  it("consumes a shot only once", () => {
    key("keydown", "KeyC");
    expect(controller.consume().intent.shot).toBe("lofted");
    expect(controller.consume().intent.shot).toBeNull();
  });
  it("normalizes diagonals, mirrors cameras and clamps crease movement", () => {
    const diagonal = moveAtCrease({ x: 0, z: 0 }, 1, 1, 0.1, 1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(0.12);
    expect(moveAtCrease({ x: 0, z: 0 }, 1, 0, 0.1, -1).x).toBeCloseTo(-0.12);
    expect(moveAtCrease({ x: 0, z: 0 }, 1, 1, 10, 1)).toEqual({ x: 0.65, z: 0.6 });
    expect(moveAtCrease({ x: 0, z: 0 }, -1, -1, 10, 1)).toEqual({ x: -0.65, z: -0.3 });
  });
});
