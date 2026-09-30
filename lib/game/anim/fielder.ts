/**
 * Fielders and the wicketkeeper.
 *
 * A fielder is a body moving across the ground under real limits: it
 * accelerates and brakes at a finite rate, cannot turn on the spot at full
 * sprint, leans into acceleration, and its gait phase advances with the
 * distance its feet actually cover. Then the set pieces: walking in as the
 * bowler runs up, the "set" crouch at delivery, stooping to pick the ball up,
 * and throwing it back from a side-on base.
 *
 * World placement is `world` (root position) and `yaw` (0 faces -Z).
 */

import * as THREE from "three";
import { RIG_SCALE, SKELETON, type PlayerRig } from "../assets/kit";
import { C, Pose, PoseValues, applyPose, copyPose, makePose, setPose } from "./pose";
import { Track, type Key } from "./track";
import { advancePhase, gaitPose, idlePose, readyPose } from "./locomotion";

const G = SKELETON.ankleH;

/** Yaw that makes a figure (which faces -Z) look along ground vector (dx, dz). */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export type FielderState =
  | "stand"
  | "walkIn"
  | "set"
  | "move"
  | "pickup"
  | "throw"
  | "catch";

export interface MoveLimits {
  vMax: number;
  accel: number;
  brake: number;
}

export const SPRINT: MoveLimits = { vMax: 7.2, accel: 5, brake: 7 };
export const JOG: MoveLimits = { vMax: 3.4, accel: 3, brake: 4 };
export const WALK: MoveLimits = { vMax: 1.5, accel: 2, brake: 3 };

/* ------------------------------------------------------------------ *
 * Set pieces
 * ------------------------------------------------------------------ */

/**
 * Stooping to pick up a ball at `ball` (root space, on the ground in front).
 * Feet split, knees bent, back bent, throwing hand to the ball. The ball is
 * gathered at `grabT`.
 */
export function pickupKeys(from: Pose, ball: THREE.Vector3): { keys: Key[]; grabT: number } {
  const k0 = copyPose(makePose(), from);
  const low = makePose({
    footLX: -0.16, footLY: G, footLZ: -0.3, footLYaw: 0.1, footLW: 1,
    footRX: 0.2, footRY: G, footRZ: 0.22, footRYaw: -0.3, footRW: 1,
    pelvisY: -0.36, pelvisZ: 0.02, pelvisPitch: 0.55,
    torsoPitch: 0.75, headPitch: -0.2,
    handRX: ball.x, handRY: ball.y + 0.02, handRZ: ball.z, handRW: 1,
    shLFlex: 0.6, shLAbd: 0.3, elbowL: 0.4,
    lookX: ball.x, lookY: ball.y, lookZ: ball.z, lookW: 1,
  });
  const up = makePose({
    footLX: -0.16, footLY: G, footLZ: -0.3, footLYaw: 0.1, footLW: 1,
    footRX: 0.2, footRY: G, footRZ: 0.22, footRYaw: -0.3, footRW: 1,
    pelvisY: -0.12, pelvisPitch: 0.15, torsoPitch: 0.2,
    handRX: 0.22, handRY: 1.45, handRZ: 0.12, handRW: 1,
    shLFlex: 0.4, shLAbd: 0.3, elbowL: 0.5,
  });
  return {
    keys: [
      { t: 0, pose: k0 },
      { t: 0.16, pose: low },
      { t: 0.24, pose: copyPose(makePose(), low) },
      { t: 0.42, pose: up, hold: true },
    ],
    grabT: 0.22,
  };
}

/**
 * A throw from a side-on base: front arm points at the target, throwing arm
 * cocked behind the head, step and whip over. Released at `releaseT`.
 * The fielder's root should already face the target.
 */
