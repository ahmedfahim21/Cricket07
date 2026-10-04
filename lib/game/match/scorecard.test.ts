import { describe, expect, it } from "vitest";
import {
  approachingMilestone,
  currentBowler,
  economy,
  figuresText,
  legalBalls,
  overSymbol,
  overText,
  oversFromBalls,
  partnershipText,
  rateText,
  requiredRate,
  runRate,
} from "./scorecard";
import { applyBall, newInnings, type BallOutcome, type MatchState } from "./state";

const NAMES = ["Adams", "Bell", "Cross", "Doyle", "Ellis", "Fisher", "Grant"];
const innings = () => newInnings(NAMES);

/** Bowl a sequence of outcomes at one bowler, in order. */
function bowl(state: MatchState, outcomes: BallOutcome[], bowler = "Mitchell"): MatchState {
  return outcomes.reduce((s, o) => applyBall(s, o, bowler), state);
}
const dot: BallOutcome = { runs: 0 };
const single: BallOutcome = { runs: 1 };
const four: BallOutcome = { runs: 4, four: true };

describe("bowling figures", () => {
  it("counts only legal balls toward the overs", () => {
    const s = bowl(innings(), [dot, { runs: 0, extra: { kind: "wide", runs: 1 } }, dot]);
    const f = currentBowler(s)!;
    expect(f.name).toBe("Mitchell");
    expect(f.balls).toBe(2);
    expect(figuresText(f)).toBe("0.2-0-1-0");
  });

  it("charges wides and no-balls to him, and byes to nobody", () => {
    const s = bowl(innings(), [
      four,
      { runs: 0, extra: { kind: "wide", runs: 2 } },
      { runs: 2, extra: { kind: "no-ball", runs: 1 } },
      { runs: 0, extra: { kind: "bye", runs: 4 } },
      { runs: 0, extra: { kind: "leg-bye", runs: 1 } },
    ]);
    const f = currentBowler(s)!;
    // 4 off the bat + 2 wides + (2 off the bat and 1 no-ball) = 9. The bye and
    // the leg-bye are the team's 5 runs and none of his.
    expect(f.runs).toBe(9);
    expect(s.runs).toBe(14);
  });

  it("credits his wickets but never a run-out", () => {
    let s = bowl(innings(), [{ runs: 0, dismissal: "bowled" }, { runs: 0, dismissal: "caught" }]);
    s = applyBall(s, { runs: 0, dismissal: "run-out" }, "Mitchell");
    expect(currentBowler(s)!.wickets).toBe(2);
    expect(s.wickets).toBe(3);
  });

  it("gives a maiden for an over that costs him nothing, byes included", () => {
    const byes: BallOutcome = { runs: 0, extra: { kind: "bye", runs: 2 } };
    const s = bowl(innings(), [dot, dot, byes, dot, dot, dot, dot]);
    const f = currentBowler(s)!;
    expect(f.maidens).toBe(1);
    // The over cost the bowler nothing even though the team scored off it.
    expect(f.runs).toBe(0);
    expect(s.runs).toBe(2);
    expect(figuresText(f)).toBe("1.1-1-0-0");
  });

  it("writes a completed over bare, and only an unfinished one with a decimal", () => {
    const figures = (balls: number) => figuresText({ name: "x", balls, runs: 0, wickets: 0, maidens: 0 });
    expect(figures(0)).toBe("0-0-0-0");
    expect(figures(6)).toBe("1-0-0-0");
    expect(figures(24)).toBe("4-0-0-0");
    expect(figures(22)).toBe("3.4-0-0-0");
  });

  it("does not give a maiden for an over that cost a single wide", () => {
    const wide: BallOutcome = { runs: 0, extra: { kind: "wide", runs: 1 } };
    const s = bowl(innings(), [dot, wide, dot, dot, dot, dot, dot]);
    expect(currentBowler(s)!.maidens).toBe(0);
  });

  it("keeps a figure per bowler and follows whoever is named", () => {
    let s = bowl(innings(), [four, dot, dot, dot, dot, dot], "Mitchell");
    s = bowl(s, [single, dot], "Silva");
    expect(s.bowlers.map((b) => b.name)).toEqual(["Mitchell", "Silva"]);
    expect(figuresText(s.bowlers[0])).toBe("1-0-4-0");
    expect(figuresText(s.bowlers[1])).toBe("0.2-0-1-0");
    expect(currentBowler(s)!.name).toBe("Silva");

    // Coming back for a second spell adds to the figures he already has.
    s = bowl(s, [dot], "Mitchell");
    expect(s.bowlers).toHaveLength(2);
    expect(figuresText(s.bowlers[0])).toBe("1.1-0-4-0");
  });

  it("goes to whoever bowled last when no bowler is named", () => {
    let s = applyBall(innings(), dot, "Mitchell");
    s = applyBall(s, four);
    expect(figuresText(currentBowler(s)!)).toBe("0.2-0-4-0");
    // A caller that never names anyone still scores, it just keeps no figures.
    const anonymous = applyBall(innings(), four);
    expect(anonymous.runs).toBe(4);
    expect(anonymous.bowlers).toEqual([]);
    expect(currentBowler(anonymous)).toBeNull();
  });

  it("reports economy, and nothing before a legal ball", () => {
    const s = bowl(innings(), [four, single, dot, dot, dot, dot]);
    expect(economy(currentBowler(s)!)).toBeCloseTo(5);
    expect(economy({ name: "x", balls: 0, runs: 0, wickets: 0, maidens: 0 })).toBeNull();
  });
});

