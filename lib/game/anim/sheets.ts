/**
 * Filmstrips for the preview harness (`pnpm preview:motion`).
 *
 * Motion cannot be judged from one pose, and the live game runs on a clock the
 * headless browser throttles — so each movement is sampled here at fixed
 * times, every frame posed on its own rig, and laid out in rows. Rows also
 * report numeric metrics (foot skate, bat-to-ball distance at contact, release
 * height), because some faults are invisible at filmstrip scale and obvious in
 * a number.
 */

import { BATTING_STYLES, BOWLING_STYLES, styledApproach } from "./style";
import type { BodyLibrary } from "../assets/bodies";
import { dressAs, sampleFor } from "../roster/cast";
import * as THREE from "three";
import {
  BATTING_KIT,
  FIELDING_KIT,
  makePlayer,
  type PlayerRig,
  type Role,
  type KitColours,
} from "../assets/kit";
import { C, GRIP_GAP, GRIP_TOP, Pose, applyPose, jointPoint, makePose, solePoint, sweetSpot } from "./pose";
import { BatsmanAnimator, readyBatPose, type ShotPlan } from "./batsman";
import { FielderAnimator, keeperCrouch, pickupKeys, throwKeys } from "./fielder";
import { Track } from "./track";
import type { Footwork, ShotType } from "../input/bindings";
import { advancePhase, gaitPose, idlePose, readyPose } from "./locomotion";
import {
  APPROACH,
  BowlerAnimator,
  deliveryOrigin,
  frontFootTime,
} from "./bowler";
import { RIG_SCALE } from "../assets/kit";
import { CREASE_Z, POPPING_CREASE_OFFSET, STRIKER_STUMPS_Z } from "../dimensions";

export type MotionFrame = {
  group: THREE.Group;
  label?: string;
  /** Extra offset within the frame's cell. */
  dx?: number;
  dy?: number;
  /** Markers drawn with the frame (a ball, a target). */
  extras?: THREE.Object3D[];
};
export type MotionRow = { label: string; frames: MotionFrame[] };
export type MotionSheet = { name: string; rows: MotionRow[]; metrics?: Record<string, number | string> };

/** Side view: facing screen-right, player's right side toward the camera. */
export const SIDE = -Math.PI / 2;
/** Front view: facing the camera. */
export const FRONT = Math.PI;

export function posedFrame(
  role: Role,
  colours: KitColours | undefined,
  pose: Pose,
  yaw: number,
  label?: string
): MotionFrame & { rig: PlayerRig } {
  const rig = makePlayer({ role, colours });
  dressSample(rig, role);
  applyPose(rig, pose);
  rig.root.rotation.y = yaw;
  return { group: rig.root, label, rig };
}

/** Bodies for the frames, set by `motionSheets`. Measuring rigs stay bare. */
let sheetBodies: BodyLibrary | null = null;
function dressSample(rig: PlayerRig, role: Role): void {
  if (!sheetBodies) throw new Error("motion sheets: no bodies loaded");
  dressAs(rig, sheetBodies, sampleFor(role));
}

export function marker(color: number, r = 0.05): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 12, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })
  );
  return m;
}

/* ------------------------------------------------------------------ *
 * Locomotion
 * ------------------------------------------------------------------ */

/**
 * How far the planted foot slides, as a fraction of body speed. 0 means the
 * foot is nailed to the ground through stance; 1 means it travels with the
 * body, i.e. the figure is skating.
 */
