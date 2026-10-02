export interface CreaseOffset { x: number; z: number }

/** How far across the crease the batsman may shuffle, metres either way. */
const ACROSS = 0.65;
/** Forward and back inside the crease, from a normal stance. */
const FORWARD = 0.6;
const BACK = -0.3;
/** How far down the wicket a charge gets, metres in front of a normal stance. */
export const ADVANCE = 1.45;
/** Shuffling pace, m/s, and the quicker pace of a committed charge. */
const SHUFFLE_SPEED = 1.2;
const ADVANCE_SPEED = 2.6;

/**
 * Bounded, frame-rate-independent shuffling; diagonals never move faster.
 *
 * `advance` is coming down the wicket to the bowler, which is both quicker and
 * allowed much further forward than a shuffle. Letting go of it does NOT pull
 * the batsman back — the forward limit keeps whatever ground he has already
 * made, so releasing the key leaves him standing where he charged to rather
 * than snapping back to the crease. Walking back is then the player's own
 * input, held on the back arrow.
 */
export function moveAtCrease(
  offset: CreaseOffset,
  x: number,
  forward: number,
  dt: number,
  screenSign: number,
  advance = false
): CreaseOffset {
  const speed = advance ? ADVANCE_SPEED : SHUFFLE_SPEED;
  const scale = speed * dt / Math.max(1, Math.hypot(x, forward));
  const limit = advance ? ADVANCE : Math.max(FORWARD, offset.z);
  return {
    x: Math.max(-ACROSS, Math.min(ACROSS, offset.x + x * screenSign * scale)),
    z: Math.max(BACK, Math.min(limit, offset.z + forward * scale)),
  };
}
