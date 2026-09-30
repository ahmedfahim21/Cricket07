/**
 * Standing, walking and running.
 *
 * Kept from the city engine's gait, because each was a bug fix there:
 *   - Phase advances with DISTANCE covered, never with the clock.
 *   - A run is not a walk played fast: the stride opens, the heel kicks higher,
 *     the elbows bend and stay bent, the trunk leans in.
 *   - Arms counter-swing the legs.
 *   - Idle is alive: breathing and a slow weight shift.
 *
 * Changed from it: the legs are placed by FOOTPRINTS, not swung by sine waves.
 * With a sinusoidal hip the planted foot moves along the ground at a
 * sinusoidal speed while the body moves at a constant one, so it has to slide —
 * measured, the foot slid at ~100% of body speed. Here each stance foot sits on
 * a print that is fixed in the world (it moves back through root space at
 * exactly body speed), rolls from heel to toe as a real foot does, then swings
 * in an arc to the next print, and IK solves the leg to meet it. The pelvis
 * height falls out of what the legs can reach, which is what gives a walk its
 * inverted-pendulum rise over the planted foot.
 */

import { SKELETON } from "../assets/kit";
import { C, Pose, setPose } from "./pose";

const S = SKELETON;

/** One full gait cycle (two steps) in metres, at a given speed in m/s. */
export function cycleLength(speed: number): number {
  // Fitted to real cadence: ~1.55m at a 1.4 m/s walk, ~4.1m at a 7 m/s sprint.
  return 0.91 + 0.455 * Math.max(0, speed);
}

/**
 * Fraction of the cycle each foot spends on the ground. Above 0.5 both feet
 * are down at once (a walk); below it there is a flight phase (a run).
 */
export function dutyFactor(speed: number): number {
  // Ground contact shortens fast once running starts: a jog is already well
  // under half the cycle, a sprint about a fifth. Linear in speed left the jog
  // with a 1.3m stance, which read as a lunge with the back foot glued down.
  return lerp(0.6, 0.21, Math.sqrt(runAmount(speed)));
}

