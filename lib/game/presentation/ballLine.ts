/**
 * Drawing the ball line.
 *
 * `trail.ts` decides which points are worth keeping; this turns them into
 * something you can see, plus the scuff mark left on the pitch where the ball
 * actually landed.
 *
 * Why Line2 and not THREE.Line: WebGL ignores `linewidth` on LineBasicMaterial
 * on every desktop driver, so a plain line is always one device pixel. At the
 * supersample factors this game renders at (up to 2x) a one-pixel trail is a
 * faint dotted thread that disappears against the crowd. Line2 expands the
 * line into camera-facing quads in the vertex shader, so a width in CSS pixels
 * means the same thickness whatever the render scale — which is also why the
 * material needs the drawing-buffer size handed to it on every resize.
 *
 * The three legs are three Line2 objects rather than one with vertex colours,
 * because they want different widths as well as different colours: the shot is
 * the headline and is drawn heaviest.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { BALL_RADIUS } from "../dimensions";
import { TRAIL_LEGS, type BallTrail, type TrailLeg, type TrailPoint } from "./trail";

/**
 * Per-leg look.
 *
 * Pale cyan through the air, amber off the deck, hot orange off the bat: three
 * hues that all hold up against grass, against the sky and against the crowd,
 * and that read in the same order a viewer learns them (what the bowler did,
 * what the pitch did, what the batsman did).
 */
const LOOK: Record<TrailLeg, { color: number; width: number }> = {
  flight: { color: 0x9fe8ff, width: 3.0 },
  pitched: { color: 0xffce46, width: 3.4 },
  struck: { color: 0xff6036, width: 4.4 },
};

/** The scuff is drawn a hair above the turf so it never z-fights the pitch. */
const MARK_Y = 0.012;

export interface BallLineView {
  readonly group: THREE.Group;
  /** Rebuild the geometry from the trail and apply the current fade. */
  update(trail: BallTrail, opts: { visible: boolean; opacity: number }): void;
  /** Where the ball pitched, or null to take the mark away. */
  markPitch(at: TrailPoint | null): void;
  /** Drawing-buffer size in pixels — Line2 needs it to size the line. */
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createBallLine(): BallLineView {
  const group = new THREE.Group();
  group.name = "ball-line";

  // LineMaterial's `resolution` setter COPIES the vector it is given, so a
  // shared Vector2 does not stay live — every resize has to assign it again.
  const resolution = new THREE.Vector2(1, 1);
  const lines = {} as Record<TrailLeg, Line2>;
  const materials = {} as Record<TrailLeg, LineMaterial>;

  for (const leg of TRAIL_LEGS) {
    const material = new LineMaterial({
      color: LOOK[leg].color,
      linewidth: LOOK[leg].width,
      transparent: true,
      opacity: 1,
      // Depth TEST on so a trail behind a fielder stays behind him; depth
      // WRITE off so the ink pass, which reads the depth texture, does not
      // draw an outline down both sides of every trail.
      depthTest: true,
      depthWrite: false,
      // Line2 widens the line in the vertex shader, so the quad edges alias
      // badly without this. It is cheaper here than another full-screen pass.
      alphaToCoverage: true,
    });
    material.resolution = resolution;
    const line = new Line2(new LineGeometry(), material);
    line.name = `ball-line-${leg}`;
    // The bounding sphere of a two-point geometry is tiny and the line is wide;
    // culling it by that sphere pops the trail out at the edges of frame.
    line.frustumCulled = false;
    line.visible = false;
    line.castShadow = false;
    line.receiveShadow = false;
    // Over the grass, under nothing: the legs draw in trail order.
    line.renderOrder = 2;
    lines[leg] = line;
    materials[leg] = material;
    group.add(line);
  }

  /*
   * The pitch mark.
   *
   * Elongated along Z because that is the direction a delivery is travelling
   * when it lands, so it reads as a scuff dragged down the pitch rather than as
   * a dot dropped on it. Drawn as a filled blob with a brighter rim, which is
   * what survives being 15 pixels across on screen.
   */
  const markGeometry = new THREE.CircleGeometry(1, 28);
  const markMaterial = new THREE.MeshBasicMaterial({
    color: LOOK.pitched.color,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mark = new THREE.Mesh(markGeometry, markMaterial);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 28), ringMaterial);
  mark.add(ring);
  mark.name = "pitch-mark";
  mark.rotation.x = -Math.PI / 2;
  // A ball is 36mm across; the scuff it leaves is about twice that, stretched.
  mark.scale.set(BALL_RADIUS * 2.1, BALL_RADIUS * 3.8, 1);
  mark.visible = false;
  mark.renderOrder = 1;
  group.add(mark);
  let marked = false;

  return {
    group,

    update(trail, { visible, opacity }) {
      for (const leg of TRAIL_LEGS) {
        const line = lines[leg];
        const count = trail.count(leg);
        // One point is a dot, not a line; Line2 would draw a degenerate quad.
        line.visible = visible && count >= 2;
        if (!line.visible) continue;
        line.geometry.setPositions(trail.positions(leg) as number[]);
        materials[leg].opacity = opacity;
      }
      mark.visible = visible && marked;
      markMaterial.opacity = opacity * 0.4;
      ringMaterial.opacity = opacity * 0.95;
    },

    markPitch(at) {
      marked = at !== null;
      if (!at) {
        mark.visible = false;
        return;
      }
      mark.position.set(at.x, MARK_Y, at.z);
    },

    resize(width, height) {
      resolution.set(Math.max(1, width), Math.max(1, height));
      for (const leg of TRAIL_LEGS) materials[leg].resolution = resolution;
    },

    dispose() {
      for (const leg of TRAIL_LEGS) {
        lines[leg].geometry.dispose();
        materials[leg].dispose();
      }
      markGeometry.dispose();
      markMaterial.dispose();
      (ring.geometry as THREE.BufferGeometry).dispose();
      ringMaterial.dispose();
    },
  };
}
