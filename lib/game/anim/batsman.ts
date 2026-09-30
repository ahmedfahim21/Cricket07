/**
 * The batsman: guard, trigger, backlift, footwork, the shot, the leave.
 *
 * Root space for a right-hander at the crease (the rig is yawed +90 degrees):
 *   -X  toward the bowler          +X  toward the keeper
 *   -Z  off side (he faces it)     +Z  leg side (behind him)
 *
 * The whole point is that the bat goes where the ball is. A shot is not a
 * canned swing: it is built at the moment of the press from WHERE THE BALL
 * WILL BE when the bat arrives, and the downswing is timed to get there then.
 * The bat's middle is placed on that point by IK — the grip is derived from
 * the contact point and the bat angle, and both hands are solved onto the
 * handle — so a ball on off stump is met in front of off stump and a short
 * one is met at chest height.
 *
 * Shot shape follows the three decisions the player makes:
 *   footwork    front foot strides toward the pitch of the ball, back foot
 *               goes back and across
 *   type        defend (soft hands, face angled down), along the ground, or
 *               over the top (face opened, high finish)
 *   direction   the bat face at contact points along the exit direction, so
 *               the ball goes where the bat says; the hips and shoulders open
 *               toward leg-side shots and stay closed for off-side ones
 * and a short ball on the back foot is played with a horizontal bat — pulled
 * to leg, cut to off.
 */

import * as THREE from "three";
import { SKELETON, type PlayerRig } from "../assets/kit";
import type { Footwork, ShotType } from "../input/bindings";
import {
  C,
  GRIP_TOP,
  Pose,
  PoseValues,
  batChannels,
  batFromAxes,
  batOf,
  batQuaternion,
  applyPose,
  copyPose,
  gripForSweetSpot,
  makePose,
  setPose,
  sweetSpot,
} from "./pose";
import { Track, type Key } from "./track";

const G = SKELETON.ankleH;

/** Where along the pitch (root X) the bat meets the ball, by footwork. */
export const CONTACT_X: Record<Footwork, number> = {
  front: -0.8,
  none: -0.48,
  back: -0.16,
};

/** Face yaw that makes the bat face point along horizontal direction `d`. */
export function faceYaw(d: THREE.Vector3): number {
  return Math.atan2(-d.x, -d.z);
}

/** Root-space unit direction for a shot's exit angle (0 = back past the bowler). */
export function exitVector(exitDirection: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.cos(exitDirection), 0, Math.sin(exitDirection));
}

