import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALLENGES } from "../match/challenges";
import { BOWLERS } from "../match/player-bowling";
import { fieldFor } from "../match/fielding";
import { FACIAL_HAIR, HAIR_STYLES, HERITAGES, PHYSIQUES, VETERAN_HERITAGES, bodyColours, buildFor, validAppearance } from "./appearance";
import { FIELDING, HOME, UMPIRE, VISITORS, bowlerFor, fieldersFor, playerNamed } from "./squads";

const ROOT = join(__dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "public/models/players/manifest.json"), "utf8")) as {
  builds: { name: string; heritage: string; physique: string }[];
  hairStyles: string[];
  beardStyles: string[];
};
const spec = JSON.parse(readFileSync(join(ROOT, "tools/players/builds.json"), "utf8")) as {
  builds: { name: string }[];
};
const everyone = [...HOME.players, ...VISITORS.players, ...FIELDING.players, UMPIRE];

describe("the building blocks", () => {
  it("are exactly what the Blender build makes", () => {
    expect([...HAIR_STYLES]).toEqual(manifest.hairStyles);
    expect([...FACIAL_HAIR]).toEqual(manifest.beardStyles);
    const built = new Set(manifest.builds.map((b) => b.name));
    expect(built).toEqual(new Set(spec.builds.map((b) => b.name)));
    for (const h of HERITAGES) {
      for (const p of PHYSIQUES) {
        const exists = p !== "veteran" || VETERAN_HERITAGES.includes(h);
        expect(built.has(`${h}-${p}`), `${h}-${p}`).toBe(exists);
      }
    }
  });

  it("paint stubble between skin and hair, and keep grey-haired brows darker than the hair", () => {
    const base = { heritage: "european", physique: "veteran", skin: "fair", hair: "short", hairColour: "grey", eyes: "blue", cap: false } as const;
    const stubble = bodyColours({ ...base, facialHair: "stubble" }, { shirt: 1, trousers: 2, boot: 3, longSleeves: false });
    const full = bodyColours({ ...base, facialHair: "full" }, { shirt: 1, trousers: 2, boot: 3, longSleeves: true });
    expect(stubble.beard).not.toBe(stubble.hair);
    expect(full.beard).toBe(full.hair);
    expect(full.brow).toBeLessThan(full.hair);
    // Sleeves follow the kit: shirt when long, skin when short.
    expect(full.sleeve).toBe(1);
    expect(stubble.sleeve).toBe(stubble.skin);
  });
});

describe("the squads", () => {
  it("describe every player with real building blocks", () => {
    for (const p of everyone) {
      expect(validAppearance(p.appearance), p.name).toEqual([]);
      expect(manifest.builds.some((b) => b.name === buildFor(p.appearance)), p.name).toBe(true);
    }
  });

  it("never repeat a name within a side", () => {
    for (const squad of [HOME, VISITORS, FIELDING]) {
      const names = squad.players.map((p) => p.name);
      expect(new Set(names).size, squad.name).toBe(names.length);
    }
  });

  it("have a fielding bowler for every bowler the player can pick and every style the AI bowls", () => {
    for (const b of BOWLERS) expect(playerNamed(FIELDING, b.name).bowling, b.name).toBe(b.style);
    for (const c of CHALLENGES) for (const style of c.styles) expect(bowlerFor(FIELDING, style).bowling).toBe(style);
  });

  it("fill every field position with someone who is not bowling, keeper behind the stumps", () => {
    const positions = fieldFor("right");
    for (const bowler of FIELDING.players.filter((p) => p.bowling)) {
      const field = fieldersFor(FIELDING, bowler, positions.length);
      expect(field).toHaveLength(positions.length);
      expect(field).not.toContain(bowler);
      expect(field[0].role).toBe("keeper");
      expect(positions[0].keeper).toBe(true);
      expect(new Set(field).size).toBe(field.length);
    }
  });
});
