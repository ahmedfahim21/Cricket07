import { describe, expect, it } from "vitest";
import {
  classifyTiming,
  idealPressLead,
  resolveShot,
  effectiveFootwork,
  type DeliveryContext,
  type ShotAttempt,
} from "./shot";

function delivery(over: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    length: "good",
    lineAtCrease: 0,
    heightAtCrease: 0.7,
    speed: 30,
    hand: "right",
    ...over,
  };
}

function attempt(over: Partial<ShotAttempt> = {}): ShotAttempt {
  return {
    type: "ground",
    footwork: "front",
    aim: 0,
    square: false,
    timingError: 0,
    ...over,
  };
}

describe("classifyTiming", () => {
  it("bands the error symmetrically about zero", () => {
    expect(classifyTiming(0)).toBe("perfect");
    expect(classifyTiming(0.02)).toBe("perfect");
    expect(classifyTiming(-0.02)).toBe("perfect");
    expect(classifyTiming(0.06)).toBe("perfect");
    expect(classifyTiming(0.12)).toBe("good");
    expect(classifyTiming(-0.12)).toBe("good");
    expect(classifyTiming(0.18)).toBe("mistimed");
    expect(classifyTiming(0.23)).toBe("edged");
    expect(classifyTiming(0.3)).toBe("missed");
    expect(classifyTiming(-0.3)).toBe("missed");
  });
});

describe("resolveShot — a missed shot", () => {
  it("returns a fully zeroed outcome, not a partly-filled one", () => {
    const o = resolveShot(delivery(), attempt({ timingError: 0.4 }));
    expect(o).toEqual({
      band: "missed",
      missed: true,
      exitSpeed: 0,
      exitDirection: 0,
      exitElevation: 0,
      contactOffset: 0,
      chanceOfCatch: 0,
      playedOn: false,
    });
  });
});

describe("resolveShot — timing", () => {
  it("hits a perfectly timed shot harder than a well timed one, all else equal", () => {
    const perfect = resolveShot(delivery(), attempt({ timingError: 0 }));
    const good = resolveShot(delivery(), attempt({ timingError: 0.10 }));
    expect(perfect.exitSpeed).toBeGreaterThan(good.exitSpeed);
  });

  it("degrades exit speed monotonically as timing worsens", () => {
    let prev = Infinity;
    for (const e of [0, 0.02, 0.05, 0.08, 0.12]) {
      const o = resolveShot(delivery(), attempt({ timingError: e }));
      expect(o.exitSpeed).toBeLessThan(prev);
      prev = o.exitSpeed;
    }
  });

  it("raises the catching chance as timing worsens", () => {
    const perfect = resolveShot(delivery(), attempt({ timingError: 0 }));
    const edged = resolveShot(delivery(), attempt({ timingError: 0.20 }));
    expect(edged.chanceOfCatch).toBeGreaterThan(perfect.chanceOfCatch);
    expect(edged.band).toBe("edged");
  });

  it("meets the ball nearer the toe when late and nearer the splice when early", () => {
    const late = resolveShot(delivery(), attempt({ timingError: 0.06 }));
    const early = resolveShot(delivery(), attempt({ timingError: -0.06 }));
    expect(late.contactOffset).toBeGreaterThan(0);
    expect(early.contactOffset).toBeLessThan(0);
    expect(late.contactOffset).toBeCloseTo(-early.contactOffset, 9);
  });

  it("lifts a mistimed ball into the air even on a ground shot", () => {
    const clean = resolveShot(delivery(), attempt({ type: "ground", timingError: 0 }));
    const scuffed = resolveShot(delivery(), attempt({ type: "ground", timingError: 0.16 }));
    expect(scuffed.exitElevation).toBeGreaterThan(clean.exitElevation);
  });

  it("sends a late shot squarer to the leg side and an early one to the off", () => {
    const late = resolveShot(delivery(), attempt({ timingError: 0.07 }));
    const early = resolveShot(delivery(), attempt({ timingError: -0.07 }));
    expect(late.exitDirection).toBeGreaterThan(early.exitDirection);
  });
});