function smooth(x: number): number {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Top hand position for a bat whose toe is at `toe`. */
function gripForToe(toe: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return toe.clone().addScaledVector(up, GRIP_TOP);
}

const _ex = new THREE.Vector3(1, 0, 0);
const _ey = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ *
 * Guard, trigger, backlift and footwork: a parametric pose
 * ------------------------------------------------------------------ */

/** The bat grounded by the back toe, face half-open toward cover. */
const STANCE_Q = batQuaternion(0.55, 0, 0.12);
const STANCE_TOE = new THREE.Vector3(0.06, 0.03, -0.32);

/** Top of the backlift: hands by the back hip, toe up behind toward the keeper. */
// Toe well up toward the sky, not flat behind: a flat backlift has nowhere
// to swing down from.
const LIFT_Q = batQuaternion(1.3, 0.05, -2.6);
const LIFT_GRIP = new THREE.Vector3(0.12, 1.18, -0.14);

export interface ReadyState {
  /** Wall-clock seconds, for breathing and the bat tap. */
  time: number;
  /** -1 back foot, 0 stance, +1 front foot. Eased by the caller. */
  footwork: number;
  /** 0 bat grounded .. 1 top of the backlift. */
  lift: number;
  /** 0..1 trigger press (small back-and-across move as the bowler bounds). */
  trigger: number;
  /** Where to look (the bowler, then the ball), root space. */
  look: THREE.Vector3;
}

/**
 * The batsman between shots. Everything that happens BEFORE the swing is a
 * blend of four ingredients, so any combination of backlift, footwork and
 * trigger is a valid pose and none of them pops when another starts.
 */
export function readyBatPose(out: Pose, s: ReadyState): Pose {
  out.fill(0);
  const breath = Math.sin(s.time * 1.4);
  const lift = smooth(s.lift);
  const fw = s.footwork;
  const fwd = Math.max(0, fw);
  const back = Math.max(0, -fw);

  // Feet. The front (left) foot strides toward the bowler and a little
  // toward the line of the ball; going back, the back (right) foot steps
  // back and across toward off stump and the front foot follows it in.
  const lx = -0.24 - 0.42 * smooth(fwd) + 0.22 * smooth(back) - 0.03 * s.trigger;
  const lz = -0.02 - 0.06 * smooth(fwd) - 0.04 * smooth(back);
  const ly = G + 0.11 * Math.sin(Math.PI * Math.min(1, fwd)) + 0.07 * Math.sin(Math.PI * Math.min(1, back));
  const rx = 0.22 + 0.12 * smooth(back) + 0.05 * s.trigger;
  const rz = 0.02 - 0.16 * smooth(back) - 0.05 * s.trigger;
  const ry = G + 0.08 * Math.sin(Math.PI * Math.min(1, back));

  setPose(out, {
    footLX: lx, footLY: ly, footLZ: lz, footLYaw: 0.3 + 0.25 * fwd, footLW: 1,
    footRX: rx, footRY: ry, footRZ: rz, footRYaw: -0.05, footRPitch: -0.25 * fwd, footRW: 1,
    // Weight moves over the foot that has moved.
    pelvisX: -0.2 * smooth(fwd) + 0.13 * smooth(back),
    pelvisY: -0.07 - 0.05 * fwd + 0.03 * back + breath * 0.004,
    pelvisPitch: 0.12 + 0.06 * fwd,
    pelvisYaw: 0.05 * fwd,
    torsoPitch: 0.28 + 0.12 * fwd - 0.1 * back - 0.06 * lift,
    torsoYaw: -0.05 * lift,
    lookX: s.look.x, lookY: s.look.y, lookZ: s.look.z, lookW: 1,
  });

  // Bat: grounded (with a tap every couple of seconds while waiting) to the
  // top of the backlift, along an arc that goes up before it goes back.
  const tap = s.lift < 0.01 ? Math.max(0, Math.sin(s.time * 3.1)) ** 6 * 0.07 : 0;
  const toe = STANCE_TOE.clone();
  toe.y += tap;
  const stanceGrip = gripForToe(toe, STANCE_Q);
  // Hands move with the pelvis when the batsman steps.
  const shift = new THREE.Vector3(out[C.pelvisX], 0, 0);
  const grip = stanceGrip.clone().lerp(LIFT_GRIP, lift).add(shift);
  grip.y += Math.sin(Math.PI * lift) * 0.08;
  setPose(out, batChannels(grip, STANCE_Q.clone().slerp(LIFT_Q, lift)));
  return out;
}

/* ------------------------------------------------------------------ *
 * The shot
 * ------------------------------------------------------------------ */

export interface ShotPlan {
  type: ShotType;
  footwork: Footwork;
  /** Where the bat's middle meets the ball, root space. */
  contact: THREE.Vector3;
  /** Exit angle from resolveShot: 0 straight, + leg side. */
  exitDirection: number;
  /** Seconds from the press to contact. */
  downswing: number;
  /** Ball to be looked at, root space, at contact. */
  look: THREE.Vector3;
}

export type ShotShape = "drive" | "defence" | "punch" | "flick" | "pull" | "cut" | "loft";

/** Which family of stroke a plan produces. */
export function shotShape(plan: ShotPlan): ShotShape {
  const e = plan.exitDirection;
  const high = plan.contact.y > 0.8;
  if (plan.type === "defensive") return "defence";
  if (plan.footwork === "back" && high) return e > 0.2 ? "pull" : e < -0.35 ? "cut" : "punch";
  if (plan.footwork === "back") return "punch";
  if (plan.type === "lofted") return "loft";
  if (e > 0.45) return "flick";
  return "drive";
}

/**
 * Keyframes for a shot, starting from the live pose.
 *
 * Keys, in time from the press: [now] -> downswing midway -> CONTACT ->
 * just after (bat still travelling along the exit line) -> follow-through ->
 * finish (held). Catmull-Rom tangents keep the bat moving fastest through
 * contact rather than easing into it.
 */
export function shotKeys(from: Pose, plan: ShotPlan): { keys: Key[]; contactT: number; shape: ShotShape } {
  const shape = shotShape(plan);
  const d = exitVector(plan.exitDirection);
  const e = plan.exitDirection;
  const Tc = Math.max(0.08, plan.downswing);
  const c = plan.contact;
  const eyes: PoseValues = { lookX: plan.look.x, lookY: plan.look.y, lookZ: plan.look.z, lookW: 1 };

  const k0 = copyPose(makePose(), from);
  const base = (v: PoseValues): Pose => {
    // Every key inherits the live pose's feet unless it moves them.
    const p = copyPose(makePose(), from);
    setPose(p, { ...eyes, footLW: 1, footRW: 1, batW: 1, ...v });
    return p;
  };

  // Where the feet end up for this shot.
  const feet: PoseValues = {};
  const body: PoseValues = {};
  const legSide = Math.max(0, e);
  const offSide = Math.max(0, -e);
  if (plan.footwork === "front") {
    Object.assign(feet, {
      // Stride toward the pitch of the ball and toward its line.
      footLX: Math.min(-0.62, c.x + 0.18), footLY: G, footLZ: THREE.MathUtils.clamp(c.z * 0.55 - 0.02, -0.45, 0.25),
      footLYaw: 0.45 + 0.4 * legSide,
      // Back foot up on its toe: it no longer bears weight, so the back knee
      // can drop toward the turf instead of the leg trailing out straight.
      footRX: from[C.footRX] - 0.04, footRY: G + 0.13, footRZ: from[C.footRZ], footRPitch: -0.75, footRYaw: -0.1,
    });
    Object.assign(body, {
      // Weight over the front knee, head over the ball: the trunk leans down
      // the pitch toward the bowler (a roll, since he stands side-on) as well
      // as forward over the line.
      pelvisX: -0.22, pelvisY: -0.13, pelvisPitch: 0.2, pelvisRoll: 0.08,
      pelvisYaw: 0.12 + 0.55 * legSide, torsoYaw: 0.05 + 0.5 * legSide - 0.2 * offSide,
      torsoPitch: 0.42, torsoRoll: 0.28,
    });
  } else if (plan.footwork === "back") {
    Object.assign(feet, {
      footRX: 0.34, footRY: G, footRZ: shape === "pull" ? -0.05 : -0.18, footRYaw: shape === "pull" ? 0.3 : -0.1,
      footLX: shape === "pull" ? -0.12 : 0.02, footLY: G + (shape === "pull" ? 0.03 : 0), footLZ: shape === "pull" ? 0.2 : -0.08,
      footLYaw: shape === "pull" ? 1.0 : 0.3, footLPitch: shape === "pull" ? -0.3 : 0,
    });
    Object.assign(body, {
      pelvisX: 0.14, pelvisY: -0.05, pelvisPitch: 0.08,
      pelvisYaw: shape === "pull" ? 0.95 : shape === "cut" ? -0.1 : 0.1,
      torsoYaw: shape === "pull" ? 0.75 : shape === "cut" ? -0.35 : 0.1,
      torsoPitch: shape === "cut" ? 0.3 : 0.15,
      torsoRoll: shape === "pull" ? 0.15 : 0,
    });
  } else {
    Object.assign(feet, {
      footLX: -0.3, footLY: G, footLZ: -0.05, footLYaw: 0.4,
      footRX: from[C.footRX], footRY: G, footRZ: from[C.footRZ], footRYaw: -0.05,
    });
    Object.assign(body, {
      pelvisX: -0.06, pelvisY: -0.09, pelvisPitch: 0.15,
      pelvisYaw: 0.1 + 0.4 * legSide, torsoYaw: 0.05 + 0.4 * legSide, torsoPitch: 0.36,
    });
  }

  // Bat at contact, from geometry: where the hands sit relative to the ball
  // (above it for a straight bat, back toward the chest for a horizontal one)
  // and which way the face should look. Hands ahead of the bat angles the face
  // down (defence); hands behind it opens the face up (a loft).
  let up: THREE.Vector3;
  const face = d.clone();
  const toBody = new THREE.Vector3(0, 0, 0.12);
  switch (shape) {
    case "defence":
      up = new THREE.Vector3(0, 1, 0).addScaledVector(d, 0.38).add(toBody);
      face.y -= 0.3;
      break;
    case "loft":
      up = new THREE.Vector3(0, 1, 0).addScaledVector(d, -0.3).add(toBody);
      face.y += 0.35;
      break;
    case "punch":
      up = new THREE.Vector3(0, 1, 0).addScaledVector(d, 0.2).add(toBody);
      face.y -= 0.08;
      break;
    case "flick":
      up = new THREE.Vector3(0, 1, 0).addScaledVector(d, 0.05).add(new THREE.Vector3(0, 0, 0.15));
      break;
    case "pull":
      // Hands in front of the chest; bat out flat toward the ball.
      up = new THREE.Vector3(0.05, 1.12, 0.05).sub(c).add(new THREE.Vector3(0, 0.22, 0));
      face.y -= 0.2;
      break;
    case "cut":
      up = new THREE.Vector3(-0.05, 1.05, -0.3).sub(c).add(new THREE.Vector3(0, 0.2, 0));
      face.y -= 0.25;
      break;
    default:
      up = new THREE.Vector3(0, 1, 0).addScaledVector(d, 0.12).add(toBody);
      face.y -= 0.05;
  }
  const horizontal = shape === "pull" || shape === "cut";
  const qC = batFromAxes(up, face);
  const gripC = gripForSweetSpot(c, qC);

  // Mid-downswing: hands leading, bat still behind them.
  const qFrom = batOf(from);
  const liftGrip = new THREE.Vector3(from[C.gripX], from[C.gripY], from[C.gripZ]);
  const gripMid = liftGrip.clone().lerp(gripC, 0.62);
  gripMid.y += 0.06;
  const qMid = qFrom.clone().slerp(qC, 0.55);
  const qLate = qFrom.clone().slerp(qC, 0.82);

  // Just after contact: the bat carries on along the exit line — rotating on
  // through its swing for a straight bat, sweeping round for a flat one.
  const carry = shape === "defence" ? 0.04 : 0.32;
  const after = c.clone().addScaledVector(d, carry);
  after.y += shape === "defence" ? 0 : 0.1;
  const qAfter =
    shape === "defence"
      ? qC.clone()
      : horizontal
        ? new THREE.Quaternion().setFromAxisAngle(_ey, shape === "pull" ? 0.45 : -0.45).multiply(qC)
        : qC.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_ex, 0.75));
  const gripAfter = gripForSweetSpot(after, qAfter);

  // Follow-through.
  const yaw = faceYaw(d);
  let followGrip: THREE.Vector3;
  let qFollow: THREE.Quaternion;
  switch (shape) {
    case "defence":
      // Soft hands: the bat stops where it met the ball, face presented.
      followGrip = gripC.clone();
      qFollow = qC.clone();
      break;
    case "pull":
      followGrip = new THREE.Vector3(-0.05, 1.3, 0.22);
      qFollow = new THREE.Quaternion().setFromAxisAngle(_ey, 1.3).multiply(qC);
      break;
    case "cut":
      followGrip = new THREE.Vector3(-0.15, 0.95, -0.4);
      qFollow = new THREE.Quaternion().setFromAxisAngle(_ey, -0.9).multiply(qC);
      break;
    case "loft":
      followGrip = new THREE.Vector3(-0.22, 1.55, -0.12);
      qFollow = batQuaternion(yaw, 0, 2.75);
      break;
    case "punch":
      followGrip = new THREE.Vector3(-0.3, 1.2, -0.35);
      qFollow = batQuaternion(yaw, 0, 1.2);
      break;
    case "flick":
      followGrip = new THREE.Vector3(-0.15, 1.3, 0.15);
      qFollow = batQuaternion(yaw + 0.5, 0, 2.1);
      break;
    default:
      followGrip = new THREE.Vector3(-0.28, 1.38, -0.18);
      qFollow = batQuaternion(yaw, 0, 2.35);
  }

  const tMid = Tc * 0.58;
  const tAfter = Tc + (shape === "defence" ? 0.1 : 0.07);
  const tFollow = Tc + (shape === "defence" ? 0.35 : 0.34);
  const tFinish = tFollow + 0.45;
  // Feet arrive before the bat does: a stride lands just ahead of contact.
  const tFeet = Math.max(0.05, Tc * 0.82);

  const openFinish: PoseValues =
    shape === "defence"
      ? {}
      : {
          pelvisYaw: (body.pelvisYaw as number) + 0.25,
          torsoYaw: (body.torsoYaw as number) + 0.45,
          torsoPitch: (body.torsoPitch as number) - 0.15,
        };

  const keys: Key[] = [
    { t: 0, pose: k0 },
    { t: tMid, pose: base({ ...lerpFeet(from, feet, 0.7), ...body, ...batChannels(gripMid, qMid) }) },
    { t: tFeet, pose: base({ ...feet, ...body, ...batChannels(gripMid.clone().lerp(gripC, 0.6), qLate) }) },
    { t: Tc, pose: base({ ...feet, ...body, ...batChannels(gripC, qC) }) },
    { t: tAfter, pose: base({ ...feet, ...body, ...batChannels(gripAfter, qAfter) }) },
    { t: tFollow, pose: base({ ...feet, ...body, ...openFinish, ...batChannels(followGrip, qFollow), lookW: 0.6 }) },
    { t: tFinish, pose: base({ ...feet, ...body, ...openFinish, ...batChannels(followGrip, qFollow), lookW: 0.4 }), hold: true },
  ];
  return { keys, contactT: Tc, shape };
}

