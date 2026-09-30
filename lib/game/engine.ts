/**
 * The game engine.
 *
 * A plain class that owns a WebGLRenderer bound to a canvas. React mounts it
 * and reads telemetry; it never owns game state itself. This is the same split
 * the sibling city engine uses, and the reason for it is in `LiveState` below.
 *
 * The delivery is a small state machine:
 *
 *   idle -> runup -> flight -> resolved (struck, in play) -> settling -> idle
 *
 * and every contact in it is physical. The ball sits in the bowler's hand
 * through the run-up and leaves from that hand on the release frame. A shot is
 * built at the press from where the ball WILL be, the bat's middle is driven
 * to that point, and the ball is struck on the frame the bat gets there. A
 * fielder runs to cut the ball off, stoops, gathers it into his hand and
 * throws it — aimed through the same drag the world applies — into the
 * keeper's gloves. Nothing teleports and nothing is decided off-screen.
 */

import * as THREE from "three";
import {
  BALL_RADIUS,
  BOUNDARY_STRAIGHT,
  CREASE_Z,
  PLAYER_HEIGHT,
  POPPING_CREASE_OFFSET,
  STRIKER_STUMPS_Z,
  STUMP_DIAMETER,
  STUMP_HEIGHT,
  boundaryDistanceAlong,
  isBeyondBoundary,
  type Handedness,
} from "./dimensions";
import { createMaterialLibrary, type MaterialLibrary } from "./materials";
import { mulberry32 } from "./mat/noise";
import { buildGround } from "./assets/ground";
import { buildStadium } from "./assets/stadium";
import { makeBall, makeStumps } from "./assets/equipment";
import { BATTING_KIT, FIELDING_KIT, RIG_SCALE, makePlayer, type PlayerRig } from "./assets/kit";
import { createRenderPipeline, type RenderPipeline } from "./render";
import { createCelifier } from "./fx/toon";
import { DAY_MATCH_PRESET } from "./fx/presets";
import { CricketWorld, initPhysics } from "./physics/world";
import { predictPath, pathAt, solveThrow, type PathPoint } from "./physics/predict";
import { v3 } from "./physics/vec3";
import { classifyLength, type Length } from "./physics/pitch";
import { buildDelivery, previewBounce, type BowlerStyle, type DeliveryPlan } from "./match/bowling";
import { effectiveFootwork, resolveShot, type ShotOutcome, type TimingBand } from "./match/shot";
import { predictBounce, predictContact, lengthForStance, type ContactPrediction } from "./match/contact";
import { CHALLENGES, challengeDelivery, challengeStatus, freshProgress, loadProgress, recordWin, PROGRESS_KEY, type Progress } from "./match/challenges";
import { moveAtCrease } from "./input/movement";
import { RUN_TIME, fieldFor, runsAvailable, type FieldPosition } from "./match/fielding";
import { applyBall, newInnings, toOutcome, type Dismissal, type MatchState } from "./match/state";
import { BattingController } from "./input/controller";
import type { Footwork, ShotType } from "./input/bindings";
import { C, applyPose, copyPose, makePose, sweetSpot } from "./anim/pose";
import { APPROACH, BowlerAnimator, deliveryOrigin, simulateRelease } from "./anim/bowler";
import { BatsmanAnimator, CONTACT_X } from "./anim/batsman";
import { FielderAnimator, JOG, SPRINT, faceYaw } from "./anim/fielder";
import { RunnerAnimator } from "./anim/runner";
import { umpireSignalPose } from "./anim/umpire";
import { BOUNDARY_CUT_TIME, BOUNDARY_HOLD_TIME, UMPIRE_SIGNAL_START, type BoundaryRuns } from "./presentation/boundary";
import { dismissedBatsman, momentShot, nextReaction, reactionTime, WICKET_HOLD_TIME, type MatchMoment, type MomentShot } from "./presentation/moments";
import { ReactionScene } from "./presentation/reactions";
import { BOWLERS, DEFAULT_BOWLING_AIM, bowlingStatus, isBowlingWide, lockPlayerDelivery, moveBowlingAim, playerDelivery, shouldChangeBowler, type BowlingAim } from "./match/player-bowling";
import { decideAiShot, type AiDecision } from "./match/ai-batsman";
import { NEUTRAL_INTENT } from "./input/bindings";

export type Phase = "idle" | "runup" | "flight" | "resolved" | "settling";
export type GameMode = "batting" | "bowling";

/**
 * Values the HUD reads every frame.
 *
 * Mutated in place, never reallocated, and deliberately NOT React state.
 * Pushing these through setState on every frame re-renders the whole HUD tree
 * 60 times a second from inside the rAF callback, which costs more than the
 * scene does.
 */
export interface LiveState {
  mode: GameMode;
  bowling: { aim: BowlingAim; locked: boolean; runup: number; aiDecision: string };
  radarForwardX: number;
  radarForwardZ: number;
  boundaryRuns: BoundaryRuns | null;
  celebrationTime: number;
  moment: MatchMoment | null;
  momentShot: MomentShot | null;
  /** Seconds from the ideal press; negative is early, null means no contact ahead. */
  timingError: number | null;
  shotFeedback: string;
  footwork: Footwork;
  phase: Phase;
  ballX: number;
  ballY: number;
  ballZ: number;
  ballSpeed: number;
  /** 0..1 progress of the delivery from release to reaching the striker. */
  approach: number;
  /** Set once the ball has pitched. */
  pitchedLength: Length | null;
  lastBand: TimingBand | null;
  fielders: { x: number; z: number }[];
  /** 0 clear .. 1 black: the cut between deliveries. */
  fade: number;
}

/** Slow-changing data pushed to React, at this rate rather than per frame. */
const TELEMETRY_HZ = 10;

export interface Telemetry {
  mode: GameMode;
  bowling: ReturnType<typeof bowlingStatus> & { bowler: number; changePending: boolean };
  challenge: ReturnType<typeof challengeStatus> & { level: number; screen: "select" | "ready" | "playing"; progress: Progress };
  match: MatchState;
  phase: Phase;
  lastEvent: string;
  bowlerStyle: BowlerStyle;
  fieldNames: string[];
}

export type CameraMode = "batting" | "tv";

/**
 * BATTING view — third person, over the striker's shoulder.
 *
 * This is the default because it is the one you can actually play off. The
 * striker fills a useful share of the frame so his footwork is readable, the
 * ball comes toward the camera so its line and length are judgeable, and
 * left/right on screen maps directly to the batsman's off and leg sides
 * instead of being mirrored.
 */
const CAMERA_BATTING = new THREE.Vector3(-1.15, 3.15, STRIKER_STUMPS_Z - 7.6);
// Looked at almost the same X as the camera sits at, so the pitch runs UP the
// frame instead of cutting across it diagonally.
const CAMERA_BATTING_LOOK = new THREE.Vector3(-0.55, 1.45, STRIKER_STUMPS_Z + 11);

/**
 * TV view — behind the bowler's arm, the broadcast framing: far back up the
 * ground on a long lens. The distance is what flattens the pitch the way a
 * broadcast does, and it keeps the non-striker and the bowler's stride IN
 * the frame instead of filling it — a camera a few metres behind the stumps
 * is looking through the back of both of them.
 */
const CAMERA_BROADCAST = new THREE.Vector3(1.2, 9.5, CREASE_Z + 42);
const CAMERA_LOOK = new THREE.Vector3(0, 0.9, STRIKER_STUMPS_Z + 3.5);
const CAMERA_TV_FOV = 11;

const CAMERA_FOV = 34;

/* ------------------------------------------------------------------ *
 * Where people stand
 * ------------------------------------------------------------------ */

/**
 * The striker's root: leg side of middle stump (the bat is grounded in front
 * of middle), bat toe a foot behind the popping crease.
 */
const STRIKER_ROOT = new THREE.Vector3(0.35, 0, STRIKER_STUMPS_Z + 0.95);
/** Rig yaw that stands a right-hander side-on, facing the off side. */
const STRIKER_YAW = Math.PI / 2;

/** Run lines, either side of the strip, so the batsmen never meet or run on it. */
const NON_STRIKER_LANE = 1.2;
const STRIKER_LANE = -1.0;

/** Right-arm over: the bowler runs in just to the off side of the stumps. */
const BOWLER_LINE_X = -0.45;
/** The bowler's front foot lands this far behind the popping crease. */
const FRONT_FOOT_Z = CREASE_Z - POPPING_CREASE_OFFSET + 0.2;

const UMPIRE_AT = new THREE.Vector3(0.7, 0, CREASE_Z + 2.2);
const UMPIRE_SIGNAL_CAMERA = UMPIRE_AT.clone().add(new THREE.Vector3(-4.5, 2.2, -2.2));
const UMPIRE_SIGNAL_YAW = faceYaw(-4.5, -2.2);

/** The keeper takes throws standing up to the stumps, gloves over the bails. */
const KEEPER_AT_STUMPS = new THREE.Vector3(0, 0, STRIKER_STUMPS_Z - 0.75);
const THROW_TARGET = new THREE.Vector3(0, 1.0, STRIKER_STUMPS_Z - 0.35);

const STUMPS_LOOK = new THREE.Vector3(0, 0.7, STRIKER_STUMPS_Z);

