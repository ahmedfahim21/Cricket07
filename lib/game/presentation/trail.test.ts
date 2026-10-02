import { describe, expect, it } from "vitest";
import { BallTrail, TRAIL_CAPACITY, TRAIL_STEP } from "./trail";

const point = (x: number, y = 0, z = 0) => ({ x, y, z });
/** Every point of a leg as [x,y,z] triples, for readable assertions. */
const triples = (trail: BallTrail, leg: "flight" | "pitched" | "struck") => {
  const flat = trail.positions(leg);
  return Array.from({ length: flat.length / 3 }, (_, i) => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]]);
};

describe("ball trail", () => {
  it("records nothing until a leg is opened", () => {
    const trail = new BallTrail();
    expect(trail.leg).toBeNull();
    expect(trail.push(point(1))).toBe(false);
    expect(trail.count("flight")).toBe(0);
    expect(trail.drawable).toBe(false);
  });

  it("keeps points at least a step apart and drops the rest", () => {
    const trail = new BallTrail();
    trail.open("flight", point(0));
    expect(trail.count("flight")).toBe(1);
    // A single point is not a line.
    expect(trail.drawable).toBe(false);

    expect(trail.push(point(TRAIL_STEP * 0.5))).toBe(false);
    expect(trail.count("flight")).toBe(1);

    expect(trail.push(point(TRAIL_STEP * 1.5))).toBe(true);
    expect(trail.count("flight")).toBe(2);
    expect(trail.drawable).toBe(true);

    // Measured from the last RECORDED point, not from the leg's start.
    expect(trail.push(point(TRAIL_STEP * 2))).toBe(false);
    expect(trail.push(point(TRAIL_STEP * 3))).toBe(true);
    expect(triples(trail, "flight")).toEqual([
      [0, 0, 0],
      [TRAIL_STEP * 1.5, 0, 0],
      [TRAIL_STEP * 3, 0, 0],
    ]);
  });

  it("joins a new leg to where the previous one actually ended", () => {
    const trail = new BallTrail();
    trail.open("flight", point(0, 2));
    trail.push(point(1, 1.4));
    trail.push(point(2, 0.9));
    // The bounce point is given exactly; the air leg is left untouched.
    trail.open("pitched", point(2.4, 0.036));

    expect(trail.leg).toBe("pitched");
    expect(trail.count("flight")).toBe(3);
    expect(triples(trail, "pitched")).toEqual([
      [2, 0.9, 0],
      [2.4, 0.036, 0],
    ]);
    // The shared endpoint means no gap at the kink.
    expect(triples(trail, "flight").at(-1)).toEqual(triples(trail, "pitched")[0]);

    trail.push(point(3.5, 0.4));
    trail.open("struck", point(3.9, 0.8));
    expect(triples(trail, "struck")).toEqual([
      [3.5, 0.4, 0],
      [3.9, 0.8, 0],
    ]);
    expect(trail.count("pitched")).toBe(3);
  });

  it("re-opening the current leg leaves it alone", () => {
    const trail = new BallTrail();
    trail.open("flight", point(0));
    trail.push(point(1));
    trail.open("flight", point(99));
    expect(triples(trail, "flight")).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });

  it("thins a long leg instead of truncating it, keeping both ends", () => {
    const trail = new BallTrail();
    trail.open("flight", point(0));
    // One point every half metre: comfortably past the step, so all are kept
    // until capacity forces a thin.
    for (let i = 1; i <= TRAIL_CAPACITY; i++) expect(trail.push(point(i * 0.5))).toBe(true);

    const count = trail.count("flight");
    expect(count).toBeLessThanOrEqual(TRAIL_CAPACITY);
    expect(count).toBeGreaterThan(TRAIL_CAPACITY / 2 - 2);
    const kept = triples(trail, "flight");
    expect(kept[0]).toEqual([0, 0, 0]);
    // The far end is preserved: the line still reaches where the ball got to.
    expect(kept.at(-1)).toEqual([TRAIL_CAPACITY * 0.5, 0, 0]);
    // Thinning doubled the step, so a half-metre move is now too small to keep.
    expect(trail.push(point(TRAIL_CAPACITY * 0.5 + 0.15))).toBe(false);
    expect(trail.push(point(TRAIL_CAPACITY * 0.5 + 0.5))).toBe(true);
  });

  it("clears every leg and forgets the thinned step", () => {
    const trail = new BallTrail();
    trail.open("flight", point(0));
    trail.push(point(1));
    trail.open("pitched", point(1.2));
    trail.push(point(2));

    trail.clear();
    expect(trail.leg).toBeNull();
    expect(trail.drawable).toBe(false);
    expect(trail.count("flight")).toBe(0);
    expect(trail.count("pitched")).toBe(0);

    // A fresh delivery starts at the base step again.
    trail.open("flight", point(0));
    expect(trail.push(point(TRAIL_STEP * 1.2))).toBe(true);
  });
});
