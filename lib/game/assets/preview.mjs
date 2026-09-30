// Visual verification harness for the procedural cricket asset kit.
//
// Assets in this project are code, not files — which means the only way to
// know what you built is to render it and look. This harness builds every
// asset via `previewGroups()`, lays them out on a labelled grid over a 1m
// GridHelper so scale errors are obvious, and saves screenshots next to the
// source. It also prints a triangle count per asset so a blown budget shows
// up as a number rather than as a mystery framerate drop later.
//
// The .ts sources are transpiled in isolation with TypeScript's
// transpileModule (type erasure only — `pnpm typecheck` is the real check),
// flattened into one directory, and served next to three.js's ESM build over
// a tiny static server, then driven with real headless Chrome.
//
// Run with:  pnpm preview:assets

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");

const ts = (
  await import(pathToFileURL(path.join(REPO, "node_modules/typescript/lib/typescript.js")).href)
).default;
const { chromium } = await import(
  pathToFileURL(path.join(REPO, "node_modules/playwright-core/index.mjs")).href
);

/* ------------------------------------------------------------------ *
 * Locate a Chrome to drive.
 *
 * playwright-core ships no browsers of its own, so rather than hardcode one
 * machine's path we try, in order: whatever playwright already resolves, the
 * newest browser in the shared playwright cache, then a system Chrome.
 * ------------------------------------------------------------------ */

function resolveChrome() {
  const candidates = [];

  try {
    const p = chromium.executablePath();
    if (p) candidates.push(p);
  } catch {
    // playwright-core throws when no browsers are registered; that is fine.
  }

  const cacheRoot = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const altRoot = path.join(os.homedir(), ".cache/ms-playwright");
  for (const root of [cacheRoot, altRoot]) {
    if (!fs.existsSync(root)) continue;
    const builds = fs
      .readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const b of builds) {
      candidates.push(
        path.join(root, b, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        path.join(root, b, "chrome-linux/chrome")
      );
    }
  }

  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  );

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(
    "No Chrome/Chromium found. Install one, or run: pnpm exec playwright install chromium"
  );
}

/* ------------------------------------------------------------------ *
 * Transpile the TypeScript sources, keeping the directory tree.
 *
 * Every .ts file under lib/game (tests excluded) is served at its own
 * repo-relative path with a .mjs extension, and relative specifiers just gain
 * the extension. An earlier version flattened everything into one directory,
 * which only worked while every basename in the graph was unique. Type-only
 * imports are already elided by transpileModule; `pnpm typecheck` is the real
 * type check.
 *
 * Nothing reachable from assets/index.ts may import the Rapier physics world:
 * the harness renders geometry and poses, and a WASM physics engine has no
 * business being loaded to do that.
 * ------------------------------------------------------------------ */

function transpile(src, fileName) {
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    fileName,
  });
  return out.outputText.replace(/from "(\.{1,2}\/[^"]+)"/g, 'from "$1.mjs"');
}

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(abs, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(abs);
  }
  return out;
}

const modules = {};
for (const abs of collect(path.join(REPO, "lib/game"))) {
  const rel = path.relative(REPO, abs).replace(/\\/g, "/").replace(/\.ts$/, ".mjs");
  modules[rel] = transpile(fs.readFileSync(abs, "utf8"), path.basename(abs));
}

if (!modules["lib/game/assets/index.mjs"]) {
  throw new Error("lib/game/assets/index.ts is missing — nothing to preview.");
}

/** "kit" renders the asset catalogue; "motion" renders animation filmstrips. */
const MODE = process.argv.includes("--motion") ? "motion" : "kit";

/* ------------------------------------------------------------------ *
 * Static server: flattened modules + the three.js package.
 * ------------------------------------------------------------------ */

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
};

const THREE_PKG = path.join(REPO, "node_modules/three");

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:#11151a;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/build/three.module.js",
    "three/": "/vendor/three/"
  }
}
</script>
<script>window.__PREVIEW_MODE = "__MODE__";</script>
<script type="module" src="/boot.mjs"></script>
`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE.replace("__MODE__", MODE));
  }

  if (url.startsWith("/vendor/three/")) {
    const rel = url.slice("/vendor/three/".length);
    const abs = path.join(THREE_PKG, rel);
    if (!abs.startsWith(THREE_PKG) || !fs.existsSync(abs)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "text/plain" });
    return res.end(fs.readFileSync(abs));
  }

  if (url === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }

  const key = url.replace(/^\//, "");
  if (modules[key]) {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(modules[key]);
  }
  if (key === "boot.mjs") {
    // Read per-request so an edit to the boot script needs no restart.
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(fs.readFileSync(path.join(__dirname, "preview-boot.js")));
  }

  res.writeHead(404);
  res.end("not found");
});

/* ------------------------------------------------------------------ *
 * The in-page harness lives in preview-boot.js next to this file. It is a
 * real module rather than a string in here because it is browser code with
 * its own template literals and backticks, which an embedded literal keeps
 * silently breaking on.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Drive it.
 * ------------------------------------------------------------------ */

const port = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") problems.push("console: " + m.text());
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

try {
  await page.waitForFunction(() => window.__done || window.__error, null, { timeout: 120000 });
} catch {
  problems.push("timed out waiting for the preview to finish building");
}

const err = await page.evaluate(() => window.__error);
if (err) problems.push(err);

const done = await page.evaluate(() => window.__done ?? null);

if (done && done.metrics) {
  for (const m of done.metrics) if (m.metrics) console.log("METRICS " + m.name + " " + JSON.stringify(m.metrics));
}

if (done) {
  for (const [name, dataUrl] of Object.entries(done.shots)) {
    const out = path.join(__dirname, `preview-${name}.png`);
    fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", path.relative(REPO, out));
  }
  console.log("\nTRIANGLE COUNTS:");
  for (const [name, tris] of Object.entries(done.tris).sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(tris).padStart(8) + "  " + name);
  }
}

await browser.close();
server.close();

if (problems.length) {
  console.error("\nPREVIEW FAILED:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
if (!done) process.exit(1);
