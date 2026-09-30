import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { radarPoint } from "./radar";

describe("camera-relative field radar", () => {
  it("matches lateral screen direction from batting, TV and angled chase cameras", () => {
    for (const [position, look] of [
      [[-1.15, 3.15, -17.66], [-0.55, 1.45, 1]],
      [[1.2, 9.5, 52], [0, 0.9, -6.5]],
      [[12, 26, -42], [30, 1, 25]],
    ]) {
      const camera = new THREE.PerspectiveCamera(34, 1.6, 0.1, 600);
      camera.position.fromArray(position);
      camera.lookAt(new THREE.Vector3().fromArray(look));
      camera.updateMatrixWorld();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      const origin = new THREE.Vector3(0, 0, 0).project(camera);
      for (const x of [-10, 10]) {
        const onScreen = new THREE.Vector3(x, 0, 0).project(camera).x - origin.x;
        const radar = radarPoint(x, 0, direction.x, direction.z);
        expect(Math.sign(radar.x)).toBe(Math.sign(onScreen));
      }
    }
  });
  it("rotates pitch ends and fielders together when the view reverses", () => {
    const batting = radarPoint(20, 30, 0, 1);
    const tv = radarPoint(20, 30, 0, -1);
    expect(tv.x).toBeCloseTo(-batting.x);
    expect(tv.y).toBeCloseTo(-batting.y);
    expect(radarPoint(0, 10, 0, 1).y).toBeLessThan(0);
  });
});
