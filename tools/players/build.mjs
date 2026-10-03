#!/usr/bin/env node
/**
 * Runs tools/players/build.py inside Blender, headless.
 *
 *   pnpm build:players                      every build in builds.json
 *   PLAYER_ONLY=european-lean pnpm build:players
 *
 * Blender is found from $BLENDER, then the usual install locations. It needs
 * the MPFB extension installed and enabled (Preferences > Get Extensions).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.BLENDER,
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "/usr/bin/blender",
  "/snap/bin/blender",
  "C:\\Program Files\\Blender Foundation\\Blender\\blender.exe",
].filter(Boolean);
const blender = candidates.find((p) => existsSync(p));
if (!blender) {
  console.error("Blender not found. Set BLENDER to its executable.");
  process.exit(1);
}
const r = spawnSync(blender, ["-b", "--python", join(here, "build.py")], { stdio: "inherit" });
process.exit(r.status ?? 1);
