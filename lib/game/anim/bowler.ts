/**
 * The bowler: run-up, delivery stride, release, follow-through.
 *
 * Built from how a pace bowler actually moves, phase by phase:
 *
 *   RUN-UP       accelerates from a walk to top speed over the approach. The
 *                stride is stretched or shortened fractionally over the whole
 *                run so the last stride lands on the right foot in the right
 *                place — which is exactly what bowlers do to avoid no-balls.
 *   BOUND        a jump off the LEFT foot, coiling side-on in the air.
 *   BACK FOOT    lands sideways. Hips half-open, shoulders still closed: the
 *                hip-shoulder separation that pace comes from.
 *   FRONT FOOT   braces behind the popping crease. The body brakes over it and
 *                the front arm pulls down hard, whipping the trunk round.
 *   RELEASE      shoulders square, arm vertical, leaning away so the arm is as
 *                high as it can be. The ball leaves from THIS HAND, wherever
 *                the choreography has put it.
 *   FOLLOW-THRU  arm across the body, trunk folded, a few decelerating steps
 *                veering off the pitch.
 *
 * During the stride the rig's root stays fixed at the point where the run-up
 * handed over, and the travel is carried by the pelvis and the footprints —
 * so planted feet are simply constant targets and cannot slide.
 */

import * as THREE from "three";
import { RIG_SCALE, SKELETON, type PlayerRig } from "../assets/kit";
import type { BowlerStyle } from "../match/bowling";
import { C, Pose, PoseValues, applyPose, copyPose, jointPoint, makePose, setPose } from "./pose";
import { Track, type Key } from "./track";
import { cycleLength, dutyFactor, gaitPose, idlePose } from "./locomotion";

export interface Approach {
  /** Metres from the mark to the start of the delivery stride. */
  runLength: number;
  /** Top speed, m/s. */
  vMax: number;
  /** Acceleration from the mark, m/s². */
  accel: number;
}

export const APPROACH: Record<BowlerStyle, Approach> = {
  fast: { runLength: 26, vMax: 7.1, accel: 3.4 },
  "fast-medium": { runLength: 22, vMax: 6.4, accel: 3.2 },
  medium: { runLength: 18, vMax: 5.5, accel: 3.0 },
  "off-spin": { runLength: 8, vMax: 3.3, accel: 2.6 },
  "leg-spin": { runLength: 9, vMax: 3.5, accel: 2.6 },
};

/** Speed at the start of the run: bowlers walk the first couple of steps. */
const START_SPEED = 1.1;

/**
 * Speed after `s` metres of run-up: uniform acceleration capped at top speed.
 * v = sqrt(v0² + 2as).
 */
export function approachSpeed(a: Approach, s: number): number {
  return Math.min(a.vMax, Math.sqrt(START_SPEED * START_SPEED + 2 * a.accel * Math.max(0, s)));
}

/** Where in the gait cycle the left foot is mid-stance: the take-off foot. */
function takeoffCycle(speed: number): number {
  return dutyFactor(speed) * 0.42;
}

/**
 * Stride scale that makes the run-up finish on the take-off foot.
 *
 * Cycles covered = ∫ ds / cycleLength(v(s)). Round that to the nearest count
 * ending at the take-off point and stretch every stride by the ratio — a few
 * percent at most, invisible, and the delivery stride always starts right.
 */
export function strideScale(a: Approach): number {
  const n = 400;
  let cycles = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * a.runLength;
    cycles += a.runLength / n / RIG_SCALE / cycleLength(approachSpeed(a, s) / RIG_SCALE);
  }
  const want = takeoffCycle(a.vMax / RIG_SCALE);
  const target = Math.max(1, Math.round(cycles - want)) + want;
  return cycles / target;
}

const S = SKELETON;
const G = S.ankleH;

/**
 * The delivery stride as keyframes, in the root space of the hand-over point.
 *
 * `start` is the live pose at hand-over, so there is no pop into the stride.
 * `sp` scales forward travel with approach speed (a spinner's stride is short),
 * `tm` scales time. `look` is the batsman's stumps in this root space.
 */
