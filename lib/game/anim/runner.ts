/**
 * A batsman off strike: backing up, running between the wickets, standing
 * with the bat in hand.
 *
 * Running is a body under real limits: it accelerates out of the crease, has
 * to brake before the far one (you cannot turn at full sprint), turns, and
 * goes again. The bat is carried in the bottom hand, swinging with the stride.
 * Each batsman runs his own side of the pitch so the two never meet and
 * neither runs on the strip.
 */

import * as THREE from "three";
import { RIG_SCALE, type PlayerRig } from "../assets/kit";
import { CREASE_Z, POPPING_CREASE_OFFSET } from "../dimensions";
import { C, Pose, applyPose, batChannels, batQuaternion, makePose, setPose } from "./pose";
import { advancePhase, gaitPose, idlePose } from "./locomotion";
import { faceYaw } from "./fielder";

/** Where a batsman turns at each end: over the popping crease, bat grounded. */
const TURN_Z = CREASE_Z - POPPING_CREASE_OFFSET + 0.45;

const RUN = { vMax: 8.2, accel: 7.5, brake: 9.5 };
const WALK = { vMax: 1.4, accel: 2, brake: 3 };

const CARRY_Q = batQuaternion(0, 0, 0.75);
const STAND_Q = batQuaternion(0.2, 0, 0.12);

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export type RunnerState = "stand" | "move";

export class RunnerAnimator {
  readonly pose = makePose();
  readonly world = new THREE.Vector3();
  yaw = 0;
  state: RunnerState = "stand";
  /** Lengths still to run, and lengths completed this delivery. */
  lengthsLeft = 0;
  lengthsDone = 0;
  /** The run line (x) this batsman uses. */
  private laneX = 1;
  private target = new THREE.Vector3();
  private limits = RUN;
  private speed = 0;
  private phase = 0;
  private time = 0;
  private faceWhenStopped = 0;
  private seed: number;

  constructor(readonly rig: PlayerRig, seed = 0) {
    this.seed = seed;
  }

  /** Stand at an end, facing along the pitch toward the other end. */
  placeAt(end: 1 | -1, laneX: number): void {
    this.laneX = laneX;
    this.world.set(laneX, 0, end * (TURN_Z - 0.2));
    this.yaw = end > 0 ? 0 : Math.PI;
    this.faceWhenStopped = this.yaw;
    this.state = "stand";
    this.speed = 0;
    this.lengthsLeft = 0;
    this.lengthsDone = 0;
  }

  /**
   * Take over from another controller (the striker after his shot): start
   * where the rig already is, facing the way it faces, blending out of its
   * last pose.
   */
  takeOver(pos: THREE.Vector3, yaw: number, laneX: number, from: Pose): void {
    this.world.copy(pos);
    this.yaw = yaw;
    this.faceWhenStopped = yaw;
    this.laneX = laneX;
    this.state = "stand";
    this.speed = 0;
    this.crossfadeFrom(from, 0.3);
  }

  /** Walk out of the crease as the bowler delivers. */
  backUp(): void {
    const dir = this.world.z > 0 ? -1 : 1;
    this.go(new THREE.Vector3(this.laneX, 0, this.world.z + dir * 1.6), WALK);
  }

  /** Walk back behind the crease. */
  goHome(): void {
    const end = this.world.z > 0 ? 1 : -1;
    this.go(new THREE.Vector3(this.laneX, 0, end * (TURN_Z - 0.2)), WALK);
    this.faceWhenStopped = end > 0 ? 0 : Math.PI;
  }

  /** Run `n` lengths, starting from wherever he is. */
  run(n: number): void {
    this.lengthsLeft = n;
    this.lengthsDone = 0;
    if (n > 0) this.nextLength();
  }

  get running(): boolean {
    return this.lengthsLeft > 0;
  }

  /** Which end he is nearer: +1 bowler's end, -1 striker's end. */
  get end(): 1 | -1 {
    return this.world.z > 0 ? 1 : -1;
  }

  private nextLength(): void {
    const toward = this.world.z > 0 ? -1 : 1;
    this.go(new THREE.Vector3(this.laneX, 0, toward * TURN_Z), RUN);
  }

