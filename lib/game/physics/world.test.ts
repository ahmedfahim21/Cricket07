/**
 * End-to-end physics: the bowling machine.
 *
 * These drive the real Rapier world with no renderer, firing deliveries down
 * the pitch and asserting where and when they arrive. This is the milestone
 * check that drag, Magnus, swing, the bounce, the aiming solver and the 240 Hz
 * stepping all compose into something that behaves like cricket rather than
 * merely compiling.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CricketWorld, initPhysics, type DeliveryRelease } from "./world";
import { classifyLength } from "./pitch";
import { buildDelivery, planFor } from "../match/bowling";
import { BALL_RADIUS, CREASE_Z } from "../dimensions";

beforeAll(async () => {
  await initPhysics();
});

/** Run a delivery until it reaches the striker's crease. */
function bowl(world: CricketWorld, d: DeliveryRelease) {
  world.resetStumps();
  world.release(d);

  let time = 0;
  let arrivalHeight = 0;
  let arrivalX = 0;
  let arrived = false;

  for (let i = 0; i < 2000 && time < 4; i++) {
    world.step(1 / 240);
    time += 1 / 240;
    if (world.ball.position.z <= -CREASE_Z) {
      arrived = true;
      arrivalHeight = world.ball.position.y;
      arrivalX = world.ball.position.x;
      break;
    }
  }

  return {
    arrived,
    time,
    arrivalHeight,
    arrivalX,
    bounce: world.lastBounce,
    pitched: world.hasPitched,
  };
}

