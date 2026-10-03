import { DEFAULT_BOWLING } from "../anim/style";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, CricketWorld } from "../physics/world";
import { buildDelivery, planFor, previewBounce, type BowlerStyle } from "./bowling";
import { predictContact } from "./contact";
import { idealPressLead } from "./shot";
import { APPROACH, deliveryOrigin, simulateRelease } from "../anim/bowler";
import { makePlayer } from "../assets/kit";
import { CREASE_Z, POPPING_CREASE_OFFSET, STRIKER_STUMPS_Z } from "../dimensions";

beforeAll(initPhysics);

describe("shared delivery prediction", () => {
  it("omits a pitching marker for a ball that passes the striker before bouncing", () => {
    const world = new CricketWorld();
    const release = { position: { x: 0, y: 2, z: STRIKER_STUMPS_Z + 1 }, velocity: { x: 0, y: 0, z: -25 }, spin: { x: 0, y: 0, z: 0 }, seamAngle: 0 };
    expect(previewBounce(release, world.pitch, world.outfield)).toBeNull();
    world.dispose();
  });
  it("places the locked marker within 15 cm of actual pitches at varied frame rates", () => {
    const rig = makePlayer({ role: "bowler" });
    const frontFoot = CREASE_Z - POPPING_CREASE_OFFSET + 0.2;
    for (const style of ["medium", "fast-medium", "fast", "off-spin", "leg-spin"] as BowlerStyle[]) {
      const approach = APPROACH[style];
      const origin = deliveryOrigin(approach, frontFoot);
      const look = new THREE.Vector3(0, 0.7, STRIKER_STUMPS_Z);
      const preview = simulateRelease(rig, approach, origin, -0.45, look).hand;
      const plan = planFor(style, { targetLength: 4, seamAngle: 0.2 });
      const snapshot = (hand: THREE.Vector3) => ({ ...buildDelivery({ ...plan, releaseX: hand.x, releaseHeight: hand.y, releaseZ: hand.z }), shine: 1 });
      for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
        const world = new CricketWorld();
        const marker = previewBounce(snapshot(preview), world.pitch, world.outfield)!;
        const liveHand = simulateRelease(rig, approach, origin, -0.45, look, DEFAULT_BOWLING, dt).hand;
        world.release(snapshot(liveHand));
        for (let i = 0; i < 300 && !world.hasPitched; i++) world.step(dt);
        const actual = world.lastBounce!.position;
        expect(Math.hypot(actual.x - marker.x, actual.z - marker.z), `${style} at ${1 / dt} fps`).toBeLessThan(0.15);
        world.dispose();
      }
    }
  });
  it("uses the moved contact plane for both timing and arrival", () => {
    const world = new CricketWorld();
    const ball = { ...buildDelivery(planFor("medium")), shine: 1 };
    const normal = predictContact(ball, world, STRIKER_STUMPS_Z + 1)!;
    const forward = predictContact(ball, world, STRIKER_STUMPS_Z + 1.6)!;
    expect(forward.hit.t).toBeLessThan(normal.hit.t);
    expect(normal.timingError).toBeCloseTo(idealPressLead(normal.speed) - normal.hit.t);
    expect(predictContact({ ...ball, position: { x: 0, y: 1, z: STRIKER_STUMPS_Z } }, world, STRIKER_STUMPS_Z + 1)).toBeNull();
    world.dispose();
  });
});