export function gaitSkate(speed: number): number {
  const rig = makePlayer({ role: "fielder", colours: FIELDING_KIT });
  const p = makePose();
  const dt = 1 / 240;
  let phase = 0;
  let x = 0;
  let prevL: THREE.Vector3 | null = null;
  let prevR: THREE.Vector3 | null = null;
  let slide = 0;
  let n = 0;
  for (let i = 0; i < 480; i++) {
    const d = speed * dt;
    x += d;
    phase = advancePhase(phase, d, speed);
    gaitPose(p, phase, speed);
    applyPose(rig, p);
    // World = root space shifted forward by the distance covered (forward is -Z).
    const l = solePoint(rig, -1).add(new THREE.Vector3(0, 0, -x));
    const r = solePoint(rig, 1).add(new THREE.Vector3(0, 0, -x));
    if (prevL && prevR) {
      // The lower foot bears the weight — but only if it is actually on the
      // turf. A run has a flight phase with both feet up, and counting those
      // frames measures the stride, not a skate.
      const lower = l.y < r.y ? l : r;
      if (lower.y < 0.02) {
        const planted = lower === l ? l.clone().sub(prevL) : r.clone().sub(prevR);
        slide += Math.hypot(planted.x, planted.z) / dt;
        n++;
      }
    }
    prevL = l;
    prevR = r;
  }
  return slide / n / speed;
}

