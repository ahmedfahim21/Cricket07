/**
 * A full over, end to end, with no renderer.
 *
 * This is the iteration-1 acceptance check: six legal balls can be faced,
 * timing visibly changes the outcome, and a boundary, a dot and a dismissal
 * are all reachable. It drives the same modules the engine drives — the real
 * Rapier world, the real aiming solver, the real shot resolution, the real
 * fielding and the real scoring — rather than a mock of any of them.
 *
 * It lives here rather than in a browser because the interactive loop is
 * driven by requestAnimationFrame, which a headless pane throttles; the
 * physics and the laws do not need a canvas to be checked.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { CricketWorld, initPhysics } from "../physics/world";
import { buildDelivery, planFor, varyDelivery, type BowlerStyle } from "./bowling";
import { classifyLength } from "../physics/pitch";
import { resolveShot, type ShotAttempt } from "./shot";
import { catchTaken, fieldFor, resolveChase, runsAvailable } from "./fielding";
import { applyBall, newInnings, toOutcome, type Dismissal, type MatchState } from "./state";
import { BALL_RADIUS, STRIKER_STUMPS_Z, isBeyondBoundary } from "../dimensions";
import { mulberry32 } from "../mat/noise";

beforeAll(async () => {
  await initPhysics();
});

const NAMES = ["Sharma", "Patel", "Khan", "Mitchell", "Okafor", "Silva", "Brennan"];
const FIELD = fieldFor("right");

interface BallReport {
  arrivedAtCrease: boolean;
  lengthFromStumps: number;
  speedAtCrease: number;
  heightAtCrease: number;
  lineAtCrease: number;
  /** Where the struck ball came to rest or crossed the rope. */
  endX: number;
  endZ: number;
  apex: number;
  travelTime: number;
  clearedOnFull: boolean;
  beyondBoundary: boolean;
}

/** Run a delivery to the striker, then, if a shot connects, follow the ball. */
function playDelivery(
  world: CricketWorld,
  style: BowlerStyle,
  attempt: ShotAttempt | null,
  rand: () => number,
  seed: number
): { report: BallReport; outcome: ReturnType<typeof resolveShot> | null } {
  world.resetStumps();
  const plan = varyDelivery(planFor(style, { targetLength: 5 }), mulberry32(seed));
  world.release(buildDelivery(plan));

  const dt = 1 / 240;
  let arrived = false;
  const report: BallReport = {
    arrivedAtCrease: false,
    lengthFromStumps: 0,
    speedAtCrease: 0,
    heightAtCrease: 0,
    lineAtCrease: 0,
    endX: 0,
    endZ: 0,
    apex: 0,
    travelTime: 0,
    clearedOnFull: false,
    beyondBoundary: false,
  };

  // Phase 1: down the pitch to the striker.
  for (let i = 0; i < 1200 && !arrived; i++) {
    world.step(dt);
    const b = world.ball;
    if (b.position.z <= STRIKER_STUMPS_Z + 0.6) {
      arrived = true;
      report.arrivedAtCrease = true;
      report.speedAtCrease = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
      report.heightAtCrease = Math.max(BALL_RADIUS, b.position.y);
      report.lineAtCrease = b.position.x;
    }
  }
  report.lengthFromStumps = world.lastBounce?.lengthFromStumps ?? 0;

  if (!attempt || !arrived) return { report, outcome: null };

  const outcome = resolveShot(
    {
      length: classifyLength(report.lengthFromStumps),
      lineAtCrease: report.lineAtCrease,
      heightAtCrease: report.heightAtCrease,
      speed: report.speedAtCrease,
      hand: "right",
    },
    attempt
  );

  if (outcome.missed) return { report, outcome };

  // Phase 2: send it away and follow it.
  const el = outcome.exitElevation;
  const horizontal = outcome.exitSpeed * Math.cos(el);
  world.setBallVelocity({
    x: horizontal * Math.sin(outcome.exitDirection),
    y: outcome.exitSpeed * Math.sin(el),
    z: horizontal * Math.cos(outcome.exitDirection),
  });

  let bounced = false;
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    world.step(dt);
    t += dt;
    const b = world.ball;
    report.apex = Math.max(report.apex, b.position.y);
    if (b.position.y <= BALL_RADIUS * 1.5) bounced = true;

    if (isBeyondBoundary(b.position.x, b.position.z)) {
      report.beyondBoundary = true;
      report.clearedOnFull = !bounced;
      break;
    }
    const speed = Math.hypot(b.velocity.x, b.velocity.z);
    if (speed < 1.2 && b.position.y < BALL_RADIUS * 2.5) break;
    if (t > 8) break;
  }
  report.travelTime = t;
  report.endX = world.ball.position.x;
  report.endZ = world.ball.position.z;

  void rand;
  return { report, outcome };
}

