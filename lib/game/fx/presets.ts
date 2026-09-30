/**
 * The look of the ground, for the cel render pipeline.
 *
 * Same house style as the city engine this is borrowed from: flat cel bands,
 * a dark warm ink line on silhouettes and creases, shadows that shift toward a
 * cool violet instead of going grey. Identity comes from hue, never from
 * desaturation, and no gain channel drops below 1.0 (pulling a channel down to
 * fake a cast is what makes a grade look washed).
 *
 * Haze is a depth cue, not weather, and ink fades out with distance so the far
 * stands dissolve instead of turning into scribble at screen resolution.
 */

export type QualityTier = "high" | "medium" | "low";

type RGB = [number, number, number];

export type RenderPreset = {
  name: string;
  /** Hue the cel shadow bands shift toward (sRGB hex). */
  celShadowTint: number;
  ink: { color: RGB; strength: number; fadeStart: number; fadeEnd: number };
  tone: { exposure: number; splitShadow: RGB; splitLight: RGB; shadowLift: number };
  grade: {
    lift: RGB;
    gamma: RGB;
    gain: RGB;
    saturation: number;
    temperature: number;
    vignette: { strength: number; radius: number };
  };
  haze: { color: RGB; density: number; horizonBoost: number };
};

export const DAY_MATCH_PRESET: RenderPreset = {
  name: "Day match - clear afternoon",
  celShadowTint: 0x8a7fb8,
  ink: {
    color: [0.045, 0.03, 0.05],
    strength: 1,
    // Fielders are 10-60m from the camera, the stands 90m+. Lines on the
    // players want to stay; lines on the terracing do not.
    fadeStart: 50,
    fadeEnd: 130,
  },
  tone: {
    exposure: 1.06,
    splitShadow: [0.86, 0.84, 1.0],
    splitLight: [1.0, 0.98, 0.93],
    shadowLift: 0.018,
  },
  grade: {
    lift: [0.01, 0.008, 0.0],
    gamma: [1.0, 1.0, 1.02],
    gain: [1.05, 1.03, 1.0],
    saturation: 1.12,
    temperature: 0.22,
    vignette: { strength: 0.12, radius: 0.82 },
  },
  haze: { color: [0.62, 0.74, 0.88], density: 0.0022, horizonBoost: 0.12 },
};
