/**
 * Drawing the ball line.
 *
 * `trail.ts` decides which points are worth keeping; this turns them into
 * something you can see, plus the scuff mark left on the pitch where the ball
 * actually landed.
 *
 * ---------------------------------------------------------------------------
 * THE DELIVERY IS INFORMATION. THE SHOT IS THE MOMENT.
 * ---------------------------------------------------------------------------
 * These are not the same drawing problem and are deliberately not drawn alike.
 *
 * The two delivery legs are a pitch map: thin, flat, readable. Their whole job
 * is to let you see where it was bowled and how much it did off the deck, and
 * the kink between them is the only thing they need to sell.
 *
 * The shot is a replay beat. It gets proper ball tracking, built from three
 * passes drawn over each other:
 *
 *   shadow  the arc projected flat onto the turf, directly beneath itself. This
 *           is the one that sells HEIGHT — without it a six and a flat drive
 *           read the same from behind, because the screen is two-dimensional.
 *   core    the arc, graded along its length from deep red where the bat met it
 *           to white-hot at the ball, so it reads as travelling rather than as
 *           a line that happens to be there.
 *   glow    a wide additive bloom over the last stretch only, so the near end
 *           burns and the far end falls away: a comet, not a stripe.
 *
 * ---------------------------------------------------------------------------
 * WHY Line2 AND NOT THREE.Line
 * ---------------------------------------------------------------------------
 * WebGL ignores `linewidth` on LineBasicMaterial on every desktop driver, so a
 * plain line is always one device pixel. At the supersample factors this game
 * renders at (up to 2x) that is a faint dotted thread that disappears against
 * the crowd, and there is no dramatic version of one pixel. Line2 expands the
 * line into camera-facing quads in the vertex shader, so a width in CSS pixels
 * means the same thickness whatever the render scale — which is also why the
 * material needs the drawing-buffer size handed to it on every resize.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { BALL_RADIUS } from "../dimensions";
import { type BallTrail, type TrailLeg, type TrailPoint } from "./trail";

/**
 * The delivery, as a pitch map.
 *
 * Pale cyan through the air and amber off the deck: two hues that hold up
 * against grass, sky and crowd, and that read in the order you learn them —
 * what the bowler did, then what the pitch did.
 */
const DELIVERY_LOOK: Record<"flight" | "pitched", { color: number; width: number }> = {
  flight: { color: 0x9fe8ff, width: 2.6 },
  pitched: { color: 0xffce46, width: 3.0 },
};

/** The shot's three passes, in CSS pixels. */
const SHOT_CORE_WIDTH = 5.5;
const SHOT_GLOW_WIDTH = 18;
const SHOT_SHADOW_WIDTH = 4.2;

/** Graded along the arc: deep red at the bat, white-hot at the ball. */
const SHOT_COOL = new THREE.Color(0xc62411);
const SHOT_HOT = new THREE.Color(0xfff0b4);

/**
 * How much of the arc the bloom covers, as a fraction of its points.
 *
 * Only the leading stretch burns. Blooming the whole arc gives an even stripe,
 * which is the opposite of the intent — the brightness has to fall away behind
 * the ball for the eye to read a direction of travel.
 */
const SHOT_GLOW_FRACTION = 0.3;
/** ...but never fewer than this, or a freshly struck ball has no head at all. */
const SHOT_GLOW_MIN = 6;