/**
 * Take the body to the ball.
 *
 * The keys put the hands where the bat needs them, but arms have a length: to
 * a ball wide of off stump, or down by the boots, they run out before the
 * bat's middle gets there. A batsman closes that gap with his legs and hips —
 * knees bend, the pelvis drops and moves toward the line — and the feet stay
 * where they landed. So: pose the contact key on the real rig, measure where
 * the middle actually is, and move the pelvis by the shortfall, a few times.
 * The keys either side of contact move with it so the motion stays smooth.
 */
export function fitToBall(rig: PlayerRig, keys: Key[], contactT: number, contact: THREE.Vector3): number {
  const at = keys.findIndex((k) => Math.abs(k.t - contactT) < 1e-9);
  if (at < 0) throw new Error("shot keys have no key at the contact time");
  const shifted = [at - 1, at, at + 1].filter((i) => i > 0 && i < keys.length);
  const sweet = new THREE.Vector3();
  let gap = Infinity;
  for (let iter = 0; iter < 5; iter++) {
    applyPose(rig, keys[at].pose);
    sweetSpot(rig, sweet);
    const err = sweet.sub(contact);
    gap = err.length();
    if (gap < 0.02) break;
    for (const i of shifted) {
      const p = keys[i].pose;
      // Near keys follow fully; the one before contact half-way, so the hips
      // are already travelling as the hands come down.
      const k = i === at ? 1 : 0.6;
      p[C.pelvisX] = THREE.MathUtils.clamp(p[C.pelvisX] - err.x * k, -0.45, 0.3);
      p[C.pelvisY] = THREE.MathUtils.clamp(p[C.pelvisY] - err.y * k, -0.42, 0);
      p[C.pelvisZ] = THREE.MathUtils.clamp(p[C.pelvisZ] - err.z * k, -0.3, 0.2);
    }
  }
  return gap;
}

