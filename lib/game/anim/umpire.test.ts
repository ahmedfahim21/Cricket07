import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { makePlayer } from "../assets/kit";
import { applyPose, makePose } from "./pose";
import { idlePose } from "./locomotion";
import { umpireSignalPose } from "./umpire";

describe("umpire boundary signals", () => {
  const rig = makePlayer({ role: "umpire" });
  const idle = idlePose(makePose(), 0, 7);
  const pose = makePose();
  const at = (runs: 4 | 6, time: number) => {
    umpireSignalPose(pose, idle, runs, time);
    applyPose(rig, pose);
    rig.root.updateMatrixWorld(true);
  };
  it("raises both hands above the head for a six", () => {
    at(6, 0.8);
    const head = rig.head.getWorldPosition(new THREE.Vector3());
    for (const hand of [rig.handL, rig.handR]) expect(hand.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(head.y + 0.2);
  });
  it("sweeps one arm across the chest for four while the other stays down", () => {
    at(4, 0.4);
    const first = rig.handR.getWorldPosition(new THREE.Vector3());
    at(4, 0.85);
    const across = rig.handR.getWorldPosition(new THREE.Vector3());
    const left = rig.handL.getWorldPosition(new THREE.Vector3());
    expect(first.x - across.x).toBeGreaterThan(0.5);
    expect(across.y).toBeGreaterThan(left.y + 0.3);
  });
  it("returns to the idle pose without modifying its input", () => {
    const before = idle.slice();
    at(6, 0);
    expect(pose).toEqual(before);
    at(4, 3);
    expect(pose).toEqual(before);
    expect(idle).toEqual(before);
  });
});
