import { describe, expect, it } from "vitest";
import { DEFAULT_AERO, dragForce, magnusForce, swingForce } from "./aero";
import { dot, length, normalize, v3 } from "./vec3";

/** A stock delivery: 35 m/s toward the striker, which is -Z. */
const DOWN_THE_PITCH = v3(0, 0, -35);

describe("dragForce", () => {
  it("is exactly antiparallel to velocity", () => {
    const f = dragForce(v3(3, -2, -35));
    const vHat = normalize(v3(3, -2, -35));
    const fHat = normalize(f);
    // cos of the angle between them is -1.
    expect(dot(vHat, fHat)).toBeCloseTo(-1, 6);
  });

  it("scales with the square of speed", () => {
    const slow = length(dragForce(v3(0, 0, -20)));
    const fast = length(dragForce(v3(0, 0, -40)));
    expect(fast / slow).toBeCloseTo(4, 3);
  });

  it("decelerates a fast bowler's delivery by a realistic amount over 20m", () => {
    // Integrate drag alone down the pitch and check the speed drop is in the
    // 8-20% band a real delivery loses, not 1% and not half.
    let v = { ...DOWN_THE_PITCH };
    const m = 0.156;
    const dt = 1 / 480;
    let travelled = 0;
    while (travelled < 20.12) {
      const f = dragForce(v);
      v = { x: v.x + (f.x / m) * dt, y: v.y + (f.y / m) * dt, z: v.z + (f.z / m) * dt };
      travelled += Math.abs(v.z) * dt;
    }
    const loss = 1 - length(v) / 35;
    expect(loss).toBeGreaterThan(0.08);
    expect(loss).toBeLessThan(0.2);
  });

  it("is zero for a stationary ball", () => {
    expect(length(dragForce(v3()))).toBe(0);
  });
});

describe("magnusForce", () => {
  it("acts perpendicular to both velocity and spin", () => {
    const v = v3(0, 0, -35);
    const spin = v3(-120, 40, 0);
    const f = magnusForce(v, spin);
    expect(dot(normalize(f), normalize(v))).toBeCloseTo(0, 6);
    expect(dot(normalize(f), normalize(spin))).toBeCloseTo(0, 6);
  });

  it("lifts a backspinning ball", () => {
    // Ball travels -Z. Backspin = the top of the ball moving back against the
    // direction of travel, i.e. the top moving toward +Z. At the top point
    // (0, R, 0) the surface velocity is omega x (0, R, 0) = (0, 0, omega_x*R),
    // so that requires omega_x > 0. Backspin is +X here, not -X.
    const f = magnusForce(v3(0, 0, -35), v3(150, 0, 0));
    expect(f.y).toBeGreaterThan(0);
    expect(Math.abs(f.x)).toBeLessThan(1e-9);
  });

  it("drops a topspinning ball", () => {
    const f = magnusForce(v3(0, 0, -35), v3(-150, 0, 0));
    expect(f.y).toBeLessThan(0);
  });

  it("clamps the lift coefficient so absurd spin does not produce a banana", () => {
    const sane = length(magnusForce(v3(0, 0, -35), v3(150, 0, 0)));
    const absurd = length(magnusForce(v3(0, 0, -35), v3(15000, 0, 0)));
    expect(absurd).toBeGreaterThanOrEqual(sane);
    // Capped, so a 100x spin increase is nowhere near a 100x force increase.
    expect(absurd / sane).toBeLessThan(4);
  });

  it("is zero without spin", () => {
    expect(length(magnusForce(v3(0, 0, -35), v3()))).toBe(0);
  });
});