export function deliveryKeys(
  start: Pose,
  v0: number,
  look: THREE.Vector3
): { keys: Key[]; release: number } {
  const sp = THREE.MathUtils.clamp(v0 / 6.4, 0.5, 1.15);
  const tm = THREE.MathUtils.clamp(Math.sqrt(6.4 / v0), 0.9, 1.4);
  const T = (t: number) => t * tm;
  const Z = (z: number) => z * sp;

  const k0 = copyPose(makePose(), start);
  // The front arm starts from hanging down, expressed at 2PI so it rises
  // forward (decreasing angle) rather than swinging back over the top.
  setPose(k0, { aimLSwing: Math.PI * 2, aimRSwing: 0, aimLW: 0, aimRW: 0 });
  const pL = { x: start[C.footLX], z: start[C.footLZ] };

  const eyes: PoseValues = { lookX: look.x, lookY: look.y, lookZ: look.z, lookW: 1 };
  const key = (t: number, v: PoseValues, hold = false): Key => ({
    t: T(t),
    pose: makePose({ ...eyes, footLW: 1, footRW: 1, aimLW: 1, aimRW: 1, ...v }),
    hold,
  });

  // BFC and FFC prints, in the hand-over root space.
  const bfc = { x: 0.14, z: Z(-2.45) };
  const ffc = { x: -0.06, z: Z(FFC_Z) };

  const keys: Key[] = [
    { t: 0, pose: k0 },

    // Last contact on the take-off (left) print: rolling onto the toe while
    // the pelvis carries on over it and the right knee starts to drive.
    key(0.07, {
      pelvisZ: Z(-0.42), pelvisY: 0.0, pelvisYaw: -0.12, pelvisPitch: 0.1,
      torsoYaw: -0.1, torsoPitch: 0.12,
      footLX: pL.x, footLY: G + 0.07, footLZ: pL.z - 0.05, footLPitch: -0.55,
      footRX: 0.1, footRY: 0.3, footRZ: Z(-0.42) - 0.05, footRPitch: 0.15,
      aimRSwing: 0.15, aimRElbow: 0.5,
      aimLSwing: 5.6, aimLElbow: 0.6,
    }),

    // Take-off: the left foot leaves, the right knee is up in front, the
    // arms load — bowling arm down by the hip, front arm rising.
    key(0.14, {
      pelvisZ: Z(-0.86), pelvisY: 0.08, pelvisYaw: -0.3, pelvisPitch: 0.06,
      torsoYaw: -0.2, torsoPitch: 0.08,
      footLX: pL.x, footLY: 0.2, footLZ: Z(-0.86) + 0.42, footLPitch: -0.7,
      footRX: 0.1, footRY: 0.42, footRZ: Z(-0.86) - 0.15, footRPitch: 0.2,
      aimRSwing: 0.25, aimRElbow: 0.4,
      aimLSwing: 5.2, aimLElbow: 0.5,
    }),

    // In the air, coiling side-on. Front arm reaching up at the batsman.
    key(0.3, {
      pelvisZ: Z(-1.9), pelvisY: 0.16, pelvisYaw: -0.85, pelvisPitch: 0.05,
      torsoYaw: -0.45, torsoRoll: 0.1,
      footLX: -0.05, footLY: 0.3, footLZ: Z(-1.9) + 0.35, footLPitch: -0.4,
      footRX: 0.12, footRY: 0.25, footRZ: Z(-1.9) - 0.1, footRYaw: -0.8,
      aimRSwing: 0.7, aimRElbow: 0.3, aimRSide: 0.1,
      aimLSwing: 3.95, aimLElbow: 0.2, aimLSide: -0.1,
    }),

    // Back-foot contact: lands sideways; leans back; hips half open,
    // shoulders closed.
    key(0.44, {
      pelvisX: 0.05, pelvisZ: Z(-2.35), pelvisY: -0.02, pelvisYaw: -1.05,
      torsoYaw: -0.4, torsoRoll: 0.1, torsoPitch: -0.05,
      footRX: bfc.x, footRY: G, footRZ: bfc.z, footRYaw: -1.3,
      footLX: -0.05, footLY: 0.3, footLZ: Z(-2.35) - 0.55, footLYaw: -0.3,
      aimRSwing: 1.0, aimRElbow: 0.2,
      aimLSwing: 3.9, aimLElbow: 0.15,
    }),

    // Front-foot contact: braced. Maximum hip-shoulder separation.
    key(0.58, {
      pelvisX: 0.0, pelvisZ: Z(-3.2), pelvisY: -0.03, pelvisYaw: -0.75,
      torsoYaw: -0.55, torsoRoll: 0.25, torsoPitch: 0.05,
      footLX: ffc.x, footLY: G, footLZ: ffc.z, footLYaw: -0.35,
      // Back foot up on its toe and dragging: no longer bearing weight.
      footRX: bfc.x, footRY: G + 0.14, footRZ: bfc.z - 0.05, footRYaw: -1.3, footRPitch: -0.8,
      aimRSwing: 2.35, aimRElbow: 0.05, aimRSide: 0.05,
      aimLSwing: 4.3, aimLElbow: 0.6,
    }),

    // Release: posted up over a straight front leg, shoulders square, arm
    // just past vertical. Height comes from leaning AWAY (sideways), not from
    // bending forward — the trunk only folds after the ball has gone.
    key(0.66, {
      pelvisX: -0.03, pelvisZ: ffc.z + 0.12, pelvisY: 0.0, pelvisYaw: -0.2,
      torsoYaw: 0.25, torsoRoll: 0.4, torsoPitch: 0.1,
      footLX: ffc.x, footLY: G, footLZ: ffc.z, footLYaw: -0.35,
      footRX: 0.1, footRY: G + 0.22, footRZ: Z(-2.8), footRYaw: -1.0, footRPitch: -0.9,
      aimRSwing: 3.2, aimRElbow: 0.02, aimRSide: -0.08,
      aimLSwing: 5.9, aimLElbow: 1.0,
    }),

    // Follow-through: arm sweeping across, trunk folding, back leg through.
    key(0.78, {
      pelvisX: -0.08, pelvisZ: Z(-3.85), pelvisY: -0.1, pelvisYaw: 0.25,
      torsoYaw: 0.6, torsoRoll: 0.05, torsoPitch: 0.75,
      footLX: ffc.x, footLY: G, footLZ: ffc.z, footLYaw: -0.35,
      footRX: 0.02, footRY: 0.2, footRZ: Z(-3.7), footRYaw: -0.2,
      aimRSwing: 4.7, aimRElbow: 0.15, aimRSide: -0.5,
      aimLSwing: 6.6, aimLElbow: 0.8,
    }),

    key(0.95, {
      pelvisX: -0.2, pelvisZ: Z(-4.45), pelvisY: -0.06, pelvisYaw: 0.3,
      torsoYaw: 0.5, torsoPitch: 0.55,
      footRX: -0.3, footRY: G, footRZ: Z(-4.55), footRYaw: 0.2,
      // Front foot has left its print and is swinging through.
      footLX: -0.3, footLY: 0.22, footLZ: Z(-4.15), footLYaw: -0.1, footLPitch: -0.3,
      aimRSwing: 5.9, aimRElbow: 0.3, aimRSide: -0.7,
      aimLSwing: 6.4, aimLElbow: 0.6,
    }),

    key(1.15, {
      pelvisX: -0.5, pelvisZ: Z(-5.2), pelvisY: -0.03, pelvisYaw: 0.35,
      torsoYaw: 0.2, torsoPitch: 0.3,
      footLX: -0.75, footLY: G, footLZ: Z(-5.35), footLYaw: 0.35,
      footRX: -0.3, footRY: G + 0.08, footRZ: Z(-4.55), footRYaw: 0.2, footRPitch: -0.5,
      aimRSwing: 6.2, aimRElbow: 0.5, aimRSide: -0.3, aimRW: 0.5,
      aimLSwing: 6.3, aimLElbow: 0.5, aimLW: 0.5,
      shLFlex: 0.1, shRFlex: 0.1, elbowL: 0.4, elbowR: 0.4,
    }),

    key(1.42, {
      pelvisX: -0.85, pelvisZ: Z(-5.85), pelvisY: -0.01, pelvisYaw: 0.4,
      torsoPitch: 0.12,
      footRX: -1.05, footRY: G, footRZ: Z(-5.95), footRYaw: 0.4,
      footLX: -0.75, footLY: G, footLZ: Z(-5.35), footLYaw: 0.35,
      aimRW: 0, aimLW: 0, lookW: 0.3,
      shLFlex: 0.05, shRFlex: 0.05, shLAbd: 0.1, shRAbd: 0.1, elbowL: 0.25, elbowR: 0.25,
    }),

    key(1.8, {
      pelvisX: -1.1, pelvisZ: Z(-6.05), pelvisY: -0.01, pelvisYaw: 0.45,
      footLX: -1.25, footLY: G, footLZ: Z(-6.1), footLYaw: 0.55,
      footRX: -0.98, footRY: G, footRZ: Z(-6.05), footRYaw: 0.3,
      aimRW: 0, aimLW: 0, lookW: 0,
      shLAbd: 0.1, shRAbd: 0.1, elbowL: 0.2, elbowR: 0.2,
    }, true),
  ];
  return { keys, release: T(0.66) };
}

