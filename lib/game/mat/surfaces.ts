/**
 * Per-surface procedural texture recipes for the cricket ground.
 *
 * Same method as the city engine this project borrows from: build a
 * heightfield out of tileable fBm / Worley, Sobel it into a normal map,
 * paint a colour field, and derive roughness from the same structure so the
 * bump, the sheen and the colour all agree. Nothing is loaded from disk.
 *
 * Colour fields are kept near-neutral and high-key wherever a surface will be
 * tinted (turf, fabric, seats), because `tint()` multiplies — a map that is
 * already dark multiplies any tint into mud.
 */
import { makeTileableFbm, makeWorley2D, mulberry32, clamp01, lerp } from "./noise";
import { Field, makeField, heightToNormalCanvas, rgbCanvas, aoFromHeight } from "./canvas";

export const SIZE = 256;

export interface SurfaceBuild {
  colorCanvas: HTMLCanvasElement;
  normalCanvas: HTMLCanvasElement;
  roughness: Field;
  ao?: Field;
  repeat: [number, number];
  metalness: number;
  normalStrength?: number;
}

function fieldsFromSize(size = SIZE) {
  return {
    h: makeField(size),
    r: makeField(size),
    g: makeField(size),
    b: makeField(size),
    rough: makeField(size),
  };
}

/* ------------------------------------------------------------------ *
 * 1. Turf — outfield grass.
 *
 * The readable cue is not "green": it is the fine directional blade streak
 * plus the clump structure underneath. Blades are stretched heavily in V so
 * the normal map catches raking floodlight along one axis, which is what
 * makes a mown stripe visibly change tone with view angle.
 * ------------------------------------------------------------------ */
export function buildTurf(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  // Anisotropic: high frequency across the blade, low along it.
  const blade = makeTileableFbm(seed, 64, 3, 2, 0.5);
  const bladeLong = makeTileableFbm(seed + 1, 8, 2, 2, 0.5);
  const clump = makeTileableFbm(seed + 2, 6, 4, 2, 0.55);
  const wear = makeTileableFbm(seed + 3, 3, 3, 2, 0.5);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      const bladeAmt = blade(u, v * 0.18) * 0.55 + bladeLong(u, v) * 0.2;
      const clumpAmt = clump(u, v);
      h[i] = clamp01(bladeAmt + clumpAmt * 0.35);

      // Green built from a luminance ramp rather than a flat hue, so the
      // tint() call that sets the actual pitch colour still has range.
      const lum = clamp01(0.62 + (clumpAmt - 0.5) * 0.3 + (bladeAmt - 0.4) * 0.25);
      const dry = clamp01(wear(u, v) - 0.45) * 0.5;
      r[i] = lum * lerp(0.62, 0.86, dry);
      g[i] = lum * 1.0;
      b[i] = lum * lerp(0.42, 0.55, dry);

      rough[i] = clamp01(0.88 + (bladeAmt - 0.5) * 0.14);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 2.0),
    roughness: rough,
    ao: aoFromHeight(h, size, 3, 0.7),
    repeat: [8, 8],
    metalness: 0,
    normalStrength: 0.85,
  };
}

/* ------------------------------------------------------------------ *
 * 2. Pitch soil — the rolled clay strip.
 *
 * Nearly flat, because it has been rolled; the character comes from the
 * craze-crack network and the bowler's footmark scuffing, not from bump.
 * Cracks are Worley f2-f1 ties, the same trick the city uses for plaster.
 * ------------------------------------------------------------------ */
