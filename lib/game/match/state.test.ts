import { describe, expect, it } from "vitest";
import {
  applyBall,
  newInnings,
  oversText,
  scoreText,
  toOutcome,
  type MatchState,
} from "./state";

const NAMES = ["Adams", "Bell", "Cross", "Doyle", "Ellis"];

function innings(): MatchState {
  return newInnings(NAMES);
}

/** Fields that must not move unless the test says so. */
function snapshot(s: MatchState) {
  return {
    runs: s.runs,
    wickets: s.wickets,
    ballsThisOver: s.ballsThisOver,
    overs: s.overs,
    striker: s.striker,
    nonStriker: s.nonStriker,
    extras: s.extras,
    nextIn: s.nextIn,
    complete: s.complete,
  };
}

describe("newInnings", () => {
  it("starts at nought for none, first over, openers in", () => {
    const s = innings();
    expect(snapshot(s)).toEqual({
      runs: 0,
      wickets: 0,
      ballsThisOver: 0,
      overs: 0,
      striker: 0,
      nonStriker: 1,
      extras: 0,
      nextIn: 2,
      complete: false,
    });
    expect(s.timeline).toEqual([]);
    expect(s.batsmen).toHaveLength(NAMES.length);
    expect(s.batsmen.every((b) => b.runs === 0 && b.ballsFaced === 0 && !b.out)).toBe(true);
  });
});

describe("applyBall — a dot ball", () => {
  it("advances the ball count and changes NOTHING else", () => {
    const before = innings();
    const after = applyBall(before, { runs: 0 });
    expect(snapshot(after)).toEqual({ ...snapshot(before), ballsThisOver: 1 });
  });

  it("credits the striker with a ball faced and no runs", () => {
    const after = applyBall(innings(), { runs: 0 });
    expect(after.batsmen[0].ballsFaced).toBe(1);
    expect(after.batsmen[0].runs).toBe(0);
    expect(after.batsmen[1].ballsFaced).toBe(0);
  });

  it("does not mutate the state it was given", () => {
    const before = innings();
    const copy = snapshot(before);
    applyBall(before, { runs: 4, four: true });
    expect(snapshot(before)).toEqual(copy);
    expect(before.batsmen[0].runs).toBe(0);
  });
});

describe("applyBall — runs off the bat", () => {
  it("adds a single to the team and the striker, and rotates strike", () => {
    const before = innings();
    const after = applyBall(before, { runs: 1 });
    expect(snapshot(after)).toEqual({
      ...snapshot(before),
      runs: 1,
      ballsThisOver: 1,
      striker: 1,
      nonStriker: 0,
    });
    expect(after.batsmen[0].runs).toBe(1);
    expect(after.batsmen[0].ballsFaced).toBe(1);
    expect(after.batsmen[1].runs).toBe(0);
  });

  it("keeps strike on an even number of runs", () => {
    const after = applyBall(innings(), { runs: 2 });
    expect(after.striker).toBe(0);
    expect(after.nonStriker).toBe(1);
    expect(after.runs).toBe(2);
  });

  it("counts a four and keeps strike", () => {
    const after = applyBall(innings(), { runs: 4, four: true });
    expect(after.runs).toBe(4);
    expect(after.batsmen[0].runs).toBe(4);
    expect(after.batsmen[0].fours).toBe(1);
    expect(after.batsmen[0].sixes).toBe(0);
    expect(after.striker).toBe(0);
  });

  it("counts a six", () => {
    const after = applyBall(innings(), { runs: 6, six: true });
    expect(after.runs).toBe(6);
    expect(after.batsmen[0].sixes).toBe(1);
    expect(after.batsmen[0].fours).toBe(0);
  });

  it("does not add to extras for runs off the bat", () => {
    const after = applyBall(innings(), { runs: 3 });
    expect(after.extras).toBe(0);
  });
});

describe("applyBall — extras", () => {
  it("adds a wide to the score and extras WITHOUT advancing the ball count", () => {
    const before = innings();
    const after = applyBall(before, { runs: 0, extra: { kind: "wide", runs: 1 } });
    expect(snapshot(after)).toEqual({ ...snapshot(before), runs: 1, extras: 1 });
    expect(after.ballsThisOver).toBe(0);
  });

  it("does not charge the striker a ball faced for a wide", () => {
    const after = applyBall(innings(), { runs: 0, extra: { kind: "wide", runs: 1 } });
    expect(after.batsmen[0].ballsFaced).toBe(0);
  });

  it("does not advance the ball count for a no-ball, but does charge a ball faced", () => {
    const after = applyBall(innings(), { runs: 0, extra: { kind: "no-ball", runs: 1 } });
    expect(after.ballsThisOver).toBe(0);
    expect(after.batsmen[0].ballsFaced).toBe(1);
    expect(after.runs).toBe(1);
    expect(after.extras).toBe(1);
  });

  it("credits runs off a no-ball to the batsman", () => {
    const after = applyBall(innings(), { runs: 4, four: true, extra: { kind: "no-ball", runs: 1 } });
    expect(after.runs).toBe(5);
    expect(after.extras).toBe(1);
    expect(after.batsmen[0].runs).toBe(4);
    expect(after.batsmen[0].fours).toBe(1);
  });

  it("gives byes to the team and NOT to the batsman", () => {
    const after = applyBall(innings(), { runs: 0, extra: { kind: "bye", runs: 2 } });
    expect(after.runs).toBe(2);
    expect(after.extras).toBe(2);
    expect(after.batsmen[0].runs).toBe(0);
    expect(after.ballsThisOver).toBe(1);
  });

  it("rotates strike on an odd number of byes, because they were run", () => {
    const after = applyBall(innings(), { runs: 0, extra: { kind: "leg-bye", runs: 1 } });
    expect(after.striker).toBe(1);
  });
});