/** Forward-travel scale of the stride for an approach (see deliveryKeys). */
function strideTravel(a: Approach): number {
  return THREE.MathUtils.clamp(a.vMax / RIG_SCALE / 6.4, 0.5, 1.15);
}

/** Front-foot landing, root space of the hand-over point, before scaling. */
const FFC_Z = -3.6;

/**
 * World z where the stride must begin so the front foot lands at `frontFootZ`.
 * The Laws require part of the front foot behind the popping crease; the game
 * aims a little behind it so a full approach is never a no-ball.
 */
export function deliveryOrigin(a: Approach, frontFootZ: number): number {
  return frontFootZ - FFC_Z * strideTravel(a) * RIG_SCALE;
}

/** Clip time of front-foot contact, scaled for an approach. */
export function frontFootTime(a: Approach): number {
  return 0.58 * THREE.MathUtils.clamp(Math.sqrt(6.4 / (a.vMax / RIG_SCALE)), 0.9, 1.4);
}

/* ------------------------------------------------------------------ *
 * The controller
 * ------------------------------------------------------------------ */

export type BowlerState = "mark" | "runup" | "delivery" | "settle";

const _v = new THREE.Vector3();

export class BowlerAnimator {
  readonly pose = makePose();
  /** Root position in the world. The bowler always faces -Z. */
  readonly world = new THREE.Vector3();
  state: BowlerState = "mark";

