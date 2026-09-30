import { beforeAll, describe, expect, it } from "vitest";
import { CricketWorld, initPhysics } from "./world";
import { buildDelivery, planFor } from "../match/bowling";
import { pathAt, predictPath, solveThrow } from "./predict";
import { v3 } from "./vec3";

beforeAll(async () => {
  await initPhysics();
});

describe("predictPath", () => {
  it("matches the live physics world down the pitch to within a few centimetres", () => {
    // The batsman aims the bat at this prediction, so it has to agree with
    // what the world then actually does — bounce included.
    const world = new CricketWorld();
    const d = buildDelivery(planFor("fast-medium", { targetLength: 5, seamAngle: 0.25 }));
    world.release(d);
    const path = predictPath(
      { position: d.position, velocity: d.velocity, spin: d.spin, seamAngle: d.seamAngle, shine: 1 },
      { pitch: world.pitch, outfield: world.outfield, maxTime: 0.7 }
    );
    let worst = 0;
    for (let i = 0; i < 150; i++) {
      world.step(1 / 240);
      const t = (i + 1) / 240;
      const p = pathAt(path, t);
      const b = world.ball.position;
      worst = Math.max(worst, Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("stops once the ball has come to rest on the outfield", () => {
    const path = predictPath(
      { position: v3(0, 0.5, 0), velocity: v3(0, 0, 12), spin: v3(), seamAngle: 0, shine: 0 },
      { pitch: { hardness: 0.6, friction: 0.5, seamDeviation: 0 }, outfield: { hardness: 0.3, friction: 0.2, seamDeviation: 0 }, maxTime: 30 }
    );
    const last = path[path.length - 1];
    expect(last.t).toBeLessThan(30);
    expect(Math.hypot(last.velocity.x, last.velocity.z)).toBeLessThan(0.5);
  });
});

describe("solveThrow", () => {
  const opts = {
    pitch: { hardness: 0.6, friction: 0.5, seamDeviation: 0 },
    outfield: { hardness: 0.3, friction: 0.2, seamDeviation: 0 },
  };

  it("lands a long flat throw in the keeper's gloves despite drag", () => {
    const from = v3(-30, 1.9, 25);
    const to = v3(0, 1.0, -11);
    const T = 2.0;
    const v = solveThrow(from, to, T, opts);
    const path = predictPath({ position: from, velocity: v, spin: v3(), seamAngle: 0, shine: 0 }, { ...opts, maxTime: T + 0.1 });
    const at = pathAt(path, T);
    expect(Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z)).toBeLessThan(0.1);
  });

  it("throws harder than the vacuum answer, because drag slows the ball", () => {
    const from = v3(0, 1.9, 40);
    const to = v3(0, 1.0, -11);
    const T = 2.0;
    const v = solveThrow(from, to, T, opts);
    const vacuumZ = (to.z - from.z) / T;
    expect(Math.abs(v.z)).toBeGreaterThan(Math.abs(vacuumZ));
  });
});