/** A fielder's hands reach this far round his body for a catch or a stop. */
const REACH = 0.9;
/** Time to react to the ball coming off the bat. */
const REACTION = 0.28;

/**
 * Seconds for a fielder to cover `d` metres from a standing start at sprint
 * limits (uniform acceleration to top speed, then cruising), with a little
 * allowance for braking into the take.
 */
function runTime(d: number): number {
  if (d <= 0) return 0;
  const { vMax, accel } = SPRINT;
  const dAccel = (vMax * vMax) / (2 * accel);
  const t = d < dAccel ? Math.sqrt((2 * d) / accel) : vMax / accel + (d - dAccel) / vMax;
  return t + 0.25;
}

/** Shortest distance from point p to the segment a-b. */
function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = _s1.subVectors(b, a);
  const len2 = ab.lengthSq();
  const u = len2 > 0 ? THREE.MathUtils.clamp(_s2.subVectors(p, a).dot(ab) / len2, 0, 1) : 0;
  return _s2.copy(a).addScaledVector(ab, u).distanceTo(p);
}
const _s1 = new THREE.Vector3();
const _s2 = new THREE.Vector3();

/** One of the two batsmen: a striker's controller and a runner's, one rig. */
interface BatEntity {
  rig: PlayerRig;
  bat: BatsmanAnimator;
  run: RunnerAnimator;
  mode: "bat" | "run";
  /** Index into match.batsmen of whoever this rig currently is. */
  index: number;
}

/** Who has the ball in his hand, if anyone. */
type Holder =
  | { kind: "bowler" }
  | { kind: "fielder"; index: number }
  | null;

/** A shot waiting for the bat to reach the ball. */
interface PendingShot {
  outcome: ShotOutcome;
  type: ShotType;
  /** Where the predictor says the ball will be at contact, world space. */
  at: THREE.Vector3;
}

/** A catch being run for. */
interface CatchPlan {
  fielder: number;
  /** Seconds after contact that the ball comes down to him. */
  t: number;
  point: THREE.Vector3;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private lib!: MaterialLibrary;
  private world!: CricketWorld;
  private input: BattingController;
  private pipeline: RenderPipeline | null = null;

  private ballMesh!: THREE.Group;
  private stumpMeshes: THREE.Mesh[] = [];

  private bowler!: BowlerAnimator;
  private previewRig!: PlayerRig;
  private marker!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerPoint: THREE.Vector3 | null = null;
  private markerLocked = false;
  private markerFade = 0;
  private previewRelease = new Map<BowlerStyle, THREE.Vector3>();
  private bounceZ: number | null = null;
  private strikerRoot = STRIKER_ROOT.clone();
  private shuffleTime = 0;
  private shuffleAmount = 0;
  private shufflePose = makePose();
  private level = 0;
  private screen: "select" | "ready" | "playing" = "select";
  private progress: Progress = freshProgress();
  private batsmen: BatEntity[] = [];
  private fielders: FielderAnimator[] = [];
  private umpire!: FielderAnimator;
  private umpirePose = makePose();
  private boundaryCameraActive = false;
  private reactions!: ReactionScene;
  private reactionCameraShot: MomentShot | null = null;
  private cosmeticRand = mulberry32(7062026);
  private previousBowlerReaction = -1;
  private previousBatterReaction = -1;
  private keeperIndex = 0;
  private field: FieldPosition[] = [];

  private rand = mulberry32(20070607);
  private mode: GameMode = "batting";
  private playerBowler = 0;
  private bowlerChangePending = false;
  private bowlingAim = { ...DEFAULT_BOWLING_AIM };
  private aiRand = mulberry32(20071001);
  private aiDecision: AiDecision | null = null;
  private previousAiSpeed: number | null = null;
  private deliveryWide = false;
  private hand: Handedness = "right";
  private style: BowlerStyle = "medium";

  private phase: Phase = "idle";
  private phaseTime = 0;
  private lastEvent = "Press R to bowl";
  private match: MatchState;
  private telemetryTimer = 0;
  private onTelemetry?: (t: Telemetry) => void;

  /* Per-delivery state. */
  private plan: DeliveryPlan | null = null;
  private holder: Holder = { kind: "bowler" };
  private triggered = false;
  private shotPlayed = false;
  private left = false;
  private pending: PendingShot | null = null;
  private struck = false;
  private contactClock = 0;
  private outcome: ShotOutcome | null = null;
  private catchPlan: CatchPlan | null = null;
  private caught = false;
  private chaser = -1;
  private replanTimer = 0;
  private thrown = false;
  private boundary: { six: boolean } | null = null;
  private bouncedSinceShot = false;
  private bouncesAtContact = 0;
  private runsDecided = false;
  private keeperTaking = false;
  private dead: { dismissal: Dismissal | null; offTheBat: boolean } | null = null;
  private deadTimer = 0;
  private fadeTimer = 0;
  private resetDone = false;
  private prevBall = new THREE.Vector3();
  private settleTimer = 0;

