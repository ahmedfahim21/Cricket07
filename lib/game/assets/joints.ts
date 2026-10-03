/**
 * The rig's joints, in a fixed order. Shared by the rig (`kit.ts`) and the
 * skinned bodies (`bodies.ts`), which bind to joints by these names.
 */
export const JOINTS = [
  "pelvis", "spine", "chest", "head",
  "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR",
  "shoulderL", "elbowL", "handL", "shoulderR", "elbowR", "handR",
] as const;
export type JointName = (typeof JOINTS)[number];
