import * as THREE from "three";
import { previewGroups, motionSheets, loadBodies } from "/lib/game/assets/index.mjs";

// The players' bodies, served by the harness from public/models/players.
const bodies = await loadBodies();

const W = 1600, H = 1000;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151a);

// Three-point rig: a key with shadows, a cool fill, and a rim to separate
// silhouettes from the background.
const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
key.position.set(18, 26, 14);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const c = key.shadow.camera;
c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 140;
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc4ff, 0.7);
fill.position.set(-16, 10, -8);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(-6, 8, -22);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x3a3f2e, 0.55));

// Two grids: 1m majors for reading real-world scale, 10cm minors because a
// cricket ball is 7cm across and a 1m grid tells you nothing about it.
const gridFine = new THREE.GridHelper(10, 100, 0x2b3540, 0x222b34);
gridFine.position.y = 0.0005;
const gridMajor = new THREE.GridHelper(10, 10, 0x6b7f90, 0x46545f);
gridMajor.position.y = 0.001;
const grid = new THREE.Group();
grid.add(gridFine, gridMajor);
scene.add(grid);

/** Label sprite sized in WORLD units, so it stays legible next to a 7cm ball. */
function label(text, worldWidth) {
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 80;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(10,14,18,0.85)";
  ctx.fillRect(0, 0, 512, 80);
  ctx.fillStyle = "#eaf2ff";
  ctx.font = "30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 10;
  sp.scale.set(worldWidth, (worldWidth * 80) / 512, 1);
  return sp;
}

/**
 * Point the camera so `box` fills the frame, from a 3/4 elevation.
 * Derived from the fov rather than hand-tuned multipliers, which is what kept
 * going wrong when asset sizes spanned two orders of magnitude.
 */
function frame(cam, box, margin = 1.35) {
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.05);
  const vFov = (cam.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * margin;
  const dir = new THREE.Vector3(0.42, 0.5, 1).normalize();
  cam.position.copy(ctr).addScaledVector(dir, dist);
  cam.near = Math.max(dist / 500, 0.01);
  cam.far = dist * 8;
  cam.updateProjectionMatrix();
  cam.lookAt(ctr);
}

function countTriangles(obj) {
  let tris = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(tris);
}

const results = {};

async function shoot(name) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 600);

/**
 * Lay a list of {name, group} out on a uniform grid.
 *
 * Cell size comes from the LARGEST item rather than each item's own width, so
 * labels can be a fixed fraction of a cell and never overlap their neighbour —
 * the failure mode when the kit spans a 7cm ball and a 1m swatch at once.
 */
function layout(items) {
  const root = new THREE.Group();
  const measured = items.map(({ name, group }) => {
    const box = new THREE.Box3().setFromObject(group);
    return { name, group, box, size: box.getSize(new THREE.Vector3()) };
  });

  // Biggest first, so the eye lands on the substantial props.
  measured.sort((a, b) => b.size.length() - a.size.length());

  const cell =
    Math.max(...measured.map((m) => Math.max(m.size.x, m.size.z))) * 1.4 + 0.06;
  const cols = Math.ceil(Math.sqrt(measured.length));

  measured.forEach((m, i) => {
    const centre = m.box.getCenter(new THREE.Vector3());
    m.group.position.x -= centre.x;
    m.group.position.z -= centre.z;
    m.group.position.y -= m.box.min.y;

    const holder = new THREE.Group();
    holder.add(m.group);
    holder.position.set((i % cols) * cell, 0, Math.floor(i / cols) * cell);

    const tag = label(`${m.name}  (${results[m.name]} tris)`, cell * 0.86);
    tag.position.set(0, m.size.y + cell * 0.16, 0);
    holder.add(tag);

    root.add(holder);
  });

  const rows = Math.ceil(measured.length / cols);
  const tallest = Math.max(...measured.map((m) => m.size.y));

  // Bounds of the CELLS, not of setFromObject(root) — label sprites overhang
  // their cell and would otherwise pad the frame out with empty space.
  const bounds = new THREE.Box3(
    new THREE.Vector3(-cell / 2, 0, -cell / 2),
    new THREE.Vector3(
      (cols - 1) * cell + cell / 2,
      tallest + cell * 0.3,
      (rows - 1) * cell + cell / 2
    )
  );
  return { root, cell, cols, rows, bounds };
}