describe("bowling machine", () => {
  let world: CricketWorld;

  beforeEach(() => {
    world = new CricketWorld();
  });

  it("delivers a ball that pitches and reaches the striker", () => {
    const r = bowl(world, buildDelivery(planFor("fast-medium")));
    expect(r.arrived).toBe(true);
    expect(r.pitched).toBe(true);
    expect(r.bounce).not.toBeNull();
  });

  it("pitches where it was aimed, to within 40cm", () => {
    for (const targetLength of [2, 4, 5, 6, 8]) {
      const r = bowl(world, buildDelivery(planFor("fast-medium", { targetLength })));
      expect(r.bounce).not.toBeNull();
      expect(Math.abs(r.bounce!.lengthFromStumps - targetLength)).toBeLessThan(0.4);
    }
  });

  it("hits the requested length band for every style", () => {
    for (const style of ["fast", "fast-medium", "medium", "off-spin", "leg-spin"] as const) {
      const r = bowl(world, buildDelivery(planFor(style, { targetLength: 5 })));
      expect(classifyLength(r.bounce!.lengthFromStumps)).toBe("good");
    }
  });

  it("takes a realistic time to travel the pitch", () => {
    // 22 yards at ~35 m/s is a bit under 0.7s. Outside 0.4-1.2 means the
    // units are wrong somewhere.
    const r = bowl(world, buildDelivery(planFor("fast-medium")));
    expect(r.time).toBeGreaterThan(0.4);
    expect(r.time).toBeLessThan(1.2);
  });

  it("gets a spinner to the batsman slower than a quick", () => {
    const quick = bowl(world, buildDelivery(planFor("fast")));
    const spin = bowl(world, buildDelivery(planFor("leg-spin")));
    expect(spin.time).toBeGreaterThan(quick.time);
  });

  it("arrives at a height the batsman could actually play", () => {
    const r = bowl(world, buildDelivery(planFor("fast-medium", { targetLength: 5 })));
    expect(r.arrivalHeight).toBeGreaterThan(BALL_RADIUS);
    expect(r.arrivalHeight).toBeLessThan(1.6);
  });

  it("brings a short ball through higher than a full one", () => {
    const full = bowl(world, buildDelivery(planFor("fast-medium", { targetLength: 2 })));
    const short = bowl(world, buildDelivery(planFor("fast-medium", { targetLength: 9 })));
    expect(short.arrivalHeight).toBeGreaterThan(full.arrivalHeight);
  });

  it("never lets the ball fall through the pitch", () => {
    world.release(buildDelivery(planFor("fast")));
    for (let i = 0; i < 900; i++) {
      world.step(1 / 240);
      expect(world.ball.position.y).toBeGreaterThan(-0.01);
    }
  });

  it("swings an angled seam toward the leg side, and reverses with the seam", () => {
    const plan = planFor("fast-medium", { targetLength: 5 });
    const straight = bowl(world, buildDelivery({ ...plan, seamAngle: 0 }));
    const inswing = bowl(world, buildDelivery({ ...plan, seamAngle: Math.PI / 9 }));
    const outswing = bowl(world, buildDelivery({ ...plan, seamAngle: -Math.PI / 9 }));

    expect(inswing.arrivalX).toBeGreaterThan(straight.arrivalX);
    expect(outswing.arrivalX).toBeLessThan(straight.arrivalX);
  });

  it("moves a swinging ball a visible but not absurd distance", () => {
    const plan = planFor("fast-medium", { targetLength: 5 });
    const straight = bowl(world, buildDelivery({ ...plan, seamAngle: 0 }));
    const inswing = bowl(world, buildDelivery({ ...plan, seamAngle: Math.PI / 9 }));
    const movement = inswing.arrivalX - straight.arrivalX;
    expect(movement).toBeGreaterThan(0.08);
    expect(movement).toBeLessThan(1.2);
  });

  it("turns a leg-break away from a right-hander and an off-break into them", () => {
    // Leg spin turns leg-to-off, i.e. AWAY from a right-hander, toward -X.
    // Off spin turns off-to-leg, into them, toward +X. Getting these the
    // wrong way round is the single easiest thing to do in a cricket game.
    const leg = bowl(world, buildDelivery(planFor("leg-spin", { targetLength: 5 })));
    const off = bowl(world, buildDelivery(planFor("off-spin", { targetLength: 5 })));

    expect(leg.bounce!.deviation).toBeLessThan(0); // toward the off side, -X
    expect(off.bounce!.deviation).toBeGreaterThan(0); // toward the leg side, +X
    expect(off.arrivalX).toBeGreaterThan(leg.arrivalX);
  });

  it("turns the ball further on a gripping pitch", () => {
    const plan = planFor("off-spin", { targetLength: 5 });

    world.pitch = { ...world.pitch, friction: 0.1 };
    const skiddy = bowl(world, buildDelivery(plan));

    world.pitch = { ...world.pitch, friction: 1 };
    const gripping = bowl(world, buildDelivery(plan));

    expect(Math.abs(gripping.bounce!.deviation)).toBeGreaterThan(
      Math.abs(skiddy.bounce!.deviation)
    );
  });

  it("is deterministic — the same delivery twice gives the same result", () => {
    const d = buildDelivery(planFor("fast-medium", { seamAngle: Math.PI / 12 }));
    const a = bowl(world, d);
    const b = bowl(world, d);
    expect(b.arrivalX).toBeCloseTo(a.arrivalX, 5);
    expect(b.arrivalHeight).toBeCloseTo(a.arrivalHeight, 5);
    expect(b.bounce!.lengthFromStumps).toBeCloseTo(a.bounce!.lengthFromStumps, 5);
  });

  it("loses pace off the pitch", () => {
    world.release(buildDelivery(planFor("fast-medium")));
    let speedBefore = 0;
    for (let i = 0; i < 1000; i++) {
      const wasPitched = world.hasPitched;
      if (!wasPitched) speedBefore = Math.abs(world.ball.velocity.z);
      world.step(1 / 240);
      if (!wasPitched && world.hasPitched) {
        expect(Math.abs(world.ball.velocity.z)).toBeLessThan(speedBefore);
        return;
      }
    }
    throw new Error("delivery never pitched");
  });
});