export function throwKeys(from: Pose, power: number): { keys: Key[]; releaseT: number } {
  const k0 = copyPose(makePose(), from);
  setPose(k0, { aimRSwing: Math.PI * 0.6, aimLSwing: Math.PI * 1.5, aimRW: 0, aimLW: 0 });
  const eyes: PoseValues = { lookX: 0, lookY: 1.4, lookZ: -20, lookW: 1 };
  const feet = (lz: number): PoseValues => ({
    footLX: -0.1, footLY: G, footLZ: lz, footLYaw: 0.4, footLW: 1,
    footRX: 0.18, footRY: G, footRZ: 0.25, footRYaw: -1.2, footRW: 1,
  });
  const cock = makePose({
    ...eyes, ...feet(-0.2),
    pelvisYaw: -1.0, torsoYaw: -0.35, pelvisY: -0.08, torsoRoll: -0.15,
    aimLSwing: Math.PI * 1.5, aimLElbow: 0.2, aimLW: 1,
    aimRSwing: 1.9, aimRElbow: 1.5, aimRSide: 0.25, aimRW: 1,
  });
  const whip = makePose({
    ...eyes, ...feet(-0.62),
    pelvisYaw: -0.25, torsoYaw: 0.3, pelvisY: -0.12, pelvisX: -0.05, pelvisZ: -0.2,
    torsoPitch: 0.25, torsoRoll: 0.2,
    aimLSwing: 5.6, aimLElbow: 1.0, aimLW: 1,
    aimRSwing: 3.35, aimRElbow: 0.35, aimRSide: 0.15, aimRW: 1,
  });
  const follow = makePose({
    ...eyes, ...feet(-0.62),
    pelvisYaw: 0.2, torsoYaw: 0.5, pelvisY: -0.14, pelvisZ: -0.3, torsoPitch: 0.55,
    aimLSwing: 6.1, aimLElbow: 0.9, aimLW: 1,
    aimRSwing: 5.3, aimRElbow: 0.3, aimRSide: -0.4, aimRW: 1,
  });
  follow[C.footRY] = G + 0.1;
  follow[C.footRPitch] = -0.7;
  const tm = THREE.MathUtils.lerp(1.15, 0.9, power);
  return {
    keys: [
      { t: 0, pose: k0 },
      { t: 0.2 * tm, pose: cock },
      { t: 0.34 * tm, pose: whip },
      { t: 0.6 * tm, pose: follow, hold: true },
    ],
    releaseT: 0.33 * tm,
  };
}

/** The keeper's crouch: sat on the haunches, gloves out low in front. */
export function keeperCrouch(out: Pose, t: number): Pose {
  out.fill(0);
  const sway = Math.sin(t * 2) * 0.01;
  return setPose(out, {
    footLX: -0.28, footLY: G, footLZ: 0.02, footLYaw: 0.35, footLW: 1,
    footRX: 0.28, footRY: G, footRZ: 0.02, footRYaw: -0.35, footRW: 1,
    pelvisY: -0.52 + sway, pelvisZ: 0.1, pelvisPitch: 0.45,
    torsoPitch: 0.45, headPitch: -0.55,
    handLX: -0.08, handLY: 0.42, handLZ: -0.42, handLW: 1,
    handRX: 0.08, handRY: 0.42, handRZ: -0.42, handRW: 1,
  });
}

/* ------------------------------------------------------------------ *
 * The controller
 * ------------------------------------------------------------------ */

const _d = new THREE.Vector3();

export class FielderAnimator {
  readonly pose = makePose();
  readonly world = new THREE.Vector3();
  yaw = 0;
  state: FielderState = "stand";
  readonly keeper: boolean;
  /** Where this fielder stands between deliveries. */
  readonly home = new THREE.Vector3();
  homeYaw = 0;

  speed = 0;
  private phase = 0;
  private time = 0;
  private seed: number;
  private target = new THREE.Vector3();
  private targetYaw: number | null = null;
  private limits: MoveLimits = JOG;
  private track: Track | null = null;
  private trackT = 0;
  private eventT = 0;
  private eventFired = false;
  private onEvent: (() => void) | null = null;
  private lookWorld = new THREE.Vector3();
  private looking = false;
  private scratch = makePose();

  constructor(readonly rig: PlayerRig, keeper = false, seed = 0) {
    this.keeper = keeper;
    this.seed = seed;
  }

