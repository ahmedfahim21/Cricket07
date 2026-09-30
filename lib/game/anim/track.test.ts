import { describe, expect, it } from "vitest";
import { C, makePose } from "./pose";
import { Track } from "./track";

const at = (tr: Track, t: number, ch: keyof typeof C) => tr.evaluate(t)[C[ch]];

describe("Track", () => {
  const tr = new Track([
    { t: 0, pose: makePose({ torsoYaw: 0 }) },
    { t: 0.2, pose: makePose({ torsoYaw: 1 }) },
    { t: 0.3, pose: makePose({ torsoYaw: 1.5 }) },
    { t: 0.6, pose: makePose({ torsoYaw: -0.5 }), hold: true },
    { t: 1.0, pose: makePose({ torsoYaw: 0 }) },
  ]);

  it("passes exactly through every key", () => {
    for (const k of tr.keys) expect(at(tr, k.t, "torsoYaw")).toBeCloseTo(k.pose[C.torsoYaw], 9);
  });

  it("clamps outside its range", () => {
    expect(at(tr, -1, "torsoYaw")).toBe(0);
    expect(at(tr, 5, "torsoYaw")).toBe(0);
  });

  it("keeps velocity continuous through an interior key", () => {
    // The whole point of Catmull-Rom over per-pair easing: no dead stop at
    // a key unless it asked for one.
    // One-sided differences differ by roughly curvature x step even on a
    // smooth curve (~0.02 here); a dead stop at the key would differ by the
    // whole velocity (~5). The tolerance sits between the two.
    const e = 1e-4;
    for (const t of [0.2]) {
      const before = (at(tr, t, "torsoYaw") - at(tr, t - e, "torsoYaw")) / e;
      const after = (at(tr, t + e, "torsoYaw") - at(tr, t, "torsoYaw")) / e;
      expect(Math.abs(before - after)).toBeLessThan(0.1);
      expect(Math.abs(before)).toBeGreaterThan(0.5);
    }
  });

  it("never overshoots a key that is a turning point", () => {
    // 0.3 is a peak at 1.5; the curve must not go above it either side.
    for (let t = 0.2; t <= 0.6; t += 0.002) expect(at(tr, t, "torsoYaw")).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it("holds a channel perfectly still between two equal keys", () => {
    // A planted foot: lands at 0.5 and stays at 0.5 until 1.0, whatever the
    // keys either side are doing.
    const foot = new Track([
      { t: 0, pose: makePose({ footLZ: -1 }) },
      { t: 0.3, pose: makePose({ footLZ: 0.5 }) },
      { t: 0.6, pose: makePose({ footLZ: 0.5 }) },
      { t: 1.0, pose: makePose({ footLZ: 2 }) },
    ]);
    for (let t = 0.3; t <= 0.6; t += 0.01) expect(at(foot, t, "footLZ")).toBeCloseTo(0.5, 6);
  });

  it("comes to rest at a hold key", () => {
    const e = 1e-4;
    const v = (at(tr, 0.6 + e, "torsoYaw") - at(tr, 0.6 - e, "torsoYaw")) / (2 * e);
    expect(Math.abs(v)).toBeLessThan(0.01);
  });

  it("clamps weight channels into [0,1] even when the curve overshoots", () => {
    const w = new Track([
      { t: 0, pose: makePose({ batW: 0 }) },
      { t: 0.1, pose: makePose({ batW: 1 }) },
      { t: 0.11, pose: makePose({ batW: 1 }) },
      { t: 1, pose: makePose({ batW: 0 }) },
    ]);
    for (let t = 0; t <= 1; t += 0.01) {
      const v = at(w, t, "batW");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("rejects an empty track", () => {
    expect(() => new Track([])).toThrow();
  });
});
