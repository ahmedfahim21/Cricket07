import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyBall, newInnings } from "../match/state";
import { dismissedBatsman, momentShot, nextReaction, reactionTime, WICKET_IMPACT_TIME, type MatchMoment } from "./moments";
import { ReactionScene } from "./reactions";
import { BOUNDARY_HOLD_TIME } from "./boundary";

const wicket: MatchMoment = { kind: "wicket", bowlerVariant: 0, batterVariant: 0, dismissed: null };

describe("match-moment presentation", () => {
  it("reserves player cutaways for wickets and keeps both boundaries umpire-only", () => {
    expect(momentShot(null, 1)).toBeNull();
    expect(momentShot(wicket, 0)).toBeNull();
    expect(momentShot(wicket, WICKET_IMPACT_TIME)).toBe("fielders");
    expect(momentShot(wicket, 3.99)).toBe("fielders");
    expect(momentShot(wicket, 4)).toBe("walkoff");
    expect(momentShot({ ...wicket, bowlerName: "Mitchell" }, 0.5)).toBeNull();
    expect(momentShot({ ...wicket, bowlerName: "Mitchell" }, 1.5)).toBe("bowler-wicket");
    expect(momentShot({ ...wicket, bowlerName: "Mitchell" }, 2.1)).toBe("fielders");
    for (const kind of ["four", "six"] as const) {
      for (const time of [0, 1.4, 2.6, 4, 5.2]) expect(momentShot({ ...wicket, kind }, time)).toBeNull();
    }
    expect(BOUNDARY_HOLD_TIME).toBe(2.6);
  });

  it("keeps both dismissal types live for a full second without eating animation time", () => {
    for (const dismissal of ["bowled", "caught"] as const) {
      const dismissed = dismissedBatsman(newInnings(["A", "B", "C"]), dismissal);
      for (const bowlerName of [undefined, "Mitchell"]) {
        const moment = { ...wicket, dismissed, bowlerName };
        expect(momentShot(moment, 0.99)).toBeNull();
        expect(reactionTime(moment, 0.99)).toBe(0);
        expect(reactionTime(moment, 1.5)).toBe(0.5);
        expect(reactionTime(moment, 4)).toBe(3);
      }
    }
  });

  it("includes the dismissal ball without mutating or double-scoring the innings", () => {
    const match = applyBall(newInnings(["A", "B", "C", "D"]), { runs: 4, four: true });
    const before = structuredClone(match);
    for (const dismissal of ["bowled", "caught"] as const) {
      expect(dismissedBatsman(match, dismissal)).toMatchObject({ name: "A", runs: 4, ballsFaced: 2, out: true, dismissal });
      expect(match).toEqual(before);
    }
    const scored = applyBall(match, { runs: 0, dismissal: "bowled" });
    expect(scored.batsmen[0]).toEqual(dismissedBatsman(match, "bowled"));
    expect(scored.batsmen[scored.striker].ballsFaced).toBe(0);
  });

  it("never repeats the preceding cosmetic variant", () => {
    for (let previous = -1; previous < 3; previous++) {
      for (const random of [0, 0.4, 0.999]) {
        const next = nextReaction(previous, () => random);
        expect(next).not.toBe(previous);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(3);
      }
    }
  });

  const scene = new ReactionScene();
  it("brings the high-five hands together above shoulder height", () => {
    scene.update(wicket, "fielders", 2);
    scene.group.updateMatrixWorld(true);
    const right = scene.fielders[0].handR.getWorldPosition(new THREE.Vector3());
    const left = scene.fielders[1].handL.getWorldPosition(new THREE.Vector3());
    expect(right.distanceTo(left)).toBeLessThan(0.12);
    expect(right.y).toBeGreaterThan(1.5);
  });

  it("gathers all eleven, including the keeper, with distinct inward-facing positions", () => {
    scene.update(wicket, "fielders", 2);
    expect(scene.fielders).toHaveLength(11);
    expect(scene.fielders.every((rig) => rig.root.visible)).toBe(true);
    const positions = scene.fielders.map((rig) => rig.root.position.toArray().join(","));
    expect(new Set(positions).size).toBe(11);
    expect(new Set(scene.fielders.map((rig) => rig.root.rotation.y.toFixed(2))).size).toBeGreaterThan(6);
    // The elevated group shot must contain every head, not just the front pair.
    const camera = new THREE.PerspectiveCamera(38, 1440 / 900, 0.1, 200);
    camera.position.copy(scene.camera);
    camera.lookAt(scene.look);
    camera.updateMatrixWorld(true);
    scene.group.updateMatrixWorld(true);
    for (const rig of scene.fielders) {
      const head = rig.head.getWorldPosition(new THREE.Vector3()).project(camera);
      expect(Math.abs(head.x)).toBeLessThan(0.9);
      expect(Math.abs(head.y)).toBeLessThan(0.9);
    }
  });

  it.each([0, 1, 2])("walks every dismissed-batter variant toward the stands (%i)", (batterVariant) => {
    const moment = { ...wicket, batterVariant };
    scene.update(moment, "walkoff", 3.1);
    const start = scene.batsmen[0].root.position.z;
    scene.update(moment, "walkoff", 6);
    expect(scene.batsmen[0].root.position.z).toBeLessThan(start - 1.5);
    expect(scene.camera.z).toBeLessThan(scene.batsmen[0].root.position.z);
  });

  it("clears all cinematic actors when a moment ends", () => {
    scene.update(wicket, "fielders", 1);
    expect(scene.group.visible).toBe(true);
    scene.update(null, null, 0);
    expect(scene.group.visible).toBe(false);
  });

  it("rests the hand on the bowed helmet instead of above it", () => {
    for (const time of [4, 4.5, 5, 6]) {
      scene.update({ ...wicket, batterVariant: 2 }, "walkoff", time);
      scene.group.updateMatrixWorld(true);
      const rig = scene.batsmen[0];
      const crown = rig.head.localToWorld(new THREE.Vector3(-0.045, 0.28, -0.025));
      const hand = rig.handL.getWorldPosition(new THREE.Vector3());
      expect(hand.distanceTo(crown)).toBeLessThan(0.1);
    }
  });
});
