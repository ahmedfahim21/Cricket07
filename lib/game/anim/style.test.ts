import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BATTING_KIT, makePlayer } from "../assets/kit";
import type { BowlerStyle } from "../match/bowling";
import type { Footwork, ShotType } from "../input/bindings";
import { C, applyPose, makePose, sweetSpot, type Pose } from "./pose";
import { BatsmanAnimator, CONTACT_X, readyBatPose } from "./batsman";
import { APPROACH, deliveryOrigin, simulateRelease } from "./bowler";
import {
  BATTING_STYLES,
  BOWLING_STYLES,
  DEFAULT_BATTING,
  DEFAULT_BOWLING,
  battingStyle,
  bowlingStyle,
  checkBatting,
  checkBowling,
  styledApproach,
  type BattingStyle,
  type BowlingStyle,
} from "./style";

const DT = 1 / 60;
const LOOK = new THREE.Vector3(-18, 1.8, 0);
const STUMPS = new THREE.Vector3(0, 0.7, -10.06);
const FRONT_FOOT = 10.06 - 1.22 + 0.2;

function ready(style: BattingStyle, trigger = 0, lift = 0): Pose {
  return readyBatPose(makePose(), { time: 0.1, footwork: 0, lift, trigger, look: LOOK }, style);
}

function release(type: BowlerStyle, style: BowlingStyle, lineX = -0.45, dt = 1 / 120) {
  const a = styledApproach(APPROACH[type], style);
  return simulateRelease(makePlayer({ role: "bowler" }), a, deliveryOrigin(a, FRONT_FOOT), lineX, STUMPS, style, dt);
}

describe("style presets", () => {
  it("are all within their ranges", () => {
    for (const [name, s] of Object.entries(BATTING_STYLES)) expect(checkBatting(s), name).toEqual([]);
    for (const [name, s] of Object.entries(BOWLING_STYLES)) expect(checkBowling(s), name).toEqual([]);
  });

  it("take overrides on top of a preset, and only what is named", () => {
    const s = battingStyle({ preset: "crouched", backlift: 1.2 });
    expect(s).toEqual({ ...BATTING_STYLES.crouched, backlift: 1.2 });
    expect(bowlingStyle({ preset: "slingy", crease: 0 })).toEqual({ ...BOWLING_STYLES.slingy, crease: 0 });
    expect(battingStyle(undefined)).toBe(DEFAULT_BATTING);
    expect(bowlingStyle(undefined)).toBe(DEFAULT_BOWLING);
  });

  it("bend a bowling type's run, not replace it", () => {
    const a = styledApproach(APPROACH.fast, BOWLING_STYLES.express);
    expect(a.runLength).toBeCloseTo(APPROACH.fast.runLength * 1.2, 6);
    expect(a.vMax).toBeCloseTo(APPROACH.fast.vMax * 1.08, 6);
    expect(styledApproach(APPROACH.fast, DEFAULT_BOWLING)).toEqual(APPROACH.fast);
  });
});

describe("batting styles shape the stance", () => {
  it("crouched sits lower and bends further over the bat than upright", () => {
    const low = ready(BATTING_STYLES.crouched);
    const tall = ready(BATTING_STYLES.upright);
    expect(low[C.pelvisY]).toBeLessThan(tall[C.pelvisY] - 0.08);
    expect(low[C.torsoPitch]).toBeGreaterThan(tall[C.torsoPitch] + 0.15);
  });

  it("a wide stance spreads the feet", () => {
    const spread = (p: Pose) => p[C.footRX] - p[C.footLX];
    expect(spread(ready({ ...DEFAULT_BATTING, stanceWidth: 1.3 }))).toBeGreaterThan(spread(ready(DEFAULT_BATTING)) + 0.1);
  });

  it("an open stance faces the bowler, and closes as he triggers", () => {
    const open = ready(BATTING_STYLES.open);
    const side = ready(DEFAULT_BATTING);
    expect(open[C.pelvisYaw]).toBeGreaterThan(side[C.pelvisYaw] + 0.25);
    expect(open[C.footLZ]).toBeGreaterThan(side[C.footLZ] + 0.1);
    const triggered = ready(BATTING_STYLES.open, 1);
    expect(triggered[C.pelvisYaw]).toBeLessThan(open[C.pelvisYaw] * 0.5);
  });

  it("a raised guard holds the bat off the turf; a grounded one rests its toe", () => {
    expect(ready(BATTING_STYLES.upright)[C.gripY]).toBeGreaterThan(ready(DEFAULT_BATTING)[C.gripY] + 0.05);
  });

  it("a high backlift takes the hands higher than a compact one", () => {
    expect(ready(BATTING_STYLES.upright, 1, 1)[C.gripY]).toBeGreaterThan(ready(BATTING_STYLES.compact, 1, 1)[C.gripY] + 0.08);
  });

  it("each trigger moves the feet its own way", () => {
    const at = (trigger: BattingStyle["trigger"]) => ready({ ...DEFAULT_BATTING, trigger, triggerSize: 1 }, 1);
    const still = at("none");
    // Forward press: front foot toward the bowler (-X).
    expect(at("forward-press")[C.footLX]).toBeLessThan(still[C.footLX] - 0.05);
    // Back and across: back foot toward the keeper and across to off (-Z).
    expect(at("back-across")[C.footRX]).toBeGreaterThan(still[C.footRX] + 0.03);
    expect(at("back-across")[C.footRZ]).toBeLessThan(still[C.footRZ] - 0.03);
    // Shuffle: further across than back-and-across.
    expect(at("shuffle")[C.footRZ]).toBeLessThan(at("back-across")[C.footRZ] - 0.03);
  });
});