  private go(p: THREE.Vector3, limits: typeof RUN): void {
    this.target.copy(p);
    this.limits = limits;
    this.state = "move";
  }

  update(dt: number): void {
    this.time += dt;
    if (this.state === "stand") {
      this.yaw += wrap(this.faceWhenStopped - this.yaw) * Math.min(1, dt * 6);
      idlePose(this.pose, this.time, this.seed);
      this.holdBat(false);
      this.write();
      return;
    }

    const to = this.target.clone().sub(this.world);
    to.y = 0;
    const dist = to.length();
    const lim = this.limits;
    const want = Math.min(lim.vMax, Math.sqrt(2 * lim.brake * Math.max(0, dist - 0.05)));
    const prev = this.speed;
    this.speed += THREE.MathUtils.clamp(want - this.speed, -lim.brake * dt, lim.accel * dt);

    if (dist > 0.05) {
      const heading = faceYaw(to.x, to.z);
      const dy = wrap(heading - this.yaw);
      // A quick turn when slow (at the crease), none to speak of at speed.
      const rate = THREE.MathUtils.lerp(14, 3, Math.min(1, this.speed / 6));
      this.yaw += THREE.MathUtils.clamp(dy, -rate * dt, rate * dt);
      this.speed *= Math.max(0.2, Math.cos(Math.min(Math.abs(dy), Math.PI / 2)));
    }
    const step = Math.min(dist, this.speed * dt);
    if (dist > 1e-4) this.world.addScaledVector(to.normalize(), step);
    this.phase = advancePhase(this.phase, step / RIG_SCALE, this.speed / RIG_SCALE);

    if (dist < 0.08 && this.speed < 0.3) {
      if (this.lengthsLeft > 0 && this.limits === RUN) {
        this.lengthsLeft--;
        this.lengthsDone++;
        if (this.lengthsLeft > 0) {
          this.nextLength();
        } else {
          this.state = "stand";
          this.faceWhenStopped = this.world.z > 0 ? 0 : Math.PI;
        }
      } else {
        this.state = "stand";
      }
      idlePose(this.pose, this.time, this.seed);
      this.holdBat(false);
      this.write();
      return;
    }

    const accel = dt > 0 ? (this.speed - prev) / dt : 0;
    gaitPose(this.pose, this.phase, this.speed / RIG_SCALE, THREE.MathUtils.clamp(accel * 0.03, -0.2, 0.25));
    this.holdBat(true);
    this.write();
  }

  /** The bat in the bottom hand: swinging with the stride, or grounded at rest. */
  private holdBat(moving: boolean): void {
    if (!this.rig.bat) return;
    if (moving) {
      const swing = Math.sin(this.phase);
      const grip = new THREE.Vector3(0.27, 0.9 + 0.04 * Math.abs(swing), -0.05 - 0.18 * swing);
      setPose(this.pose, { ...batChannels(grip, CARRY_Q), batOneHand: 1 });
    } else {
      const grip = new THREE.Vector3(0.28, 0.88, -0.12);
      setPose(this.pose, { ...batChannels(grip, STAND_Q), batOneHand: 1 });
    }
    void C;
  }

  private fadeFrom: Pose | null = null;
  private fadeT = 0;
  private fadeLen = 0.25;
  private blended = makePose();

  /** Blend in from another controller's last pose, so switching does not pop. */
  crossfadeFrom(p: Pose, duration = 0.25): void {
    this.fadeFrom = p.slice() as Pose;
    this.fadeT = 0;
    this.fadeLen = duration;
  }

  private write(): void {
    this.rig.root.position.copy(this.world);
    this.rig.root.rotation.set(0, this.yaw, 0);
    if (this.fadeFrom) {
      this.fadeT += 1 / 60;
      const k = Math.min(1, this.fadeT / this.fadeLen);
      for (let i = 0; i < this.blended.length; i++) {
        this.blended[i] = this.fadeFrom[i] + (this.pose[i] - this.fadeFrom[i]) * k;
      }
      if (k >= 1) this.fadeFrom = null;
      applyPose(this.rig, this.blended);
      return;
    }
    applyPose(this.rig, this.pose as Pose);
  }
}
