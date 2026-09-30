export interface CreaseOffset { x: number; z: number }

/** Bounded, frame-rate-independent shuffling; diagonals never move faster. */
export function moveAtCrease(offset: CreaseOffset, x: number, forward: number, dt: number, screenSign: number): CreaseOffset {
  const scale = 1.2 * dt / Math.max(1, Math.hypot(x, forward));
  return {
    x: Math.max(-0.65, Math.min(0.65, offset.x + x * screenSign * scale)),
    z: Math.max(-0.3, Math.min(0.6, offset.z + forward * scale)),
  };
}
