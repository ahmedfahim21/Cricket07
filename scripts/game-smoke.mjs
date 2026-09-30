import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

// Use a fresh temporary browser profile: never read or change personal browser data.
const browser = await chromium.launch({
  executablePath: [process.env.CHROME_PATH, chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find((p) => p && existsSync(p)),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "warning") console.log(m.text()); });
try {
  await page.goto(process.argv[2] || process.env.GAME_URL || "http://localhost:3001");
  await page.waitForFunction(() => !!window.__game || document.body.innerText.includes("FAILED TO START"), null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => !!window.__game), true, "game startup failed");
  await page.getByRole("heading", { name: "Chase it down" }).waitFor();
  await page.screenshot({ path: "/private/tmp/cricket-ladder.png" });
  await page.getByRole("button", { name: /01Find the gaps/ }).click();
  await page.getByRole("heading", { name: "Find the gaps" }).waitFor();
  // Stop rendering while advancing real engine frames deterministically. Physics,
  // input handling, batting IK, fielding, scoring and challenge transitions all run.
  await page.evaluate(() => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    window.__playBall = ({ shot = "KeyC", error = -0.02, aim = null, move = null } = {}) => {
      const key = (code, down = true) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }));
      g.bowl();
      let pressed = false;
      let band = null;
      let marker = null;
      let bounceError = null;
      let releasePosition = null;
      let frozen = true;
      let markerSeen = false;
      let markerStable = true;
      let meterError = null;
      let celebrationRuns = null;
      let immediateCelebration = false;
      let umpireCutSeen = false;
      if (aim) key(aim);
      if (move) key(move);
      for (let frame = 0; frame < 2400; frame++) {
        if (g.phase === "flight" && !pressed && shot && g.live.timingError !== null && g.live.timingError >= error) {
          meterError = g.live.timingError;
          key(shot); pressed = true;
        }
        g.update(1 / 60);
        if (g.live.boundaryRuns !== null) {
          if (celebrationRuns === null) {
            celebrationRuns = g.live.boundaryRuns;
            immediateCelebration = g.phase === "settling" && g.live.celebrationTime === 0;
          }
          umpireCutSeen ||= g.boundaryCameraActive;
        }
        if (shot) key(shot, false);
        markerSeen ||= g.marker.visible;
        if (g.markerLocked && g.markerPoint && !marker) marker = g.marker.position.clone();
        if (marker && g.marker.visible) markerStable &&= marker.distanceTo(g.marker.position) < 1e-6;
        if (marker && g.phase === "flight" && g.world.lastBounce && bounceError === null) bounceError = Math.hypot(marker.x - g.world.lastBounce.position.x, marker.z - g.world.lastBounce.position.z);
        if (g.phase === "flight" && !releasePosition) releasePosition = g.strikerRoot.clone();
        if (releasePosition && g.phase !== "idle" && !g.resetDone) frozen &&= releasePosition.distanceTo(g.strikerRoot) < 1e-6;
        if (g.live.lastBand) band = g.live.lastBand;
        if (g.phase === "idle") break;
      }
      if (aim) key(aim, false);
      if (move) key(move, false);
      return { band, meterError, style: g.style, score: g.match.runs, wickets: g.match.wickets, event: g.lastEvent, bounceError, markerSeen, markerStable, frozen, releasePosition: releasePosition?.toArray(), timeline: [...g.match.timeline], celebrationRuns, immediateCelebration, umpireCutSeen, celebrationCleared: g.live.boundaryRuns === null };
    };
  });
  const report = await page.evaluate(() => {
    const g = window.__game;
    const deliveries = [];
    for (let ball = 0; ball < 6 && !g.match.complete; ball++) {
      deliveries.push(window.__playBall());
    }
    g.emitTelemetry(999);
    return { deliveries, complete: g.match.complete, unlocked: g.progress.unlocked };
  });
  console.log("Opening chase:", report.deliveries.map((d) => d.event).join(", "));
  assert.equal(report.unlocked, 1, "timed lofts should win level one through the real engine");
  await page.getByRole("heading", { name: "Chase complete!" }).waitFor();
  await page.screenshot({ path: "/private/tmp/cricket-result.png" });
  const ladder = await page.evaluate(() => {
    const g = window.__game;
    const levels = [];
    for (let level = 1; level < 5; level++) {
      g.selectLevel(level);
      const deliveries = [];
      for (let n = 0; n < 18 && !g.match.complete; n++) deliveries.push(window.__playBall());
      levels.push({ level, score: g.match.runs, wickets: g.match.wickets, complete: g.match.complete, deliveries });
    }
    g.emitTelemetry(999);
    return levels;
  });
  console.log("Ladder:", ladder.map((l) => `L${l.level + 1} ${l.score}/${l.wickets}`).join(", "));
  for (const level of ladder) {
    assert.ok(level.complete && level.score >= [12, 20, 28, 38, 48][level.level], `level ${level.level + 1} should be winnable`);
    for (const delivery of level.deliveries) {
      assert.ok(delivery.markerSeen && delivery.markerStable && delivery.frozen);
      if (delivery.bounceError !== null) assert.ok(delivery.bounceError < 0.15);
      if (delivery.celebrationRuns) assert.ok(delivery.immediateCelebration && delivery.umpireCutSeen && delivery.celebrationCleared, "boundary celebration must start on crossing, cut to umpire, and reset");
    }
  }
  await page.getByRole("heading", { name: "Ladder complete!" }).waitFor();
  const shots = await page.evaluate(() => {
    const g = window.__game;
    const cases = [];
    for (const level of [0, 2]) {
      for (const error of [-0.02, -0.10]) {
        for (const shot of ["KeyX", "KeyC", "KeyZ"]) {
          g.selectLevel(level);
          cases.push({ level, error, shot, ...window.__playBall({ shot, error }) });
        }
      }
    }
    return cases;
  });
  console.log("Shots:", shots.map((s) => `${s.style} ${s.shot} ${s.band}: ${s.event}`).join("; "));
  for (const shot of shots) {
    if (shot.shot === "KeyC") assert.equal(shot.event, "SIX", `${shot.style} loft should clear rope`);
    if (shot.shot === "KeyZ") assert.ok(shot.score < 4, "defence should remain soft");
  }
  assert.ok(shots.some((shot) => shot.shot === "KeyX" && shot.event === "FOUR"), "ground shots should reach gaps");
  const movement = await page.evaluate(() => {
    const g = window.__game;
    const result = [];
    for (const camera of ["batting", "tv"]) {
      for (const move of ["KeyA", "KeyD", "KeyW", "KeyS"]) {
        g.cameraMode = camera;
        g.selectLevel(0);
        result.push({ camera, move, ...window.__playBall({ move }) });
      }
    }
    g.cameraMode = "batting";
    return result;
  });
  for (const move of movement) {
    assert.ok(move.frozen, "position must freeze at release even with WASD held");
    const [x, , z] = move.releasePosition;
    if (move.move === "KeyW") assert.ok(Math.abs(z - (-10.06 + 0.95 + 0.6)) < 1e-6);
    if (move.move === "KeyS") assert.ok(Math.abs(z - (-10.06 + 0.95 - 0.3)) < 1e-6);
    if (move.move === "KeyA") assert.ok(move.camera === "batting" ? x > 0.35 : x < 0.35);
    if (move.move === "KeyD") assert.ok(move.camera === "batting" ? x < 0.35 : x > 0.35);
  }
  const failure = await page.evaluate(() => {
    const g = window.__game;
    g.selectLevel(0);
    const reset = g.match.runs === 0 && g.match.wickets === 0 && g.strikerRoot.x === 0.35;
    for (let ball = 0; ball < 12 && !g.match.complete; ball++) window.__playBall({ shot: null });
    const before = JSON.stringify(g.match);
    g.bowl();
    const result = { reset, complete: g.match.complete, runs: g.match.runs, blocked: g.phase === "idle" && JSON.stringify(g.match) === before };
    g.emitTelemetry(999);
    return result;
  });
  assert.ok(failure.reset && failure.complete && failure.blocked && failure.runs === 0);
  await page.getByRole("heading", { name: "Give it another go" }).waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("heading", { name: "Find the gaps" }).waitFor();
  // Pause actual boundary deliveries to inspect the wide shot and umpire cut.
  for (const runs of [4, 6]) {
    const found = await page.evaluate((wanted) => {
      const g = window.__game;
      const shot = wanted === 4 ? "KeyX" : "KeyC";
      for (let attempt = 0; attempt < 12; attempt++) {
        g.selectLevel(0); g.bowl();
        let pressed = false;
        for (let frame = 0; frame < 2400; frame++) {
          if (!pressed && g.phase === "flight" && g.live.timingError !== null && g.live.timingError >= -0.02) {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: shot })); pressed = true;
          }
          g.update(1 / 60);
          window.dispatchEvent(new KeyboardEvent("keyup", { code: shot }));
          if (g.live.boundaryRuns === wanted) {
            g.pipeline.render(1 / 60); g.emitTelemetry(999);
            return g.live.celebrationTime === 0 && !g.boundaryCameraActive;
          }
          if (g.phase === "idle") break;
        }
      }
      return false;
    }, runs);
    assert.ok(found, `need a real ${runs} for visual inspection`);
    await page.getByRole("status").filter({ hasText: runs === 6 ? "SIX!" : "FOUR!" }).waitFor({ state: "visible" });
    await page.screenshot({ path: `/private/tmp/cricket-boundary-${runs}-wide.png` });
    const cut = await page.evaluate(() => {
      const g = window.__game;
      for (let frame = 0; frame < 84; frame++) g.update(1 / 60);
      g.pipeline.render(1 / 60); g.emitTelemetry(999);
      const points = [g.umpire.rig.head, g.umpire.rig.handL, g.umpire.rig.handR].map((joint) => {
        const p = joint.getWorldPosition(g.umpire.world.clone()).project(g.camera);
        return { x: p.x, y: p.y };
      });
      return { active: g.boundaryCameraActive, phase: g.phase, points };
    });
    assert.ok(cut.active && cut.phase === "settling");
    assert.ok(cut.points.every((p) => Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95), "umpire head and signalling hands must stay in frame");
    await page.screenshot({ path: `/private/tmp/cricket-boundary-${runs}-umpire.png` });
    {
      const shortBoundary = await page.evaluate(() => {
        const g = window.__game;
        let reactionSeen = false;
        let frames = 0;
        for (; frames < 300 && g.phase !== "idle"; frames++) {
          g.update(1 / 60);
          reactionSeen ||= !!g.live.momentShot;
        }
        return { reactionSeen, frames, idle: g.phase === "idle" };
      });
      assert.ok(shortBoundary.idle && !shortBoundary.reactionSeen && shortBoundary.frames < 125, `${runs} should finish after its umpire signal without player cutaways`);
    }
    await page.evaluate(() => {
      const g = window.__game;
      for (let frame = 0; frame < 300 && g.phase !== "idle"; frame++) g.update(1 / 60);
      g.pipeline.render(1 / 60); g.emitTelemetry(999);
    });
    await page.getByRole("status").filter({ hasText: "BOUNDARY" }).waitFor({ state: "hidden" });
  }
  // Let an actual delivery dismiss the striker, then inspect both wicket cuts.
  const wicket = await page.evaluate(() => {
    const g = window.__game;
    for (let attempt = 0; attempt < 20; attempt++) {
      g.selectLevel(0);
      window.__playBall({ shot: "KeyX" });
      if (g.match.complete) continue;
      g.bowl();
      for (let frame = 0; frame < 2400; frame++) {
        g.update(1 / 60);
        if (g.live.moment?.kind === "wicket") {
          const original = g.match.batsmen[g.match.striker];
          const dismissed = g.live.moment.dismissed;
          window.__dismissedIndex = g.match.striker;
          window.__beforeWickets = g.match.wickets;
          window.__dismissed = dismissed;
          for (let i = 0; i < 180 && g.live.celebrationTime < 2; i++) g.update(1 / 60);
          g.pipeline.render(1 / 60); g.emitTelemetry(999);
          return { original, dismissed, shot: g.live.momentShot, teamSize: g.reactions.fielders.filter((f) => f.root.visible).length, hold: g.deadTimer };
        }
        if (g.phase === "idle") break;
      }
    }
    return null;
  });
  assert.ok(wicket, "need an actual wicket for visual inspection");
  assert.equal(wicket.shot, "fielders");
  assert.equal(wicket.teamSize, 11);
  assert.equal(wicket.hold, 5.2);
  assert.equal(wicket.dismissed.runs, wicket.original.runs);
  assert.equal(wicket.dismissed.ballsFaced, wicket.original.ballsFaced + 1);
  await page.getByTestId("wicket-presentation").waitFor({ state: "visible" });
  await page.screenshot({ path: "/private/tmp/cricket-wicket-highfive.png" });
  const walkoff = await page.evaluate(() => {
    const g = window.__game;
    for (let frame = 0; frame < 300 && g.live.celebrationTime < 4.5; frame++) g.update(1 / 60);
    g.pipeline.render(1 / 60); g.emitTelemetry(999);
    const rig = g.reactions.batsmen[0];
    const point = rig.head.getWorldPosition(rig.root.position.clone()).project(g.camera);
    return { shot: g.live.momentShot, inFrame: Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.9 };
  });
  assert.equal(walkoff.shot, "walkoff");
  assert.ok(walkoff.inFrame);
  await page.screenshot({ path: "/private/tmp/cricket-wicket-walkoff.png" });
  assert.ok((await page.getByTestId("wicket-presentation").innerText()).includes(`${wicket.dismissed.ballsFaced} BALLS`));
  // Pose each cosmetic option at the same moment without changing delivery RNG.
  for (const variant of [0, 1, 2]) {
    await page.evaluate((v) => {
      const g = window.__game;
      g.live.moment.batterVariant = v;
      g.update(0);
      g.pipeline.render(1 / 60);
    }, variant);
    await page.screenshot({ path: `/private/tmp/cricket-wicket-walkoff-${variant}.png` });
  }
  const restored = await page.evaluate(() => {
    const g = window.__game;
    for (let frame = 0; frame < 600 && g.phase !== "idle"; frame++) g.update(1 / 60);
    return {
      scoredOnce: g.match.wickets === window.__beforeWickets + 1 && JSON.stringify(g.match.batsmen[window.__dismissedIndex]) === JSON.stringify(window.__dismissed),
      cleared: g.phase === "idle" && !g.live.moment && !g.live.momentShot && !g.reactions.group.visible,
      visible: [...g.batsmen, ...g.fielders, g.bowler, g.umpire].every((actor) => actor.rig.root.visible),
    };
  });
  assert.ok(restored.scoredOnce && restored.cleared && restored.visible);
  await page.getByTestId("wicket-presentation").waitFor({ state: "hidden" });
  // Render the same marker in both cameras for visual inspection.
  for (const camera of ["batting", "tv"]) {
    await page.evaluate((mode) => {
      const g = window.__game;
      g.selectLevel(0); g.cameraMode = mode; g.bowl();
      for (let i = 0; i < 500 && !g.markerLocked; i++) g.update(1 / 60);
      g.pipeline.render(1 / 60);
      g.emitTelemetry(999);
    }, camera);
    await page.screenshot({ path: `/private/tmp/cricket-marker-${camera}.png` });
  }
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole("heading", { name: "Chase it down" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /05Finish the chase/ }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__game.match.runs), 0, "reload starts a fresh innings");
  assert.deepEqual(errors, []);
  console.log("PASS: ladder, persistence, live shots, movement, markers, boundary/umpire reactions, wicket high-fives, walk-off stats and reset");
} catch (error) {
  console.log("Page errors:", errors);
  await page.screenshot({ path: "/private/tmp/cricket-failure.png" });
  console.log((await page.locator("body").innerText()).slice(0, 2000));
  throw error;
} finally {
  await browser.close();
}