describe("resolveShot — shot type", () => {
  it("puts a defensive shot away far more softly than a drive", () => {
    const block = resolveShot(delivery(), attempt({ type: "defensive" }));
    const drive = resolveShot(delivery(), attempt({ type: "ground" }));
    expect(drive.exitSpeed).toBeGreaterThan(block.exitSpeed * 2);
  });

  it("launches a loft upward and keeps a ground shot down", () => {
    const loft = resolveShot(delivery(), attempt({ type: "lofted" }));
    const ground = resolveShot(delivery(), attempt({ type: "ground" }));
    expect(loft.exitElevation).toBeGreaterThan(0.3);
    expect(ground.exitElevation).toBeLessThan(0.15);
  });

  it("keeps a defensive shot down and slow enough to stay in the ring", () => {
    const block = resolveShot(delivery(), attempt({ type: "defensive" }));
    expect(block.exitElevation).toBeLessThanOrEqual(0);
    expect(block.exitSpeed).toBeLessThan(12);
  });

  it("makes a lofted shot riskier than a ground shot at identical timing", () => {
    const loft = resolveShot(delivery(), attempt({ type: "lofted", timingError: 0.08 }));
    const ground = resolveShot(delivery(), attempt({ type: "ground", timingError: 0.08 }));
    expect(loft.chanceOfCatch).toBeGreaterThan(ground.chanceOfCatch);
  });
});

describe("resolveShot — footwork", () => {
  it("assists neutral input while preserving manual overrides", () => {
    expect(effectiveFootwork("none", "full")).toBe("front");
    expect(effectiveFootwork("none", "short")).toBe("back");
    expect(effectiveFootwork("front", "short")).toBe("front");
    expect(effectiveFootwork("back", "full")).toBe("back");
  });
  it("rewards going forward to a full ball and back to a short one", () => {
    const forwardToFull = resolveShot(
      delivery({ length: "full" }),
      attempt({ footwork: "front" })
    );
    const backToFull = resolveShot(delivery({ length: "full" }), attempt({ footwork: "back" }));
    expect(forwardToFull.exitSpeed).toBeGreaterThan(backToFull.exitSpeed);

    const backToShort = resolveShot(
      delivery({ length: "short" }),
      attempt({ footwork: "back" })
    );
    const forwardToShort = resolveShot(
      delivery({ length: "short" }),
      attempt({ footwork: "front" })
    );
    expect(backToShort.exitSpeed).toBeGreaterThan(forwardToShort.exitSpeed);
  });

  it("punishes the wrong foot to a good length only mildly", () => {
    // A good length is the one that leaves you in two minds; the penalty must
    // be a compromise rather than a disaster or the length stops being a
    // decision and becomes a guess.
    const right = resolveShot(delivery({ length: "good" }), attempt({ footwork: "front" }));
    const wrong = resolveShot(delivery({ length: "good" }), attempt({ footwork: "back" }));
    expect(wrong.exitSpeed).toBeGreaterThan(right.exitSpeed * 0.85);
    expect(wrong.exitSpeed).toBeLessThan(right.exitSpeed);
  });

  it("punishes being stuck in the crease", () => {
    const moved = resolveShot(delivery({ length: "full" }), attempt({ footwork: "front" }));
    const stuck = resolveShot(delivery({ length: "full" }), attempt({ footwork: "none" }));
    expect(stuck.exitSpeed).toBeLessThan(moved.exitSpeed);
    expect(stuck.chanceOfCatch).toBeGreaterThan(moved.chanceOfCatch);
  });
});