  place(pos: THREE.Vector3, yaw: number): void {
    this.world.copy(pos);
    this.home.copy(pos);
    this.yaw = yaw;
    this.homeYaw = yaw;
    this.speed = 0;
    this.state = "stand";
    this.track = null;
  }

  /** Watch a point in the world (the ball). */
  lookAt(p: THREE.Vector3 | null): void {
    this.looking = !!p;
    if (p) this.lookWorld.copy(p);
  }

  /** A few steps in toward the bat as the bowler runs in. */
  walkIn(): void {
    if (this.keeper) return;
    const toBat = _d.set(-this.world.x, 0, -10 - this.world.z).normalize();
    this.moveTo(this.world.clone().addScaledVector(toBat, 2.2), WALK, "walkIn");
  }

  /** Crouched and ready as the ball is delivered. */
  set(): void {
    if (this.state === "walkIn" || this.state === "stand" || this.state === "move") {
      this.state = "set";
      this.speed = 0;
    }
  }

  moveTo(p: THREE.Vector3, limits: MoveLimits, as: FielderState = "move", endYaw: number | null = null): void {
    this.target.set(p.x, 0, p.z);
    this.limits = limits;
    this.targetYaw = endYaw;
    this.state = as;
    this.track = null;
  }

  /** Stoop and gather a ball lying at `ballWorld`; `onGrab` fires on the gather. */
  pickup(ballWorld: THREE.Vector3, onGrab: () => void): void {
    const local = this.toRoot(ballWorld);
    const { keys, grabT } = pickupKeys(this.pose, local);
    this.startTrack(keys, grabT, onGrab, "pickup");
  }

  /** Turn to `targetWorld` and throw; `onRelease` fires as the ball leaves the hand. */
  throwAt(targetWorld: THREE.Vector3, power: number, onRelease: () => void): void {
    this.yaw = faceYaw(targetWorld.x - this.world.x, targetWorld.z - this.world.z);
    const { keys, releaseT } = throwKeys(this.pose, power);
    this.startTrack(keys, releaseT, onRelease, "throw");
  }

  /** Hands up to take a ball arriving at `atWorld`. */
  catchAt(atWorld: THREE.Vector3): void {
    this.state = "catch";
    this.track = null;
    this.lookAt(atWorld);
    this.catchPoint.copy(atWorld);
  }
  private catchPoint = new THREE.Vector3();

  get busy(): boolean {
    return this.state === "pickup" || this.state === "throw";
  }