describe("swingForce", () => {
  it("is horizontal and perpendicular to travel", () => {
    const f = swingForce(DOWN_THE_PITCH, Math.PI / 9, 1);
    expect(f.y).toBeCloseTo(0, 9);
    expect(dot(normalize(f), normalize(DOWN_THE_PITCH))).toBeCloseTo(0, 6);
  });

  it("swings toward the leg side for a positive seam angle (inswing to a right-hander)", () => {
    const f = swingForce(DOWN_THE_PITCH, Math.PI / 9, 1);
    expect(f.x).toBeGreaterThan(0);
  });

  it("reverses direction with the seam angle", () => {
    const inswing = swingForce(DOWN_THE_PITCH, Math.PI / 9, 1);
    const outswing = swingForce(DOWN_THE_PITCH, -Math.PI / 9, 1);
    expect(outswing.x).toBeCloseTo(-inswing.x, 9);
  });

  it("does not swing with a bolt-upright seam", () => {
    expect(swingForce(DOWN_THE_PITCH, 0, 1).x).toBeCloseTo(0, 9);
  });

  it("does not swing once both sides are scuffed", () => {
    expect(length(swingForce(DOWN_THE_PITCH, Math.PI / 9, 0))).toBe(0);
  });

  it("peaks near a 20 degree seam and never reverses past it", () => {
    const peak = swingForce(DOWN_THE_PITCH, Math.PI / 9, 1).x;
    for (const deg of [25, 30, 40, 60, 90]) {
      const f = swingForce(DOWN_THE_PITCH, (deg * Math.PI) / 180, 1).x;
      expect(f).toBeGreaterThanOrEqual(0); // never flips sign
      expect(f).toBeLessThanOrEqual(peak + 1e-9);
    }
  });

  it("raises the side-force coefficient as the ball slows", () => {
    // Compared at a FIXED speed, turning the late-swing ramp on must produce
    // more side force. Comparing across two speeds would not isolate it,
    // because force also scales with v^2.
    const p = { ...DEFAULT_AERO, lateSwingGain: 0 };
    const v = v3(0, 0, -(DEFAULT_AERO.lateSwingSpeed - 5));
    const without = swingForce(v, Math.PI / 9, 1, p).x;
    const withRamp = swingForce(v, Math.PI / 9, 1, DEFAULT_AERO).x;
    expect(withRamp).toBeGreaterThan(without);
  });

  it("ramps in smoothly, with no step change in force mid-flight", () => {
    // A discontinuity here reads in-game as the ball twitching sideways.
    let prev = swingForce(v3(0, 0, -45), Math.PI / 9, 1).x;
    for (let speed = 44.5; speed >= 15; speed -= 0.5) {
      const cur = swingForce(v3(0, 0, -speed), Math.PI / 9, 1).x;
      expect(Math.abs(cur - prev)).toBeLessThan(0.02);
      prev = cur;
    }
  });

  it("deflects the ball far more in the second half of its flight — late swing", () => {
    // The observable. Lateral displacement goes as t^2, so even with the side
    // force falling as the ball slows, most of the movement happens late.
    let v = { ...DOWN_THE_PITCH };
    const m = 0.156;
    const dt = 1 / 480;
    let z = 0;
    let x = 0;
    let xAtHalfway = 0;
    while (z < 18) {
      const f = swingForce(v, Math.PI / 9, 1);
      v = { x: v.x + (f.x / m) * dt, y: v.y, z: v.z };
      x += v.x * dt;
      z += Math.abs(v.z) * dt;
      if (xAtHalfway === 0 && z >= 9) xAtHalfway = x;
    }
    const firstHalf = xAtHalfway;
    const secondHalf = x - xAtHalfway;
    expect(secondHalf).toBeGreaterThan(firstHalf * 2);
  });

  it("moves the ball a realistic distance sideways over a full delivery", () => {
    // Integrate swing alone and check the lateral movement lands in the
    // 15-90cm band, not 1cm and not 5m.
    let v = { ...DOWN_THE_PITCH };
    let x = 0;
    const m = 0.156;
    const dt = 1 / 480;
    let z = 0;
    while (z < 18) {
      const f = swingForce(v, Math.PI / 9, 1);
      v = { x: v.x + (f.x / m) * dt, y: v.y, z: v.z };
      x += v.x * dt;
      z += Math.abs(v.z) * dt;
    }
    expect(x).toBeGreaterThan(0.15);
    expect(x).toBeLessThan(0.9);
  });
});
