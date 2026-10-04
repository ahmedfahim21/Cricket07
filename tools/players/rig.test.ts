/**
 * `rig.json` is the game's skeleton as the Blender build script sees it: every
 * joint, its parent, and its rest offset. The bodies are fitted to these exact
 * pivots, so if `kit.ts` changes and this file does not, every body is skinned
 * to joints that are no longer there.
 *
 * Fails on drift. Regenerate with:  UPDATE_RIG=1 pnpm test tools/players
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOINTS, SKELETON, makePlayer } from "../../lib/game/assets/kit";

const FILE = join(__dirname, "rig.json");

function current() {
  const rig = makePlayer({ role: "fielder" });
  return {
    joints: JOINTS.map((name) => {
      const j = rig[name];
      const parent = j.parent!;
      return {
        name,
        parent: parent === rig.root ? null : parent.name,
        offset: j.position.toArray().map((v) => +v.toFixed(5)),
      };
    }),
    skeleton: SKELETON,
  };
}

describe("rig.json", () => {
  it("matches the rig the game builds", () => {
    const now = current();
    if (process.env.UPDATE_RIG) writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(now);
  });
});