/** Feet part-way from the live pose to their shot positions (mid-stride). */
function lerpFeet(from: Pose, to: PoseValues, k: number): PoseValues {
  const out: PoseValues = {};
  for (const ch of ["footLX", "footLZ", "footRX", "footRZ", "footLYaw", "footRYaw"] as const) {
    if (to[ch] !== undefined) out[ch] = lerp(from[C[ch]], to[ch] as number, k);
  }
  // A foot that is moving is in the air mid-stride.
  if (to.footLX !== undefined && Math.abs((to.footLX as number) - from[C.footLX]) > 0.1) out.footLY = G + 0.1;
  if (to.footRX !== undefined && Math.abs((to.footRX as number) - from[C.footRX]) > 0.1) out.footRY = G + 0.08;
  return out;
}

/** Keys for leaving the ball: bat lifted high out of the way, then held. */
export function leaveKeys(from: Pose, look: THREE.Vector3): Key[] {
  const eyes: PoseValues = { lookX: look.x, lookY: look.y, lookZ: look.z, lookW: 1 };
  const k0 = copyPose(makePose(), from);
  const high = copyPose(makePose(), from);
  setPose(high, {
    ...eyes,
    ...batChannels(new THREE.Vector3(0.02, 1.55, -0.06), batQuaternion(1.45, 0, -2.95)),
    torsoPitch: 0.12,
    pelvisY: -0.04,
  });
  return [
    { t: 0, pose: k0 },
    { t: 0.22, pose: high },
    { t: 0.8, pose: copyPose(makePose(), high), hold: true },
  ];
}

