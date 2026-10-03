/**
 * Putting a roster player into a rig. Shared by the engine, the cutaway
 * doubles and the preview harness, so there is one way to dress a player.
 */

import type { BodyLibrary } from "../assets/bodies";
import { dressPlayer, type PlayerRig, type Role } from "../assets/kit";
import { buildFor } from "./appearance";
import { FIELDING, HOME, UMPIRE, bowlerFor, playerNamed, type RosterPlayer } from "./squads";

/** Dress `rig` as `player`, unless he is already in it. */
export function dressAs(rig: PlayerRig, bodies: BodyLibrary, player: RosterPlayer): void {
  const build = buildFor(player.appearance);
  const id = `${player.name}:${build}:${JSON.stringify(player.appearance)}`;
  if (rig.root.userData.wearer === id) return;
  const body = bodies.get(build);
  if (!body) throw new Error(`body "${build}" for ${player.name} was not loaded`);
  dressPlayer(rig, body, player.appearance);
  rig.root.userData.wearer = id;
}

/** One familiar face per role, for the asset preview and the motion sheets. */
export function sampleFor(role: Role): RosterPlayer {
  switch (role) {
    case "batsman":
      return HOME.players[0];
    case "bowler":
      return bowlerFor(FIELDING, "fast-medium");
    case "keeper": {
      const k = FIELDING.players.find((p) => p.role === "keeper");
      if (!k) throw new Error("the fielding side has no keeper");
      return k;
    }
    case "umpire":
      return UMPIRE;
    default:
      return playerNamed(FIELDING, "Fernando");
  }
}