  /** Fired once, on the frame the ball leaves the hand, with the hand's world position. */
  onRelease?: (handWorld: THREE.Vector3) => void;

  private approach: Approach = APPROACH["fast-medium"];
  private scale = 1;
  private originZ = 0;
  private lineX = 0;
  private lookWorld = new THREE.Vector3();
  private s = 0;
  private speed = 0;
  private phase = 0;
  private t = 0;
  private clock = 0;
  private track: Track | null = null;
  private releaseAt = 0;
  private released = false;
  private settleFrom = makePose();
  private scratch = makePose();

  constructor(readonly rig: PlayerRig) {}

  /**
   * Stand at the mark for a delivery whose stride begins at world z `originZ`
   * on the line `lineX`, looking at `lookWorld` (the batsman's stumps).
   */
  setup(approach: Approach, originZ: number, lineX: number, lookWorld: THREE.Vector3): void {
    this.approach = approach;
    this.scale = strideScale(approach);
    this.originZ = originZ;
    this.lineX = lineX;
    this.lookWorld.copy(lookWorld);
    this.state = "mark";
    this.s = 0;
    this.speed = 0;
    this.phase = 0;
    this.t = 0;
    this.track = null;
    this.released = false;
    this.world.set(lineX, 0, originZ + approach.runLength);
    idlePose(this.pose, this.clock);
    this.write();
  }

  startRunup(): void {
    if (this.state !== "mark") return;
    this.state = "runup";
    this.s = 0;
    this.phase = 0;
  }

  /** Seconds from the start of the delivery stride to the release. */
  get releaseTime(): number {
    return this.releaseAt;
  }

  /** Normalized approach distance for cues that settle before the delivery stride. */
  get runupProgress(): number {
    return this.state === "mark" ? 0 : this.state === "runup" ? this.s / this.approach.runLength : 1;
  }

  update(dt: number): void {
    this.clock += dt;
    switch (this.state) {
      case "mark":
        idlePose(this.pose, this.clock, 3);
        break;
      case "runup":
        this.updateRunup(dt);
        break;
      case "delivery":
        this.updateDelivery(dt);
        break;
      case "settle":
        this.updateSettle(dt);
        break;
    }
    this.write();
  }