describe("applyBall — the over", () => {
  it("completes an over after six legal balls and rotates strike", () => {
    let s = innings();
    for (let i = 0; i < 6; i++) s = applyBall(s, { runs: 0 });
    expect(s.overs).toBe(1);
    expect(s.ballsThisOver).toBe(0);
    // Six dots: no single rotated strike, so the over change must.
    expect(s.striker).toBe(1);
    expect(s.nonStriker).toBe(0);
  });

  it("needs seven deliveries to finish an over containing a wide", () => {
    let s = innings();
    s = applyBall(s, { runs: 0, extra: { kind: "wide", runs: 1 } });
    for (let i = 0; i < 6; i++) s = applyBall(s, { runs: 0 });
    expect(s.overs).toBe(1);
    expect(s.runs).toBe(1);
  });

  it("leaves the same batsman on strike after a single off the last ball", () => {
    // The single rotates strike, then the end of the over rotates it back.
    // This is the classic case a naive implementation gets wrong.
    let s = innings();
    for (let i = 0; i < 5; i++) s = applyBall(s, { runs: 0 });
    expect(s.striker).toBe(0);
    s = applyBall(s, { runs: 1 });
    expect(s.overs).toBe(1);
    expect(s.striker).toBe(0);
  });

  it("reports overs in the conventional form", () => {
    let s = innings();
    expect(oversText(s)).toBe("0.0");
    for (let i = 0; i < 8; i++) s = applyBall(s, { runs: 0 });
    expect(oversText(s)).toBe("1.2");
  });
});

describe("applyBall — wickets", () => {
  it("records the dismissal, adds no runs, and brings in the next batsman", () => {
    const before = innings();
    const after = applyBall(before, { runs: 0, dismissal: "bowled" });
    expect(after.wickets).toBe(1);
    expect(after.runs).toBe(0);
    expect(after.batsmen[0].out).toBe(true);
    expect(after.batsmen[0].dismissal).toBe("bowled");
    expect(after.striker).toBe(2); // the next man in
    expect(after.nonStriker).toBe(1); // unchanged
    expect(after.nextIn).toBe(3);
    expect(after.ballsThisOver).toBe(1);
  });

  it("charges the dismissed batsman with the ball they were out to", () => {
    const after = applyBall(innings(), { runs: 0, dismissal: "caught" });
    expect(after.batsmen[0].ballsFaced).toBe(1);
  });

  it("declares the innings complete when only one batsman is left", () => {
    let s = innings(); // 5 batsmen, so all out at 4 wickets
    for (let i = 0; i < 4; i++) {
      expect(s.complete).toBe(false);
      s = applyBall(s, { runs: 0, dismissal: "bowled" });
    }
    expect(s.wickets).toBe(4);
    expect(s.complete).toBe(true);
  });

  it("ignores further deliveries once the innings is complete", () => {
    let s = innings();
    for (let i = 0; i < 4; i++) s = applyBall(s, { runs: 0, dismissal: "bowled" });
    const done = snapshot(s);
    s = applyBall(s, { runs: 6, six: true });
    expect(snapshot(s)).toEqual(done);
  });
});

describe("timeline", () => {
  it("logs each delivery in commentary shorthand", () => {
    let s = innings();
    s = applyBall(s, { runs: 0 });
    s = applyBall(s, { runs: 4, four: true });
    s = applyBall(s, { runs: 0, extra: { kind: "wide", runs: 1 } });
    s = applyBall(s, { runs: 0, dismissal: "caught" });
    expect(s.timeline).toEqual(["0", "4", "wide", "W (caught)"]);
  });
});

describe("scoreText", () => {
  it("renders runs for wickets", () => {
    let s = innings();
    s = applyBall(s, { runs: 4, four: true });
    s = applyBall(s, { runs: 0, dismissal: "bowled" });
    expect(scoreText(s)).toBe("4/1");
  });
});

describe("toOutcome", () => {
  it("turns a cleared rope into a six", () => {
    const o = toOutcome({ clearedRope: true, reachedRope: true, ranRuns: 0, offTheBat: true });
    expect(o).toEqual({ runs: 6, four: false, six: true });
  });

  it("turns a rope reached along the ground into a four", () => {
    const o = toOutcome({ clearedRope: false, reachedRope: true, ranRuns: 0, offTheBat: true });
    expect(o).toEqual({ runs: 4, four: true, six: false });
  });

  it("prefers the boundary over any runs that were also recorded", () => {
    const o = toOutcome({ clearedRope: false, reachedRope: true, ranRuns: 2, offTheBat: true });
    expect(o.runs).toBe(4);
  });

  it("gives a wide one run plus anything run off it, and no ball faced", () => {
    const o = toOutcome({ clearedRope: false, reachedRope: false, ranRuns: 1, offTheBat: false, wide: true });
    expect(o).toEqual({ runs: 0, extra: { kind: "wide", runs: 2 } });
  });

  it("scores runs not off the bat as byes", () => {
    const o = toOutcome({ clearedRope: false, reachedRope: false, ranRuns: 2, offTheBat: false });
    expect(o).toEqual({ runs: 0, extra: { kind: "bye", runs: 2 } });
  });

  it("returns a plain dot for a dot ball", () => {
    const o = toOutcome({ clearedRope: false, reachedRope: false, ranRuns: 0, offTheBat: true });
    expect(o).toEqual({ runs: 0, four: false, six: false });
  });

  it("reports a dismissal with no runs", () => {
    const o = toOutcome({
      clearedRope: false,
      reachedRope: false,
      ranRuns: 0,
      offTheBat: true,
      dismissal: "bowled",
    });
    expect(o).toEqual({ runs: 0, dismissal: "bowled" });
  });
});
