import { describe, expect, it } from "vitest";
import {
  DEFAULT_PITCH,
  bounce,
  bounceHeightAtStumps,
  classifyLength,
  type PitchConditions,
} from "./pitch";
import { v3 } from "./vec3";

/** A seamer's good-length ball arriving at the pitch: quick, dropping, -Z. */
const ARRIVING = v3(0, -6, -33);

const noSpin = v3();

function conditions(over: Partial<PitchConditions> = {}): PitchConditions {
  return { ...DEFAULT_PITCH, ...over };
}

describe("bounce", () => {
  it("reverses vertical velocity and loses energy doing it", () => {
    const r = bounce({ velocity: ARRIVING, spin: noSpin, conditions: conditions() });
    expect(r.velocity.y).toBeGreaterThan(0);
    expect(r.velocity.y).toBeLessThan(Math.abs(ARRIVING.y));
  });

  it("bounces higher off a hard pitch than a dead one", () => {
    const hard = bounce({ velocity: ARRIVING, spin: noSpin, conditions: conditions({ hardness: 1 }) });
    const dead = bounce({ velocity: ARRIVING, spin: noSpin, conditions: conditions({ hardness: 0 }) });
    expect(hard.velocity.y).toBeGreaterThan(dead.velocity.y);
  });

  it("leaves a ball travelling upward untouched", () => {
    const up = v3(1, 4, -20);
    const r = bounce({ velocity: up, spin: v3(10, 0, 5), conditions: conditions() });
    expect(r.velocity).toEqual(up);
    expect(r.deviation).toBe(0);
  });

  it("does not deviate a ball with no spin and no seam movement", () => {
    const r = bounce({
      velocity: ARRIVING,
      spin: noSpin,
      conditions: conditions({ seamDeviation: 0 }),
    });
    expect(r.deviation).toBeCloseTo(0, 9);
    expect(r.velocity.x).toBeCloseTo(0, 9);
  });

  it("does not deviate a ball spinning purely about the vertical axis", () => {
    // The contact point is that spin's own pivot, so it has no slip to grip
    // against. This is why a spinner has to tilt the axis to turn the ball.
    const r = bounce({
      velocity: ARRIVING,
      spin: v3(0, 200, 0),
      conditions: conditions({ friction: 1 }),
    });
    expect(r.deviation).toBeCloseTo(0, 9);
  });

  it("turns the ball toward the leg side for spin about -Z", () => {
    // Spin about the direction of travel is what slips sideways at the
    // contact point; friction opposing that slip is what turns it.
    const r = bounce({
      velocity: ARRIVING,
      spin: v3(0, 0, -200),
      conditions: conditions({ friction: 1 }),
    });
    expect(r.deviation).toBeGreaterThan(0);
    expect(r.velocity.x).toBeGreaterThan(0);
  });

  it("turns the other way for the opposite sidespin", () => {
    const leg = bounce({
      velocity: ARRIVING,
      spin: v3(0, 0, -200),
      conditions: conditions({ friction: 1 }),
    });
    const off = bounce({
      velocity: ARRIVING,
      spin: v3(0, 0, 200),
      conditions: conditions({ friction: 1 }),
    });
    expect(off.deviation).toBeCloseTo(-leg.deviation, 9);
  });

  it("turns more on a gripping pitch than a skiddy one", () => {
    const spin = v3(0, 0, -200);
    const gripping = bounce({ velocity: ARRIVING, spin, conditions: conditions({ friction: 1 }) });
    const skiddy = bounce({ velocity: ARRIVING, spin, conditions: conditions({ friction: 0 }) });
    expect(gripping.deviation).toBeGreaterThan(skiddy.deviation);
  });

  it("never reverses the slip — a heavily spun ball does not squirt backwards", () => {
    const r = bounce({
      velocity: ARRIVING,
      spin: v3(0, 0, -5000),
      conditions: conditions({ friction: 1 }),
    });
    // Ball must still be heading down the pitch, and sideways movement must
    // stay physical rather than exceeding its forward pace.
    expect(r.velocity.z).toBeLessThan(0);
    expect(Math.abs(r.velocity.x)).toBeLessThan(Math.abs(ARRIVING.z));
  });

  it("scrubs spin off on contact so the ball does not turn identically forever", () => {
    const spin = v3(80, 50, -200);
    const r = bounce({ velocity: ARRIVING, spin, conditions: conditions() });
    expect(Math.abs(r.spin.x)).toBeLessThan(Math.abs(spin.x));
    expect(Math.abs(r.spin.z)).toBeLessThan(Math.abs(spin.z));
  });

  it("applies seam movement proportional to pace, independent of spin", () => {
    const quick = bounce({
      velocity: v3(0, -6, -38),
      spin: noSpin,
      conditions: conditions({ seamDeviation: 0.02 }),
    });
    const slow = bounce({
      velocity: v3(0, -6, -25),
      spin: noSpin,
      conditions: conditions({ seamDeviation: 0.02 }),
    });
    expect(quick.deviation).toBeGreaterThan(slow.deviation);
    expect(slow.deviation).toBeGreaterThan(0);
  });

  it("sits a topspinner up and skids a backspinner on low", () => {
    // Backspin is +X for a -Z delivery. This is the effect batsmen actually
    // feel, and it comes from the restitution modulation, not from friction:
    // at this pace the ball slides either way, so friction alone cannot
    // distinguish them.
    const back = bounce({ velocity: ARRIVING, spin: v3(250, 0, 0), conditions: conditions() });
    const top = bounce({ velocity: ARRIVING, spin: v3(-250, 0, 0), conditions: conditions() });
    expect(top.velocity.y).toBeGreaterThan(back.velocity.y);
  });

  it("costs a topspinner pace off the pitch, and a backspinner keeps it", () => {
    const back = bounce({ velocity: ARRIVING, spin: v3(250, 0, 0), conditions: conditions() });
    const top = bounce({ velocity: ARRIVING, spin: v3(-250, 0, 0), conditions: conditions() });
    expect(Math.abs(back.velocity.z)).toBeGreaterThan(Math.abs(top.velocity.z));
  });

  it("works the same way at the other end, where travel is +Z", () => {
    // Sign conventions that only hold for one direction of travel are a
    // reliable source of "it behaves oddly in the second innings" bugs.
    const arrivingOtherWay = v3(0, -6, 33);
    // Backspin for +Z travel is -X.
    const back = bounce({
      velocity: arrivingOtherWay,
      spin: v3(-250, 0, 0),
      conditions: conditions(),
    });
    const top = bounce({
      velocity: arrivingOtherWay,
      spin: v3(250, 0, 0),
      conditions: conditions(),
    });
    expect(top.velocity.y).toBeGreaterThan(back.velocity.y);
  });
});