/* ------------------------------------------------------------------ *
 * The controller
 * ------------------------------------------------------------------ */

export type BatsmanState = "ready" | "shot" | "leave" | "recover";

export class BatsmanAnimator {
  readonly pose = makePose();
  state: BatsmanState = "ready";
  /** The live ball (or the bowler before release), root space. */
  readonly look = new THREE.Vector3(-18, 1.8, 0);

  /** Seconds since the shot started; `contactT` is when bat meets ball. */
  shotTime = 0;
  contactT = 0;
  shape: ShotShape | null = null;

  private time = 0;
  private footwork = 0;
  private footworkTarget = 0;
  private lift = 0;
  private liftTarget = 0;
  private trigger = 0;
  private triggerTarget = 0;
  private track: Track | null = null;
  private recoverFrom = makePose();
  private recoverT = 0;
  private scratch = makePose();
  private readyState: ReadyState = { time: 0, footwork: 0, lift: 0, trigger: 0, look: this.look };

  /** -1 back, 0, +1 front: held footwork. Only honoured before the shot. */
  setFootwork(f: number): void {
    this.footworkTarget = THREE.MathUtils.clamp(f, -1, 1);
  }

  /** The bowler is in his bound: small trigger press. */
  triggerMove(on: boolean): void {
    this.triggerTarget = on ? 1 : 0;
  }