  /** Where the throwing hand is in the world. */
  handWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.handR.getWorldPosition(out);
  }

  /** Midpoint of both gloves (keeper) in the world. */
  glovesWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    const a = this.rig.handL.getWorldPosition(new THREE.Vector3());
    return this.rig.handR.getWorldPosition(out).add(a).multiplyScalar(0.5);
  }

  private startTrack(keys: Key[], eventT: number, onEvent: () => void, as: FielderState) {
    this.track = new Track(keys);
    this.trackT = 0;
    this.eventT = eventT;
    this.eventFired = false;
    this.onEvent = onEvent;
    this.state = as;
    this.speed = 0;
  }

  toRoot(world: THREE.Vector3): THREE.Vector3 {
    const d = world.clone().sub(this.world);
    // Undo the yaw: root = R(-yaw) * d, then undo the rig scale.
    const c = Math.cos(-this.yaw);
    const s = Math.sin(-this.yaw);
    return new THREE.Vector3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c).divideScalar(RIG_SCALE);
  }

  update(dt: number): void {
    this.time += dt;
    switch (this.state) {
      case "stand":
        if (this.keeper) keeperCrouch(this.pose, this.time);
        else idlePose(this.pose, this.time, this.seed);
        break;
      case "set":
        if (this.keeper) keeperCrouch(this.pose, this.time);
        else readyPose(this.pose, this.time, this.seed);
        break;
      case "walkIn":
      case "move":
        this.updateMove(dt);
        break;
      case "pickup":
      case "throw":
        this.updateTrack(dt);
        break;
      case "catch":
        this.updateCatch();
        break;
    }
    if (this.looking) {
      const l = this.toRoot(this.lookWorld);
      setPose(this.pose, { lookX: l.x, lookY: l.y, lookZ: l.z, lookW: 1 });
    }
    this.write();
  }

  private updateMove(dt: number): void {
    const to = _d.copy(this.target).sub(this.world);
    to.y = 0;
    const dist = to.length();
    const lim = this.limits;

    // Brake so as to stop on the target: v <= sqrt(2 * brake * distance).
    const want = Math.min(lim.vMax, Math.sqrt(2 * lim.brake * Math.max(0, dist - 0.15)));
    const prev = this.speed;
    this.speed += THREE.MathUtils.clamp(want - this.speed, -lim.brake * dt, lim.accel * dt);

    // Turn toward the heading, slower the faster he is going. Not once he is
    // arriving: there he turns to his final facing instead, and steering at
    // the (now sideways) heading as well deadlocks the two turns against
    // each other with him stood still.
    if (dist > 0.2) {
      const heading = faceYaw(to.x, to.z);
      const rate = THREE.MathUtils.lerp(9, 3.2, Math.min(1, this.speed / 7));
      const dy = wrapAngle(heading - this.yaw);
      this.yaw += THREE.MathUtils.clamp(dy, -rate * dt, rate * dt);
      // Cannot run full pace in a direction he is not facing yet.
      this.speed *= Math.max(0.35, Math.cos(Math.min(Math.abs(dy), Math.PI / 2)));
    }

    const step = Math.min(dist, this.speed * dt);
    if (dist > 1e-4) this.world.addScaledVector(to.normalize(), step);
    const vRoot = this.speed / RIG_SCALE;
    this.phase = advancePhase(this.phase, step / RIG_SCALE, vRoot);

    const accel = dt > 0 ? (this.speed - prev) / dt : 0;
    const lean = THREE.MathUtils.clamp(accel * 0.035, -0.15, 0.25);
    if (this.speed < 0.08 && dist < 0.2) {
      if (this.targetYaw !== null) {
        const dy = wrapAngle(this.targetYaw - this.yaw);
        this.yaw += THREE.MathUtils.clamp(dy, -4 * dt, 4 * dt);
      }
      idlePose(this.pose, this.time, this.seed);
      if (this.state === "walkIn") this.state = "set";
      else if (this.targetYaw === null || Math.abs(wrapAngle(this.targetYaw - this.yaw)) < 0.05) {
        this.state = "stand";
      }
      return;
    }
    gaitPose(this.pose, this.phase, vRoot, lean);
  }

  private updateTrack(dt: number): void {
    this.trackT += dt;
    this.track!.evaluate(this.trackT, this.pose);
    if (!this.eventFired && this.trackT >= this.eventT) {
      this.eventFired = true;
      this.write();
      this.onEvent?.();
    }
    if (this.trackT >= this.track!.end) {
      this.track = null;
      this.state = "stand";
    }
  }

  private updateCatch(): void {
    // Hands up toward the ball, feet set.
    idlePose(this.pose, this.time, this.seed);
    const l = this.toRoot(this.catchPoint);
    const high = Math.max(0.5, Math.min(2.3, l.y));
    setPose(this.pose, {
      handLX: l.x - 0.07, handLY: high, handLZ: Math.min(-0.25, l.z), handLW: 1,
      handRX: l.x + 0.07, handRY: high, handRZ: Math.min(-0.25, l.z), handRW: 1,
      pelvisY: high < 0.8 ? -0.2 : -0.03,
      torsoPitch: high < 0.8 ? 0.35 : 0.05,
    });
  }

  private write(): void {
    this.rig.root.position.copy(this.world);
    this.rig.root.rotation.set(0, this.yaw, 0);
    applyPose(this.rig, this.pose);
  }
}

/** Copy of a pose, for callers that capture frames. */
export function snapshot(p: Pose): Pose {
  return copyPose(makePose(), p);
}

void C;
