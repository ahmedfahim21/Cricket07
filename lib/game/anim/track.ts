/**
 * Keyframe tracks over channel poses.
 *
 * Interpolation is a cubic Hermite with Catmull-Rom tangents, per channel.
 * The old swing eased smoothstep-style between each pair of keys, which brings
 * the bat to a dead stop at EVERY key — so the bat decelerated to nothing at
 * the moment it met the ball, then set off again. Catmull-Rom keeps velocity
 * continuous through a key, so a bat can be moving fastest exactly at contact.
 *
 * A key marked `hold` has zero velocity (top of the backlift, the moment a
 * bowler plants), which is where a real movement does pause. Tangents are also
 * kept monotone per channel — see `tangent` — so nothing overshoots its key.
 */

import { C, CHANNELS, Pose, clampWeights, copyPose, makePose } from "./pose";

export interface Key {
  t: number;
  pose: Pose;
  /** Zero velocity at this key. */
  hold?: boolean;
}

export class Track {
  readonly keys: Key[];

  constructor(keys: Key[]) {
    if (keys.length === 0) throw new Error("Track needs at least one key");
    this.keys = keys.slice().sort((a, b) => a.t - b.t);
    // q and -q are the same rotation; interpolating between keys that
    // disagree on sign swings the bat the long way round. Keep neighbours
    // in the same hemisphere.
    for (let i = 1; i < this.keys.length; i++) {
      const a = this.keys[i - 1].pose;
      const b = this.keys[i].pose;
      const dot = a[C.batQX] * b[C.batQX] + a[C.batQY] * b[C.batQY] + a[C.batQZ] * b[C.batQZ] + a[C.batQW] * b[C.batQW];
      if (dot < 0) {
        b[C.batQX] = -b[C.batQX];
        b[C.batQY] = -b[C.batQY];
        b[C.batQZ] = -b[C.batQZ];
        b[C.batQW] = -b[C.batQW];
      }
    }
  }

  get start(): number {
    return this.keys[0].t;
  }

  get end(): number {
    return this.keys[this.keys.length - 1].t;
  }

  get duration(): number {
    return this.end - this.start;
  }

  /** Sample at time `t` into `out`. Clamped at both ends. */
  evaluate(t: number, out: Pose = makePose()): Pose {
    const k = this.keys;
    if (k.length === 1 || t <= k[0].t) return clampWeights(copyPose(out, k[0].pose));
    if (t >= k[k.length - 1].t) return clampWeights(copyPose(out, k[k.length - 1].pose));

    let i = 0;
    while (i < k.length - 2 && t >= k[i + 1].t) i++;
    const k0 = k[i];
    const k1 = k[i + 1];
    const h = k1.t - k0.t;
    const s = (t - k0.t) / h;

    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;

    const prev = i > 0 ? k[i - 1] : null;
    const next = i + 2 < k.length ? k[i + 2] : null;

    for (let c = 0; c < CHANNELS.length; c++) {
      const p0 = k0.pose[c];
      const p1 = k1.pose[c];
      const m0 = tangent(prev, k0, k1, c);
      const m1 = tangent(k0, k1, next, c);
      out[c] = h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1;
    }
    return clampWeights(out);
  }
}

/**
 * Tangent at `cur` for channel `c`: Catmull-Rom, made monotone.
 *
 * Zero at the ends of the track and at hold keys, so movements ease in and out
 * of rest. Also zero where the key is a turning point or equals a neighbour,
 * and limited so the curve never overshoots between two keys (Fritsch-Carlson).
 *
 * Without that, a foot that lands at key N and stays put until key N+1 picks
 * up a tangent from the airborne key before it, sails past its footprint and
 * comes back — a planted foot sliding several centimetres.
 */
function tangent(prev: Key | null, cur: Key, next: Key | null, c: number): number {
  if (cur.hold || !prev || !next) return 0;
  const h0 = cur.t - prev.t;
  const h1 = next.t - cur.t;
  const s0 = (cur.pose[c] - prev.pose[c]) / h0;
  const s1 = (next.pose[c] - cur.pose[c]) / h1;
  if (s0 * s1 <= 0) return 0;
  const m = (next.pose[c] - prev.pose[c]) / (next.t - prev.t);
  const cap = 3 * Math.min(Math.abs(s0), Math.abs(s1));
  return Math.sign(m) * Math.min(Math.abs(m), cap);
}
