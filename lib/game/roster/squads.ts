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
    { name: "Sharma", role: "batsman", appearance: { heritage: "south-asian", physique: "athletic", skin: "tan", hair: "neat", hairColour: "black", facialHair: "short", eyes: "dark-brown", cap: false } },
    { name: "Patel", role: "batsman", appearance: { heritage: "south-asian", physique: "lean", skin: "brown", hair: "short", hairColour: "black", facialHair: "none", eyes: "brown", cap: false } },
    { name: "Khan", role: "batsman", appearance: { heritage: "south-asian", physique: "stocky", skin: "olive", hair: "buzz", hairColour: "black", facialHair: "full", eyes: "dark-brown", cap: false } },
    { name: "Mitchell", role: "allrounder", appearance: { heritage: "european", physique: "athletic", skin: "fair", hair: "short", hairColour: "dark-blonde", facialHair: "stubble", eyes: "blue", cap: false } },
    { name: "Okafor", role: "allrounder", appearance: { heritage: "african", physique: "athletic", skin: "dark", hair: "curly", hairColour: "black", facialHair: "goatee", eyes: "dark-brown", cap: false } },
    { name: "Silva", role: "allrounder", appearance: { heritage: "south-asian", physique: "lean", skin: "dark-brown", hair: "long", hairColour: "black", facialHair: "moustache", eyes: "dark-brown", cap: false } },
    { name: "Brennan", role: "allrounder", appearance: { heritage: "european", physique: "stocky", skin: "porcelain", hair: "receding", hairColour: "auburn", facialHair: "full", eyes: "green", cap: false } },
  ],
};

/** The side the AI bats with when the player bowls. */
export const VISITORS: Squad = {
  name: "Visitors",
  players: [
    { name: "Sharma", role: "batsman", appearance: { heritage: "south-asian", physique: "lean", skin: "light", hair: "neat", hairColour: "dark-brown", facialHair: "none", eyes: "brown", cap: false } },
    { name: "Patel", role: "batsman", appearance: { heritage: "south-asian", physique: "athletic", skin: "tan", hair: "short", hairColour: "black", facialHair: "goatee-moustache", eyes: "dark-brown", cap: false } },
    { name: "Khan", role: "batsman", appearance: { heritage: "south-asian", physique: "athletic", skin: "olive", hair: "curly", hairColour: "black", facialHair: "full", eyes: "hazel", cap: false } },
    { name: "Singh", role: "batsman", appearance: { heritage: "south-asian", physique: "stocky", skin: "brown", hair: "buzz", hairColour: "black", facialHair: "full", eyes: "dark-brown", cap: false } },
    { name: "Rao", role: "allrounder", appearance: { heritage: "south-asian", physique: "lean", skin: "dark-brown", hair: "short", hairColour: "black", facialHair: "moustache", eyes: "dark-brown", cap: false } },
    { name: "Das", role: "allrounder", appearance: { heritage: "south-asian", physique: "athletic", skin: "tan", hair: "neat", hairColour: "black", facialHair: "stubble", eyes: "brown", cap: false } },
    { name: "Kumar", role: "bowler", appearance: { heritage: "south-asian", physique: "lean", skin: "brown", hair: "short", hairColour: "black", facialHair: "none", eyes: "dark-brown", cap: false } },
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
    { name: "Carter", role: "keeper", appearance: { heritage: "european", physique: "stocky", skin: "light", hair: "short", hairColour: "brown", facialHair: "stubble", eyes: "hazel", cap: false } },
    { name: "Mitchell", role: "bowler", bowling: "fast", appearance: { heritage: "european", physique: "athletic", skin: "fair", hair: "neat", hairColour: "brown", facialHair: "none", eyes: "blue", cap: false } },
    { name: "Brennan", role: "bowler", bowling: "fast-medium", appearance: { heritage: "european", physique: "lean", skin: "porcelain", hair: "short", hairColour: "auburn", facialHair: "goatee", eyes: "green", cap: true } },
    { name: "Hughes", role: "bowler", bowling: "medium", appearance: { heritage: "african", physique: "stocky", skin: "dark-brown", hair: "buzz", hairColour: "black", facialHair: "full", eyes: "dark-brown", cap: false } },
    { name: "Silva", role: "bowler", bowling: "off-spin", appearance: { heritage: "south-asian", physique: "lean", skin: "brown", hair: "curly", hairColour: "black", facialHair: "moustache", eyes: "dark-brown", cap: true } },
    { name: "Okafor", role: "bowler", bowling: "leg-spin", appearance: { heritage: "african", physique: "lean", skin: "deep", hair: "short", hairColour: "black", facialHair: "goatee-moustache", eyes: "dark-brown", cap: false } },
    { name: "Nakamura", role: "batsman", appearance: { heritage: "east-asian", physique: "athletic", skin: "light", hair: "neat", hairColour: "black", facialHair: "none", eyes: "dark-brown", cap: true } },
    { name: "Mensah", role: "allrounder", appearance: { heritage: "african", physique: "athletic", skin: "dark", hair: "buzz", hairColour: "black", facialHair: "short", eyes: "dark-brown", cap: false } },
    { name: "Fernando", role: "batsman", appearance: { heritage: "south-asian", physique: "athletic", skin: "dark-brown", hair: "long", hairColour: "black", facialHair: "stubble", eyes: "brown", cap: false } },
    { name: "Reid", role: "batsman", appearance: { heritage: "european", physique: "lean", skin: "fair", hair: "curly", hairColour: "blonde", facialHair: "none", eyes: "blue", cap: true } },
    { name: "Tanaka", role: "allrounder", appearance: { heritage: "east-asian", physique: "lean", skin: "olive", hair: "short", hairColour: "black", facialHair: "moustache", eyes: "dark-brown", cap: true } },
    { name: "Ward", role: "batsman", appearance: { heritage: "european", physique: "athletic", skin: "light", hair: "receding", hairColour: "dark-brown", facialHair: "full", eyes: "grey", cap: true } },
  ],
};

export const UMPIRE: RosterPlayer = {
  name: "Umpire",
  role: "batsman",
  appearance: { heritage: "european", physique: "veteran", skin: "fair", hair: "receding", hairColour: "grey", facialHair: "moustache", eyes: "grey", cap: false },
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