function locomotionSheet(): MotionSheet {
  const rows: MotionRow[] = [];
  const idle: MotionFrame[] = [];
  const ready: MotionFrame[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i * 0.7;
    idle.push(posedFrame("fielder", FIELDING_KIT, idlePose(makePose(), t), SIDE, `${t.toFixed(1)}s`));
    ready.push(posedFrame("fielder", FIELDING_KIT, readyPose(makePose(), t), SIDE, `${t.toFixed(1)}s`));
  }
  rows.push({ label: "idle", frames: idle }, { label: "ready (set)", frames: ready });

  for (const [name, speed] of [
    ["walk 1.4", 1.4],
    ["jog 4", 4],
    ["sprint 7.5", 7.5],
  ] as const) {
    const frames: MotionFrame[] = [];
    for (let i = 0; i < 10; i++) {
      const phase = (i / 10) * Math.PI * 2;
      const p = gaitPose(makePose(), phase, speed);
      frames.push(posedFrame("fielder", FIELDING_KIT, p, SIDE, `${(i * 36).toFixed(0)}°`));
    }
    rows.push({ label: name, frames });
  }

  return {
    name: "locomotion",
    rows,
    metrics: {
      skateWalk: +gaitSkate(1.4).toFixed(3),
      skateJog: +gaitSkate(4).toFixed(3),
      skateSprint: +gaitSkate(7.5).toFixed(3),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Bowling
 * ------------------------------------------------------------------ */

/** A captured frame: the pose, and where the pelvis had travelled to. */
type Capture = { pose: Pose; t: number; label: string };

function bowlingSheet(style: keyof typeof APPROACH): MotionSheet {
  const approach = APPROACH[style];
  const popping = CREASE_Z - POPPING_CREASE_OFFSET;
  const originZ = deliveryOrigin(approach, popping + 0.2);
  const lineX = -0.45;
  const stumps = new THREE.Vector3(0, 0.6, STRIKER_STUMPS_Z);

  const rig = makePlayer({ role: "bowler", colours: FIELDING_KIT });
  const b = new BowlerAnimator(rig);
  b.setup(approach, originZ, lineX, stumps);

  let release: THREE.Vector3 | null = null;
  let releaseClock = 0;
  b.onRelease = (h) => {
    release = h.clone();
  };

  const runup: Capture[] = [];
  const stride: Capture[] = [];
  const dt = 1 / 240;
  let clock = 0;
  let strideT = 0;
  let ffcFoot: THREE.Vector3 | null = null;
  let frontSlide = 0;
  const stridePicks = [0, 0.13, 0.22, 0.3, 0.37, 0.44, 0.51, 0.58, 0.62, 0.66, 0.72, 0.78, 0.86, 0.95, 1.15, 1.42];
  const tm = frontFootTime(approach) / 0.58;
  let nextPick = 0;
  let runupStart = 0;

  b.startRunup();
  while (clock < 30) {
    b.update(dt);
    clock += dt;
    if (b.state === "runup") {
      runupStart = runupStart || clock;
    } else if (b.state === "delivery") {
      strideT += dt;
      if (nextPick < stridePicks.length && strideT >= stridePicks[nextPick] * tm) {
        stride.push({ pose: b.pose.slice() as Pose, t: strideT, label: `${stridePicks[nextPick].toFixed(2)}` });
        nextPick++;
      }
      // Front foot from contact to release: it must not move.
      const foot = new THREE.Vector3();
      rig.root.updateMatrixWorld(true);
      rig.ankleL.getWorldPosition(foot);
      if (strideT >= frontFootTime(approach) && !release) {
        if (!ffcFoot) ffcFoot = foot.clone();
        frontSlide = Math.max(frontSlide, Math.hypot(foot.x - ffcFoot.x, foot.z - ffcFoot.z));
      }
      if (release && !releaseClock) releaseClock = clock;
    } else if (b.state === "settle") {
      break;
    }
  }

  // Last stretch of the run-up, replayed.
  const replay = new BowlerAnimator(makePlayer({ role: "bowler", colours: FIELDING_KIT }));
  replay.setup(approach, originZ, lineX, stumps);
  replay.startRunup();
  let rc = 0;
  const total = releaseClock - frontFootTime(approach) * 1.2;
  while (replay.state === "runup") {
    replay.update(dt);
    rc += dt;
    if (rc > total - 1.3 && runup.length < 12 && Math.round(rc / dt) % Math.round(0.1 / dt) === 0) {
      runup.push({ pose: replay.pose.slice() as Pose, t: rc, label: `${rc.toFixed(1)}s` });
    }
  }

  // Centre each frame on its pelvis so the travel does not overlap frames.
  const side = (c: Capture) => {
    const f = posedFrame("bowler", FIELDING_KIT, c.pose, SIDE, c.label);
    f.dx = c.pose[C.pelvisZ] * RIG_SCALE;
    return f;
  };
  const behind = (c: Capture) => {
    const f = posedFrame("bowler", FIELDING_KIT, c.pose, 0, c.label);
    f.dx = -c.pose[C.pelvisX] * RIG_SCALE;
    return f;
  };

  const rel = release as THREE.Vector3 | null;
  return {
    name: `bowling-${style}`,
    rows: [
      { label: `${style} run-up`, frames: runup.map(side) },
      { label: "delivery, side", frames: stride.map(side) },
      { label: "delivery, behind", frames: stride.map(behind) },
    ],
    metrics: {
      releaseHeight: rel ? +rel.y.toFixed(3) : "none",
      releaseX: rel ? +rel.x.toFixed(3) : "none",
      releaseBeyondPopping: rel ? +(popping - rel.z).toFixed(3) : "none",
      frontFootBehindPopping: ffcFoot ? +((ffcFoot as THREE.Vector3).z - popping).toFixed(3) : "none",
      frontFootSlide: +frontSlide.toFixed(4),
      secondsToRelease: +(releaseClock - runupStart).toFixed(2),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Batting
 * ------------------------------------------------------------------ */

type ShotCase = {
  name: string;
  footwork: Footwork;
  type: ShotType;
  exit: number;
  contact: [number, number, number];
};

const SHOTS: ShotCase[] = [
  { name: "straight drive", footwork: "front", type: "ground", exit: 0, contact: [-0.82, 0.22, -0.35] },
  { name: "cover drive", footwork: "front", type: "ground", exit: -0.75, contact: [-0.8, 0.25, -0.58] },
  { name: "flick to leg", footwork: "front", type: "ground", exit: 0.6, contact: [-0.74, 0.3, -0.18] },
  { name: "sweep to square leg", footwork: "front", type: "ground", exit: 1.1, contact: [-0.8, 0.25, 0.1] },
  { name: "slog sweep", footwork: "front", type: "lofted", exit: 1.2, contact: [-0.8, 0.4, 0.1] },
  { name: "scoop to fine leg", footwork: "back", type: "lofted", exit: 1.7, contact: [-0.16, 0.4, 0.1] },
  { name: "forward defence", footwork: "front", type: "defensive", exit: 0.05, contact: [-0.7, 0.3, -0.34] },
  { name: "lofted drive", footwork: "front", type: "lofted", exit: 0.05, contact: [-0.84, 0.3, -0.36] },
  { name: "back-foot punch", footwork: "back", type: "ground", exit: -0.4, contact: [-0.2, 0.72, -0.45] },
  { name: "pull", footwork: "back", type: "ground", exit: 1.1, contact: [-0.22, 1.15, -0.3] },
  { name: "cut", footwork: "back", type: "ground", exit: -1.25, contact: [-0.12, 0.95, -0.82] },
];

/** Play one shot offline and capture frames around contact. */
function captureShot(sc: ShotCase) {
  const rig = makePlayer({ role: "batsman", colours: BATTING_KIT });
  const b = new BatsmanAnimator();
  const dt = 1 / 240;
  const contact = new THREE.Vector3(...sc.contact);
  const frames: { pose: Pose; label: string; atContact: boolean }[] = [];
  const grab = (label: string, atContact = false) =>
    frames.push({ pose: b.pose.slice() as Pose, label, atContact });

  let t = 0;
  const step = (until: number) => {
    while (t < until - 1e-9) {
      b.update(dt);
      t += dt;
    }
  };
  b.look.set(-18, 1.9, 0.3);
  step(0.4);
  grab("guard");
  b.triggerMove(true);
  step(0.55);
  b.pickUp(true);
  b.look.set(-9, 1.6, -0.3);
  step(0.8);
  grab("backlift");
  b.setFootwork(sc.footwork === "front" ? 1 : sc.footwork === "back" ? -1 : 0);
  step(0.95);
  b.look.copy(contact).add(new THREE.Vector3(-4, 0.3, 0));
  const plan: ShotPlan = {
    type: sc.type,
    footwork: sc.footwork,
    contact,
    exitDirection: sc.exit,
    downswing: 0.18,
    look: contact,
  };
  const shape = b.play(plan, rig);
  const t0 = t;
  const picks = [0.09, 0.15, 0.18, 0.25, 0.36, 0.52, 0.75];
  let measure: { sweet: number; top: number; bottom: number } | null = null;
  for (const pk of picks) {
    b.look.copy(contact).addScaledVector(new THREE.Vector3(-1, 0, 0), Math.max(-1, (0.18 - (t - t0)) * 30));
    step(t0 + pk);
    const at = Math.abs(pk - 0.18) < 1e-6;
    grab(at ? "CONTACT" : `+${pk.toFixed(2)}`, at);
    if (at) {
      applyPose(rig, b.pose);
      const sw = sweetSpot(rig);
      const top = jointPoint(rig, rig.bat!, new THREE.Vector3(0, GRIP_TOP, 0));
      const bot = jointPoint(rig, rig.bat!, new THREE.Vector3(0, GRIP_TOP - GRIP_GAP, 0));
      measure = {
        sweet: sw.distanceTo(contact),
        top: jointPoint(rig, rig.handL).distanceTo(top),
        bottom: jointPoint(rig, rig.handR).distanceTo(bot),
      };
    }
  }
  return { frames, contact, shape, measure: measure! };
}

function battingSheet(shots: ShotCase[], name: string): MotionSheet {
  const rows: MotionRow[] = [];
  const metrics: Record<string, number | string> = {};
  for (const sc of shots) {
    const cap = captureShot(sc);
    for (const [view, yaw] of [["from point", FRONT], ["from bowler", Math.PI / 2]] as const) {
      rows.push({
        label: `${sc.name} (${cap.shape}) ${view}`,
        frames: cap.frames.map((f) => {
          const fr = posedFrame("batsman", BATTING_KIT, f.pose, yaw, f.label);
          if (f.atContact) {
            const ball = marker(0xd23a2a, 0.036);
            ball.position.copy(cap.contact);
            fr.group.add(ball);
          }
          return fr;
        }),
      });
    }
    const key = sc.name.replace(/[^a-z]+/g, "_");
    metrics[`${key}_sweetToBall`] = +cap.measure.sweet.toFixed(3);
    metrics[`${key}_topHandGap`] = +cap.measure.top.toFixed(3);
    metrics[`${key}_bottomHandGap`] = +cap.measure.bottom.toFixed(3);
  }
  return { name, rows, metrics };
}

/* ------------------------------------------------------------------ *
 * Fielding
 * ------------------------------------------------------------------ */

function fieldingSheet(): MotionSheet {
  const rows: MotionRow[] = [];
  const start = gaitPose(makePose(), 1.2, 3.5);

  const ball = new THREE.Vector3(0.12, 0.036, -0.62);
  const pick = new Track(pickupKeys(start, ball).keys);
  const pf: MotionFrame[] = [];
  for (const t of [0, 0.06, 0.12, 0.18, 0.22, 0.3, 0.36, 0.42]) {
    const f = posedFrame("fielder", FIELDING_KIT, pick.evaluate(t), SIDE, t.toFixed(2));
    if (t <= 0.22) {
      const m = marker(0xd23a2a, 0.036);
      m.position.copy(ball);
      f.group.add(m);
    }
    pf.push(f);
  }
  rows.push({ label: "pickup", frames: pf });

  const thr = throwKeys(pick.evaluate(0.42), 1);
  const tt = new Track(thr.keys);
  const tf: MotionFrame[] = [];
  for (const t of [0, 0.08, 0.14, 0.2, 0.26, 0.3, thr.releaseT, 0.4, 0.5, 0.6]) {
    tf.push(posedFrame("fielder", FIELDING_KIT, tt.evaluate(t), SIDE, t === thr.releaseT ? "RELEASE" : t.toFixed(2)));
  }
  rows.push({ label: "throw, side", frames: tf });
  rows.push({
    label: "throw, from target",
    frames: [0, 0.14, 0.26, thr.releaseT, 0.45, 0.6].map((t) =>
      posedFrame("fielder", FIELDING_KIT, tt.evaluate(t), FRONT, t.toFixed(2))
    ),
  });

  // Keeper: crouch, then taking balls at different heights.
  const kf: MotionFrame[] = [];
  kf.push(posedFrame("keeper", FIELDING_KIT, keeperCrouch(makePose(), 0), SIDE, "crouch"));
  kf.push(posedFrame("keeper", FIELDING_KIT, keeperCrouch(makePose(), 0), FRONT, "crouch"));
  for (const [h, lbl] of [[0.3, "low take"], [0.9, "waist"], [1.6, "chest"]] as const) {
    const rig = makePlayer({ role: "keeper", colours: FIELDING_KIT });
    dressSample(rig, "keeper");
    const k = new FielderAnimator(rig, true);
    k.place(new THREE.Vector3(0, 0, 0), 0);
    const at = new THREE.Vector3(0.1, h, -0.5);
    k.catchAt(at);
    k.update(1 / 60);
    const f = { group: rig.root, label: lbl } as MotionFrame;
    rig.root.rotation.y = SIDE;
    const m = marker(0xd23a2a, 0.036);
    m.position.copy(at).divideScalar(RIG_SCALE);
    rig.root.add(m);
    kf.push(f);
  }
  rows.push({ label: "keeper", frames: kf });
  return { name: "fielding", rows };
}

/**
 * Every batting style side by side: stance, trigger and the top of the
 * backlift from point, then stance and backlift from the bowler's end.
 */
function battingStylesSheet(): MotionSheet {
  const rows: MotionRow[] = [];
  const look = new THREE.Vector3(-18, 1.8, 0);
  for (const [name, style] of Object.entries(BATTING_STYLES)) {
    const at = (trigger: number, lift: number) =>
      readyBatPose(makePose(), { time: 0.3, footwork: 0, lift, trigger, look }, style);
    rows.push({
      label: `${name}`,
      frames: [
        posedFrame("batsman", BATTING_KIT, at(0, 0), FRONT, "stance"),
        posedFrame("batsman", BATTING_KIT, at(1, 0), FRONT, "trigger"),
        posedFrame("batsman", BATTING_KIT, at(1, 1), FRONT, "backlift"),
        posedFrame("batsman", BATTING_KIT, at(0, 0), Math.PI / 2, "stance, bowler"),
        posedFrame("batsman", BATTING_KIT, at(1, 1), Math.PI / 2, "backlift, bowler"),
      ],
    });
  }
  return { name: "styles-batting", rows };
}

/**
 * Every bowling style through the stride — coil, back-foot contact, front-foot
 * contact, release, follow-through — from the side, and at release from
 * behind. Spinners' styles are shown bowling spin.
 */
function bowlingStylesSheet(): MotionSheet {
  const rows: MotionRow[] = [];
  const metrics: Record<string, number | string> = {};
  const stumps = new THREE.Vector3(0, 0.6, STRIKER_STUMPS_Z);
  const picks = [0.3, 0.44, 0.58, 0.66, 0.78, 0.95];
  const labels = ["coil", "back foot", "front foot", "release", "follow", "through"];
  for (const [name, style] of Object.entries(BOWLING_STYLES)) {
    const type: keyof typeof APPROACH = name === "loopy" || name === "darting" ? "off-spin" : "fast-medium";
    const approach = styledApproach(APPROACH[type], style);
    const originZ = deliveryOrigin(approach, CREASE_Z - POPPING_CREASE_OFFSET + 0.2);
    const b = new BowlerAnimator(makePlayer({ role: "bowler", colours: FIELDING_KIT }));
    b.setup(approach, originZ, -0.45 + style.crease, stumps, style);
    let hand: THREE.Vector3 | null = null;
    b.onRelease = (h) => {
      hand = h.clone();
    };
    const tm = frontFootTime(approach) / 0.58;
    const caps: Capture[] = [];
    let strideT = 0;
    let clock = 0;
    b.startRunup();
    while (clock < 40 && b.state !== "settle" && caps.length < picks.length) {
      b.update(1 / 240);
      clock += 1 / 240;
      if (b.state !== "delivery") continue;
      strideT += 1 / 240;
      const k = caps.length;
      if (strideT >= picks[k] * tm) caps.push({ pose: b.pose.slice() as Pose, t: strideT, label: labels[k] });
    }
    const frames = caps.map((c) => {
      const f = posedFrame("bowler", FIELDING_KIT, c.pose, SIDE, c.label);
      f.dx = c.pose[C.pelvisZ] * RIG_SCALE;
      return f;
    });
    frames.push(posedFrame("bowler", FIELDING_KIT, caps[1].pose, 0, "back foot, behind"));
    frames.push(posedFrame("bowler", FIELDING_KIT, caps[3].pose, 0, "release, behind"));
    rows.push({ label: `${name} (${type})`, frames });
    const h = hand as THREE.Vector3 | null;
    if (h) {
      metrics[`${name}_releaseHeight`] = +h.y.toFixed(3);
      metrics[`${name}_releaseX`] = +h.x.toFixed(3);
    }
    metrics[`${name}_secondsToRelease`] = +clock.toFixed(2);
  }
  return { name: "styles-bowling", rows, metrics };
}

export async function motionSheets(bodies: BodyLibrary): Promise<MotionSheet[]> {
  sheetBodies = bodies;
  const batting: MotionSheet[] = [];
  for (let i = 0; i < SHOTS.length; i += 2) {
    batting.push(battingSheet(SHOTS.slice(i, i + 2), `batting-${i / 2 + 1}`));
  }
  return [locomotionSheet(), bowlingSheet("fast-medium"), ...batting, fieldingSheet(), battingStylesSheet(), bowlingStylesSheet()];
}