  readonly live: LiveState = {
    mode: "batting",
    bowling: { aim: { ...DEFAULT_BOWLING_AIM }, locked: false, runup: 0, aiDecision: "" },
    radarForwardX: 0,
    radarForwardZ: 1,
    boundaryRuns: null,
    celebrationTime: 0,
    moment: null,
    momentShot: null,
    timingError: null,
    shotFeedback: "",
    footwork: "front",
    phase: "idle",
    ballX: 0,
    ballY: 0,
    ballZ: 0,
    ballSpeed: 0,
    approach: 0,
    pitchedLength: null,
    lastBand: null,
    fielders: [],
    fade: 0,
  };

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { onTelemetry?: (t: Telemetry) => void } = {}
  ) {
    this.onTelemetry = opts.onTelemetry;
    try { this.progress = loadProgress(window.localStorage); } catch { /* Storage may be disabled. */ }
    this.match = newInnings(["Sharma", "Patel", "Khan", "Mitchell", "Okafor", "Silva", "Brennan"]);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    // The pipeline owns pixel ratio, tone mapping and anti-aliasing: the scene
    // is drawn linear into a float target and graded in one pass.
    this.renderer.shadowMap.enabled = true;

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 600);
    this.camera.position.copy(CAMERA_BATTING);
    this.camera.lookAt(CAMERA_BATTING_LOOK);

    this.input = new BattingController();
    window.addEventListener("resize", this.onResize);
  }

  /** Async because Rapier is WASM and must load before a world exists. */
  async start(): Promise<void> {
    await initPhysics();
    if (this.disposed) return;

    this.lib = createMaterialLibrary(this.renderer);
    this.world = new CricketWorld();

    this.buildScene();
    this.resetPositions();
    this.onResize();
    this.clock.start();
    this.loop();
  }

  /* ---------------------------------------------------------------- *
   * Scene
   * ---------------------------------------------------------------- */

  private buildScene(): void {
    this.scene.background = this.makeSky();

    const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
    sun.position.set(40, 70, 30);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd8f5, 0x4a5a34, 0.85));

    this.scene.add(buildGround(this.lib).group);
    this.scene.add(buildStadium(this.lib).group);

    // Stumps: SIX individual meshes, one per physics body, in the same order
    // the world creates them (striker's end first), so each can be knocked
    // over for real.
    const stumpGeo = new THREE.CylinderGeometry(STUMP_DIAMETER / 2, STUMP_DIAMETER / 2, STUMP_HEIGHT, 10);
    const stumpMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(stumpGeo, stumpMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.stumpMeshes.push(m);
      this.scene.add(m);
    }
    // Bails sit on top and are decorative.
    for (const end of [-1, 1]) {
      const bails = makeStumps();
      bails.getObjectByName("stump-set")!.visible = false;
      bails.position.z = end * CREASE_Z;
      this.scene.add(bails);
    }

    this.ballMesh = makeBall();
    this.scene.add(this.ballMesh);

    for (let i = 0; i < 2; i++) {
      const rig = makePlayer({ role: "batsman", colours: BATTING_KIT });
      this.scene.add(rig.root);
      this.batsmen.push({
        rig,
        bat: new BatsmanAnimator(),
        run: new RunnerAnimator(rig, 11 + i),
        mode: "bat",
        index: i,
      });
    }

    const bowlerRig = makePlayer({ role: "bowler", colours: FIELDING_KIT });
    this.scene.add(bowlerRig.root);
    this.bowler = new BowlerAnimator(bowlerRig);
    this.bowler.onRelease = (hand) => this.release(hand);
    // Preview choreography must never disturb the visible bowler's pose.
    this.previewRig = makePlayer({ role: "bowler", colours: FIELDING_KIT });

    const umpireRig = makePlayer({ role: "umpire" });
    this.scene.add(umpireRig.root);
    this.umpire = new FielderAnimator(umpireRig, false, 7);

    this.field = fieldFor(this.hand);
    this.field.forEach((f, i) => {
      const rig = makePlayer({ role: f.keeper ? "keeper" : "fielder", colours: FIELDING_KIT });
      this.scene.add(rig.root);
      this.fielders.push(new FielderAnimator(rig, !!f.keeper, 21 + i));
      if (f.keeper) this.keeperIndex = i;
    });
    this.live.fielders = this.field.map((f) => ({ x: f.x, z: f.z }));
    this.reactions = new ReactionScene();
    this.scene.add(this.reactions.group);

    /*
     * Cel look. Everything above was authored with ordinary PBR materials;
     * celify converts the finished scene to banded toon materials in one pass,
     * then the pipeline draws it through the ink / haze / grade pass.
     */
    const cel = createCelifier({ shadowTint: new THREE.Color(DAY_MATCH_PRESET.celShadowTint) });
    cel.apply(this.scene);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 48), new THREE.MeshBasicMaterial({
      color: 0x7de8ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.pipeline = createRenderPipeline(this.renderer, this.scene, this.camera, sun);
  }

  /** Sky as a vertical gradient. */
  private makeSky(): THREE.Texture {
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 512;
    const ctx = cv.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#3f7fc4");
    grad.addColorStop(0.55, "#9cc4e4");
    grad.addColorStop(1, "#dbe6ee");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  /**
   * Everyone back to their places for the next ball: striker at the crease
   * (whoever the scorebook says is on strike), non-striker backing-up
   * position, bowler at his mark with the ball, fielders home.
   */
  private resetPositions(): void {
    this.live.moment = null;
    this.live.momentShot = null;
    this.reactionCameraShot = null;
    this.live.boundaryRuns = null;
    this.live.celebrationTime = 0;
    this.boundaryCameraActive = false;
    this.strikerRoot.copy(STRIKER_ROOT);
    this.shuffleAmount = 0;
    this.markerPoint = null;
    this.markerLocked = false;
    this.markerFade = 0;
    this.bounceZ = null;
    this.live.timingError = null;
    this.aiDecision = null;
    this.deliveryWide = false;
    this.live.bowling = { aim: { ...this.bowlingAim }, locked: false, runup: 0, aiDecision: "" };
    this.input.consumeBowling();
    const striker = this.entityFor(this.match.striker, this.match.nonStriker);
    const other = this.batsmen.find((b) => b !== striker)!;
    other.index = this.match.nonStriker;
    striker.index = this.match.striker;

    striker.bat = new BatsmanAnimator();
    striker.mode = "bat";
    striker.run = new RunnerAnimator(striker.rig, 11);
    other.bat = new BatsmanAnimator();
    other.run = new RunnerAnimator(other.rig, 12);
    other.mode = "run";
    other.run.placeAt(1, NON_STRIKER_LANE);

    const approach = APPROACH[this.style];
    this.bowler.setup(approach, deliveryOrigin(approach, FRONT_FOOT_Z), BOWLER_LINE_X, STUMPS_LOOK);

    this.umpire.place(UMPIRE_AT, 0);
    this.field.forEach((f, i) => {
      const p = new THREE.Vector3(f.x, 0, f.z);
      const yaw = f.keeper ? Math.PI : faceYaw(-f.x, STRIKER_STUMPS_Z - f.z);
      this.fielders[i].place(p, yaw);
      this.fielders[i].lookAt(null);
    });

    this.world.deaden();
    this.world.hasPitched = false;
    this.world.lastBounce = null;
    this.world.resetStumps();
    this.holder = { kind: "bowler" };
    this.plan = null;
    this.triggered = false;
    this.shotPlayed = false;
    this.left = false;
    this.pending = null;
    this.struck = false;
    this.outcome = null;
    this.catchPlan = null;
    this.caught = false;
    this.chaser = -1;
    this.thrown = false;
    this.boundary = null;
    this.bouncedSinceShot = false;
    this.runsDecided = false;
    this.keeperTaking = false;
    this.dead = null;
    this.live.approach = 0;
    this.live.pitchedLength = null;

    // Pose everyone once so the first frame is not a T-pose.
    this.updatePlayers(0);
  }

  /** The rig that belongs to batsman `index`; a new batsman takes the free one. */
  private entityFor(index: number, partner: number): BatEntity {
    const own = this.batsmen.find((b) => b.index === index);
    if (own) return own;
    return this.batsmen.find((b) => b.index !== partner) ?? this.batsmen[0];
  }

  private get striker(): BatEntity {
    return this.batsmen.find((b) => b.index === this.match.striker)!;
  }

  private get nonStriker(): BatEntity {
    return this.batsmen.find((b) => b.index !== this.match.striker)!;
  }

  /* ---------------------------------------------------------------- *
   * Delivery flow
   * ---------------------------------------------------------------- */

  bowl(): void {
    const status = this.mode === "bowling" ? bowlingStatus(this.match) : challengeStatus(CHALLENGES[this.level], this.match);
    if (this.phase !== "idle" || this.screen === "select" || status.result !== "playing") return;
    if (this.mode === "bowling" && this.bowlerChangePending) return;
    // A clicked Start button must not retain Space and steal the delivery-lock key.
    this.canvas.focus({ preventScroll: true });
    this.input.consumeBowling();
    this.input.consume();
    this.screen = "playing";
    this.phase = "runup";
    this.phaseTime = 0;
    // The previous fade has finished; chase cameras belong to this new ball.
    this.resetDone = false;
    this.lastEvent = "";
    this.live.lastBand = null;
    this.live.shotFeedback = "";

    const plan = this.mode === "bowling" ? playerDelivery(BOWLERS[this.playerBowler], this.bowlingAim)
      : challengeDelivery(CHALLENGES[this.level], this.match.overs, this.rand);
    this.setBowlerStyle(plan.style);
    this.plan = plan;

    const approach = APPROACH[this.style];
    this.bowler.setup(approach, deliveryOrigin(approach, FRONT_FOOT_Z), BOWLER_LINE_X, STUMPS_LOOK);
    let hand = this.previewRelease.get(this.style);
    if (!hand) {
      hand = simulateRelease(this.previewRig, approach, deliveryOrigin(approach, FRONT_FOOT_Z), BOWLER_LINE_X, STUMPS_LOOK).hand;
      this.previewRelease.set(this.style, hand);
    }
    const release = buildDelivery({ ...plan, releaseX: hand.x, releaseHeight: hand.y, releaseZ: hand.z });
    const bounce = this.mode === "bowling" ? { x: this.bowlingAim.line, z: STRIKER_STUMPS_Z + this.bowlingAim.length }
      : previewBounce(release, this.world.pitch, this.world.outfield);
    this.markerPoint = bounce ? new THREE.Vector3(bounce.x, 0.04, bounce.z) : null;
    this.markerLocked = false;
    this.markerFade = 1;
    this.bounceZ = bounce?.z ?? null;

    this.bowler.startRunup();
    for (const f of this.fielders) f.walkIn();
  }

  /**
   * The ball leaves the bowler's hand. The delivery is aimed from exactly
   * where the hand is on this frame, so it comes out of the hand rather than
   * appearing from a point near it.
   */
  private release(hand: THREE.Vector3): void {
    if (!this.plan) return;
    if (this.mode === "bowling" && !this.markerLocked) this.lockBowlingAim();
    const d = buildDelivery({ ...this.plan, releaseX: hand.x, releaseHeight: hand.y, releaseZ: hand.z });
    this.world.release(d);
    // Read actual release for batting assistance; the already-locked marker stays fixed.
    this.bounceZ = predictBounce({ ...d, shine: 1 }, this.world)?.position.z ?? null;
    this.holder = null;
    this.phase = "flight";
    this.phaseTime = 0;
    this.striker.bat.pickUp(true);
    for (const f of this.fielders) f.set();
    this.planKeeperTake();
  }

  /** Freeze pace/target before the delivery stride and fit the real release to that spot. */
  private lockBowlingAim(): void {
    if (this.markerLocked || this.mode !== "bowling") return;
    const hand = this.previewRelease.get(this.style);
    if (!hand) return;
    const locked = lockPlayerDelivery(playerDelivery(BOWLERS[this.playerBowler], this.bowlingAim), hand, this.world.pitch, this.world.outfield);
    this.plan = locked.plan;
    this.markerPoint = locked.bounce ? new THREE.Vector3(locked.bounce.x, 0.04, locked.bounce.z) : null;
    this.bounceZ = locked.bounce?.z ?? null;
    this.markerLocked = true;
    this.live.bowling.locked = true;
  }

  /** The keeper shuffles across to where an unplayed ball will reach him. */
  private planKeeperTake(): void {
    const keeper = this.fielders[this.keeperIndex];
    const glovePlane = keeper.world.z + 0.55;
    let hit: PathPoint | null = null;
    predictPath(this.ballSnapshot(), { pitch: this.world.pitch, outfield: this.world.outfield, maxTime: 3 }, (p) => {
      if (p.position.z <= glovePlane) {
        hit = p;
        return true;
      }
      return false;
    });
    if (!hit) return;
    const h = hit as PathPoint;
    const dx = THREE.MathUtils.clamp(h.position.x - keeper.world.x, -2.5, 2.5);
    if (Math.abs(dx) > 0.25) {
      keeper.moveTo(new THREE.Vector3(keeper.world.x + dx, 0, keeper.world.z), JOG, "move", Math.PI);
    }
  }

  private ballSnapshot() {
    const b = this.world.ball;
    return {
      position: { ...b.position },
      velocity: { ...b.velocity },
      spin: { ...b.spin },
      seamAngle: b.seamAngle,
      shine: b.shine,
    };
  }

  /* ---------------------------------------------------------------- *
   * Loop
   * ---------------------------------------------------------------- */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    // Clamped so an alt-tabbed tab does not teleport everything on return.
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    if (this.pipeline) this.pipeline.render(dt);
    else this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number): void {
    this.phaseTime += dt;

    if (this.input.consumeRestart() && this.phase === "idle") this.bowl();
    if (this.input.consumeCameraToggle()) this.toggleCamera();

    const ball = this.world.ball;
    this.prevBall.set(ball.position.x, ball.position.y, ball.position.z);

    // The world first, so everything below reacts to where the ball is now.
    this.world.step(dt);

    switch (this.phase) {
      case "runup":
        this.updateRunup(dt);
        break;
      case "flight":
        this.updateFlight(dt);
        break;
      case "resolved":
        this.updateInPlay(dt);
        break;
      case "settling":
        this.updateSettling(dt);
        break;
      default:
        // Between deliveries a shot press does nothing; do not let it queue.
        this.input.consume();
        this.input.consumeBowling();
    }

    this.updatePlayers(dt);
    // The bat reaching the ball — checked straight after the batsman is posed
    // for this frame, so the frame drawn is the frame of contact.
    const bat = this.striker.bat;
    if (this.phase === "flight" && this.pending && bat.state === "shot" && bat.shotTime >= bat.contactT) {
      this.contact();
    }
    this.updatePossession();
    this.updateMarker(dt);
    this.syncVisuals();
    this.updateCamera(dt);
    this.emitTelemetry(dt);
  }

  private updateRunup(dt: number): void {
    // Footwork can be premeditated, but a shot press cannot be made before
    // the ball is out of the hand.
    const { intent } = this.input.consume();
    const bowling = this.input.consumeBowling();
    if (this.mode === "bowling" && !this.markerLocked) {
      this.bowlingAim = moveBowlingAim(this.bowlingAim, bowling.x, bowling.forward, bowling.pace, dt, this.aimScreenSign());
      this.live.bowling.aim = { ...this.bowlingAim };
      this.markerPoint?.set(this.bowlingAim.line, 0.04, STRIKER_STUMPS_Z + this.bowlingAim.length);
      this.bounceZ = STRIKER_STUMPS_Z + this.bowlingAim.length;
      if (bowling.lock || this.bowler.runupProgress >= 0.9) this.lockBowlingAim();
    }
    this.live.bowling.runup = this.bowler.runupProgress;
    const offset = this.mode === "bowling" ? { x: 0, z: 0 }
      : moveAtCrease({ x: this.strikerRoot.x - STRIKER_ROOT.x, z: this.strikerRoot.z - STRIKER_ROOT.z }, intent.moveX, intent.moveForward, dt, this.aimScreenSign());
    const oldX = this.strikerRoot.x;
    const oldZ = this.strikerRoot.z;
    this.strikerRoot.set(STRIKER_ROOT.x + offset.x, 0, STRIKER_ROOT.z + offset.z);
    this.shuffleAmount = Math.hypot(this.strikerRoot.x - oldX, this.strikerRoot.z - oldZ) > 1e-5 ? 1 : 0;
    const footwork = this.selectedFootwork(this.mode === "bowling" ? "none" : intent.footwork);
    this.striker.bat.setFootwork(footwork === "front" ? 1 : -1);

    if (!this.triggered && this.bowler.state === "delivery") {
      // The bowler has bounded into his stride: trigger movement, the
      // non-striker walks out, the field comes set.
      this.triggered = true;
      this.striker.bat.triggerMove(true);
      this.nonStriker.run.backUp();
    }
  }

  private updateFlight(dt: number): void {
    void dt;
    const ball = this.world.ball;
    const total = CREASE_Z - STRIKER_STUMPS_Z;
    this.live.approach = THREE.MathUtils.clamp((CREASE_Z - ball.position.z) / total, 0, 1);

    if (this.world.hasPitched && !this.live.pitchedLength && this.world.lastBounce) {
      this.live.pitchedLength = classifyLength(this.world.lastBounce.lengthFromStumps);
    }

    const { intent, shotAt } = this.input.consume();
    this.input.consumeBowling();
    if (this.mode === "bowling") this.updateAiBatsman();
    else if (!this.shotPlayed) {
      const footwork = this.selectedFootwork(intent.footwork);
      this.striker.bat.setFootwork(footwork === "front" ? 1 : -1);
      const prediction = this.contactPrediction(footwork);
      this.live.timingError = prediction?.timingError ?? null;
      if (intent.shot) this.playShot(intent.shot, { ...intent, footwork }, shotAt, prediction);
    }

    // No shot offered as the ball arrives: leave it, bat raised.
    if (!this.shotPlayed && !this.left) {
      const rootX = this.toStrikerRoot(_v1.set(ball.position.x, ball.position.y, ball.position.z)).x;
      const vz = Math.max(1, -ball.velocity.z);
      if (((CONTACT_X.none - rootX) * RIG_SCALE) / vz < 0.22) {
        this.left = true;
        this.striker.bat.leave();
      }
    }

    // Past the batsman untouched: bowled, or into the keeper's gloves.
    if (ball.position.z < STRIKER_STUMPS_Z - 0.3 && !this.struck) {
      if (this.mode === "bowling" && this.prevBall.z >= STRIKER_STUMPS_Z - 0.3) this.deliveryWide = isBowlingWide(ball.position.x, this.strikerRoot.x - STRIKER_ROOT.x);
      if (this.world.strikerStumpsBroken() && !this.dead) {
        this.endBall({ dismissal: "bowled", offTheBat: false }, "Bowled");
        return;
      }
      const keeper = this.fielders[this.keeperIndex];
      if (!this.keeperTaking && ball.position.z < keeper.world.z + 4) {
        this.keeperTaking = true;
        const take = pathAt(
          predictPath(this.ballSnapshot(), { pitch: this.world.pitch, outfield: this.world.outfield, maxTime: 1 }),
          Math.max(0, (ball.position.z - (keeper.world.z + 0.45)) / Math.max(1, -ball.velocity.z))
        );
        keeper.catchAt(new THREE.Vector3(take.x, take.y, take.z));
      }
      if (!this.holder && this.keeperTaking) {
        const gloves = keeper.glovesWorld(new THREE.Vector3());
        if (segmentDistance(gloves, this.prevBall, _v1.set(ball.position.x, ball.position.y, ball.position.z)) < 0.45) {
          this.holder = { kind: "fielder", index: this.keeperIndex };
          this.world.deaden();
          this.endBall({ dismissal: null, offTheBat: false }, undefined, 0.8);
          return;
        }
      }
      const stopped = Math.hypot(ball.velocity.x, ball.velocity.z) < 0.6;
      if (stopped || this.phaseTime > 5) this.endBall({ dismissal: null, offTheBat: false });
    }
  }

  /** Observe only after release, choose once, then press through the human batting path. */
  private updateAiBatsman(): void {
    if (this.shotPlayed || this.phaseTime < 0.08) return;
    if (!this.aiDecision) {
      const footwork = this.selectedFootwork("none");
      const prediction = this.contactPrediction(footwork);
      if (!prediction) return;
      const status = bowlingStatus(this.match);
      this.aiDecision = decideAiShot({
        length: lengthForStance(this.bounceZ, 0), line: prediction.hit.position.x,
        height: prediction.hit.position.y, speed: prediction.speed,
        runsNeeded: status.runsNeeded, ballsRemaining: status.ballsRemaining,
        batter: this.match.striker, previousSpeed: this.previousAiSpeed,
      }, this.aiRand);
      this.previousAiSpeed = prediction.speed;
      this.live.bowling.aiDecision = this.aiDecision.shot ? "Reading the delivery" : "Leaves it";
    }
    const decision = this.aiDecision;
    this.live.footwork = decision.footwork;
    this.striker.bat.setFootwork(decision.footwork === "front" ? 1 : -1);
    const prediction = this.contactPrediction(decision.footwork);
    this.live.timingError = prediction?.timingError ?? null;
    if (decision.shot && prediction && prediction.timingError >= decision.timingError) {
      // AI aims in field coordinates; the input adapter cancels the human camera mapping.
      this.playShot(decision.shot, { ...NEUTRAL_INTENT, footwork: decision.footwork,
        aim: decision.aim * this.aimScreenSign(), square: decision.square, shot: decision.shot }, performance.now(), prediction);
      this.live.bowling.aiDecision = `${decision.shot === "defensive" ? "Defends" : decision.shot === "lofted" ? "Goes aerial" : "Ground stroke"} · ${this.live.shotFeedback}`;
    }
  }

  /**
   * The shot press.
   *
   * Where the ball will be when it reaches the batsman's hitting zone (front
   * foot further forward, back foot deeper) is read off the predictor, which
   * integrates the same forces as the world. Timing is measured against the
   * press timestamp rather than the frame it was read on.
   */
  private playShot(type: ShotType, intent: ReturnType<BattingController["peek"]>, shotAt: number, prediction: ContactPrediction | null): void {
    this.shotPlayed = true;
    const pressAgo = Math.max(0, (performance.now() - shotAt) / 1000);
    const footwork = intent.footwork;
    const bat = this.striker.bat;

    if (!prediction) {
      // Already past the plane: far too late.
      this.live.lastBand = "missed";
      this.live.shotFeedback = "Too late";
      bat.leave();
      return;
    }
    const { hit, speed } = prediction;
    const tBall = hit.t;
    const timingError = prediction.timingError - pressAgo;
    const length = lengthForStance(this.bounceZ, this.strikerRoot.z - STRIKER_ROOT.z);

    const outcome = resolveShot(
      {
        length,
        lineAtCrease: hit.position.x - (this.strikerRoot.x - STRIKER_ROOT.x),
        heightAtCrease: Math.max(BALL_RADIUS, hit.position.y),
        speed,
        hand: this.hand,
      },
      { type, footwork, aim: intent.aim * this.aimScreenSign(), square: intent.square, timingError }
    );

    const contact = this.toStrikerRoot(new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z));
    // Out of reach: too wide or too high to get bat on. He still plays at it.
    // A static shoulder-radius test rejected low full balls even though the
    // batsman can bend and stride to them. Limit the playable envelope here;
    // the fitted bat-to-ball gap at contact remains the final reach check.
    const reachable = contact.y > 0 && contact.y < 1.9 && Math.abs(contact.z + 0.05) < 1.1;

    // The bat is timed to reach the ball's point when the ball does. A miss
    // on timing puts the bat there too early or too late instead.
    let downswing = tBall;
    if (outcome.missed) downswing = timingError < 0 ? Math.max(0.1, tBall - 0.2) : tBall + 0.12;
    downswing = Math.min(downswing, 0.6);

    bat.play({
      type,
      footwork,
      contact,
      exitDirection: outcome.missed ? 0 : outcome.exitDirection,
      downswing,
      look: contact.clone(),
    }, this.striker.rig);

    if (outcome.missed || !reachable) {
      if (!reachable) {
        console.warn("[shot] ball out of reach", {
          contact: contact.toArray().map((v) => +v.toFixed(3)),
        });
      }
      this.live.lastBand = "missed";
      this.live.shotFeedback = !reachable ? "Out of reach" : timingError < 0 ? "Too early" : "Too late";
      this.lastEvent = "Beaten";
      return;
    }
    this.live.lastBand = outcome.band;
    this.live.shotFeedback = outcome.band === "perfect" ? "Perfect" : outcome.band === "good" ? "Good" : timingError < 0 ? "Early" : "Late";
    this.pending = { outcome, type, at: new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z) };
  }

  /**
   * The frame the bat's middle arrives. The ball is seated on the bat and
   * sent off along the outcome — but only if the bat really is where the ball
   * is. If the two are apart, the ball simply carries on past.
   */
  private contact(): void {
    const pending = this.pending!;
    this.pending = null;
    const s = this.striker;
    const rig = s.rig;
    // Measure the bat at the exact contact instant, then put the frame's pose back.
    applyPose(rig, s.bat.contactPose(this.contactScratch));
    const batAt = sweetSpot(rig, new THREE.Vector3());
    rig.root.updateMatrixWorld(true);
    rig.root.localToWorld(batAt);
    applyPose(rig, s.bat.pose);
    const gap = batAt.distanceTo(pending.at);
    if (gap > 0.25) {
      // The IK could not get the bat's middle to the ball (too wide, too
      // high, too far forward). Logged so a miss that looks wrong can be traced.
      console.warn("[shot] bat missed the ball", {
        gap: +gap.toFixed(3),
        bat: batAt.toArray().map((v) => +v.toFixed(3)),
        ball: pending.at.toArray().map((v) => +v.toFixed(3)),
        shape: s.bat.shape,
        contactT: +s.bat.contactT.toFixed(3),
      });
      this.live.lastBand = "missed";
      this.live.shotFeedback = "Out of reach";
      this.lastEvent = "Beaten";
      return;
    }

    const o = pending.outcome;
    const horizontal = o.exitSpeed * Math.cos(o.exitElevation);
    // exitDirection 0 is straight back past the bowler (+Z); + is leg side (+X).
    this.world.placeBall({ x: batAt.x, y: Math.max(BALL_RADIUS, batAt.y), z: batAt.z });
    this.world.setBallVelocity(
      v3(horizontal * Math.sin(o.exitDirection), o.exitSpeed * Math.sin(o.exitElevation), horizontal * Math.cos(o.exitDirection)),
      v3()
    );
    this.struck = true;
    this.outcome = o;
    this.contactClock = 0;
    this.phase = "resolved";
    this.phaseTime = 0;
    this.bouncedSinceShot = false;
    this.planFielding(true);
    this.bouncesAtContact = this.world.bounceCount;
  }

  /* ---------------------------------------------------------------- *
   * The ball in play
   * ---------------------------------------------------------------- */

  /**
   * Who goes for it. First look for a catch — anyone who can get under the
   * ball before it lands — then for the fielder who can cut it off soonest
   * along its path. Re-run as the ball goes so a ball that beats one man is
   * picked up by the next.
   */
  private planFielding(first: boolean): void {
    this.replanTimer = 0;
    const path = predictPath(this.ballSnapshot(), {
      pitch: this.world.pitch,
      outfield: this.world.outfield,
      maxTime: 10,
    });
    const now = this.contactClock;

    if (first) {
      this.catchPlan = this.findCatch(path, now);
    }

    // Ground fielding: earliest point along the path someone can be at.
    let best = -1;
    let bestT = Infinity;
    let bestPoint = new THREE.Vector3();
    let beyond = Infinity;
    for (const p of path) {
      if (isBeyondBoundary(p.position.x, p.position.z)) {
        beyond = p.t;
        break;
      }
    }
    for (let i = 0; i < this.fielders.length; i++) {
      if (i === this.keeperIndex) continue;
      if (this.catchPlan && this.catchPlan.fielder === i) continue;
      const f = this.fielders[i];
      for (let k = 0; k < path.length; k += 4) {
        const p = path[k];
        if (p.t >= beyond || p.t >= bestT) break;
        if (p.position.y > 1.4) continue;
        const d = Math.hypot(p.position.x - f.world.x, p.position.z - f.world.z) - REACH;
        if (REACTION * (first ? 1 : 0) + runTime(d) <= p.t) {
          best = i;
          bestT = p.t;
          bestPoint = new THREE.Vector3(p.position.x, 0, p.position.z);
          break;
        }
      }
    }
    if (best < 0 && path.length > 0) {
      // Nobody can cut it off in flight: the nearest man goes to where it
      // ends up — the rope, or wherever it stops rolling.
      const cross = Number.isFinite(beyond) ? pathAt(path, beyond) : path[path.length - 1].position;
      let nearest = Infinity;
      this.fielders.forEach((f, i) => {
        if (i === this.keeperIndex) return;
        if (this.catchPlan && this.catchPlan.fielder === i) return;
        const d = Math.hypot(cross.x - f.world.x, cross.z - f.world.z);
        if (d < nearest) {
          nearest = d;
          best = i;
        }
      });
      bestPoint = new THREE.Vector3(cross.x, 0, cross.z);
      // When he gets there, for the batsmen's judgement of the run.
      bestT = Number.isFinite(beyond) ? beyond : REACTION + runTime(nearest - REACH);
    }

    if (best !== this.chaser && this.chaser >= 0 && !this.fielders[this.chaser].busy) {
      const old = this.fielders[this.chaser];
      old.moveTo(old.home, JOG, "move", old.homeYaw);
    }
    this.chaser = best;
    if (best >= 0 && !this.fielders[best].busy) {
      const f = this.fielders[best];
      const facing = faceYaw(this.world.ball.position.x - bestPoint.x, this.world.ball.position.z - bestPoint.z);
      f.moveTo(bestPoint, SPRINT, "move", facing);
    }

    if (this.catchPlan) {
      const f = this.fielders[this.catchPlan.fielder];
      const cp = this.catchPlan.point;
      f.moveTo(new THREE.Vector3(cp.x, 0, cp.z), SPRINT, "move", faceYaw(-cp.x, STRIKER_STUMPS_Z - cp.z));
    }

    if (first && !this.runsDecided) {
      this.runsDecided = true;
      this.decideRuns(bestT, bestPoint, Number.isFinite(beyond) && best >= 0 && bestT >= beyond);
    }
    void now;
  }

  /** The earliest point before the ball lands where a fielder can be under it. */
  private findCatch(path: PathPoint[], now: number): CatchPlan | null {
    const o = this.outcome;
    if (!o) return null;
    for (const p of path) {
      if (p.position.y <= BALL_RADIUS + 1e-4) return null; // landed first
      if (isBeyondBoundary(p.position.x, p.position.z)) return null;
      if (p.position.y < 0.25 || p.position.y > 2.4) continue;
      const t = now + p.t;
      for (let i = 0; i < this.fielders.length; i++) {
        const f = this.fielders[i];
        const d = Math.hypot(p.position.x - f.world.x, p.position.z - f.world.z) - REACH;
        const need = REACTION + runTime(d);
        if (need <= p.t) {
          // A straightforward take is almost always held; one he has to
          // stretch for is fifty-fifty, and a thick edge flies harder.
          const comfort = THREE.MathUtils.clamp((p.t - need) / 0.6, 0, 1);
          let chance = 0.5 + 0.45 * comfort;
          if (o.band === "edged") chance -= 0.1;
          if (this.rand() >= chance) return null;
          return { fielder: i, t, point: new THREE.Vector3(p.position.x, p.position.y, p.position.z) };
        }
      }
    }
    return null;
  }

  /**
   * The batsmen decide how many to run from how long the ball will take to
   * come back — the same judgement a real pair make off the bat.
   */
  private decideRuns(interceptT: number, at: THREE.Vector3, boundaryBound: boolean): void {
    let n = 0;
    if (this.catchPlan) {
      n = 0;
    } else if (boundaryBound) {
      n = 1;
    } else if (Number.isFinite(interceptT)) {
      const throwDist = at.distanceTo(THROW_TARGET);
      const back = interceptT + 0.7 + throwDist / 26;
      n = runsAvailable(back);
    }
    if (n > 0) {
      this.runsToRun = n;
      this.nonStriker.run.run(n);
    }
  }
  private runsToRun = 0;
  private contactScratch = makePose();

  private updateInPlay(dt: number): void {
    this.contactClock += dt;
    this.input.consume();
    this.input.consumeBowling();
    const ball = this.world.ball;
    const bp = _v1.set(ball.position.x, ball.position.y, ball.position.z);

    if (this.world.bounceCount > this.bouncesAtContact) this.bouncedSinceShot = true;

    // The striker sets off once his shot is through.
    const s = this.striker;
    if (this.runsToRun > 0 && s.mode === "bat" && s.bat.shotTime >= s.bat.contactT + 0.25) {
      s.rig.root.updateMatrixWorld(true);
      s.run.takeOver(s.rig.root.position, s.rig.root.rotation.y, STRIKER_LANE, s.bat.pose);
      s.mode = "run";
      s.run.run(this.runsToRun);
    } else if (s.mode === "bat" && s.bat.finished) {
      s.bat.reset();
    }

    // Over the rope.
    if (!this.boundary && !this.holder && isBeyondBoundary(ball.position.x, ball.position.z)) {
      this.boundary = { six: !this.bouncedSinceShot };
      this.lastEvent = this.boundary.six ? "SIX" : "FOUR";
      this.live.boundaryRuns = this.boundary.six ? 6 : 4;
      this.live.celebrationTime = 0;
      if (this.chaser >= 0) this.fielders[this.chaser].lookAt(bp);
      this.endBall({ dismissal: null, offTheBat: true }, undefined, BOUNDARY_HOLD_TIME);
      return;
    }

    // A catch: the ball into the hands of the man under it.
    if (this.catchPlan && !this.holder) {
      const cp = this.catchPlan;
      const f = this.fielders[cp.fielder];
      const toGo = cp.t - this.contactClock;
      if (toGo < 0.45 && f.state !== "catch") {
        const land = pathAt(predictPath(this.ballSnapshot(), { pitch: this.world.pitch, outfield: this.world.outfield, maxTime: toGo + 0.05 }), Math.max(0, toGo));
        if (Math.hypot(land.x - f.world.x, land.z - f.world.z) < REACH + 0.6) f.catchAt(new THREE.Vector3(land.x, land.y, land.z));
      }
      const hands = f.glovesWorld(new THREE.Vector3());
      if (segmentDistance(hands, this.prevBall, bp) < 0.45 && f.state === "catch") {
        this.holder = { kind: "fielder", index: cp.fielder };
        this.caught = true;
        this.catchPlan = null;
        this.endBall({ dismissal: "caught", offTheBat: true }, "OUT — caught", 1.4);
        return;
      }
      if (toGo < -0.15) {
        // Put down, or never got there: now it is just a ball to field.
        this.catchPlan = null;
        this.lastEvent = "Dropped";
        if (f.state === "catch") f.moveTo(f.world, JOG);
        this.planFielding(false);
      }
    }

    // Ground fielding.
    this.replanTimer += dt;
    if (!this.holder && !this.thrown && !this.catchPlan && this.replanTimer > 0.4 && this.chaser >= 0 && !this.fielders[this.chaser].busy) {
      this.planFielding(false);
    }
    if (!this.holder && !this.thrown && this.chaser >= 0) {
      const f = this.fielders[this.chaser];
      if (!f.busy && f.state !== "catch") {
        // Gather when the ball will be at his feet as his hand gets down.
        const ahead = pathAt(predictPath(this.ballSnapshot(), { pitch: this.world.pitch, outfield: this.world.outfield, maxTime: 0.3 }), 0.22);
        const d = Math.hypot(ahead.x - f.world.x, ahead.z - f.world.z);
        if (d < 1.0 && ahead.y < 0.6) {
          const idx = this.chaser;
          f.yaw = faceYaw(ahead.x - f.world.x, ahead.z - f.world.z);
          f.pickup(new THREE.Vector3(ahead.x, Math.max(BALL_RADIUS, ahead.y), ahead.z), () => {
            if (this.holder || this.dead) return;
            this.holder = { kind: "fielder", index: idx };
            this.world.deaden();
          });
        }
      }
    }

    // Holding it: throw it in once he is up.
    if (this.holder?.kind === "fielder" && !this.thrown && !this.caught) {
      const f = this.fielders[this.holder.index];
      if (!f.busy) this.throwIn(this.holder.index);
    }
    // The keeper comes up to the stumps for the return, unless he is the
    // man under a catch.
    if (!this.thrown && !(this.catchPlan && this.catchPlan.fielder === this.keeperIndex)) this.keeperToStumps();

    // The keeper taking the throw.
    if (this.thrown && !this.holder) {
      const keeper = this.fielders[this.keeperIndex];
      const gloves = keeper.glovesWorld(new THREE.Vector3());
      if (segmentDistance(gloves, this.prevBall, bp) < 0.5) {
        this.holder = { kind: "fielder", index: this.keeperIndex };
        this.world.deaden();
      } else if (Math.hypot(ball.velocity.x, ball.velocity.z) < 0.5 && ball.position.y < 0.2) {
        // A wild throw that got past him and stopped.
        this.endBall({ dismissal: null, offTheBat: true }, undefined, 0.8);
        return;
      }
    }

    // The ball is dead in the keeper's gloves once the batsmen are home.
    if (this.holder?.kind === "fielder" && this.holder.index === this.keeperIndex && this.thrown) {
      for (const b of this.batsmen) {
        if (b.mode === "run") b.run.lengthsLeft = Math.min(b.run.lengthsLeft, 1);
      }
      if (this.batsmen.every((b) => b.mode === "bat" || !b.run.running)) {
        this.endBall({ dismissal: null, offTheBat: true }, undefined, 0.8);
        return;
      }
    }

    if (this.contactClock > 16) this.endBall({ dismissal: null, offTheBat: true });
  }

  private keeperToStumps(): void {
    const keeper = this.fielders[this.keeperIndex];
    if (keeper.state === "stand" || keeper.state === "set") {
      if (keeper.world.distanceTo(KEEPER_AT_STUMPS) > 0.3) keeper.moveTo(KEEPER_AT_STUMPS, JOG, "move", Math.PI);
    }
  }

  /** Turn to the keeper and throw, aimed through drag into his gloves. */
  private throwIn(index: number): void {
    const f = this.fielders[index];
    const dist = f.world.distanceTo(THROW_TARGET);
    const power = THREE.MathUtils.clamp(dist / 55, 0.3, 1);
    this.thrown = true;
    f.throwAt(THROW_TARGET, power, () => {
      if (this.dead) return;
      // Aimed at the keeper's gloves where he actually is — he may still be
      // on his way up to the stumps — and he stops to take it.
      const keeper = this.fielders[this.keeperIndex];
      const target = new THREE.Vector3(keeper.world.x, THROW_TARGET.y, keeper.world.z + 0.4);
      const hand = f.handWorld(new THREE.Vector3());
      const T = THREE.MathUtils.clamp(hand.distanceTo(target) / 26, 0.35, 2.8);
      const v = solveThrow(v3(hand.x, hand.y, hand.z), v3(target.x, target.y, target.z), T, {
        pitch: this.world.pitch,
        outfield: this.world.outfield,
      });
      this.holder = null;
      this.world.release({ position: v3(hand.x, hand.y, hand.z), velocity: v, spin: v3(), seamAngle: 0 });
      keeper.catchAt(target);
    });
  }

  /**
   * The ball is dead. Hold the result/cutaways before scoring once at the
   * fade to black, then reset for the next delivery.
   */
  private endBall(dead: { dismissal: Dismissal | null; offTheBat: boolean }, event?: string, hold = 1.0): void {
    if (this.dead) return;
    this.dead = dead;
    this.deadTimer = hold;
    if (dead.dismissal || this.live.boundaryRuns !== null) {
      this.previousBowlerReaction = nextReaction(this.previousBowlerReaction, this.cosmeticRand);
      this.previousBatterReaction = nextReaction(this.previousBatterReaction, this.cosmeticRand);
      this.live.moment = {
        kind: dead.dismissal ? "wicket" : this.live.boundaryRuns === 6 ? "six" : "four",
        bowlerVariant: this.previousBowlerReaction,
        batterVariant: this.previousBatterReaction,
        dismissed: dead.dismissal ? dismissedBatsman(this.match, dead.dismissal) : null,
        bowlerName: this.mode === "bowling" ? BOWLERS[this.playerBowler].name : undefined,
      };
      this.live.celebrationTime = 0;
      if (dead.dismissal) this.deadTimer = WICKET_HOLD_TIME;
    }
    this.phase = "settling";
    this.phaseTime = 0;
    this.fadeTimer = 0;
    this.resetDone = false;
    this.settleTimer = 0;
    if (event) this.lastEvent = event;
  }

  private updateSettling(dt: number): void {
    this.settleTimer += dt;
    if (this.live.moment !== null) this.live.celebrationTime = this.settleTimer;
    this.input.consume();
    this.input.consumeBowling();

    // Batsmen still complete a run already under way.
    const s = this.striker;
    if (s.mode === "bat" && s.bat.finished) s.bat.reset();

    if (this.settleTimer < this.deadTimer) return;

    const FADE = 0.35;
    this.fadeTimer += dt;
    this.live.fade = Math.min(1, this.fadeTimer / FADE);
    if (this.fadeTimer >= FADE && !this.resetDone) {
      this.resetDone = true;
      this.score();
      this.resetPositions();
    }
    if (this.resetDone) {
      this.live.fade = Math.max(0, 1 - (this.fadeTimer - FADE) / FADE);
      if (this.fadeTimer >= FADE * 2) {
        this.live.fade = 0;
        this.phase = "idle";
        this.phaseTime = 0;
        this.emitTelemetry(999);
      }
    }
  }

  /** Put the ball in the book. */
  private score(): void {
    const dead = this.dead!;
    // Runs completed by BOTH batsmen; a run still being run does not count.
    const ranRuns = this.struck
      ? Math.min(...this.batsmen.map((b) => (b.mode === "run" ? b.run.lengthsDone : 0)))
      : 0;
    const outcome = toOutcome({
      clearedRope: !!this.boundary?.six,
      reachedRope: !!this.boundary,
      ranRuns: dead.dismissal ? 0 : ranRuns,
      dismissal: dead.dismissal ?? undefined,
      offTheBat: dead.offTheBat,
      wide: this.mode === "bowling" && this.deliveryWide && !dead.dismissal,
    });
    const before = this.match;
    this.match = applyBall(this.match, outcome);
    this.bowlerChangePending = this.mode === "bowling" && shouldChangeBowler(before, this.match);
    const status = this.mode === "bowling" ? bowlingStatus(this.match) : challengeStatus(CHALLENGES[this.level], this.match);
    if (status.result !== "playing") {
      this.match = { ...this.match, complete: true };
      if (this.mode === "batting" && status.result === "won") {
        this.progress = recordWin(this.progress, CHALLENGES[this.level], this.match.runs);
        try { window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch { /* Keep session progress when storage is unavailable. */ }
      }
    }
    if (outcome.extra || !this.lastEvent || this.lastEvent === "Beaten" || this.lastEvent === "Dropped") {
      this.lastEvent = this.describe(outcome, dead.dismissal);
    }
    this.runsToRun = 0;
  }

  private describe(outcome: ReturnType<typeof toOutcome>, dismissal: Dismissal | null): string {
    if (dismissal) return `OUT — ${dismissal}`;
    if (outcome.six) return "SIX";
    if (outcome.four) return "FOUR";
    if (outcome.extra) return `${outcome.extra.kind} +${outcome.extra.runs}`;
    if (outcome.runs === 0) return "No run";
    return `${outcome.runs} run${outcome.runs > 1 ? "s" : ""}`;
  }

  /* ---------------------------------------------------------------- *
   * Players
   * ---------------------------------------------------------------- */

  private updatePlayers(dt: number): void {
    const ball = this.world.ball;
    const ballWorld = _v2.set(ball.position.x, ball.position.y, ball.position.z);
    const watch = this.holder?.kind === "bowler" ? this.bowler.handWorld(_v3) : ballWorld;

    this.bowler.update(dt);

    for (const b of this.batsmen) {
      if (b.mode === "bat") {
        b.rig.root.position.copy(this.strikerRoot);
        b.rig.root.rotation.set(0, STRIKER_YAW, 0);
        b.rig.root.updateMatrixWorld(true);
        b.bat.look.copy(b.rig.root.worldToLocal(watch.clone()));
        b.bat.update(dt);
        if (this.phase === "runup" && this.shuffleAmount > 0) {
          this.shuffleTime += dt * 15;
          copyPose(this.shufflePose, b.bat.pose);
          // Alternate short foot lifts while retaining the ready batting stance.
          this.shufflePose[C.footLY] += Math.max(0, Math.sin(this.shuffleTime)) * 0.055;
          this.shufflePose[C.footRY] += Math.max(0, -Math.sin(this.shuffleTime)) * 0.055;
          applyPose(b.rig, this.shufflePose);
        } else applyPose(b.rig, b.bat.pose);
      } else {
        b.run.update(dt);
      }
    }

    const live = this.phase !== "idle";
    this.umpire.lookAt(live && this.live.boundaryRuns === null ? watch : null);
    if (this.live.boundaryRuns !== null) {
      // Turn toward the scorers during the wide shot, before the camera cuts.
      const turn = Math.min(1, this.live.celebrationTime / 0.6);
      this.umpire.yaw = UMPIRE_SIGNAL_YAW * turn * turn * (3 - 2 * turn);
    }
    this.umpire.update(dt);
    if (this.live.boundaryRuns !== null) {
      umpireSignalPose(this.umpirePose, this.umpire.pose, this.live.boundaryRuns, this.live.celebrationTime - UMPIRE_SIGNAL_START);
      applyPose(this.umpire.rig, this.umpirePose);
    }
    this.fielders.forEach((f, i) => {
      if (live) f.lookAt(watch);
      f.update(dt);
      this.live.fielders[i].x = f.world.x;
      this.live.fielders[i].z = f.world.z;
    });
    this.live.momentShot = momentShot(this.live.moment, this.live.celebrationTime);
    this.reactions.update(this.live.moment, this.live.momentShot, reactionTime(this.live.moment, this.live.celebrationTime));
    // Cutaway doubles replace the live actors only visually; scoring and physics
    // continue unchanged, and every actor is restored on reset/menu/retry.
    const visible = this.live.momentShot === null;
    for (const b of this.batsmen) b.rig.root.visible = visible;
    for (const f of this.fielders) f.rig.root.visible = visible;
    this.bowler.rig.root.visible = visible;
    this.umpire.rig.root.visible = visible;
    this.ballMesh.visible = visible;
  }

  /** A held ball travels in the holder's hand. */
  private updatePossession(): void {
    if (!this.holder) return;
    const at =
      this.holder.kind === "bowler"
        ? this.bowler.handWorld(_v3)
        : this.holder.index === this.keeperIndex
          ? this.fielders[this.keeperIndex].glovesWorld(_v3)
          : this.fielders[this.holder.index].handWorld(_v3);
    this.world.placeBall({ x: at.x, y: at.y, z: at.z });
  }

  /** World point -> the striker's root space. */
  private toStrikerRoot(p: THREE.Vector3): THREE.Vector3 {
    // Root at the player's moved stance, yawed +90 degrees, scaled by RIG_SCALE:
    // world +Z is root -X, world +X is root +Z.
    return p.set(
      -(p.z - this.strikerRoot.z) / RIG_SCALE,
      p.y / RIG_SCALE,
      (p.x - this.strikerRoot.x) / RIG_SCALE
    );
  }

  private syncVisuals(): void {
    const b = this.world.ball;
    this.ballMesh.position.set(b.position.x, b.position.y, b.position.z);
    if (!this.holder) {
      // Roll the ball visually so it does not slide.
      this.ballMesh.rotation.x += b.velocity.z * 0.02;
      this.ballMesh.rotation.z -= b.velocity.x * 0.02;
    }

    this.live.ballX = b.position.x;
    this.live.ballY = b.position.y;
    this.live.ballZ = b.position.z;
    this.live.ballSpeed = this.holder ? 0 : Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
    this.live.phase = this.phase;

    // Stumps follow their rigid bodies, so a hit knocks them over for real.
    const transforms = this.world.stumpTransforms();
    for (let i = 0; i < this.stumpMeshes.length && i < transforms.length; i++) {
      const t = transforms[i];
      this.stumpMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
      this.stumpMeshes[i].quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    }
  }

  /**
   * The camera. Tight on the striker for the delivery; after the shot it
   * rises and pulls back, framing the midpoint between the bat and the ball so
   * the chase stays in shot. The look target is damped separately from the
   * position, which gives the move an operator's lag rather than a snap.
   */
  private updateCamera(dt: number): void {
    // Keep the dismissal's existing framing while physics continues to topple
    // stumps or finish the catch. Do not chase the dead ball away from the wicket.
    if (this.live.moment?.kind === "wicket" && this.live.momentShot === null && !this.resetDone) return;
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = CAMERA_FOV;
    const reactionShot = this.live.momentShot;
    const umpireShot = !reactionShot && this.live.boundaryRuns !== null && this.live.celebrationTime >= BOUNDARY_CUT_TIME && !this.resetDone;

    const following = this.struck && (this.phase === "resolved" || this.phase === "settling") && !this.resetDone;
    if (reactionShot) {
      target.copy(this.reactions.camera);
      look.copy(this.reactions.look);
      fov = 38;
    } else if (umpireShot) {
      // Front three-quarter view keeps the hands and hat clear of the stumps;
      // leave room on screen-left for the boundary graphic.
      target.copy(UMPIRE_SIGNAL_CAMERA);
      look.set(UMPIRE_AT.x + 0.35, 1.35, UMPIRE_AT.z - 0.35);
      fov = 38;
    } else if (following) {
      const b = this.world.ball;
      const ball = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      const bat = new THREE.Vector3(0, 1, STRIKER_STUMPS_Z);
      const travelled = ball.distanceTo(bat);
      const pull = THREE.MathUtils.clamp(travelled / 55, 0, 1);
      target.set(bat.x + (ball.x - bat.x) * 0.22, 6 + pull * 20, STRIKER_STUMPS_Z - 14 - pull * 18);
      look.lerpVectors(bat, ball, 0.62);
      look.y = Math.max(1, look.y);
      fov = CAMERA_FOV + pull * 22;
    } else if (this.cameraMode === "batting") {
      target.copy(CAMERA_BATTING);
      look.copy(CAMERA_BATTING_LOOK);
      if (this.phase === "flight") {
        const b = this.world.ball;
        target.x += THREE.MathUtils.clamp(b.position.x, -1.5, 1.5) * 0.35;
        look.x += THREE.MathUtils.clamp(b.position.x, -2, 2) * 0.5;
      }
    } else {
      target.copy(CAMERA_BROADCAST);
      look.copy(CAMERA_LOOK);
      fov = CAMERA_TV_FOV;
    }

    // During the cut to black the camera jumps home, unseen.
    const snap = this.live.fade >= 1 || (umpireShot && !this.boundaryCameraActive) || reactionShot !== this.reactionCameraShot;
    this.reactionCameraShot = reactionShot;
    this.boundaryCameraActive = umpireShot;
    const kPos = snap ? 1 : 1 - Math.exp(-2.6 * dt);
    const kLook = snap ? 1 : 1 - Math.exp(-4.5 * dt);
    this.camera.position.lerp(target, kPos);
    this.cameraLook.lerp(look, kLook);
    this.camera.lookAt(this.cameraLook);
    // Derive radar orientation from the rendered view, including camera cuts.
    const dx = this.cameraLook.x - this.camera.position.x;
    const dz = this.cameraLook.z - this.camera.position.z;
    const groundLength = Math.hypot(dx, dz) || 1;
    this.live.radarForwardX = dx / groundLength;
    this.live.radarForwardZ = dz / groundLength;

    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * kPos;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Converts the player's LEFT/RIGHT press into an off/leg aim. The arrow keys
   * mean "hit it to that side of the screen", and which side of the screen
   * the leg side is on depends on which way the camera faces.
   */
  private aimScreenSign(): number {
    return this.cameraMode === "batting" ? -1 : 1;
  }

  private cameraLook = CAMERA_BATTING_LOOK.clone();
  cameraMode: CameraMode = "batting";

  toggleCamera(): CameraMode {
    this.cameraMode = this.cameraMode === "batting" ? "tv" : "batting";
    return this.cameraMode;
  }

  private emitTelemetry(dt: number): void {
    this.telemetryTimer += dt;
    if (this.telemetryTimer < 1 / TELEMETRY_HZ) return;
    this.telemetryTimer = 0;
    this.onTelemetry?.({
      mode: this.mode,
      bowling: { ...bowlingStatus(this.match), bowler: this.playerBowler, changePending: this.bowlerChangePending },
      challenge: { ...challengeStatus(CHALLENGES[this.level], this.match), level: this.level, screen: this.screen, progress: this.progress },
      match: this.match,
      phase: this.phase,
      lastEvent: this.lastEvent,
      bowlerStyle: this.style,
      fieldNames: this.field.map((f) => f.name),
    });
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  setBowlerStyle(style: BowlerStyle): void {
    this.style = style;
    if (this.phase === "idle" && this.world) {
      const approach = APPROACH[style];
      this.bowler.setup(approach, deliveryOrigin(approach, FRONT_FOOT_Z), BOWLER_LINE_X, STUMPS_LOOK);
    }
  }

  /** Start a fresh attempt only for unlocked levels, without recreating the scene. */
  selectLevel(level: number): void {
    if (!Number.isInteger(level) || level < 0 || level > this.progress.unlocked || !CHALLENGES[level]) return;
    this.level = level;
    this.bowlerChangePending = false;
    if (this.mode === "bowling") this.cameraMode = "batting";
    this.mode = this.live.mode = "batting";
    this.screen = "ready";
    this.phase = "idle";
    this.phaseTime = 0;
    this.live.fade = 0;
    this.live.lastBand = null;
    this.live.shotFeedback = "";
    this.match = newInnings(["Sharma", "Patel", "Khan", "Mitchell", "Okafor", "Silva", "Brennan"]);
    this.style = CHALLENGES[level].styles[0];
    this.lastEvent = "Press R to bowl";
    this.resetPositions();
    this.input.consume();
    this.input.consumeRestart();
    this.emitTelemetry(999);
  }

  /** Menus are opened between balls so a live delivery cannot continue behind them. */
  showLevelSelect(): void {
    if (this.phase !== "idle") return;
    if (this.mode === "bowling") this.cameraMode = "batting";
    this.mode = this.live.mode = "batting";
    this.screen = "select";
    this.bowlerChangePending = false;
    this.emitTelemetry(999);
  }

  /** Start a separate defence without changing batting unlocks or best scores. */
  startBowling(): void {
    if (this.phase !== "idle") return;
    this.mode = this.live.mode = "bowling";
    this.bowlerChangePending = false;
    this.screen = "ready";
    this.phaseTime = 0;
    this.live.fade = 0;
    this.live.lastBand = null;
    this.live.shotFeedback = "";
    this.previousAiSpeed = null;
    this.bowlingAim = { ...DEFAULT_BOWLING_AIM };
    this.match = newInnings(["Sharma", "Patel", "Khan", "Singh", "Rao", "Das", "Kumar"]);
    this.style = BOWLERS[this.playerBowler].style;
    this.cameraMode = "tv";
    this.camera.position.copy(CAMERA_BROADCAST);
    this.cameraLook.copy(CAMERA_LOOK);
    this.lastEvent = "Press R to start your run-up";
    this.resetPositions();
    this.input.consume();
    this.input.consumeRestart();
    this.emitTelemetry(999);
  }

  /** A bowler's identity/action cannot change after the run-up has begun. */
  selectPlayerBowler(index: number): void {
    if (this.mode !== "bowling" || this.phase !== "idle" || !Number.isInteger(index) || !BOWLERS[index]) return;
    this.playerBowler = index;
    this.setBowlerStyle(BOWLERS[index].style);
    this.emitTelemetry(999);
  }

  /** Explicit confirmation prevents R from skipping the between-over bowler picker. */
  confirmBowlerChange(): void {
    if (this.mode !== "bowling" || this.phase !== "idle" || !this.bowlerChangePending) return;
    this.bowlerChangePending = false;
    this.bowl();
    this.emitTelemetry(999);
  }

  /** Allow the HUD's pace slider while setting up or aiming, never after lock. */
  setPlayerPace(pace: number): void {
    if (this.mode !== "bowling" || !Number.isFinite(pace) || (this.phase !== "idle" && (this.phase !== "runup" || this.markerLocked))) return;
    this.bowlingAim.pace = THREE.MathUtils.clamp(pace, 0, 1);
    this.live.bowling.aim = { ...this.bowlingAim };
    this.emitTelemetry(999);
  }

  /** Resolve manual/automatic footwork and publish the choice to the timing HUD. */
  private selectedFootwork(requested: Footwork): Footwork {
    const footwork = effectiveFootwork(requested, lengthForStance(this.bounceZ, this.strikerRoot.z - STRIKER_ROOT.z));
    this.live.footwork = footwork;
    return footwork;
  }

  /** Predict contact at the frozen stance's footwork-specific hitting plane. */
  private contactPrediction(footwork: Footwork): ContactPrediction | null {
    return predictContact(this.ballSnapshot(), this.world, this.strikerRoot.z - CONTACT_X[footwork] * RIG_SCALE);
  }

  /** Decorative drift converges before the delivery stride; the locked point never follows the ball. */
  private updateMarker(dt: number): void {
    if (this.mode === "bowling" && this.bowler.state === "delivery" && !this.markerLocked) this.lockBowlingAim();
    if (this.bowler.state === "delivery" || this.phase === "flight") this.markerLocked = true;
    if (this.world.hasPitched || this.phase === "resolved") this.markerFade = Math.max(0, this.markerFade - dt * 5);
    this.marker.visible = !!this.markerPoint && this.markerFade > 0 && (this.phase === "runup" || this.phase === "flight");
    if (!this.marker.visible || !this.markerPoint) return;
    this.marker.position.copy(this.markerPoint);
    const drift = this.markerLocked || this.mode === "bowling" ? 0 : Math.max(0, 1 - this.bowler.runupProgress);
    this.marker.position.x += Math.sin(this.phaseTime * 5) * 0.22 * drift;
    this.marker.position.z += Math.cos(this.phaseTime * 4) * 0.32 * drift;
    this.marker.scale.setScalar(this.markerLocked ? 1 : 1 + 0.12 * Math.sin(this.phaseTime * 7));
    this.marker.material.opacity = this.markerFade * 0.9;
    this.marker.material.color.setHex(this.markerLocked ? 0xb8ff85 : 0x7de8ff);
  }

  private onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.pipeline) this.pipeline.resize(w, h);
    else this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.marker?.material.dispose();
    this.previewRig?.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const material of Array.isArray(m.material) ? m.material : [m.material]) material.dispose();
    });
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
    });
    this.pipeline?.dispose();
    this.lib?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export { RUN_TIME, BOUNDARY_STRAIGHT, boundaryDistanceAlong, PLAYER_HEIGHT };
