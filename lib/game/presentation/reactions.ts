import * as THREE from "three";
import { BATTING_KIT, FIELDING_KIT, makePlayer, RIG_SCALE, type PlayerRig } from "../assets/kit";
import type { RosterPlayer } from "../roster/squads";
import { applyPose, batChannels, batQuaternion, jointPoint, makePose, setPose } from "../anim/pose";
import { advancePhase, gaitPose, idlePose } from "../anim/locomotion";
import { faceYaw } from "../anim/fielder";
import { type MatchMoment, type MomentShot, WICKET_WALKOFF_TIME, BOUNDARY_REACTION_TIME } from "./moments";

// An open, irregular huddle keeps the bowler visible without lining everyone up
// for the camera. Each teammate approaches from his own side of the group.
const HUDDLE = [[-0.48, 0], [0.48, 0], [-1.12, 0.35], [1.12, 0.4],
  [-2.25, 1.15], [2.4, 1.4], [-1.3, 1.8], [-0.3, 2.1],
  [1.05, 2.35], [-2.1, 3], [2.15, 3.25]];
const smooth = (t: number) => { const u = THREE.MathUtils.clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** Reusable broadcast doubles: choreography cannot move a live fielder or alter a run. */
export class ReactionScene {
  readonly group = new THREE.Group();
  readonly fielders = Array.from({ length: 11 }, (_, i) => makePlayer({ role: i === 0 ? "bowler" : i === 3 ? "keeper" : "fielder", colours: FIELDING_KIT }));
  readonly batsmen = Array.from({ length: 2 }, () => makePlayer({ role: "batsman", colours: BATTING_KIT }));
  readonly camera = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private pose = makePose();
  private grip = new THREE.Vector3();
  private carry = batQuaternion(0, 0, 0.6);
  private salute = batQuaternion(0, 0, 2.6);
  private crown = new THREE.Vector3(-0.045, 0.28, -0.025);
  private headTouch = new THREE.Vector3();

  constructor() {
    this.group.name = "broadcast-reactions";
    this.group.visible = false;
    this.group.add(...[...this.fielders, ...this.batsmen].map((rig) => rig.root));
  }

  /**
   * Dress the doubles as the people on the field, so a cutaway shows the same
   * faces: the bowler, the keeper in the keeper's double, the rest of the
   * field, and the two batsmen. Without this they are bare skeletons, which
   * is all the tests need.
   */
  cast(bowler: RosterPlayer, field: RosterPlayer[], batsmen: RosterPlayer[], wear: (rig: PlayerRig, p: RosterPlayer) => void): void {
    const [keeper, ...others] = field;
    wear(this.fielders[0], bowler);
    wear(this.fielders[3], keeper);
    let k = 0;
    this.fielders.forEach((rig, i) => {
      if (i !== 0 && i !== 3) wear(rig, others[k++]);
    });
    this.batsmen.forEach((rig, i) => wear(rig, batsmen[i]));
  }

  /** Stage one cutaway from elapsed engine time; repeated renders are deterministic. */
  update(moment: MatchMoment | null, shot: MomentShot | null, time: number): void {
    this.group.visible = !!shot;
    if (!moment || !shot) return;
    for (const rig of [...this.fielders, ...this.batsmen]) rig.root.visible = false;
    const p = this.pose;
    if (shot === "bowler-wicket") {
      const rig = this.fielders[0];
      rig.root.visible = true;
      rig.root.position.set(8, 0, 0);
      rig.root.rotation.set(0, -0.25, 0);
      idlePose(p, time);
      const energy = Math.sin(Math.PI * smooth(time / 1.05));
      if (moment.bowlerVariant === 2) {
        // A brief, non-verbal competitive stare/point, without delaying the group cut.
        setPose(p, { aimRSwing: Math.PI * 1.5, aimRElbow: 0.12, aimRW: 1, torsoPitch: 0.08, headYaw: -0.16 });
      } else {
        setPose(p, { aimRSwing: 2.3 + energy * 0.7, aimRElbow: 0.8 + energy * 0.5, aimRW: 1, torsoYaw: energy * 0.3 });
        if (moment.bowlerVariant === 1) {
          setPose(p, { aimLSwing: 2.9, aimLElbow: 0.5, aimLW: 1 });
          rig.root.position.y = energy * 0.18;
        }
      }
      applyPose(rig, p);
      this.camera.set(10.3, 2.1, -4.7);
      this.look.set(8, 1.25, 0);
    } else if (shot === "fielders") {
      this.teamCelebration(moment, time);
    } else if (shot === "walkoff") {
      const t = time - WICKET_WALKOFF_TIME;
      const variant = moment.batterVariant;
      const distance = Math.max(0, t - (variant === 1 ? 0 : 0.3)) * 0.85;
      const rig = this.batsmen[0];
      rig.root.visible = true;
      rig.root.position.set(8, 0, -8 - distance);
      rig.root.rotation.set(0, 0, 0);
      if (distance > 0) gaitPose(p, advancePhase(0, distance / RIG_SCALE, 0.85 / RIG_SCALE), 0.85 / RIG_SCALE);
      else idlePose(p, t);
      setPose(p, { ...batChannels(this.grip.set(0.3, 0.9, -0.1), this.carry), batOneHand: 1,
        headPitch: variant === 1 ? 0.15 : 0.4, torsoPitch: variant === 0 ? 0.18 : 0.06, lookW: 0 });
      if (variant === 2) this.handOnHead(rig, Math.min(1, t * 3));
      applyPose(rig, p);
      // Track from the front three-quarter side as the player heads toward the stands.
      this.camera.set(10.8, 2.1, rig.root.position.z - 4.7);
      this.look.set(8, 1.05, rig.root.position.z);
    } else if (shot === "batsmen") {
      const t = time - BOUNDARY_REACTION_TIME;
      this.camera.set(10.8, 2.2, -6.8);
      this.look.set(8.3, 1.15, -1);
      this.batsmen.forEach((rig, i) => {
        rig.root.visible = true;
        rig.root.position.set(8 + i * 1.1, 0, -1 + i * 0.6);
        rig.root.rotation.set(0, -0.2, 0);
        idlePose(p, t, i);
        const salute = i === 0 && moment.batterVariant === 0;
        setPose(p, { ...batChannels(this.grip.set(0.3, salute ? 1.65 : 0.95, -0.2), salute ? this.salute : this.carry), batOneHand: 1 });
        if (i === 0 && !salute) setPose(p, { aimLSwing: (moment.batterVariant === 1 ? 2.7 : 2) + Math.sin(t * 8) * 0.2, aimLElbow: 1.3, aimLW: 1, torsoYaw: Math.sin(t * 5) * 0.12 });
        if (i === 1) setPose(p, { aimLSwing: 2.3, aimLElbow: 1.2, aimLW: 1 });
        applyPose(rig, p);
      });
    } else {
      const t = time - 4;
      const rig = this.fielders[0];
      rig.root.visible = true;
      rig.root.position.set(8, 0, 0);
      rig.root.rotation.set(0, 0, 0);
      idlePose(p, t);
      if (moment.bowlerVariant === 0) setPose(p, { headPitch: 0.3, headYaw: Math.sin(t * 8) * 0.25, torsoPitch: 0.1 });
      else if (moment.bowlerVariant === 1) {
        setPose(p, { headPitch: 0.15 });
        this.handOnHead(rig, 1);
      }
      else setPose(p, { handRX: 0.27, handRY: 1, handRZ: 0, handRW: 1, handLX: -0.27, handLY: 1, handLZ: 0, handLW: 1, headPitch: 0.25 });
      applyPose(rig, p);
      this.camera.set(10.6, 2, -4.5);
      this.look.set(8, 1.2, 0);
    }
  }

  /** Assemble all eleven with staggered arrivals, partner contacts and individual rhythms. */
  private teamCelebration(moment: MatchMoment, time: number): void {
    this.camera.set(9.1, 5.3, -9.8);
    this.look.set(8, 0.95, 1.1);
    const p = this.pose;
    this.fielders.forEach((rig, i) => {
      const [x, z] = HUDDLE[i];
      const delay = i < 2 ? 0 : (i % 4) * 0.11;
      const duration = i < 2 ? 1 : 0.85 + (i % 3) * 0.16;
      const u = THREE.MathUtils.clamp((time - delay) / duration, 0, 1);
      const travel = i === 0 ? 0 : 0.85 + (i % 3) * 0.22;
      const direction = new THREE.Vector2(x || 0.3, z + 0.25).normalize();
      const remaining = travel * (1 - smooth(u));
      rig.root.visible = true;
      rig.root.position.set(8 + x + direction.x * remaining, 0, z + direction.y * remaining);
      const inward = faceYaw(-direction.x, -direction.y);
      // The front pair open toward one another; the others watch the bowler,
      // rather than all staring out at the broadcast camera.
      const finalYaw = i < 2 ? (i === 0 ? -0.35 : 0.35) : faceYaw(-x - 0.48, -z);
      const turn = smooth((u - 0.75) / 0.25);
      rig.root.rotation.set(0, inward + Math.atan2(Math.sin(finalYaw - inward), Math.cos(finalYaw - inward)) * turn, 0);
      if (i === 0) rig.root.rotation.y = finalYaw;
      const speed = travel * 6 * u * (1 - u) / duration;
      if (speed > 0.05) gaitPose(p, advancePhase(0, (travel - remaining) / RIG_SCALE, travel / duration / RIG_SCALE), speed / RIG_SCALE);
      else idlePose(p, time, i * 13);

      const settled = smooth((u - 0.75) / 0.25);
      if (i === 0 && time < 1.05) {
        const punch = Math.sin(Math.PI * smooth(time / 1.05));
        setPose(p, { aimRSwing: 1.8 + punch * 1.1, aimRElbow: 0.7 + punch * 0.6, aimRW: 1,
          torsoYaw: -0.2 + punch * 0.4, torsoPitch: -punch * 0.08 });
        if (moment.bowlerVariant === 1) {
          setPose(p, { aimLSwing: 2.8, aimLElbow: 0.5, aimLW: 1 });
          rig.root.position.y = Math.max(0, Math.sin(time / 1.05 * Math.PI)) * 0.2;
        } else if (moment.bowlerVariant === 2) setPose(p, { aimLSwing: 2.2, aimLSide: -0.8, aimLW: 1 });
      } else if (i < 2) {
        const contact = smooth((time - 1.05) / 0.5) * (1 - smooth((time - 2.05) / 0.55));
        this.reachWorld(rig, i === 0 ? "R" : "L", 8, 1.78, -0.13, contact);
      } else if (i === 2 || i === 3) {
        // A shoulder pat on the front pair, with a small lift/release rather than a frozen reach.
        const partner = this.fielders[i === 2 ? 0 : 1];
        const shoulder = i === 2 ? partner.shoulderL : partner.shoulderR;
        const at = shoulder.getWorldPosition(this.headTouch);
        this.reachWorld(rig, i === 2 ? "R" : "L", at.x, at.y + 0.04 + Math.sin(time * 8 + i) * 0.035, at.z, settled);
      } else if (i === 6 || i === 7) {
        const contact = settled * smooth((time - 1.4) / 0.4) * (1 - smooth((time - 2.3) / 0.5));
        this.reachWorld(rig, i === 6 ? "R" : "L", 7.2, 1.8, 1.95, contact);
      } else if (i % 2 === 0) {
        const clap = 0.04 + 0.15 * Math.abs(Math.sin(time * (6 + i * 0.13) + i));
        setPose(p, { handRX: clap, handLX: -clap, handRY: 1.24, handLY: 1.24, handRZ: -0.4, handLZ: -0.4, handRW: settled, handLW: settled });
      } else setPose(p, { aimRSwing: 2.3 + Math.sin(time * 6 + i) * 0.3, aimRElbow: 1, aimRW: settled, torsoYaw: Math.sin(time * 3 + i) * 0.12 });
      setPose(p, { headYaw: Math.sin(time * 2 + i) * 0.13 });
      applyPose(rig, p);
    });
  }

  /** World-space partner contacts remain aligned even when teammates turn inward. */
  private reachWorld(rig: PlayerRig, side: "L" | "R", x: number, y: number, z: number, weight: number): void {
    rig.root.updateMatrixWorld(true);
    const at = rig.root.worldToLocal(this.headTouch.set(x, y, z));
    setPose(this.pose, side === "L" ? { handLX: at.x, handLY: at.y, handLZ: at.z, handLW: weight }
      : { handRX: at.x, handRY: at.y, handRZ: at.z, handRW: weight });
  }

  /** Follow the posed helmet/cap so a lowered head never leaves the hand floating. */
  private handOnHead(rig: PlayerRig, weight: number): void {
    applyPose(rig, this.pose);
    jointPoint(rig, rig.head, this.crown, this.headTouch);
    setPose(this.pose, { handLX: this.headTouch.x, handLY: this.headTouch.y, handLZ: this.headTouch.z, handLW: weight });
  }
}