describe("the over in progress", () => {
  it("reads the over out, with dots for dot balls, and clears at the end", () => {
    let s = bowl(innings(), [single, dot, four, { runs: 0, dismissal: "bowled" }]);
    // How he was out belongs in the log; the strip just says W.
    expect(overText(s)).toBe("1 • 4 W");
    expect(s.timeline.at(-1)).toBe("W (bowled)");
    expect(s.runsThisOver).toBe(5);

    s = bowl(s, [dot, dot]);
    expect(s.thisOver).toEqual([]);
    expect(overText(s)).toBe("");
    expect(s.runsThisOver).toBe(0);
    expect(s.overs).toBe(1);
  });

  it("keeps an illegal delivery in the over's reading even though it adds no ball", () => {
    const s = bowl(innings(), [{ runs: 0, extra: { kind: "wide", runs: 1 } }, single]);
    expect(overText(s)).toBe("wd 1");
    expect(s.ballsThisOver).toBe(1);
  });

  it("abbreviates every extra the way a scorer writes it", () => {
    expect(overSymbol("0")).toBe("•");
    expect(overSymbol("4")).toBe("4");
    expect(overSymbol("W (caught)")).toBe("W");
    expect(overSymbol("wide")).toBe("wd");
    expect(overSymbol("wide +2")).toBe("2wd");
    expect(overSymbol("no-ball +3")).toBe("3nb");
    expect(overSymbol("bye +4")).toBe("4b");
    expect(overSymbol("leg-bye")).toBe("lb");
    // Anything it does not recognise goes through untouched rather than blank.
    expect(overSymbol("??")).toBe("??");
  });
});

describe("the partnership", () => {
  it("counts every run the pair put on, including extras", () => {
    const s = bowl(innings(), [single, { runs: 0, extra: { kind: "wide", runs: 1 } }, four]);
    expect(s.partnership).toEqual({ runs: 6, balls: 2 });
    expect(partnershipText(s)).toBe("6 (2)");
  });

  it("ends on the wicket that breaks it, and the next pair start at nought", () => {
    let s = bowl(innings(), [four, single, four]);
    expect(s.partnership.runs).toBe(9);
    s = applyBall(s, { runs: 0, dismissal: "caught" }, "Mitchell");
    expect(s.partnership).toEqual({ runs: 0, balls: 0 });
    s = applyBall(s, single, "Mitchell");
    expect(partnershipText(s)).toBe("1 (1)");
  });
});

describe("rates", () => {
  it("has no run rate before a ball is bowled, then runs per over", () => {
    expect(runRate(innings())).toBeNull();
    expect(rateText(runRate(innings()))).toBe("—");
    const s = bowl(innings(), [four, dot, single]);
    expect(legalBalls(s)).toBe(3);
    expect(runRate(s)).toBeCloseTo(10);
    expect(rateText(runRate(s))).toBe("10.00");
  });

  it("counts wides toward the score but not toward the rate's balls", () => {
    const s = bowl(innings(), [{ runs: 0, extra: { kind: "wide", runs: 1 } }, single]);
    expect(legalBalls(s)).toBe(1);
    expect(runRate(s)).toBeCloseTo(12);
  });

  it("asks for a required rate only while there is something to ask for", () => {
    expect(requiredRate(24, 12)).toBeCloseTo(12);
    expect(requiredRate(1, 1)).toBeCloseTo(6);
    // Target reached, or no balls left to reach it in: no rate, not infinity.
    expect(requiredRate(0, 12)).toBeNull();
    expect(requiredRate(-3, 12)).toBeNull();
    expect(requiredRate(5, 0)).toBeNull();
  });

  it("writes overs from a raw ball count", () => {
    expect(oversFromBalls(0)).toBe("0.0");
    expect(oversFromBalls(5)).toBe("0.5");
    expect(oversFromBalls(6)).toBe("1.0");
    expect(oversFromBalls(19)).toBe("3.1");
  });
});

describe("milestones", () => {
  it("announces a fifty or a hundred, and only when it is close", () => {
    expect(approachingMilestone(44)).toEqual({ at: 50, away: 6 });
    expect(approachingMilestone(95)).toEqual({ at: 100, away: 5 });
    expect(approachingMilestone(193)).toEqual({ at: 200, away: 7 });
    expect(approachingMilestone(12)).toBeNull();
    // On the milestone itself there is nothing left to approach.
    expect(approachingMilestone(50)).toBeNull();
    expect(approachingMilestone(100)).toBeNull();
    expect(approachingMilestone(0)).toBeNull();
  });
});
