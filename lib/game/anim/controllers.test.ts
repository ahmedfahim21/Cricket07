import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BATTING_KIT, FIELDING_KIT, makePlayer } from "../assets/kit";
import type { Footwork, ShotType } from "../input/bindings";
import { applyPose, C, makePose, sweetSpot } from "./pose";
import { BatsmanAnimator, CONTACT_X, readyBatPose } from "./batsman";
import { APPROACH, deliveryOrigin, simulateRelease } from "./bowler";
import { FielderAnimator, SPRINT } from "./fielder";
import { RunnerAnimator } from "./runner";

const DT = 1 / 60;

function run(update: (dt: number) => void, seconds: number, until?: () => boolean): number {
  let t = 0;
  while (t < seconds) {
    update(DT);
    t += DT;
    if (until?.()) break;
  }
  return t;
}

/** A batsman waiting at the top of his backlift, as he is when the press comes. */
function batsmanInBacklift(footwork: Footwork): BatsmanAnimator {
  const b = new BatsmanAnimator();
  b.look.set(-18, 1.8, 0);
  run((dt) => b.update(dt), 0.4);
  b.triggerMove(true);
  b.pickUp(true);
  b.setFootwork(footwork === "front" ? 1 : footwork === "back" ? -1 : 0);
  run((dt) => b.update(dt), 0.5);
  return b;
}

describe("BatsmanAnimator", () => {
  it("lifts and grounds the bat repeatedly, then stops tapping for the delivery", () => {
    const sample = (time: number, trigger = 0) => readyBatPose(makePose(), {
      time, trigger, footwork: 0, lift: 0, look: new THREE.Vector3(-18, 1.8, 0),
    });
    const grounded = sample(0);
    const raised = sample(1.35 * 0.48);
    expect(raised[C.gripY] - grounded[C.gripY]).toBeCloseTo(0.24);
    expect(sample(1.35 * 0.8)[C.gripY]).toBeCloseTo(grounded[C.gripY]);
    expect(sample(1.35 * 1.48)[C.gripY]).toBeCloseTo(raised[C.gripY]);
    // At the bound, the hands settle regardless of where the tap cycle was.
    expect(sample(1.35 * 0.48, 1)[C.gripY]).toBeCloseTo(sample(0, 1)[C.gripY]);
    expect(raised[C.footLX]).toBe(grounded[C.footLX]);
    expect(raised[C.footRX]).toBe(grounded[C.footRX]);
  });
  // The engine only strikes the ball if the bat's middle is within 25 cm of
  // it at the contact instant, so every reachable contact the game can ask
  // for has to land well inside that.
  const rig = makePlayer({ role: "batsman", colours: BATTING_KIT });
  const cases: { footwork: Footwork; type: ShotType; y: number; z: number; exit: number; downswing: number }[] = [];
  for (const footwork of ["front", "none", "back"] as Footwork[]) {
    for (const type of ["defensive", "ground", "lofted"] as ShotType[]) {
      for (const y of [0.2, 0.5, 0.9]) {
        for (const z of [-0.6, -0.35, -0.1]) {
          for (const exit of [-0.6, 0, 0.6]) {
            cases.push({ footwork, type, y, z, exit, downswing: 0.18 });
          }
        }
      }
    }
  }

  it("puts the bat's middle on the contact point at the contact instant", () => {
    const pose = makePose();
    let worst = 0;
    let worstCase = "";
    for (const c of cases) {
      const b = batsmanInBacklift(c.footwork);
      const contact = new THREE.Vector3(CONTACT_X[c.footwork], c.y, c.z);
      b.play({ type: c.type, footwork: c.footwork, contact, exitDirection: c.exit, downswing: c.downswing, look: contact }, rig);
      applyPose(rig, b.contactPose(pose));
      const gap = sweetSpot(rig).distanceTo(contact);
      if (gap > worst) {
        worst = gap;
        worstCase = JSON.stringify(c);
      }
    }
    expect(worst, worstCase).toBeLessThan(0.06);
  });

  it("reaches the ball on a quick and a slow downswing alike", () => {
    const pose = makePose();
    for (const downswing of [0.1, 0.25, 0.45]) {
      const b = batsmanInBacklift("front");
      const contact = new THREE.Vector3(CONTACT_X.front, 0.35, -0.3);
      b.play({ type: "ground", footwork: "front", contact, exitDirection: 0, downswing, look: contact }, rig);
      expect(b.contactT).toBeCloseTo(downswing, 5);
      applyPose(rig, b.contactPose(pose));
      expect(sweetSpot(rig).distanceTo(contact)).toBeLessThan(0.06);
    }
  });

  it("refuses to report a contact pose when no shot is being played", () => {
    const b = new BatsmanAnimator();
    expect(() => b.contactPose(makePose())).toThrow();
  });
});