export function buildPitchSoil(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const grain = makeTileableFbm(seed, 40, 3, 2, 0.5);
  const patch = makeTileableFbm(seed + 1, 4, 4, 2, 0.55);
  const cracks = makeWorley2D(seed + 2, 9);
  const scuff = makeTileableFbm(seed + 3, 7, 3, 2.1, 0.5);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      const w = cracks(u * 9, v * 9);
      const crack = clamp01(1 - (w.f2 - w.f1) * 16);
      let height = 0.55 + (grain(u, v) - 0.5) * 0.18 + (patch(u, v) - 0.5) * 0.1;
      height -= crack * 0.4;
      h[i] = clamp01(height);

      const scuffAmt = clamp01(scuff(u, v) - 0.5) * 0.6;
      // Dry straw-buff, lifting where it has been scuffed up.
      const lum = clamp01(0.72 + (patch(u, v) - 0.5) * 0.16 - crack * 0.3 + scuffAmt * 0.12);
      r[i] = lum;
      g[i] = lum * 0.9;
      b[i] = lum * 0.73;

      rough[i] = clamp01(0.9 + (grain(u, v) - 0.5) * 0.12 + crack * 0.06);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 2.4),
    roughness: rough,
    ao: aoFromHeight(h, size, 4, 1.0),
    repeat: [2, 6],
    metalness: 0,
    normalStrength: 1.0,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Concrete — stand structure, terracing, walls.
 * ------------------------------------------------------------------ */
export function buildConcrete(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const blotch = makeTileableFbm(seed, 4, 5, 2, 0.55);
  const speck = makeTileableFbm(seed + 1, 48, 2, 2, 0.5);
  const stain = makeTileableFbm(seed + 2, 3, 3, 2.2, 0.5);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      h[i] = clamp01(0.5 + (blotch(u, v) - 0.5) * 0.25 + (speck(u, v) - 0.5) * 0.12);

      const grime = clamp01(v * 0.5 + stain(u, v) * 0.3 - 0.25) * 0.22;
      const lum = clamp01((0.78 + (blotch(u, v) - 0.5) * 0.16) * (1 - grime));
      r[i] = lum;
      g[i] = lum * 0.995;
      b[i] = lum * 0.97;

      rough[i] = clamp01(0.86 + (speck(u, v) - 0.5) * 0.16);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.6),
    roughness: rough,
    ao: aoFromHeight(h, size, 4, 0.8),
    repeat: [3, 3],
    metalness: 0,
    normalStrength: 0.8,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Fabric — cricket whites and coloured kit.
 *
 * A visible woven weave at 1:1 would be wrong at player scale, so the weave
 * frequency here is deliberately below thread level; what it buys is a soft
 * cloth sheen break-up rather than a plastic-looking flat white.
 * ------------------------------------------------------------------ */
export function buildFabric(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const weaveA = makeTileableFbm(seed, 56, 2, 2, 0.5);
  const weaveB = makeTileableFbm(seed + 1, 52, 2, 2, 0.5);
  const fold = makeTileableFbm(seed + 2, 5, 3, 2, 0.55);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      // Crossed high-frequency bands read as warp and weft.
      const weave = weaveA(u, v * 0.1) * 0.5 + weaveB(u * 0.1, v) * 0.5;
      h[i] = clamp01(0.5 + (weave - 0.5) * 0.5 + (fold(u, v) - 0.5) * 0.25);

      const lum = clamp01(0.95 + (weave - 0.5) * 0.07 + (fold(u, v) - 0.5) * 0.08);
      r[i] = lum;
      g[i] = lum;
      b[i] = lum * 0.99;

      rough[i] = clamp01(0.8 + (weave - 0.5) * 0.18);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.1),
    roughness: rough,
    repeat: [4, 4],
    metalness: 0,
    normalStrength: 0.5,
  };
}

/* ------------------------------------------------------------------ *
 * 5. Willow — the bat blade.
 *
 * Straight vertical grain lines with a few pronounced ones, which is the
 * whole visual signature of a bat face.
 * ------------------------------------------------------------------ */
