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
console.log("Browser started; loading game");
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log(m.text()); });
page.on("requestfailed", (request) => console.log("Request failed:", request.url(), request.failure()?.errorText));
try {
  await page.goto(process.argv[2] || process.env.GAME_URL || "http://localhost:3001");
  await page.waitForFunction(() => !!window.__game || document.body.innerText.includes("FAILED TO START"), null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => !!window.__game), true, "game startup failed");
  console.log("Game ready");
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
        // Locking can precede the batting cue's reveal; sample its rendered position only once visible.
        if (g.markerLocked && g.marker.visible && g.markerPoint && !marker) marker = g.marker.position.clone();
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
          for (let i = 0; i < 240 && g.live.celebrationTime < 3; i++) g.update(1 / 60);
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
  assert.equal(wicket.hold, 6.2);
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
      // Batting cues stay hidden throughout the approach and appear large at release.
      for (let i = 0; i < 700 && g.phase !== "flight"; i++) {
        g.update(1 / 60);
        if (g.phase === "runup" && g.marker.visible) throw new Error("Early batting marker");
      }
      if (!g.marker.visible || g.marker.scale.x < 4) throw new Error("Missing release cue");
      const releaseScale = g.marker.scale.x;
      const bouncePoint = g.marker.position.clone();
      for (let i = 0; i < 12; i++) g.update(1 / 60);
      if (g.marker.scale.x >= releaseScale || g.marker.position.distanceTo(bouncePoint) > 1e-6) {
        throw new Error("Batting cue must shrink over a fixed bounce point");
      }
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
  await page.getByRole("button", { name: "Try bowling · defend 24 runs" }).click();
  await page.getByRole("heading", { name: "Defend the total" }).waitFor();
  await page.getByLabel("YOUR BOWLER").selectOption("2");
  await page.getByRole("slider", { name: "Delivery pace", exact: true }).fill("45");
  await page.screenshot({ path: "/private/tmp/cricket-bowling-setup.png" });
  await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
  await page.getByRole("button", { name: "Start bowling · R" }).click();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("KeyW");
  const aiming = await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 28; i++) g.update(1 / 60);
    g.pipeline.render(1 / 60); g.emitTelemetry(999);
    return { aim: structuredClone(g.bowlingAim), unlocked: !g.markerLocked, visible: g.marker.visible };
  });
  await page.keyboard.up("ArrowRight"); await page.keyboard.up("KeyW");
  assert.ok(aiming.unlocked && aiming.visible && aiming.aim.line > -0.12 && aiming.aim.length < 5);
  await page.screenshot({ path: "/private/tmp/cricket-bowling-aim.png" });
  await page.keyboard.press("Space");
  assert.ok(await page.evaluate(() => {
    const g = window.__game;
    g.update(1 / 60); g.pipeline.render(1 / 60); g.emitTelemetry(999);
    return g.markerLocked && document.activeElement === g.canvas;
  }), "Space should lock after clicking Start, not reactivate the button");
  await page.screenshot({ path: "/private/tmp/cricket-bowling-locked.png" });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 2600 && g.phase !== "idle"; i++) g.update(1 / 60);
  });
  await page.evaluate(() => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    window.__bowlPlayer = ({ move = null, moveFrames = 28, pace = null, manualLock = false, spamBat = false, stopAtImpact = false } = {}) => {
      const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code }));
      const before = structuredClone(g.match);
      const selected = g.playerBowler;
      if (g.bowlerChangePending) g.confirmBowlerChange();
      else g.bowl();
      let locked = null;
      let stable = true;
      let error = null;
      let markerSeen = false;
      let struck = false;
      let decision = null;
      let releaseSpeed = null;
      let wicketCut = false;
      let consumedFrames = 0;
      if (move) key(move, true);
      if (pace) key(pace, true);
      for (let frame = 0; frame < 2600; frame++) {
        consumedFrames++;
        if (frame === moveFrames) {
          if (move) key(move, false);
          if (pace) key(pace, false);
          if (manualLock) key("Space", true);
        }
        if (frame === moveFrames + 1) key("Space", false);
        if (spamBat && frame % 10 === 0) key("KeyC", true);
        g.update(1 / 60);
        if (spamBat) key("KeyC", false);
        markerSeen ||= g.marker.visible;
        if (g.markerLocked && !locked) {
          locked = { aim: structuredClone(g.bowlingAim), marker: g.marker.position.clone(), plan: structuredClone(g.plan) };
          // Mid-delivery UI changes must not swap actions or change pace after lock.
          g.selectPlayerBowler((selected + 1) % 4);
          g.setPlayerPace(0);
        }
        if (locked && !g.resetDone) {
          stable &&= JSON.stringify(locked.aim) === JSON.stringify(g.bowlingAim) && selected === g.playerBowler;
          if (g.marker.visible) stable &&= locked.marker.distanceTo(g.marker.position) < 1e-6;
        }
        if (g.phase === "flight" && releaseSpeed === null) releaseSpeed = Math.hypot(g.world.ball.velocity.x, g.world.ball.velocity.y, g.world.ball.velocity.z) * 3.6;
        if (locked && g.world.lastBounce && error === null) error = Math.hypot(locked.marker.x - g.world.lastBounce.position.x, locked.marker.z - g.world.lastBounce.position.z);
        decision ||= g.aiDecision ? structuredClone(g.aiDecision) : null;
        struck ||= g.struck;
        wicketCut ||= g.live.momentShot === "bowler-wicket";
        if (stopAtImpact && g.live.moment?.kind === "wicket") break;
        if (g.phase === "idle") break;
      }
      if (move) key(move, false);
      if (pace) key(pace, false);
      key("Space", false); key("KeyC", false);
      return { markerSeen, stable, error, locked: locked?.aim, releaseSpeed, struck, decision, wicketCut, impact: g.live.moment?.kind === "wicket",
        idle: g.phase === "idle", consumedFrames, event: g.lastEvent, before, after: structuredClone(g.match) };
    };
  });
  const bowling = await page.evaluate(() => {
    const g = window.__game;
    const saved = JSON.stringify(g.progress);
    const reports = [];
    for (let bowler = 0; bowler < 4; bowler++) {
      g.startBowling(); g.selectPlayerBowler(bowler);
      reports.push(window.__bowlPlayer({ move: "ArrowUp", pace: "KeyQ", manualLock: true }));
      reports.push(window.__bowlPlayer({ move: "ArrowDown", pace: "KeyE", spamBat: true }));
    }
    const unchanged = JSON.stringify(g.progress) === saved;
    g.emitTelemetry(999);
    return { reports, unchanged };
  });
  console.log("Player bowling:", bowling.reports.map((r) => `${r.releaseSpeed?.toFixed(0)}kph ${r.decision?.shot || "leave"}: ${r.event}`).join("; "));
  assert.ok(bowling.unchanged, "bowling must not unlock batting levels");
  assert.ok(bowling.reports.every((r) => r.idle && r.markerSeen && r.stable && r.error !== null && r.error < 0.15), "every specialist must lock, hit the marker and finish the delivery");
  assert.ok(bowling.reports.some((r) => r.struck), "AI must make real physical bat contact");
  assert.ok(bowling.reports.every((r) => r.decision), "AI must choose its own stroke");
  const wide = await page.evaluate(() => {
    const g = window.__game;
    g.startBowling(); g.selectPlayerBowler(0);
    return window.__bowlPlayer({ move: "ArrowRight", moveFrames: 130, manualLock: true });
  });
  assert.equal(wide.after.extras, 1, "an unreachable untouched ball must cost a wide");
  assert.equal(wide.after.ballsThisOver, 0);
  assert.equal(wide.after.batsmen[0].ballsFaced, 0);
  const overBreak = await page.evaluate(() => {
    const g = window.__game;
    for (let attempt = 0; attempt < 8; attempt++) {
      g.startBowling(); g.selectPlayerBowler(2);
      for (let ball = 0; ball < 6 && !g.match.complete; ball++) window.__bowlPlayer();
      if (g.bowlerChangePending) {
        g.pipeline.render(1 / 60); g.emitTelemetry(999);
        return { score: JSON.stringify(g.match), overs: g.match.overs, balls: g.match.ballsThisOver };
      }
    }
    return null;
  });
  assert.ok(overBreak && overBreak.overs === 1 && overBreak.balls === 0);
  await page.getByRole("heading", { name: "Over complete — choose your bowler" }).waitFor();
  await page.keyboard.press("r");
  assert.ok(await page.evaluate((snapshot) => {
    const g = window.__game;
    g.update(1 / 60);
    return g.phase === "idle" && g.bowlerChangePending && JSON.stringify(g.match) === snapshot;
  }, overBreak.score), "R must not bypass the over-break picker");
  await page.getByLabel("YOUR BOWLER").selectOption("0");
  await page.screenshot({ path: "/private/tmp/cricket-bowler-change.png" });
  await page.getByRole("button", { name: "Start next over", exact: true }).click();
  assert.ok(await page.evaluate((snapshot) => {
    const g = window.__game;
    const valid = g.phase === "runup" && !g.bowlerChangePending && g.playerBowler === 0 && g.style === "fast" && JSON.stringify(g.match) === snapshot;
    for (let i = 0; i < 2600 && g.phase !== "idle"; i++) g.update(1 / 60);
    return valid;
  }, overBreak.score), "confirmation must start the new bowler without resetting the innings");
  const spell = await page.evaluate(() => {
    const g = window.__game;
    g.startBowling();
    g.selectPlayerBowler(0);
    const reports = [];
    for (let ball = 0; ball < 20 && !g.match.complete; ball++) reports.push(window.__bowlPlayer());
    const snapshot = JSON.stringify(g.match);
    g.bowl();
    g.emitTelemetry(999);
    return { reports, complete: g.match.complete, blocked: g.phase === "idle" && snapshot === JSON.stringify(g.match), match: g.match };
  });
  console.log("Bowling spell:", spell.reports.map((r) => r.event).join(", "));
  assert.ok(spell.complete && spell.blocked, "bowling challenge must finish and block further deliveries");
  await page.getByRole("button", { name: "Bowl again", exact: true }).waitFor();
  await page.screenshot({ path: "/private/tmp/cricket-bowling-result.png" });
  await page.getByRole("button", { name: "Bowl again", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__game.match.runs), 0);
  const loss = await page.evaluate(() => {
    const g = window.__game;
    for (let attempt = 0; attempt < 8; attempt++) {
      g.startBowling(); g.selectPlayerBowler(2);
      for (let ball = 0; ball < 14 && !g.match.complete; ball++) window.__bowlPlayer({ move: ball === 0 ? "ArrowUp" : null });
      if (g.match.runs >= 24) { g.emitTelemetry(999); return true; }
    }
    return false;
  });
  assert.ok(loss, "loose bowling must also be chaseable by the AI");
  await page.getByRole("heading", { name: "Target chased down" }).waitFor();
  // Find a physical wicket; never inject a dismissal to make the cinematic pass.
  const playerWicket = await page.evaluate(() => {
    const g = window.__game;
    for (let attempt = 0; attempt < 40; attempt++) {
      g.startBowling(); g.selectPlayerBowler(attempt % 2);
      const result = window.__bowlPlayer({ move: "ArrowUp", stopAtImpact: true });
      if (result.impact) {
        const camera = g.camera.position.clone();
        const look = g.cameraLook.clone();
        const stumps = JSON.stringify(g.world.stumpTransforms());
        const liveImmediately = g.live.momentShot === null && !g.reactions.group.visible && g.bowler.rig.root.visible;
        for (let i = 0; i < 30; i++) g.update(1 / 60);
        g.pipeline.render(1 / 60); g.emitTelemetry(999);
        return { cut: g.live.momentShot, liveImmediately, name: g.live.moment.bowlerName,
          cameraHeld: camera.equals(g.camera.position) && look.equals(g.cameraLook),
          physicsContinued: stumps !== JSON.stringify(g.world.stumpTransforms()),
          visible: g.batsmen.every((b) => b.rig.root.visible) && g.ballMesh.visible };
      }
    }
    return null;
  });
  assert.ok(playerWicket && playerWicket.cut === null && playerWicket.liveImmediately && playerWicket.cameraHeld && playerWicket.visible && playerWicket.physicsContinued, "show the actual wicket falling before cutting away");
  await page.getByTestId("wicket-presentation").waitFor({ state: "hidden" });
  await page.screenshot({ path: "/private/tmp/cricket-wicket-impact.png" });
  assert.equal(await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 90 && g.live.celebrationTime < 1.5; i++) g.update(1 / 60);
    g.pipeline.render(1 / 60); g.emitTelemetry(999);
    return g.live.momentShot;
  }), "bowler-wicket", "celebrate after the one-second dismissal hold");
  await page.getByTestId("wicket-presentation").waitFor({ state: "visible" });
  await page.screenshot({ path: "/private/tmp/cricket-bowling-wicket.png" });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 600 && g.phase !== "idle"; i++) g.update(1 / 60);
    g.showLevelSelect();
  });
  await page.getByRole("heading", { name: "Chase it down" }).waitFor();
  await page.getByRole("button", { name: /01Find the gaps/ }).click();
  assert.equal(await page.evaluate(() => window.__game.live.mode), "batting");
  assert.deepEqual(errors, []);
  console.log("PASS: batting ladder, player bowling, AI shots, pace/aim locks, markers, challenge results, celebrations and mode switching");
} catch (error) {
  console.log("Page errors:", errors);
  await page.screenshot({ path: "/private/tmp/cricket-failure.png" });
  console.log((await page.locator("body").innerText()).slice(0, 2000));
  throw error;
} finally {
  await browser.close();
}
