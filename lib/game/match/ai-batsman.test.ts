import { describe, expect, it } from "vitest";
import { decideAiShot, type AiObservation } from "./ai-batsman";
import { mulberry32 } from "../mat/noise";

const observation: AiObservation = { length: "good", line: 0, height: 0.8, speed: 26, runsNeeded: 24, ballsRemaining: 12, batter: 0, previousSpeed: null };

describe("AI batsman decisions", () => {
  it("can leave, defend, drive or loft rather than always hit", () => {
    const random = mulberry32(7);
    const shots = new Set(Array.from({ length: 200 }, () => decideAiShot(observation, random).shot));
    expect(shots).toEqual(new Set(["defensive", "ground", "lofted"]));
    expect(decideAiShot({ ...observation, line: 1.5 }, random).shot).toBeNull();
    expect(decideAiShot({ ...observation, height: 2.1 }, random).shot).toBeNull();
  });
  it("uses seeded human-scale timing errors including occasional misses", () => {
    const random = mulberry32(7);
    const decisions = Array.from({ length: 200 }, () => decideAiShot(observation, random));
    expect(decisions.some((d) => Math.abs(d.timingError) < 0.06)).toBe(true);
    expect(decisions.some((d) => Math.abs(d.timingError) > 0.23)).toBe(true);
    expect(decisions.some((d) => d.footwork === "back")).toBe(true);
    expect(decideAiShot(observation, mulberry32(7))).toEqual(decideAiShot(observation, mulberry32(7)));
  });
  it("attacks loose deliveries more and finds pace changes harder to time", () => {
    const count = (length: AiObservation["length"]) => {
      const random = mulberry32(18);
      return Array.from({ length: 300 }, () => decideAiShot({ ...observation, length }, random)).filter((d) => d.shot === "lofted").length;
    };
    expect(count("full")).toBeGreaterThan(count("good"));
    const stable = decideAiShot({ ...observation, previousSpeed: 26 }, () => 0.7);
    const changed = decideAiShot({ ...observation, previousSpeed: 13 }, () => 0.7);
    expect(Math.abs(changed.timingError)).toBeGreaterThan(Math.abs(stable.timingError));
  });
});