  private updateRunup(dt: number): void {
    const a = this.approach;
    const prevSpeed = this.speed;
    this.speed = approachSpeed(a, this.s);
    let ds = this.speed * dt;
    const handover = this.s + ds >= a.runLength;
    if (handover) ds = a.runLength - this.s;
    this.s += ds;

    const vRoot = this.speed / RIG_SCALE;
    this.phase += (2 * Math.PI * (ds / RIG_SCALE)) / (this.scale * cycleLength(vRoot));
    const accel = dt > 0 ? (this.speed - prevSpeed) / dt : 0;
    gaitPose(this.pose, this.phase % (Math.PI * 2), vRoot, THREE.MathUtils.clamp(accel * 0.05, 0, 0.2));
    this.world.set(this.lineX, 0, this.originZ + a.runLength - this.s);

    if (handover) this.beginDelivery();
  }

  private beginDelivery(): void {
    this.world.set(this.lineX, 0, this.originZ);
    // Stumps in the root space of the hand-over point (root faces -Z, yaw 0).
    const look = this.lookWorld.clone().sub(this.world).divideScalar(RIG_SCALE);
    const { keys, release } = deliveryKeys(this.pose, this.speed / RIG_SCALE, look);
    this.track = new Track(keys);
    this.releaseAt = release;
    this.t = 0;
    this.released = false;
    this.state = "delivery";
  }

  private updateDelivery(dt: number): void {
    const track = this.track!;
    this.t += dt;
    track.evaluate(this.t, this.pose);

    if (!this.released && this.t >= this.releaseAt) {
      this.released = true;
      // Pose exactly at the release instant, so the hand is where the arm is
      // vertical rather than a frame either side of it.
      track.evaluate(this.releaseAt, this.scratch);
      this.write(this.scratch);
      this.onRelease?.(this.handWorld(new THREE.Vector3()));
      this.write();
    }

    if (this.t >= track.end) {
      // Move the root to where the pelvis has walked to, and carry on from
      // there with the travel taken out of the pose.
      const dx = this.pose[C.pelvisX];
      const dz = this.pose[C.pelvisZ];
      this.world.x += dx * RIG_SCALE;
      this.world.z += dz * RIG_SCALE;
      const p = this.pose;
      p[C.pelvisX] = 0;
      p[C.pelvisZ] = 0;
      p[C.footLX] -= dx;
      p[C.footLZ] -= dz;
      p[C.footRX] -= dx;
      p[C.footRZ] -= dz;
      copyPose(this.settleFrom, p);
      this.t = 0;
      this.state = "settle";
    }
  }

  private updateSettle(dt: number): void {
    this.t += dt;
    idlePose(this.scratch, this.clock, 3);
    const k = Math.min(1, this.t / 0.6);
    const e = k * k * (3 - 2 * k);
    for (let i = 0; i < this.pose.length; i++) {
      this.pose[i] = this.settleFrom[i] + (this.scratch[i] - this.settleFrom[i]) * e;
    }
  }

  /** The bowling hand, in the world. */
  handWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.handR.getWorldPosition(out);
  }

  /** Root-space position of the bowling hand, for callers that pose offline. */
  handRoot(out: THREE.Vector3): THREE.Vector3 {
    return jointPoint(this.rig, this.rig.handR, _v.set(0, 0, 0), out);
  }

  private write(p: Pose = this.pose): void {
    this.rig.root.position.copy(this.world);
    this.rig.root.rotation.set(0, 0, 0);
    applyPose(this.rig, p);
  }
}

/**
 * Run a delivery offline and report where and when the ball leaves the hand.
 * The choreography is deterministic, so the game can aim the delivery from
 * the true release point before the bowler has taken a step.
 */
export function simulateRelease(
  rig: PlayerRig,
  approach: Approach,
  originZ: number,
  lineX: number,
  lookWorld: THREE.Vector3,
  dt = 1 / 120
): { hand: THREE.Vector3; time: number } {
  const b = new BowlerAnimator(rig);
  b.setup(approach, originZ, lineX, lookWorld);
  b.startRunup();
  let hand: THREE.Vector3 | null = null;
  b.onRelease = (h) => {
    hand = h.clone();
  };
  let t = 0;
  while (!hand && t < 20) {
    b.update(dt);
    t += dt;
  }
  if (!hand) throw new Error("simulated delivery never released the ball");
  return { hand, time: t };
}