describe("classifyLength", () => {
  it("names each band from where it pitches", () => {
    expect(classifyLength(-0.5)).toBe("full-toss");
    expect(classifyLength(0.4)).toBe("yorker");
    expect(classifyLength(2.0)).toBe("full");
    expect(classifyLength(4.5)).toBe("good");
    expect(classifyLength(7.5)).toBe("short-of-good");
    expect(classifyLength(11)).toBe("short");
  });

  it("puts a good length between full and short, at a plausible distance", () => {
    // A good length is 4-6m from the stumps; this pins the band so a later
    // tuning pass cannot quietly move it somewhere absurd.
    expect(classifyLength(4)).toBe("good");
    expect(classifyLength(5.9)).toBe("good");
    expect(classifyLength(6.1)).not.toBe("good");
  });
});

describe("bounceHeightAtStumps", () => {
  it("brings a good length through around stump height", () => {
    const h = bounceHeightAtStumps(5, 6, 30);
    expect(h).toBeGreaterThan(0.3);
    expect(h).toBeLessThan(1.1);
  });

  it("brings a fuller ball through lower than a shorter one", () => {
    const full = bounceHeightAtStumps(2.5, 6, 30);
    const short = bounceHeightAtStumps(8, 6, 30);
    expect(short).toBeGreaterThan(full);
  });

  it("never returns a negative height", () => {
    expect(bounceHeightAtStumps(30, 2, 30)).toBe(0);
  });

  it("returns zero for a ball with no forward pace", () => {
    expect(bounceHeightAtStumps(5, 6, 0)).toBe(0);
  });
});
