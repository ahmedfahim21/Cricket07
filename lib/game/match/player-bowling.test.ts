import { beforeAll, describe, expect, it } from "vitest";
import { BOWLERS, DEFAULT_BOWLING_AIM, bowlingStatus, isBowlingWide, lockPlayerDelivery, moveBowlingAim, playerDelivery, shouldChangeBowler } from "./player-bowling";
import { applyBall, newInnings } from "./state";
import { initPhysics, CricketWorld } from "../physics/world";
import { buildDelivery, previewBounce } from "./bowling";
import { STRIKER_STUMPS_Z } from "../dimensions";

beforeAll(async () => { await initPhysics(); });
describe("player bowling", () => {
  it("clamps line, length, pace and swing and mirrors only the horizontal control", () => {
    expect(moveBowlingAim(DEFAULT_BOWLING_AIM, 1, 1, 1, 1, 99, 1)).toEqual({ line: 1.4, length: 1.2, pace: 1, swing: 1 });
    expect(moveBowlingAim(DEFAULT_BOWLING_AIM, 1, -1, -1, -1, 99, -1)).toEqual({ line: -1.4, length: 9, pace: 0, swing: -1 });
    // Which way the ball swings belongs to the ball, so the TV camera's mirror
    // flips the line and nothing else.
    expect(moveBowlingAim(DEFAULT_BOWLING_AIM, 0, 0, 0, 1, 0.5, -1).swing).toBeCloseTo(0.6);
    let aim = { ...DEFAULT_BOWLING_AIM };
    for (let i = 0; i < 60; i++) aim = moveBowlingAim(aim, 1, 1, -1, 1, 1 / 60, 1);
    const single = moveBowlingAim(DEFAULT_BOWLING_AIM, 1, 1, -1, 1, 1, 1);
    expect(aim.line).toBeCloseTo(single.line);
    expect(aim.length).toBeCloseTo(single.length);
    expect(aim.pace).toBeCloseTo(single.pace);
    expect(aim.swing).toBeCloseTo(single.swing);
  });

  it("turns A/D into seam for a seamer and revolutions for a spinner", () => {
    const seamer = BOWLERS.find((b) => b.style === "fast-medium")!;
    const stock = playerDelivery(seamer, DEFAULT_BOWLING_AIM);
    const into = playerDelivery(seamer, { ...DEFAULT_BOWLING_AIM, swing: 1 });
    const away = playerDelivery(seamer, { ...DEFAULT_BOWLING_AIM, swing: -1 });
    // Positive tilts the seam toward +X, the leg side for a right-hander.
    expect(into.seamAngle).toBeGreaterThan(stock.seamAngle);
    expect(away.seamAngle).toBeLessThan(stock.seamAngle);
    // Never past 2x the 20-degree peak, where the side force would reverse.
    for (const plan of [into, away]) expect(Math.abs(plan.seamAngle)).toBeLessThan((2 * Math.PI) / 9);
    // A seamer's revolutions are untouched by it.
    expect(into.sideSpin).toBe(stock.sideSpin);

    for (const style of ["off-spin", "leg-spin"] as const) {
      const spinner = BOWLERS.find((b) => b.style === style)!;
      const flat = playerDelivery(spinner, DEFAULT_BOWLING_AIM);
      const ripper = playerDelivery(spinner, { ...DEFAULT_BOWLING_AIM, swing: 1 });
      const arm = playerDelivery(spinner, { ...DEFAULT_BOWLING_AIM, swing: -1 });
      // More revolutions either way, but never the other way: which way a
      // spinner turns it is his action, not the player's choice.
      expect(Math.abs(ripper.sideSpin)).toBeGreaterThan(Math.abs(flat.sideSpin));
      expect(Math.abs(arm.sideSpin)).toBeLessThan(Math.abs(flat.sideSpin));
      expect(Math.sign(ripper.sideSpin)).toBe(Math.sign(flat.sideSpin));
      expect(Math.sign(arm.sideSpin)).toBe(Math.sign(flat.sideSpin));
      // A spinner's seam stays upright; he is not swinging it.
      expect(ripper.seamAngle).toBe(0);
      expect(arm.seamAngle).toBe(0);
    }
  });

  it.each(BOWLERS)("keeps $name within their own speed range", (profile) => {
    expect(playerDelivery(profile, { ...DEFAULT_BOWLING_AIM, pace: 0 }).speed * 3.6).toBeCloseTo(profile.minKph);
    expect(playerDelivery(profile, { ...DEFAULT_BOWLING_AIM, pace: 1 }).speed * 3.6).toBeCloseTo(profile.maxKph);
    expect(playerDelivery(profile, DEFAULT_BOWLING_AIM).style).toBe(profile.style);
  });

  it.each(BOWLERS)("lands $name's locked delivery at the chosen circle", (profile) => {
    const world = new CricketWorld();
    try {
      for (const length of [1.2, 5, 9]) for (const pace of [0, 1]) {
        const aim = { line: pace ? 1.1 : -1.1, length, pace, swing: 0 };
        const locked = lockPlayerDelivery(playerDelivery(profile, aim), { x: -0.4, y: 2.05, z: 7.8 }, world.pitch, world.outfield);
        const actual = previewBounce(buildDelivery(locked.plan), world.pitch, world.outfield);
        expect(actual).not.toBeNull();
        expect(Math.hypot(actual!.x - aim.line, actual!.z - STRIKER_STUMPS_Z - aim.length)).toBeLessThan(0.13);
      }
    } finally { world.dispose(); }
  });

  it("awards the defence only below target; a last-ball boundary can still lose", () => {
    const match = newInnings(["A", "B", "C", "D", "E"]);
    expect(bowlingStatus(match).result).toBe("playing");
    expect(bowlingStatus({ ...match, wickets: 3 }).result).toBe("won");
    expect(bowlingStatus({ ...match, runs: 23, overs: 2 }).result).toBe("won");
    expect(bowlingStatus({ ...match, runs: 24, overs: 2 }).result).toBe("lost");
    expect(bowlingStatus({ ...match, runs: 24, wickets: 3 }).result).toBe("lost");
  });

  it("charges wides without consuming a legal ball or batter's ball faced", () => {
    expect(isBowlingWide(1.3, 0)).toBe(true);
    expect(isBowlingWide(-1.3, 0)).toBe(true);
    expect(isBowlingWide(0.6, 0)).toBe(false);
    const match = applyBall(newInnings(["A", "B", "C"]), { runs: 0, extra: { kind: "wide", runs: 1 } });
    expect(match.runs).toBe(1);
    expect(match.batsmen[0].ballsFaced).toBe(0);
    expect(bowlingStatus(match).ballsRemaining).toBe(12);
  });

  it("offers a bowler change after six legal balls, not wides or an innings-ending ball", () => {
    let match = newInnings(["A", "B", "C", "D", "E"]);
    for (let ball = 0; ball < 5; ball++) {
      const after = applyBall(match, { runs: 0 });
      expect(shouldChangeBowler(match, after)).toBe(false);
      match = after;
    }
    const wide = applyBall(match, { runs: 0, extra: { kind: "wide", runs: 1 } });
    expect(shouldChangeBowler(match, wide)).toBe(false);
    const over = applyBall(wide, { runs: 0 });
    expect(shouldChangeBowler(wide, over)).toBe(true);
    expect(shouldChangeBowler(over, applyBall(over, { runs: 0, extra: { kind: "wide", runs: 1 } }))).toBe(false);
    expect(shouldChangeBowler(wide, { ...over, wickets: 3 })).toBe(false);
    expect(shouldChangeBowler(wide, { ...over, runs: 24 })).toBe(false);
    expect(shouldChangeBowler({ ...wide, overs: 1 }, { ...over, overs: 2 })).toBe(false);
  });
});