/** Flat passes sit a hair above the turf so they never z-fight it. */
const GROUND_Y = 0.015;
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
  const materials: LineMaterial[] = [];

  function makeLine(name: string, opts: {
    color?: number;
    width: number;
    opacity: number;
    order: number;
    additive?: boolean;
    vertexColors?: boolean;
  }): Line2 {
    const material = new LineMaterial({
      color: opts.color ?? 0xffffff,
      linewidth: opts.width,
      transparent: true,
      opacity: opts.opacity,
      vertexColors: opts.vertexColors ?? false,
      // Depth TEST on so a line behind a fielder stays behind him; depth WRITE
      // off so the ink pass, which reads the depth texture, does not draw an
      // outline down both sides of every line — and so the three shot passes
      // do not occlude each other.
      depthTest: true,
      depthWrite: false,
      // NOT alphaToCoverage. It turns alpha into MSAA coverage samples, and this
      // pipeline renders to a plain half-float target and anti-aliases with
      // FXAA — there are no samples to resolve, so a semi-transparent line comes
      // out as a harsh dither pattern. The ground shadow, at 0.2 alpha, was
      // drawn as a dotted line because of it.
      ...(opts.additive ? { blending: THREE.AdditiveBlending } : {}),
    });
    material.resolution = resolution;
    materials.push(material);

    const line = new Line2(new LineGeometry(), material);
    line.name = name;
    // The bounding sphere of a two-point geometry is tiny and the line is wide;
    // culling by that sphere pops the line out at the edges of frame.
    line.frustumCulled = false;
    line.visible = false;
    line.castShadow = false;
    line.receiveShadow = false;
    line.renderOrder = opts.order;
    group.add(line);
    return line;
  }

  const flight = makeLine("ball-line-flight", { ...DELIVERY_LOOK.flight, opacity: 0.85, order: 2 });
  const pitched = makeLine("ball-line-pitched", { ...DELIVERY_LOOK.pitched, opacity: 0.9, order: 2 });
  // Drawn under the arc so the arc always wins where they cross on screen.
  const shotShadow = makeLine("ball-line-struck-shadow", { color: 0x120602, width: SHOT_SHADOW_WIDTH, opacity: 0.55, order: 1 });
  const shotCore = makeLine("ball-line-struck", { width: SHOT_CORE_WIDTH, opacity: 1, order: 3, vertexColors: true });
  const shotGlow = makeLine("ball-line-struck-glow", { color: 0xff5a1e, width: SHOT_GLOW_WIDTH, opacity: 0.3, order: 4, additive: true });

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
    color: DELIVERY_LOOK.pitched.color,
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

  // Scratch buffers for the shot's derived passes. Grown, never reallocated per
  // frame: the arc is rebuilt every time a point is appended.
  let shadowPositions: number[] = [];
  let coreColors: number[] = [];
  let glowPositions: number[] = [];
  const scratch = new THREE.Color();

  /** Hide every pass of the shot at once. */
  function hideShot() {
    shotShadow.visible = false;
    shotCore.visible = false;
    shotGlow.visible = false;
  }

  /** Build the shadow, the gradient and the comet head from the arc. */
  function buildShot(points: readonly number[], count: number, opacity: number) {
    shadowPositions.length = 0;
    coreColors.length = 0;
    for (let i = 0; i < count; i++) {
      shadowPositions.push(points[i * 3], GROUND_Y, points[i * 3 + 2]);
      // Hot end at the ball, which is the LAST point: the arc is appended to.
      scratch.copy(SHOT_COOL).lerp(SHOT_HOT, count === 1 ? 1 : i / (count - 1));
      coreColors.push(scratch.r, scratch.g, scratch.b);
    }
    shotCore.geometry.setPositions(points as number[]);
    shotCore.geometry.setColors(coreColors);
    shotShadow.geometry.setPositions(shadowPositions);

    // The bloom covers the leading stretch only, so the head burns and the tail
    // falls away. Needs two points of its own to be a line at all.
    const head = Math.max(SHOT_GLOW_MIN, Math.round(count * SHOT_GLOW_FRACTION));
    const from = Math.max(0, count - head);
    shotGlow.visible = count - from >= 2;
    if (shotGlow.visible) {
      glowPositions.length = 0;
      for (let i = from; i < count; i++) {
        glowPositions.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      }
      shotGlow.geometry.setPositions(glowPositions);
    }

    shotCore.material.opacity = opacity;
    shotShadow.material.opacity = opacity * 0.55;
    shotGlow.material.opacity = opacity * 0.3;
    shotShadow.visible = true;
    shotCore.visible = true;
  }

  function drawDelivery(line: Line2, trail: BallTrail, leg: TrailLeg, visible: boolean, opacity: number, base: number) {
    const count = trail.count(leg);
    // One point is a dot, not a line; Line2 would draw a degenerate quad.
    line.visible = visible && count >= 2;
    if (!line.visible) return;
    line.geometry.setPositions(trail.positions(leg) as number[]);
    line.material.opacity = opacity * base;
  }

  return {
    group,

    update(trail, { visible, opacity }) {
      drawDelivery(flight, trail, "flight", visible, opacity, 0.85);
      drawDelivery(pitched, trail, "pitched", visible, opacity, 0.9);

      const struck = trail.count("struck");
      if (!visible || struck < 2) hideShot();
      else buildShot(trail.positions("struck"), struck, opacity);

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
      for (const material of materials) material.resolution = resolution;
    },

    dispose() {
      for (const line of [flight, pitched, shotShadow, shotCore, shotGlow]) line.geometry.dispose();
      for (const material of materials) material.dispose();
      markGeometry.dispose();
      markMaterial.dispose();
      (ring.geometry as THREE.BufferGeometry).dispose();
      ringMaterial.dispose();
    },
  };
}
