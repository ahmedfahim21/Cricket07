/**
 * The asset catalogue.
 *
 * Factories are exported as thunks so the scene builder decides when (and how
 * many times) anything is instantiated, and so the preview harness can build
 * the whole kit without the engine existing.
 */

import type { BodyLibrary } from "./bodies";
import { dressAs, sampleFor } from "../roster/cast";
import * as THREE from "three";
import { createMaterialLibrary, type MaterialLibrary } from "../materials";
import { makeBall, makeBat, makeHelmet, makePads, makeStumps } from "./equipment";
import { buildGround } from "./ground";
import { buildStadium } from "./stadium";
import { BATTING_KIT, FIELDING_KIT, makePlayer, type Role } from "./kit";
import { applyPose, makePose } from "../anim/pose";
import { idlePose, readyPose } from "../anim/locomotion";

export * from "./equipment";
export * from "./ground";
export * from "./stadium";
export * from "./kit";
export { motionSheets } from "../anim/sheets";
export { loadBodies } from "./bodies";

export type PreviewEntry = { name: string; group: THREE.Group };

/**
 * Everything the preview harness renders. Takes a live renderer because the
 * material library needs the max-anisotropy capability off it.
 */
export async function previewGroups(renderer: THREE.WebGLRenderer, bodies: BodyLibrary): Promise<PreviewEntry[]> {
  const lib: MaterialLibrary = createMaterialLibrary(renderer);
  const mats = { standard: undefined }; // equipment uses its own cached materials

  const entries: PreviewEntry[] = [
    { name: "ball", group: makeBall() },
    { name: "bat", group: makeBat() },
    { name: "stumps", group: makeStumps() },
    { name: "pads", group: makePads() },
    { name: "helmet", group: makeHelmet() },
  ];

  // Surface swatches: one 1m quad per procedural material, so a texture that
  // has gone wrong is visible next to the props that use it.
  for (const name of ["turf", "pitch_soil", "concrete", "fabric", "willow", "leather"] as const) {
    const g = new THREE.Group();
    // 40cm, not 1m: a swatch big enough to read the texture on, but not so big
    // it forces a grid cell that shrinks the ball next to it into a dot.
    const quad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.4), lib.get(name));
    quad.receiveShadow = true;
    quad.castShadow = true;
    g.add(quad);
    g.name = `swatch-${name}`;
    entries.push({ name: `swatch:${name}`, group: g });
  }

  // Players, in their standing poses. How they move is judged on the motion
  // sheets (`pnpm preview:motion`), not here.
  const posed = (role: Role, colours = FIELDING_KIT, ready = false) => {
    const rig = makePlayer({ role, colours });
    dressAs(rig, bodies, sampleFor(role));
    applyPose(rig, ready ? readyPose(makePose(), 0) : idlePose(makePose(), 0));
    return rig.root;
  };
  entries.push({ name: "batsman", group: posed("batsman", BATTING_KIT) });
  entries.push({ name: "fielder", group: posed("fielder") });
  entries.push({ name: "fielder-ready", group: posed("fielder", FIELDING_KIT, true) });
  entries.push({ name: "keeper", group: posed("keeper") });
  entries.push({ name: "umpire", group: posed("umpire") });

  // The big two get their own frames — laid out next to a ball they would
  // shrink everything else to nothing.
  const ground = buildGround(lib);
  entries.push({ name: "ground", group: ground.group });

  const stadium = buildStadium(lib);
  const whole = new THREE.Group();
  whole.add(buildGround(lib).group, stadium.group);
  entries.push({ name: "stadium", group: whole });

  void mats;
  return entries;
}
