import { blendPose, copyPose, makePose, setPose, type Pose } from "./pose";
import type { BoundaryRuns } from "../presentation/boundary";

const target = makePose();
const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

/**
 * Layer a boundary signal over a planted idle pose: both arms straight up for
 * six; the right arm sweeps sideways and finishes across the chest for four.
 * Time is relative to signal start, so camera cuts and animation share a clock.
 */
export function umpireSignalPose(out: Pose, idle: Pose, runs: BoundaryRuns, time: number): Pose {
  copyPose(target, idle);
  setPose(target, { lookW: 0, headYaw: 0, headPitch: 0 });
  if (runs === 6) {
    setPose(target, {
      aimLSwing: Math.PI, aimLSide: -0.07, aimLElbow: 0.03, aimLW: 1,
      aimRSwing: Math.PI, aimRSide: 0.07, aimRElbow: 0.03, aimRW: 1,
      handLW: 0, handRW: 0,
    });
  } else {
    const sweep = Math.max(0, Math.min(1, (time - 0.3) / 1.65)) * Math.PI * 3;
    setPose(target, {
      handRX: 0.22 + Math.cos(sweep) * 0.5,
      handRY: 1.36,
      handRZ: -0.3 - (1 - Math.cos(sweep)) * 0.08,
      handRW: 1, aimRW: 0,
    });
  }
  // Ease in and lower the arms before the between-delivery fade begins.
  const weight = smooth(time / 0.35) * (1 - smooth((time - 2.1) / 0.55));
  return blendPose(out, idle, target, weight);
}
