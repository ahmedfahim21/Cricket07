import { BOUNDARY_STRAIGHT } from "../dimensions";

/** Project the ground onto camera-relative radar axes (screen Y points down). */
export function radarPoint(x: number, z: number, forwardX: number, forwardZ: number) {
  const length = Math.hypot(forwardX, forwardZ) || 1;
  const fx = forwardX / length;
  const fz = forwardZ / length;
  return {
    x: (-fz * x + fx * z) / BOUNDARY_STRAIGHT,
    y: -(fx * x + fz * z) / BOUNDARY_STRAIGHT,
  };
}
