/**
 * Squads: who plays, and what they look like.
 *
 * All fictional. A player is a name, a role, a bowling style if he bowls, and
 * an `Appearance`. Adding a team is adding data here; nothing else changes.
 */

import type { BowlerStyle } from "../match/bowling";
import type { Appearance } from "./appearance";

export type PlayerRole = "batsman" | "allrounder" | "bowler" | "keeper";

export interface RosterPlayer {
  name: string;
  role: PlayerRole;
  bowling?: BowlerStyle;
  appearance: Appearance;
}

export interface Squad {
  name: string;
  players: RosterPlayer[];
}

/** The side the player bats with in the challenges. Batting order is list order. */
export const HOME: Squad = {
  name: "Home",
  players: [
    { name: "Sharma", role: "batsman", appearance: { avatar: "Business_Male_06", cap: false } },
    { name: "Patel", role: "batsman", appearance: { avatar: "Male_Adult_10", cap: false } },
    { name: "Khan", role: "batsman", appearance: { avatar: "Male_Adult_08", cap: false } },
    { name: "Mitchell", role: "allrounder", appearance: { avatar: "Male_Adult_02", cap: false } },
    { name: "Okafor", role: "allrounder", appearance: { avatar: "Male_Adult_07", cap: false } },
    { name: "Silva", role: "allrounder", appearance: { avatar: "Male_Adult_14", cap: false } },
    { name: "Brennan", role: "allrounder", appearance: { avatar: "Male_Adult_03", cap: false } },
  ],
};

/** The side the AI bats with when the player bowls. */
export const VISITORS: Squad = {
  name: "Visitors",
  players: [
    { name: "Sharma", role: "batsman", appearance: { avatar: "Male_Adult_10", cap: false } },
    { name: "Patel", role: "batsman", appearance: { avatar: "Business_Male_06", cap: false } },
    { name: "Khan", role: "batsman", appearance: { avatar: "Male_Adult_08", cap: false } },
    { name: "Singh", role: "batsman", appearance: { avatar: "Male_Adult_07", cap: false } },
    { name: "Rao", role: "allrounder", appearance: { avatar: "Male_Adult_14", cap: false } },
    { name: "Das", role: "allrounder", appearance: { avatar: "Male_Adult_02", cap: false } },
    { name: "Kumar", role: "bowler", appearance: { avatar: "Male_Adult_03", cap: false } },
  ],
};

/**
 * The fielding side: a keeper, a bowler of every style, and fielders. The
 * player bowls as one of the named bowlers; the AI bowls whichever matches
 * the style it is bowling. Whoever is not bowling takes the field positions.
 */
export const FIELDING: Squad = {
  name: "Fielding XI",
  players: [
    { name: "Carter", role: "keeper", appearance: { avatar: "Male_Adult_13", cap: false } },
    { name: "Mitchell", role: "bowler", bowling: "fast", appearance: { avatar: "Male_Adult_16", cap: false } },
    { name: "Brennan", role: "bowler", bowling: "fast-medium", appearance: { avatar: "Male_Adult_06", cap: true } },
    { name: "Hughes", role: "bowler", bowling: "medium", appearance: { avatar: "Male_Adult_12", cap: false } },
    { name: "Silva", role: "bowler", bowling: "off-spin", appearance: { avatar: "Male_Adult_17", cap: true } },
    { name: "Okafor", role: "bowler", bowling: "leg-spin", appearance: { avatar: "Male_Adult_04", cap: false } },
    { name: "Nakamura", role: "batsman", appearance: { avatar: "Male_Adult_09", cap: true } },
    { name: "Mensah", role: "allrounder", appearance: { avatar: "Business_Male_05", cap: false } },
    { name: "Fernando", role: "batsman", appearance: { avatar: "Sports_Male_03", cap: false } },
    { name: "Reid", role: "batsman", appearance: { avatar: "Male_Adult_11", cap: true } },
    { name: "Tanaka", role: "allrounder", appearance: { avatar: "Business_Male_02", cap: true } },
    { name: "Ward", role: "batsman", appearance: { avatar: "Male_Adult_20", cap: true } },
  ],
};

export const UMPIRE: RosterPlayer = {
  name: "Umpire",
  role: "batsman",
  appearance: { avatar: "Male_Adult_05", cap: false },
};

export function playerNamed(squad: Squad, name: string): RosterPlayer {
  const p = squad.players.find((x) => x.name === name);
  if (!p) throw new Error(`no player "${name}" in ${squad.name}`);
  return p;
}

/** The fielding side's bowler of this style. */
export function bowlerFor(squad: Squad, style: BowlerStyle): RosterPlayer {
  const p = squad.players.find((x) => x.bowling === style);
  if (!p) throw new Error(`${squad.name} has no ${style} bowler`);
  return p;
}

/**
 * The eleven on the field while `bowler` bowls, in field-position order: the
 * keeper first (field position 0 is the keeper), then everyone else who is
 * not bowling.
 */
export function fieldersFor(squad: Squad, bowler: RosterPlayer, positions: number): RosterPlayer[] {
  const keeper = squad.players.find((p) => p.role === "keeper");
  if (!keeper) throw new Error(`${squad.name} has no keeper`);
  const rest = squad.players.filter((p) => p !== keeper && p !== bowler);
  const out = [keeper, ...rest].slice(0, positions);
  if (out.length < positions) throw new Error(`${squad.name} cannot fill ${positions} positions around ${bowler.name}`);
  return out;
}

/** Every build any squad or official needs: what to load before a match. */
export function buildsNeeded(squads: Squad[], extra: RosterPlayer[], buildFor: (a: Appearance) => string): Set<string> {
  const all = [...squads.flatMap((s) => s.players), ...extra];
  return new Set(all.map((p) => buildFor(p.appearance)));
}