const shots = {};

/**
 * Motion mode: filmstrips.
 *
 * Each sheet is rows of frames of one movement, laid out left to right and
 * shot with an ORTHOGRAPHIC camera from the side — the animator's reference
 * view, where a foot that skates or a bat that leaves the hands is obvious and
 * perspective cannot hide it. Frames sit on a ground line so a floating or
 * sunken figure shows too.
 */
async function runMotion() {
  const sheets = await motionSheets(bodies);
  const SPACING = 1.55;
  const ROW_H = 2.7;
  for (const sheet of sheets) {
    const root = new THREE.Group();
    let maxCols = 0;
    sheet.rows.forEach((row, r) => {
      const y = -r * ROW_H;
      maxCols = Math.max(maxCols, row.frames.length);
      const tag = label(row.label, 3.6);
      tag.position.set(-2.6, y + 1.2, 0);
      root.add(tag);
      // Ground line under the row.
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(row.frames.length * SPACING + 1, 0.02, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x3d5a3d, roughness: 1 })
      );
      line.position.set(((row.frames.length - 1) * SPACING) / 2, y - 0.01, 0);
      root.add(line);
      row.frames.forEach((f, i) => {
        f.group.position.set(i * SPACING + (f.dx ?? 0), y + (f.dy ?? 0), 0);
        root.add(f.group);
        if (f.label) {
          const t = label(f.label, 1.3);
          t.position.set(i * SPACING, y - 0.28, 0.6);
          root.add(t);
        }
        for (const extra of f.extras ?? []) {
          extra.position.x += i * SPACING + (f.dx ?? 0);
          extra.position.y += y + (f.dy ?? 0);
          root.add(extra);
        }
      });
    });
    scene.add(root);
    grid.visible = false;

    const width = maxCols * SPACING + 3.5;
    const height = sheet.rows.length * ROW_H + 0.4;
    const W2 = 2400, H2 = Math.round(Math.min(3200, Math.max(700, (2400 * height) / width)));
    renderer.setSize(W2, H2);
    const aspect = W2 / H2;
    const halfH = Math.max(height / 2, width / aspect / 2);
    const ortho = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 100);
    const cx = (maxCols - 1) * SPACING / 2 - 1.2;
    const cy = -((sheet.rows.length - 1) * ROW_H) / 2 + 0.9;
    ortho.position.set(cx, cy, 30);
    ortho.lookAt(cx, cy, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderer.render(scene, ortho);
    shots["motion-" + sheet.name] = renderer.domElement.toDataURL("image/png");
    scene.remove(root);
  }
  window.__done = { shots, tris: {}, metrics: sheets.map((s) => ({ name: s.name, metrics: s.metrics ?? null })) };
}

async function run() {
  if (window.__PREVIEW_MODE === "motion") return runMotion();
  const kit = await previewGroups(renderer, bodies);

  // Big things (the ground, a whole stand) dwarf a ball; they get their own
  // frame rather than shrinking everything else into invisibility.
  const small = [], large = [];
  for (const entry of kit) {
    results[entry.name] = countTriangles(entry.group);
    const s = new THREE.Box3().setFromObject(entry.group).getSize(new THREE.Vector3());
    (Math.max(s.x, s.z) > 25 ? large : small).push(entry);
  }

  if (small.length) {
    const { root, cell, cols, bounds } = layout(small);
    scene.add(root);
    frame(camera, bounds, 1.12);
    shots.kit = await shoot();

    // Close 3/4 on the first two cells, for detail the wide shot loses.
    frame(
      camera,
      new THREE.Box3(
        new THREE.Vector3(-cell * 0.55, 0, -cell * 0.55),
        new THREE.Vector3(cell * (Math.min(2, cols) - 0.45), cell * 0.5, cell * 0.55)
      ),
      1.1
    );
    shots.detail = await shoot();
    scene.remove(root);
  }

  for (const entry of large) {
    const g = entry.group;
    scene.add(g);
    grid.visible = false;
    frame(camera, new THREE.Box3().setFromObject(g), 1.15);
    shots[entry.name.replace(/[^\w-]/g, "-")] = await shoot();
    scene.remove(g);
    grid.visible = true;
  }

  window.__done = { shots, tris: results };
}

run().catch((e) => {
  window.__error = String(e && e.stack || e);
});