/** Advance a gait phase (radians) by the distance just covered. */
export function advancePhase(phase: number, distance: number, speed: number): number {
  return (phase + (2 * Math.PI * distance) / cycleLength(speed)) % (Math.PI * 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** 0 at a walk, 1 at a flat-out sprint. */
export function runAmount(speed: number): number {
  return clamp01((speed - 1.8) / 5);
}

/* ------------------------------------------------------------------ *
 * Feet
 * ------------------------------------------------------------------ */

export type FootState = {
  /** Ankle target, root space. */
  x: number;
  y: number;
  z: number;
  /** Toe up > 0. */
  pitch: number;
  /** 1 while planted. */
  planted: number;
  /** -1 (right back) .. +1 (right forward): how far forward this leg is. */
  reach: number;
  /** 0..1, peaking mid-stance: how much weight the leg is taking. */
  load: number;
};

/**
 * Where a foot is at cycle position `u` (0..1, touchdown at 0).
 *
 * Stance: the footprint is still in the world, so in root space it travels
 * back by exactly `stanceLen` over the stance. The foot pivots on its heel
 * just after touchdown and on its toe before lift-off, so the ANKLE rises at
 * both ends while the ground contact stays put.
 */
export function footAt(u: number, speed: number, side: -1 | 1, out: FootState): FootState {
  const run = runAmount(speed);
  const duty = dutyFactor(speed);
  const stanceLen = duty * cycleLength(speed) * clamp01(speed / 0.6);
  // Touchdown a little ahead of the hip, lift-off further behind it.
  const aheadAt = -stanceLen * lerp(0.42, 0.36, run);
  const x = side * lerp(0.105, 0.075, run);

  if (u < duty) {
    const s = u / duty;
    const flatZ = aheadAt + stanceLen * s;
    // Heel strike, flat, toe-off.
    const heelPitch = run > 0.5 ? 0 : 0.22 * (1 - smooth(clamp01(s / 0.18)));
    const toePitch = -0.7 * Math.pow(clamp01((s - 0.58) / 0.42), 1.5);
    let y = S.ankleH;
    let z = flatZ;
    if (heelPitch > 0) {
      // Rotating about the heel lifts the ankle a little and moves it back.
      y += S.heel * Math.sin(heelPitch);
      z += S.heel * (1 - Math.cos(heelPitch));
    } else if (toePitch < 0) {
      // Rotating about the toe raises the ankle and draws it forward.
      y += S.toe * Math.sin(-toePitch);
      z -= S.toe * (1 - Math.cos(toePitch));
    }
    out.x = x;
    out.y = y;
    out.z = z;
    out.pitch = heelPitch + toePitch;
    out.planted = 1;
    out.reach = 1 - 2 * s;
    out.load = Math.sin(Math.PI * s);
    return out;
  }

  // Swing: from where the toe left to the next touchdown, in an arc. A runner
  // folds the heel up high behind early in the swing; a walker barely clears.
  const s = (u - duty) / (1 - duty);
  const fromY = S.ankleH + S.toe * Math.sin(0.7);
  const fromZ = aheadAt + stanceLen - S.toe * (1 - Math.cos(0.7));
  const toY = S.ankleH + (run > 0.5 ? 0 : S.heel * Math.sin(0.22));
  const k = smooth(s);
  // A sprinter's heel comes up toward the seat early and the foot stays high
  // while the knee drives through, so the lift curve is fattened, not peaked.
  const lift = lerp(0.07, 0.44, run) * Math.pow(Math.sin(Math.PI * Math.pow(s, lerp(1, 0.7, run))), lerp(1, 0.6, run));
  out.x = x;
  out.y = lerp(fromY, toY, k) + lift;
  // A runner's heel stays back until the knee drives through.
  out.z = lerp(fromZ, aheadAt, lerp(k, smooth(k), run));
  out.pitch = lerp(-0.7, run > 0.5 ? -0.1 : 0.22, k) + Math.sin(Math.PI * s) * 0.2;
  out.planted = 0;
  out.reach = -1 + 2 * s;
  out.load = 0;
  return out;
}

/* ------------------------------------------------------------------ *
 * Poses
 * ------------------------------------------------------------------ */

const _fL: FootState = { x: 0, y: 0, z: 0, pitch: 0, planted: 0, reach: 0, load: 0 };
const _fR: FootState = { x: 0, y: 0, z: 0, pitch: 0, planted: 0, reach: 0, load: 0 };

function plantFeet(out: Pose, lx: number, lz: number, lyaw: number, rx: number, rz: number, ryaw: number) {
  setPose(out, {
    footLX: lx, footLY: S.ankleH, footLZ: lz, footLYaw: lyaw, footLPitch: 0, footLW: 1,
    footRX: rx, footRY: S.ankleH, footRZ: rz, footRYaw: ryaw, footRPitch: 0, footRW: 1,
  });
}

/**
 * Standing, but alive. `t` is wall-clock seconds; `seed` offsets the cycle so a
 * field of eleven does not breathe in unison. Feet stay planted; the pelvis
 * moves over them.
 */
export function idlePose(out: Pose, t: number, seed = 0): Pose {
  out.fill(0);
  const breath = Math.sin(t * 1.5 + seed * 2.1);
  // Slower than the breath and out of phase with it, so the two never line up
  // into one visible bounce.
  const shift = Math.sin(t * 0.55 + seed * 1.3);
  plantFeet(out, -0.12, -0.02, 0.12, 0.12, 0.0, -0.12);
  return setPose(out, {
    pelvisX: shift * 0.025,
    pelvisY: breath * 0.004 - 0.012 - Math.abs(shift) * 0.01,
    pelvisYaw: shift * 0.03,
    pelvisRoll: -shift * 0.035,
    torsoRoll: shift * 0.02,
    torsoPitch: 0.03,
    shLFlex: 0.05 + breath * 0.02,
    shRFlex: 0.03 + breath * 0.02,
    shLAbd: 0.1,
    shRAbd: 0.1,
    elbowL: 0.18 + breath * 0.03,
    elbowR: 0.22 + breath * 0.03,
  });
}

/**
 * A fielder's "set" position as the bowler delivers: feet wide, knees bent,
 * weight forward on the balls of the feet, hands out in front ready to move.
 */
export function readyPose(out: Pose, t: number, seed = 0): Pose {
  out.fill(0);
  const sway = Math.sin(t * 2.2 + seed) * 0.012;
  plantFeet(out, -0.21, -0.02, 0.18, 0.21, -0.02, -0.18);
  return setPose(out, {
    pelvisY: -0.2 + sway,
    pelvisZ: 0.07,
    pelvisPitch: 0.3,
    torsoPitch: 0.3,
    headPitch: -0.5,
    shLFlex: 0.8,
    shRFlex: 0.8,
    shLAbd: 0.22,
    shRAbd: 0.22,
    elbowL: 0.55,
    elbowR: 0.55,
  });
}

/**
 * Walk to sprint by speed (m/s). `phase` in radians, advanced by
 * `advancePhase`; `lean` is extra forward lean from acceleration, radians.
 */
export function gaitPose(out: Pose, phase: number, speed: number, lean = 0): Pose {
  out.fill(0);
  const run = runAmount(speed);
  const amp = clamp01(speed / 1.2);
  const u = (phase / (Math.PI * 2) + 1) % 1;
  footAt(u, speed, -1, _fL);
  footAt((u + 0.5) % 1, speed, 1, _fR);

  const armSwing = lerp(0.3, 0.9, run) * amp;
  const elbow = lerp(0.2, 1.5, run);
  // Arms counter the legs: the left arm comes forward as the left leg goes back.
  const armL = -_fL.reach;
  const armR = -_fR.reach;

  setPose(out, {
    footLX: _fL.x, footLY: _fL.y, footLZ: _fL.z, footLPitch: _fL.pitch, footLW: 1,
    footRX: _fR.x, footRY: _fR.y, footRZ: _fR.z, footRPitch: _fR.pitch, footRW: 1,
    // A walker's stance leg straightens and the legs' reach sets the height.
    // A runner dips onto a flexed knee at mid-stance and rises in flight.
    pelvisY: -run * (0.02 + 0.08 * Math.max(_fL.load, _fR.load)),
    pelvisPitch: lerp(0.02, 0.1, run) + lean * 0.4,
    // Pelvis swings with the leading leg; the shoulders counter it.
    pelvisYaw: _fL.reach * lerp(0.07, 0.12, run) * amp,
    pelvisRoll: (_fL.planted - _fR.planted) * lerp(0.02, 0.03, run),
    torsoYaw: -_fL.reach * lerp(0.12, 0.28, run) * amp,
    torsoPitch: lerp(0.04, 0.3, run) + lean * 0.6,
    // Eyes stay level while the trunk leans.
    headPitch: -lerp(0.06, 0.32, run) - lean * 0.9,
    shLFlex: armL * armSwing + 0.05,
    shRFlex: armR * armSwing + 0.05,
    shLAbd: 0.08,
    shRAbd: 0.08,
    elbowL: elbow + Math.max(0, armL) * 0.35,
    elbowR: elbow + Math.max(0, armR) * 0.35,
  });
  out[C.footLYaw] = 0.05;
  out[C.footRYaw] = -0.05;
  return out;
}