  /** The ball has left the hand: bat up. */
  pickUp(on: boolean): void {
    this.liftTarget = on ? 1 : 0;
  }

  /**
   * Start a shot. With the batsman's `rig`, the stroke is fitted to his body
   * first — see `fitToBall` — so the bat's middle really arrives on the ball.
   */
  play(plan: ShotPlan, rig?: PlayerRig): ShotShape {
    const { keys, contactT, shape } = shotKeys(this.pose, plan);
    if (rig) fitToBall(rig, keys, contactT, plan.contact);
    this.track = new Track(keys);
    this.contactT = contactT;
    this.shotTime = 0;
    this.shape = shape;
    this.state = "shot";
    return shape;
  }

  leave(): void {
    if (this.state !== "ready") return;
    this.track = new Track(leaveKeys(this.pose, this.look));
    this.shotTime = 0;
    this.state = "leave";
  }

  /** Back to guard: bat down, feet home. */
  reset(): void {
    this.footworkTarget = 0;
    this.liftTarget = 0;
    this.triggerTarget = 0;
    if (this.state === "shot" || this.state === "leave") {
      copyPose(this.recoverFrom, this.pose);
      this.recoverT = 0;
      this.state = "recover";
    }
  }

  /**
   * The pose at the exact instant of contact, whatever frame the clock landed
   * on. Contact is judged against this rather than the nearest frame: at 30
   * m/s a single 16 ms frame is half a metre of ball travel.
   */
  contactPose(out: Pose): Pose {
    if (this.state !== "shot" || !this.track) throw new Error("contactPose called with no shot in progress");
    this.track.evaluate(this.contactT, out);
    return out;
  }

  get finished(): boolean {
    return (this.state === "shot" || this.state === "leave") && !!this.track && this.shotTime >= this.track.end;
  }

  update(dt: number): void {
    this.time += dt;
    const ease = (v: number, target: number, rate: number) => v + (target - v) * Math.min(1, dt * rate);
    this.footwork = ease(this.footwork, this.footworkTarget, 9);
    this.lift = ease(this.lift, this.liftTarget, this.liftTarget > this.lift ? 5.5 : 3);
    this.trigger = ease(this.trigger, this.triggerTarget, 8);

    const rs = this.readyState;
    rs.time = this.time;
    rs.footwork = this.footwork;
    rs.lift = this.lift;
    rs.trigger = this.trigger;

    switch (this.state) {
      case "ready":
        readyBatPose(this.pose, rs);
        break;
      case "shot":
      case "leave":
        this.shotTime += dt;
        this.track!.evaluate(this.shotTime, this.pose);
        // Eyes stay on the ball after the shot, whatever the keys said.
        this.pose[C.lookX] = this.look.x;
        this.pose[C.lookY] = this.look.y;
        this.pose[C.lookZ] = this.look.z;
        break;
      case "recover": {
        this.recoverT += dt;
        readyBatPose(this.scratch, rs);
        const k = smooth(this.recoverT / 0.7);
        for (let i = 0; i < this.pose.length; i++) {
          this.pose[i] = this.recoverFrom[i] + (this.scratch[i] - this.recoverFrom[i]) * k;
        }
        if (this.recoverT >= 0.7) this.state = "ready";
        break;
      }
    }
  }
}
