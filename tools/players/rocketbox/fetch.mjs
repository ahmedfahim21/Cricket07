#!/usr/bin/env node
/**
 * Downloads the Microsoft Rocketbox avatars listed in avatars.json — the FBX
 * and the colour textures only — into tools/players/.cache/rocketbox. The
 * library is MIT licensed and ~4 GB in full; each avatar needs ~25-40 MB.
 *
 *   node tools/players/rocketbox/fetch.mjs            every avatar in the list
 *   node tools/players/rocketbox/fetch.mjs Male_Adult_08
 *
 * Files already in the cache are skipped.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, "..", ".cache", "rocketbox");
const RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars";
const API = "https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars";

const { avatars } = JSON.parse(readFileSync(join(here, "avatars.json"), "utf8"));
const only = process.argv.slice(2);
const wanted = only.length ? avatars.filter((a) => only.includes(a.id)) : avatars;
if (only.length && wanted.length !== only.length) throw new Error(`unknown avatar in ${only.join(", ")}`);

async function get(url, to) {
  if (existsSync(to)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  mkdirSync(dirname(to), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(to));
  return true;
}

for (const a of wanted) {
  const dir = join(cache, a.id);
  await get(`${RAW}/${a.folder}/${a.id}/Export/${a.id}.fbx`, join(dir, `${a.id}.fbx`));
  // Only the colour maps (and an opacity map where hair uses one): the cel
  // look has no use for normal or specular maps.
  const res = await fetch(`${API}/${a.folder}/${a.id}/Textures`);
  if (!res.ok) throw new Error(`listing ${a.id} textures: ${res.status}`);
  const files = (await res.json()).map((f) => f.name).filter((n) => /_(color)\.tga$/i.test(n));
  for (const f of files) await get(`${RAW}/${a.folder}/${a.id}/Textures/${f}`, join(dir, "Textures", f));
  console.log(`${a.id}: ${files.length} textures`);
}