/** Score a played delivery exactly the way the engine does. */
function score(
  state: MatchState,
  report: BallReport,
  outcome: ReturnType<typeof resolveShot> | null,
  rand: () => number
): MatchState {
  let dismissal: Dismissal | null = null;
  const track = {
    endX: report.endX,
    endZ: report.endZ,
    travelTime: report.travelTime,
    apex: report.apex,
    clearedOnFull: report.clearedOnFull,
  };

  if (outcome && !outcome.missed && !report.beyondBoundary) {
    if (catchTaken(outcome.chanceOfCatch, track, FIELD, rand)) dismissal = "caught";
  }

  const chase = resolveChase(track, FIELD);
  const ran = dismissal || report.beyondBoundary ? 0 : runsAvailable(chase.returnTime);

  return applyBall(
    state,
    toOutcome({
      clearedRope: report.beyondBoundary && report.clearedOnFull,
      reachedRope: report.beyondBoundary,
      ranRuns: ran,
      dismissal: dismissal ?? undefined,
      offTheBat: !!outcome && !outcome.missed,
    })
  );
}

function attempt(over: Partial<ShotAttempt> = {}): ShotAttempt {
  return { type: "ground", footwork: "front", aim: 0, square: false, timingError: 0, ...over };
}

describe("a full over", () => {
  it("completes six legal balls and leaves the innings in a sane state", () => {
    const world = new CricketWorld();
    const rand = mulberry32(99);
    let state = newInnings(NAMES);

    for (let ball = 0; ball < 6; ball++) {
      const { report, outcome } = playDelivery(
        world,
        "fast-medium",
        attempt({ timingError: 0.01 }),
        rand,
        ball + 1
      );
      expect(report.arrivedAtCrease).toBe(true);
      state = score(state, report, outcome, rand);
    }

    expect(state.overs).toBe(1);
    expect(state.ballsThisOver).toBe(0);
    expect(state.timeline).toHaveLength(6);
    expect(state.runs).toBeGreaterThanOrEqual(0);
    expect(state.wickets).toBeLessThanOrEqual(NAMES.length - 1);
    // Balls faced across both batsmen must equal the six legal deliveries.
    const faced = state.batsmen.reduce((n, b) => n + b.ballsFaced, 0);
    expect(faced).toBe(6);
  });

  it("hits a straight drive back past the BOWLER, not behind the keeper", () => {
    // The striker is at -Z and the bowler at +Z, so a straight shot must end
    // up at positive Z. Getting this sign wrong sends every shot behind the
    // batsman and leaves third man to fine leg as the only scoring area in
    // the game — which is exactly how it played before this was pinned.
    const world = new CricketWorld();
    const rand = mulberry32(21);
    const { report, outcome } = playDelivery(
      world,
      "fast-medium",
      attempt({ type: "ground", aim: 0, timingError: 0 }),
      rand,
      3
    );
    expect(outcome!.missed).toBe(false);
    expect(report.endZ).toBeGreaterThan(0);
  });

  it("puts the ball on the leg side when aimed there, and the off side when aimed there", () => {
    const world = new CricketWorld();
    const rand = mulberry32(22);
    const leg = playDelivery(world, "fast-medium", attempt({ aim: 1, square: true }), rand, 3);
    const off = playDelivery(world, "fast-medium", attempt({ aim: -1, square: true }), rand, 3);

    // +X is the leg side for a right-hander.
    expect(leg.report.endX).toBeGreaterThan(off.report.endX);
    expect(leg.report.endX).toBeGreaterThan(0);
    expect(off.report.endX).toBeLessThan(0);
  });

  it("can reach all round the wicket, not just one arc", () => {
    // Sweep the aim and confirm the landing spots actually spread out. A
    // single stuck scoring area is the symptom that matters to a player.
    const world = new CricketWorld();
    const rand = mulberry32(23);
    const spots: { x: number; z: number }[] = [];
    for (const aim of [-1, -0.5, 0, 0.5, 1]) {
      const { report } = playDelivery(
        world,
        "fast-medium",
        attempt({ aim, square: true, type: "ground" }),
        rand,
        3
      );
      spots.push({ x: report.endX, z: report.endZ });
    }
    const xs = spots.map((s) => s.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
    // And they must be monotonic in the aim, so the control is predictable.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("reaches the boundary from a well-timed lofted drive", () => {
    const world = new CricketWorld();
    const rand = mulberry32(4);
    const { report, outcome } = playDelivery(
      world,
      "fast-medium",
      attempt({ type: "lofted", timingError: 0, aim: 0 }),
      rand,
      3
    );
    expect(outcome!.missed).toBe(false);
    expect(report.beyondBoundary).toBe(true);
    expect(report.apex).toBeGreaterThan(3);
  });

  it("keeps a defensive push inside the ring for no run", () => {
    const world = new CricketWorld();
    const rand = mulberry32(5);
    const { report, outcome } = playDelivery(
      world,
      "fast-medium",
      attempt({ type: "defensive", timingError: 0 }),
      rand,
      3
    );
    expect(outcome!.missed).toBe(false);
    expect(report.beyondBoundary).toBe(false);
    // Dropped at the batsman's feet, not driven into the covers.
    expect(Math.hypot(report.endX, report.endZ - STRIKER_STUMPS_Z)).toBeLessThan(30);

    const chase = resolveChase(
      {
        endX: report.endX,
        endZ: report.endZ,
        travelTime: report.travelTime,
        apex: report.apex,
        clearedOnFull: false,
      },
      FIELD
    );
    expect(runsAvailable(chase.returnTime)).toBe(0);
  });

  it("misses entirely when the timing is badly wrong", () => {
    const world = new CricketWorld();
    const rand = mulberry32(6);
    const { outcome } = playDelivery(
      world,
      "fast-medium",
      attempt({ timingError: 0.4 }),
      rand,
      3
    );
    expect(outcome!.missed).toBe(true);
    expect(outcome!.band).toBe("missed");
  });

  it("turns good timing into boundaries while an edge stays short", () => {
    const world = new CricketWorld();
    const rand = mulberry32(7);
    const boundaries: boolean[] = [];
    for (const timingError of [0, 0.10, 0.22]) {
      const { report, outcome } = playDelivery(
        world,
        "fast-medium",
        attempt({ type: "ground", timingError }),
        rand,
        3
      );
      expect(outcome!.missed).toBe(false);
      boundaries.push(report.beyondBoundary);
    }
    // Distance is capped at an elliptical rope, so it cannot rank two fours.
    expect(boundaries).toEqual([true, true, false]);
  });

  it("can be bowled by leaving a straight ball alone", () => {
    const world = new CricketWorld();
    world.resetStumps();
    // Aim it straight at the top of middle stump and offer no shot.
    world.release(
      buildDelivery(planFor("fast-medium", { targetLength: 6, targetLine: 0 }))
    );
    let hitStumps = false;
    for (let i = 0; i < 1500; i++) {
      world.step(1 / 240);
      if (world.strikerStumpsBroken()) {
        hitStumps = true;
        break;
      }
      if (world.ball.position.z < STRIKER_STUMPS_Z - 4) break;
    }
    expect(hitStumps).toBe(true);
  });

  it("plays every bowling style without the ball going missing", () => {
    const world = new CricketWorld();
    const rand = mulberry32(11);
    for (const style of ["fast", "fast-medium", "medium", "off-spin", "leg-spin"] as const) {
      const { report, outcome } = playDelivery(world, style, attempt(), rand, 3);
      expect(report.arrivedAtCrease).toBe(true);
      expect(outcome!.missed).toBe(false);
      expect(Number.isFinite(report.endX)).toBe(true);
      expect(Number.isFinite(report.endZ)).toBe(true);
      // Ball must end up somewhere on the planet.
      expect(Math.hypot(report.endX, report.endZ)).toBeLessThan(200);
    }
  });
});
