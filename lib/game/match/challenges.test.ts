import { describe, expect, it } from "vitest";
import { CHALLENGES, challengeDelivery, challengeStatus, freshProgress, loadProgress, recordWin } from "./challenges";
import { applyBall, newInnings } from "./state";
import { mulberry32 } from "../mat/noise";

const innings = () => newInnings(["A", "B", "C", "D", "E"]);

describe("challenge ladder", () => {
  it("wins early and on the final ball, including boundary overshoot", () => {
    for (const overs of [0, 1]) {
      const before = { ...innings(), runs: 10, overs, ballsThisOver: 5 };
      const after = applyBall(before, { runs: 6, six: true });
      expect(challengeStatus(CHALLENGES[0], after).result).toBe("won");
    }
  });
  it("loses at the ball or wicket limit", () => {
    expect(challengeStatus(CHALLENGES[0], { ...innings(), overs: 2 }).result).toBe("lost");
    expect(challengeStatus(CHALLENGES[0], { ...innings(), wickets: 3 }).result).toBe("lost");
    expect(challengeStatus(CHALLENGES[0], innings()).ballsRemaining).toBe(12);
  });
  it("counts extras toward the chase without using a legal ball", () => {
    const before = { ...innings(), runs: 11, overs: 1, ballsThisOver: 5 };
    for (const kind of ["wide", "no-ball"] as const) {
      const after = applyBall(before, { runs: 0, extra: { kind, runs: 1 } });
      expect(challengeStatus(CHALLENGES[0], after)).toMatchObject({ result: "won", ballsRemaining: 1 });
    }
  });
  it("preserves unlocks and best wins on replay and caps the last unlock", () => {
    const progress = recordWin(freshProgress(), CHALLENGES[0], 16);
    const replay = recordWin(progress, CHALLENGES[0], 12);
    expect(replay).toEqual(progress);
    expect(progress.unlocked).toBe(1);
    expect(recordWin(progress, CHALLENGES[4], 50).unlocked).toBe(4);
    expect(loadProgress({ getItem: () => JSON.stringify(progress) })).toEqual(progress);
  });
  it("recovers from blocked, corrupt or incompatible storage", () => {
    for (const raw of [null, "bad", '{"version":2}', '{"version":1,"unlocked":99}']) {
      expect(loadProgress({ getItem: () => raw })).toEqual(freshProgress());
    }
    expect(loadProgress({ getItem: () => { throw new Error("denied"); } })).toEqual(freshProgress());
  });
  it("offers all five bowling styles in the final level, with repeatable variation", () => {
    const sequence = () => {
      const rand = mulberry32(42);
      return Array.from({ length: 30 }, () => challengeDelivery(CHALLENGES[4], 0, rand));
    };
    expect(sequence()).toEqual(sequence());
    expect(new Set(sequence().map((d) => d.style)).size).toBe(5);
  });
});