export function buildWillow(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const rand = mulberry32(seed);
  // Fixed grain line positions across U, a few strong and the rest faint.
  const grains: { at: number; strength: number }[] = [];
  for (let i = 0; i < 14; i++) {
    grains.push({ at: rand(), strength: 0.25 + rand() * 0.75 });
  }
  const wobble = makeTileableFbm(seed + 1, 3, 3, 2, 0.5);
  const fleck = makeTileableFbm(seed + 2, 40, 2, 2, 0.5);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      // Grain runs along V; wobble it slightly in U so it is not a ruler line.
      const uu = u + (wobble(u, v) - 0.5) * 0.02;
      let grain = 0;
      for (const gr of grains) {
        let d = Math.abs(uu - gr.at);
        d = Math.min(d, 1 - d); // wrap
        grain += Math.exp(-(d * d) / 0.00004) * gr.strength;
      }
      grain = clamp01(grain);

      h[i] = clamp01(0.6 - grain * 0.35 + (fleck(u, v) - 0.5) * 0.08);

      const lum = clamp01(0.93 - grain * 0.28 + (fleck(u, v) - 0.5) * 0.05);
      r[i] = lum;
      g[i] = lum * 0.93;
      b[i] = lum * 0.79;

      rough[i] = clamp01(0.55 + grain * 0.2);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.5),
    roughness: rough,
    repeat: [1, 1],
    metalness: 0,
    normalStrength: 0.7,
  };
}

/* ------------------------------------------------------------------ *
 * 6. Leather — the ball.
 *
 * Fine pebble grain, low roughness on the polished half. The seam is NOT in
 * this texture: it is real geometry on the ball, because the seam has to be
 * orientable at runtime for swing to mean anything.
 * ------------------------------------------------------------------ */
export function buildLeather(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const pebble = makeWorley2D(seed, 26);
  const scuff = makeTileableFbm(seed + 1, 6, 3, 2, 0.55);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const w = pebble(u * 26, v * 26);
      const bump = clamp01(1 - w.f1 * 1.8);
      h[i] = clamp01(0.45 + bump * 0.35 + (scuff(u, v) - 0.5) * 0.12);

      const wear = clamp01(scuff(u, v) - 0.5) * 0.5;
      const lum = clamp01(0.72 + bump * 0.12 - wear * 0.18);
      r[i] = lum;
      g[i] = lum * 0.4;
      b[i] = lum * 0.33;

      // Polished where unscuffed — the shine is what swing bowling is about.
      rough[i] = clamp01(0.32 + wear * 0.5 + bump * 0.1);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.8),
    roughness: rough,
    repeat: [1, 1],
    metalness: 0.02,
    normalStrength: 0.6,
  };
}

/* ------------------------------------------------------------------ *
 * 7. Seat plastic — stadium seating, tinted per stand.
 * ------------------------------------------------------------------ */
export function buildSeatPlastic(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const dimple = makeWorley2D(seed, 18);
  const wear = makeTileableFbm(seed + 1, 5, 3, 2, 0.5);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const w = dimple(u * 18, v * 18);
      h[i] = clamp01(0.5 + clamp01(1 - w.f1 * 2.2) * 0.2);

      const lum = clamp01(0.93 - clamp01(wear(u, v) - 0.55) * 0.2);
      r[i] = lum;
      g[i] = lum;
      b[i] = lum;

      rough[i] = clamp01(0.42 + wear(u, v) * 0.25);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.2),
    roughness: rough,
    repeat: [2, 2],
    metalness: 0.03,
    normalStrength: 0.5,
  };
}

/* ------------------------------------------------------------------ *
 * 8. Steel — floodlight pylons, railings, sightscreen frame.
 * ------------------------------------------------------------------ */
export function buildSteel(seed: number, size = SIZE): SurfaceBuild {
  const { h, r, g, b, rough } = fieldsFromSize(size);
  const brush = makeTileableFbm(seed, 60, 2, 2, 0.5);
  const patina = makeTileableFbm(seed + 1, 5, 4, 2, 0.55);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const brushed = brush(u * 0.08, v);
      h[i] = clamp01(0.5 + (brushed - 0.5) * 0.3);

      const lum = clamp01(0.8 + (brushed - 0.5) * 0.14 - clamp01(patina(u, v) - 0.6) * 0.3);
      r[i] = lum;
      g[i] = lum * 0.99;
      b[i] = lum * 0.97;

      rough[i] = clamp01(0.4 + patina(u, v) * 0.35);
    }
  }
  return {
    colorCanvas: rgbCanvas(r, g, b, size),
    normalCanvas: heightToNormalCanvas(h, size, 1.0),
    roughness: rough,
    repeat: [2, 2],
    metalness: 0.85,
    normalStrength: 0.45,
  };
}