describe("every batting style still meets the ball", () => {
  const rig = makePlayer({ role: "batsman", colours: BATTING_KIT });
  const cases: { footwork: Footwork; type: ShotType; y: number; z: number; exit: number }[] = [];
  for (const footwork of ["front", "none", "back"] as Footwork[]) {
    for (const type of ["defensive", "ground", "lofted"] as ShotType[]) {
      for (const [y, z] of [[0.25, -0.35], [0.6, -0.15], [0.9, -0.5]]) cases.push({ footwork, type, y, z, exit: 0.3 });
    }
  }

  it.each(Object.entries(BATTING_STYLES))("%s", (_, style) => {
    const pose = makePose();
    let worst = 0;
    for (const c of cases) {
      const b = new BatsmanAnimator();
      b.style = style;
      b.look.copy(LOOK);
      for (let t = 0; t < 0.4; t += DT) b.update(DT);
      b.triggerMove(true);
      b.pickUp(true);
      b.setFootwork(c.footwork === "front" ? 1 : c.footwork === "back" ? -1 : 0);
      for (let t = 0; t < 0.5; t += DT) b.update(DT);
      const contact = new THREE.Vector3(CONTACT_X[c.footwork], c.y, c.z);
      b.play({ type: c.type, footwork: c.footwork, contact, exitDirection: c.exit, downswing: 0.18, look: contact }, rig);
      applyPose(rig, b.contactPose(pose));
      worst = Math.max(worst, sweetSpot(rig).distanceTo(contact));
    }
    expect(worst).toBeLessThan(0.06);
  });
});

describe("every bowling style bowls legally", () => {
  const types = Object.keys(APPROACH) as BowlerStyle[];
  it.each(Object.entries(BOWLING_STYLES))("%s, with every bowling type", (_, style) => {
    for (const type of types) {
      const { hand } = release(type, style);
      // A real release: high, out in front of the front foot, near the stumps.
      expect(hand.y, type).toBeGreaterThan(1.85);
      expect(hand.y, type).toBeLessThan(2.4);
      expect(hand.z, type).toBeLessThan(FRONT_FOOT + 0.3);
      expect(hand.z, type).toBeGreaterThan(FRONT_FOOT - 1.5);
      expect(Math.abs(hand.x), type).toBeLessThan(1.2);
    }
  });

  it("a round-arm sling releases wider and lower than a high action", () => {
    const high = release("fast-medium", DEFAULT_BOWLING).hand;
    const sling = release("fast-medium", { ...DEFAULT_BOWLING, armAngle: 0.5 }).hand;
    // Out to the bowler's right (+X) and down.
    expect(sling.x).toBeGreaterThan(high.x + 0.2);
    expect(sling.y).toBeLessThan(high.y - 0.03);
  });

  it("a longer run-up takes longer to reach the crease", () => {
    expect(release("fast", BOWLING_STYLES.express).time).toBeGreaterThan(release("fast", BOWLING_STYLES.economical).time + 0.5);
  });

  it("releases from the same point whatever the frame rate, so the aim preview holds", () => {
    for (const style of Object.values(BOWLING_STYLES)) {
      const a = release("fast-medium", style, -0.45, 1 / 120).hand;
      const b = release("fast-medium", style, -0.45, 1 / 50).hand;
      expect(a.distanceTo(b)).toBeLessThan(0.03);
    }
  });
});