describe("resolveShot — line and aim", () => {
  it("sends a ball outside off naturally to the off side", () => {
    const o = resolveShot(delivery({ lineAtCrease: -0.6 }), attempt({ aim: 0 }));
    expect(o.exitDirection).toBeLessThan(0);
  });

  it("sends a ball on the pads naturally to the leg side", () => {
    const o = resolveShot(delivery({ lineAtCrease: 0.6 }), attempt({ aim: 0 }));
    expect(o.exitDirection).toBeGreaterThan(0);
  });

  it("moves the ball toward the leg side when aimed there, for a right-hander", () => {
    const straight = resolveShot(delivery(), attempt({ aim: 0 }));
    const leg = resolveShot(delivery(), attempt({ aim: 1 }));
    const off = resolveShot(delivery(), attempt({ aim: -1 }));
    expect(leg.exitDirection).toBeGreaterThan(straight.exitDirection);
    expect(off.exitDirection).toBeLessThan(straight.exitDirection);
  });

  it("mirrors the aim for a left-hander", () => {
    const rightHanded = resolveShot(delivery({ hand: "right" }), attempt({ aim: 1 }));
    const leftHanded = resolveShot(delivery({ hand: "left" }), attempt({ aim: 1 }));
    expect(Math.sign(leftHanded.exitDirection)).toBe(-Math.sign(rightHanded.exitDirection));
  });

  it("opens the angle further when playing square", () => {
    const straight = resolveShot(delivery(), attempt({ aim: 1, square: false }));
    const squarer = resolveShot(delivery(), attempt({ aim: 1, square: true }));
    expect(Math.abs(squarer.exitDirection)).toBeGreaterThan(Math.abs(straight.exitDirection));
  });

  it("ignores the player's aim more the worse the contact", () => {
    // Middling gives you placement; a mistimed shot goes where it likes.
    const clean = resolveShot(delivery(), attempt({ aim: 1, timingError: 0 }));
    const scuffed = resolveShot(delivery(), attempt({ aim: 1, timingError: 0.09 }));
    const cleanAimEffect = clean.exitDirection;
    const scuffedAimEffect = scuffed.exitDirection - 0.09 * 3.4; // remove deflection
    expect(scuffedAimEffect).toBeLessThan(cleanAimEffect);
  });
});

describe("resolveShot — ball pace", () => {
  it("comes off the bat faster against a quicker bowler", () => {
    const quick = resolveShot(delivery({ speed: 38 }), attempt());
    const slow = resolveShot(delivery({ speed: 22 }), attempt());
    expect(quick.exitSpeed).toBeGreaterThan(slow.exitSpeed);
  });

  it("produces exit speeds in a plausible range for a well-timed drive", () => {
    const o = resolveShot(delivery({ speed: 33 }), attempt({ type: "ground" }));
    // A middled drive leaves the bat somewhere around 25-40 m/s.
    expect(o.exitSpeed).toBeGreaterThan(22);
    expect(o.exitSpeed).toBeLessThan(45);
  });
});

describe("resolveShot — playing on", () => {
  it("can play on from a late edge to a straight ball", () => {
    const o = resolveShot(delivery({ lineAtCrease: 0.1 }), attempt({ timingError: 0.20 }));
    expect(o.band).toBe("edged");
    expect(o.playedOn).toBe(true);
  });

  it("does not play on from an edge to a wide ball", () => {
    const o = resolveShot(delivery({ lineAtCrease: 0.8 }), attempt({ timingError: 0.20 }));
    expect(o.playedOn).toBe(false);
  });

  it("does not play on when the shot was well timed", () => {
    const o = resolveShot(delivery({ lineAtCrease: 0.1 }), attempt({ timingError: 0 }));
    expect(o.playedOn).toBe(false);
  });
});

describe("idealPressLead", () => {
  it("gives more lead time against a slower ball", () => {
    expect(idealPressLead(20)).toBeGreaterThan(idealPressLead(40));
  });

  it("stays inside a human reaction range", () => {
    for (const s of [18, 25, 32, 40, 45]) {
      expect(idealPressLead(s)).toBeGreaterThanOrEqual(0.1);
      expect(idealPressLead(s)).toBeLessThanOrEqual(0.26);
    }
  });
});
