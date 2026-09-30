import { beforeAll, describe, expect, it } from "vitest";
import { BOWLERS, DEFAULT_BOWLING_AIM, bowlingStatus, isBowlingWide, lockPlayerDelivery, moveBowlingAim, playerDelivery, shouldChangeBowler } from "./player-bowling";
import { applyBall, newInnings } from "./state";
import { initPhysics, CricketWorld } from "../physics/world";
import { buildDelivery, previewBounce } from "./bowling";
import { STRIKER_STUMPS_Z } from "../dimensions";

beforeAll(async () => { await initPhysics(); });
describe("player bowling", () => {
  it("clamps line, length and pace and mirrors horizontal controls", () => {
    expect(moveBowlingAim(DEFAULT_BOWLING_AIM, 1, 1, 1, 99, 1)).toEqual({ line: 1.4, length: 1.2, pace: 1 });
    expect(moveBowlingAim(DEFAULT_BOWLING_AIM, 1, -1, -1, 99, -1)).toEqual({ line: -1.4, length: 9, pace: 0 });
    let aim = { ...DEFAULT_BOWLING_AIM };
    for (let i = 0; i < 60; i++) aim = moveBowlingAim(aim, 1, 1, -1, 1 / 60, 1);
    const single = moveBowlingAim(DEFAULT_BOWLING_AIM, 1, 1, -1, 1, 1);
    expect(aim.line).toBeCloseTo(single.line);
    expect(aim.length).toBeCloseTo(single.length);
    expect(aim.pace).toBeCloseTo(single.pace);
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
        const aim = { line: pace ? 1.1 : -1.1, length, pace };
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
