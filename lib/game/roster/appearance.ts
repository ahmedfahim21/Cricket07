/**
 * What a player looks like, in the terms a roster is written in.
 *
 * A roster entry says "south-asian, athletic, brown skin, neat black hair,
 * full beard" and this turns it into a body to load and the colour of every
 * surface. Everything here is data or a pure function of it: no three.js, no
 * loading, so rosters can be validated in a unit test.
 *
 * The shapes (builds, hair and facial-hair styles) are what the Blender build
 * script makes — `tools/players/builds.json` — and the palettes are what the
 * game paints them with. A test checks the two agree.
 */

export const HERITAGES = ["south-asian", "east-asian", "european", "african"] as const;
export type Heritage = (typeof HERITAGES)[number];

export const PHYSIQUES = ["lean", "athletic", "stocky", "veteran"] as const;
export type Physique = (typeof PHYSIQUES)[number];

/** Veterans (umpires, older pros) are only built for some heritages; see builds.json. */
export const VETERAN_HERITAGES: readonly Heritage[] = ["south-asian", "european"];

export const HAIR_STYLES = ["bald", "buzz", "short", "receding", "neat", "curly", "long"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const FACIAL_HAIR = ["none", "stubble", "short", "full", "goatee", "moustache", "goatee-moustache"] as const;
export type FacialHair = (typeof FACIAL_HAIR)[number];

/** Skin tones, light to deep. Any tone suits any heritage: these are paint, not bodies. */
export const SKIN_TONES = {
  porcelain: 0xf0c8ad,
  fair: 0xe2b394,
  light: 0xd6a37f,
  olive: 0xc29068,
  tan: 0xb07a52,
  brown: 0x9a6643,
  "dark-brown": 0x7a4c31,
  dark: 0x5c3a27,
  deep: 0x452a1c,
} as const;
export type SkinTone = keyof typeof SKIN_TONES;

export const HAIR_COLOURS = {
  black: 0x141110,
  "dark-brown": 0x2e1f16,
  brown: 0x553824,
  auburn: 0x6e3420,
  "dark-blonde": 0x8a6a42,
  blonde: 0xc4a066,
  grey: 0x8c8a86,
  white: 0xd8d6d0,
} as const;
export type HairColour = keyof typeof HAIR_COLOURS;

export const EYE_COLOURS = {
  "dark-brown": 0x2a1a10,
  brown: 0x4a2e1a,
  hazel: 0x6a5530,
  green: 0x4a6a40,
  blue: 0x3e6a92,
  grey: 0x6a7480,
} as const;
export type EyeColour = keyof typeof EYE_COLOURS;

/**
 * Microsoft Rocketbox avatars (MIT) built into bodies by
 * tools/players/rocketbox. Their faces, hair and skin are photographic
 * textures, so an avatar player is chosen rather than described.
 */
export const AVATARS = [
  "Male_Adult_02",
  "Male_Adult_03",
  "Male_Adult_04",
  "Male_Adult_05",
  "Male_Adult_06",
  "Male_Adult_07",
  "Male_Adult_08",
  "Male_Adult_09",
  "Male_Adult_10",
  "Male_Adult_11",
  "Male_Adult_12",
  "Male_Adult_13",
  "Male_Adult_14",
  "Male_Adult_16",
  "Male_Adult_17",
  "Male_Adult_20",
  "Business_Male_02",
  "Business_Male_05",
  "Business_Male_06",
  "Sports_Male_03",
] as const;
export type Avatar = (typeof AVATARS)[number];

/** A player wearing a Rocketbox avatar: the face is the avatar's; only the kit and cap are ours. */
export interface AvatarAppearance {
  avatar: Avatar;
  /** Wears a cap in the field. Batsmen always wear a helmet and umpires a hat. */
  cap: boolean;
}

/** A player made from building blocks on an MPFB body. */
export interface BuiltAppearance {
  heritage: Heritage;
  physique: Physique;
  skin: SkinTone;
  hair: HairStyle;
  hairColour: HairColour;
  facialHair: FacialHair;
  eyes: EyeColour;
  /** Wears a cap in the field. Batsmen always wear a helmet and umpires a hat. */
  cap: boolean;
}

export type Appearance = AvatarAppearance | BuiltAppearance;

export function isAvatar(a: Appearance): a is AvatarAppearance {
  return "avatar" in a;
}

/** The body file name for an avatar: `rb-male-adult-08`. */
export function avatarBuild(avatar: string): string {
  return `rb-${avatar.toLowerCase().replace(/_/g, "-")}`;
}

/** The body file a player wears. */
export function buildFor(a: Appearance): string {
  if (isAvatar(a)) return avatarBuild(a.avatar);
  if (a.physique === "veteran" && !VETERAN_HERITAGES.includes(a.heritage)) {
    throw new Error(`no veteran build for heritage "${a.heritage}"`);
  }
  return `${a.heritage}-${a.physique}`;
}

/** The kit a player is wearing: shirt, trousers, boots, and whether the sleeves are long. */
export interface Kit {
  shirt: number;
  trousers: number;
  boot: number;
  longSleeves: boolean;
}

function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** Every painted surface of a player. An avatar's skin, hair and face are textures; only the kit is painted. */
export function bodyColours(a: Appearance, kit: Kit) {
  if (isAvatar(a)) {
    const unused = 0xff00ff; // slots an avatar does not have
    return {
      skin: unused, hand: unused, lips: unused, brow: unused, eye: unused, iris: unused, hair: unused, beard: unused,
      shirt: kit.shirt, trousers: kit.trousers, boot: kit.boot,
      // An avatar's bare forearms are textured skin; its sleeves are cloth.
      sleeve: kit.shirt,
    };
  }
  const skin = SKIN_TONES[a.skin];
  const hair = HAIR_COLOURS[a.hairColour];
  return {
    skin,
    hand: skin,
    shirt: kit.shirt,
    trousers: kit.trousers,
    sleeve: kit.longSleeves ? kit.shirt : skin,
    boot: kit.boot,
    // Lips: the skin, warmer and a shade darker.
    lips: mix(skin, 0x7a3428, 0.32),
    // Brows match the hair, a touch darker; grey and white hair keep darker brows.
    brow: a.hairColour === "grey" || a.hairColour === "white" ? mix(hair, 0x3a3530, 0.45) : mix(hair, 0x000000, 0.2),
    eye: 0xe8e2d8,
    iris: EYE_COLOURS[a.eyes],
    hair,
    // Stubble is skin showing through hair, not a block of colour.
    beard: a.facialHair === "stubble" ? mix(skin, hair, 0.55) : hair,
  };
}

/** True if every field names something that exists. Rosters are checked with this in tests. */
export function validAppearance(a: Appearance): string[] {
  if (isAvatar(a)) return AVATARS.includes(a.avatar) ? [] : [`avatar "${a.avatar}"`];
  const problems: string[] = [];
  if (!HERITAGES.includes(a.heritage)) problems.push(`heritage "${a.heritage}"`);
  if (!PHYSIQUES.includes(a.physique)) problems.push(`physique "${a.physique}"`);
  if (a.physique === "veteran" && !VETERAN_HERITAGES.includes(a.heritage)) problems.push(`no veteran ${a.heritage} build`);
  if (!(a.skin in SKIN_TONES)) problems.push(`skin "${a.skin}"`);
  if (!HAIR_STYLES.includes(a.hair)) problems.push(`hair "${a.hair}"`);
  if (!(a.hairColour in HAIR_COLOURS)) problems.push(`hair colour "${a.hairColour}"`);
  if (!FACIAL_HAIR.includes(a.facialHair)) problems.push(`facial hair "${a.facialHair}"`);
  if (!(a.eyes in EYE_COLOURS)) problems.push(`eyes "${a.eyes}"`);
  return problems;
}