describe("FielderAnimator", () => {
  it("arrives at a short sideways target and turns to the facing he was given", () => {
    // Regression: steering at the (sideways) heading while turning to the
    // final facing deadlocked him in "move" at zero speed.
    const f = new FielderAnimator(makePlayer({ role: "keeper", colours: FIELDING_KIT }), true);
    f.place(new THREE.Vector3(0, 0, -19), Math.PI);
    f.moveTo(new THREE.Vector3(0.6, 0, -19), SPRINT, "move", Math.PI);
    run((dt) => f.update(dt), 4, () => f.state === "stand");
    expect(f.state).toBe("stand");
    expect(f.world.distanceTo(new THREE.Vector3(0.6, 0, -19))).toBeLessThan(0.2);
    expect(Math.abs(Math.atan2(Math.sin(f.yaw - Math.PI), Math.cos(f.yaw - Math.PI)))).toBeLessThan(0.06);
  });

  it("gets his gloves down to a ball arriving at boot height", () => {
    // Regression: the catch pose floored the hands at 0.5 m, so a pace ball
    // reaching a standing-back keeper on its way down went under his gloves.
    const k = new FielderAnimator(makePlayer({ role: "keeper", colours: FIELDING_KIT }), true);
    k.place(new THREE.Vector3(0, 0, -19), Math.PI);
    const take = new THREE.Vector3(0.2, 0.1, -18.6);
    k.catchAt(take);
    run((dt) => k.update(dt), 0.2);
    expect(k.glovesWorld(new THREE.Vector3()).distanceTo(take)).toBeLessThan(0.15);
  });

  it("sprints 25 m inside his limits and stops on the spot", () => {
    const f = new FielderAnimator(makePlayer({ role: "fielder", colours: FIELDING_KIT }));
    f.place(new THREE.Vector3(0, 0, 0), 0);
    const target = new THREE.Vector3(0, 0, -25);
    f.moveTo(target, SPRINT);
    let top = 0;
    const t = run(
      (dt) => {
        f.update(dt);
        top = Math.max(top, f.speed);
      },
      10,
      () => f.state === "stand"
    );
    expect(top).toBeLessThanOrEqual(SPRINT.vMax + 1e-6);
    expect(top).toBeGreaterThan(SPRINT.vMax * 0.95);
    expect(f.world.distanceTo(target)).toBeLessThan(0.2);
    // 25 m from standing at 5 m/s² to 7.2 m/s, then braking: about 4.5 s.
    expect(t).toBeGreaterThan(3.8);
    expect(t).toBeLessThan(5.5);
  });

  it("fires the gather and the release exactly once each", () => {
    const f = new FielderAnimator(makePlayer({ role: "fielder", colours: FIELDING_KIT }));
    f.place(new THREE.Vector3(0, 0, 0), 0);
    let grabs = 0;
    let releases = 0;
    f.pickup(new THREE.Vector3(0.1, 0.04, -0.6), () => grabs++);
    run((dt) => f.update(dt), 2, () => !f.busy);
    f.throwAt(new THREE.Vector3(0, 1, -30), 0.8, () => releases++);
    run((dt) => f.update(dt), 2, () => !f.busy);
    expect(grabs).toBe(1);
    expect(releases).toBe(1);
  });
});

describe("BowlerAnimator", () => {
  it("releases from a high arm, from behind the crease, after a real run-up", () => {
    const approach = APPROACH["fast-medium"];
    const frontFoot = 10.06 - 1.22 + 0.2;
    const originZ = deliveryOrigin(approach, frontFoot);
    const rig = makePlayer({ role: "bowler", colours: FIELDING_KIT });
    const { hand, time } = simulateRelease(rig, approach, originZ, -0.45, new THREE.Vector3(0, 0.7, -10.06));
    expect(hand.y).toBeGreaterThan(1.95);
    expect(hand.y).toBeLessThan(2.35);
    // In front of his front foot but not past the batsman's end of the strip.
    expect(hand.z).toBeLessThan(frontFoot + 0.3);
    expect(hand.z).toBeGreaterThan(frontFoot - 1.5);
    // Right-arm over: the hand is close to the stumps, not out wide.
    expect(Math.abs(hand.x)).toBeLessThan(0.8);
    expect(time).toBeGreaterThan(4.5);
    expect(time).toBeLessThan(7);
  });
});

describe("RunnerAnimator", () => {
  it("runs two and finishes at the end he started from", () => {
    const r = new RunnerAnimator(makePlayer({ role: "batsman", colours: BATTING_KIT }));
    r.placeAt(-1, -1);
    r.run(2);
    const t = run((dt) => r.update(dt), 12, () => !r.running);
    expect(r.running).toBe(false);
    expect(r.lengthsDone).toBe(2);
    expect(r.end).toBe(-1);
    // Two runs at about three seconds each.
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(8);
  });

  it("finishes the length he is on when told to stop, and no more", () => {
    const r = new RunnerAnimator(makePlayer({ role: "batsman", colours: BATTING_KIT }));
    r.placeAt(-1, -1);
    r.run(3);
    run((dt) => r.update(dt), 1);
    r.lengthsLeft = Math.min(r.lengthsLeft, 1);
    run((dt) => r.update(dt), 8, () => !r.running);
    expect(r.lengthsDone).toBe(1);
    expect(r.end).toBe(1);
  });
});
