/**
 * The ball line — the broadcast trail the ball draws behind itself.
 *
 * A delivery is three distinct pieces of information and the trail is drawn as
 * three separate coloured LEGS so they can be read apart at a glance:
 *
 *   flight   the ball in the air out of the hand, before it pitches
 *   pitched  off the deck — the kink between this leg and the last IS the
 *            seam/spin deviation, which is the whole reason to draw the line
 *   struck   off the bat, wherever it ends up
 *
 * The legs are ordered and a delivery only ever moves forward through them, so
 * each is one contiguous polyline rather than a set of disjoint runs. A leg
 * always opens on the previous leg's last point, which is what stops a visible
 * gap appearing at the bounce and at contact — the two places a viewer is
 * looking hardest.
 *
 * Pure: no three.js. The engine owns turning `positions()` into geometry, this
 * owns deciding which points are worth keeping.
 */

/** Ordered: a delivery only ever advances through these. */
export const TRAIL_LEGS = ["flight", "pitched", "struck"] as const;
export type TrailLeg = (typeof TRAIL_LEGS)[number];

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Minimum distance between recorded points, metres.
 *
 * Sampling by DISTANCE rather than per frame is deliberate: a 40 m/s delivery
 * covers 0.66 m in a frame and a ball trickling to a fielder covers 0.01 m, so
 * per-frame sampling gives a sparse line through the air and hundreds of
 * stacked points at the end of it. At 0.12 m the fastest ball still gets five
 * points between the hand and the pitch of the ball.
 */
export const TRAIL_STEP = 0.12;

/**
 * Points kept per leg before the leg is thinned.
 *
 * A struck ball can run 90 m to the rope and back to the keeper, which is 1500
 * points at the base step. Thinning keeps the line's full extent at a coarser
 * resolution instead of truncating it, because a trail that stops halfway to
 * the boundary looks like a bug.
 */
export const TRAIL_CAPACITY = 384;

export class BallTrail {
  /** Flat x,y,z per leg. Reused across deliveries; never reallocated per frame. */
  private legs: Record<TrailLeg, number[]> = { flight: [], pitched: [], struck: [] };
  /** Current sampling distance per leg; doubles each time a leg is thinned. */
  private steps: Record<TrailLeg, number> = { flight: TRAIL_STEP, pitched: TRAIL_STEP, struck: TRAIL_STEP };
  private current: TrailLeg | null = null;

  /** The leg being appended to, or null before the first `open`. */
  get leg(): TrailLeg | null {
    return this.current;
  }

  /** True once there is a drawable line — a single point is not one. */
  get drawable(): boolean {
    return TRAIL_LEGS.some((leg) => this.count(leg) >= 2);
  }

  positions(leg: TrailLeg): readonly number[] {
    return this.legs[leg];
  }

  count(leg: TrailLeg): number {
    return this.legs[leg].length / 3;
  }

  /**
   * Start a leg at an exact point — the release, the pitch of the ball, the
   * middle of the bat. Carries the previous leg's last point in as this leg's
   * first so the two share an endpoint and the line reads as unbroken.
   *
   * Opening a leg that is already open is a no-op, so a caller may say "this
   * is the pitched leg now" on every frame without restarting it.
   */
  open(leg: TrailLeg, at: TrailPoint): void {
    if (this.current === leg) return;
    const previous = this.current;
    this.current = leg;
    this.legs[leg].length = 0;
    this.steps[leg] = TRAIL_STEP;
    if (previous) {
      const tail = this.legs[previous];
      // Join to wherever the last leg actually ended, not to where it opened.
      if (tail.length >= 3) this.legs[leg].push(tail[tail.length - 3], tail[tail.length - 2], tail[tail.length - 1]);
    }
    this.legs[leg].push(at.x, at.y, at.z);
  }

  /**
   * Record where the ball is. Dropped if it has not moved far enough since the
   * last recorded point. Returns true when the geometry changed, so the engine
   * can skip rebuilding a buffer that has not.
   */
  push(at: TrailPoint): boolean {
    const leg = this.current;
    if (!leg) return false;
    const points = this.legs[leg];
    const n = points.length;
    if (n >= 3) {
      const dx = at.x - points[n - 3];
      const dy = at.y - points[n - 2];
      const dz = at.z - points[n - 1];
      if (dx * dx + dy * dy + dz * dz < this.steps[leg] * this.steps[leg]) return false;
    }
    points.push(at.x, at.y, at.z);
    if (points.length / 3 > TRAIL_CAPACITY) this.thin(leg);
    return true;
  }

  /**
   * Halve a leg's resolution in place: keep every other point, and the last
   * one whether or not it falls on an even index, so the line's end does not
   * jump backwards. The step doubles to match the new spacing.
   */
  private thin(leg: TrailLeg): void {
    const points = this.legs[leg];
    const total = points.length / 3;
    let write = 0;
    for (let read = 0; read < total; read += 2) {
      points[write++] = points[read * 3];
      points[write++] = points[read * 3 + 1];
      points[write++] = points[read * 3 + 2];
    }
    if ((total - 1) % 2 !== 0) {
      points[write++] = points[(total - 1) * 3];
      points[write++] = points[(total - 1) * 3 + 1];
      points[write++] = points[(total - 1) * 3 + 2];
    }
    points.length = write;
    this.steps[leg] *= 2;
  }

  /** Wipe every leg for the next delivery. */
  clear(): void {
    for (const leg of TRAIL_LEGS) {
      this.legs[leg].length = 0;
      this.steps[leg] = TRAIL_STEP;
    }
    this.current = null;
  }
}
