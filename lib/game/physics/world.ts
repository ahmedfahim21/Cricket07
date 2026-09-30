/**
 * The Rapier world.
 *
 * This is the only file in `physics/` that imports Rapier. `aero.ts` and
 * `pitch.ts` stay pure so they can be tested without a WASM blob, and this
 * module is the adapter that feeds them into the solver.
 *
 * ---------------------------------------------------------------------------
 * TIMESTEP — read this before changing it
 * ---------------------------------------------------------------------------
 * A delivery leaves the hand at ~40 m/s. At 60 Hz that is 0.66 m of travel per
 * step, against a 36 mm ball, a 40 mm bat edge and a 36 mm stump. The ball
 * would pass clean through all three every single time and nothing would ever
 * connect. So:
 *
 *   - the world steps at a FIXED 240 Hz, decoupled from rendering by an
 *     accumulator, and
 *   - the ball has CCD enabled, so even at 240 Hz (0.17 m/step) its motion is
 *     swept rather than sampled.
 *
 * Both are load-bearing. Dropping either brings the tunnelling back.
 *
 * ---------------------------------------------------------------------------
 * WHAT RAPIER OWNS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Rapier owns: integration of the ball, ball vs stumps, ball vs fielders, and
 * the stumps falling over.
 *
 * Rapier does NOT own the ball's contact with the pitch. A rigid-body solver
 * bouncing a sphere off a plane gives a bounce, but it cannot give spin
 * gripping and turning or seam deviation, which are the entire character of
 * the surface. That contact is detected here and resolved by `pitch.bounce()`,
 * and the ball is explicitly filtered out of colliding with the ground so the
 * solver never fights the analytic result.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import {
  BALL_MASS,
  BALL_RADIUS,
  BOUNDARY_SQUARE,
  BOUNDARY_STRAIGHT,
  CREASE_Z,
  PITCH_WIDTH,
  STUMP_DIAMETER,
  STUMP_HEIGHT,
  STUMP_X_OFFSETS,
} from "../dimensions";
import { DEFAULT_AERO, aeroForce, type AeroParams } from "./aero";
import { DEFAULT_PITCH, bounce, type PitchConditions } from "./pitch";
import { Vec3, v3 } from "./vec3";

export const PHYSICS_HZ = 240;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

/** Never advance more than this much simulated time in one frame. */
const MAX_CATCHUP = 0.1;

/* ------------------------------------------------------------------ *
 * Collision groups
 *
 * Rapier packs membership in the high 16 bits and the filter mask in the low
 * 16. The ball deliberately omits GROUND from its mask.
 * ------------------------------------------------------------------ */

const G_BALL = 0x0001;
const G_GROUND = 0x0002;
const G_STUMPS = 0x0004;
const G_FIELDER = 0x0008;

const groups = (member: number, collidesWith: number) => (member << 16) | collidesWith;

export interface BallState {
  position: Vec3;
  velocity: Vec3;
  spin: Vec3;
  /** Seam tilt from vertical, radians. Positive swings toward +X. */
  seamAngle: number;
  /** Remaining polish on one side, 0..1. */
  shine: number;
}

export interface DeliveryRelease {
  position: Vec3;
  velocity: Vec3;
  spin: Vec3;
  seamAngle: number;
}

export type BounceEvent = {
  position: Vec3;
  /** Distance in front of the striker's stumps where it pitched. */
  lengthFromStumps: number;
  deviation: number;
};

export class CricketWorld {
  readonly world: RAPIER.World;
  private ballBody: RAPIER.RigidBody;
  private stumpBodies: RAPIER.RigidBody[] = [];
  private accumulator = 0;

  /** Mutated in place; never reallocated. Read it, do not keep references. */
  readonly ball: BallState = {
    position: v3(),
    velocity: v3(),
    spin: v3(),
    seamAngle: 0,
    shine: 1,
  };

  aero: AeroParams = { ...DEFAULT_AERO };
  pitch: PitchConditions = { ...DEFAULT_PITCH };

  /**
   * The outfield, which is NOT the pitch.
   *
   * Grass is softer and far less abrasive than a rolled clay strip: the ball
   * sits down instead of bouncing through, and it keeps its pace instead of
   * being scrubbed off. Using pitch conditions across the whole ground makes
   * every struck shot pull up short of the rope.
   */
  outfield: PitchConditions = { hardness: 0.3, friction: 0.2, seamDeviation: 0 };

  /** True once the ball has pitched at least once since release. */
  hasPitched = false;
  /** Set on the step the ball pitches; consumers clear it. */
  lastBounce: BounceEvent | null = null;
  /** True while a delivery is live (released and not yet dead). */
  live = false;

  private onBounce?: (e: BounceEvent) => void;

  constructor(opts: { onBounce?: (e: BounceEvent) => void } = {}) {
    this.onBounce = opts.onBounce;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;

    this.ballBody = this.createBall();
    this.createGround();
    this.createStumps(-1);
    this.createStumps(1);
  }

  /* ---------------------------------------------------------------- *
   * Construction
   * ---------------------------------------------------------------- */

  private createBall(): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 2, 10)
        .setCcdEnabled(true)
        // Angular damping stands in for the spin decay of a ball in air.
        .setAngularDamping(0.05)
        .setCanSleep(false)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setMass(BALL_MASS)
        .setRestitution(0.35)
        .setFriction(0.5)
        .setCollisionGroups(groups(G_BALL, G_STUMPS | G_FIELDER)),
      body
    );
    // Parked until the first delivery.
    body.setGravityScale(0, true);
    return body;
  }

  private createGround(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // Big flat slab under the whole ground. The ball is filtered out of this
    // by its collision mask; it is here so stumps and fielders have a floor.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BOUNDARY_SQUARE + 20, 0.5, BOUNDARY_STRAIGHT + 20)
        .setTranslation(0, -0.5, 0)
        .setFriction(0.8)
        .setCollisionGroups(groups(G_GROUND, G_STUMPS | G_FIELDER)),
      body
    );
  }

  /** `end` is -1 for the striker's end and +1 for the bowler's. */
  private createStumps(end: number): void {
    const z = end * (20.12 / 2);
    for (const x of STUMP_X_OFFSETS) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, STUMP_HEIGHT / 2, z)
          // Stumps are driven into the ground; they should not topple from a
          // breeze, only from a real hit. Heavy damping keeps them settled.
          .setLinearDamping(2.5)
          .setAngularDamping(2.5)
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(STUMP_HEIGHT / 2, STUMP_DIAMETER / 2)
          .setMass(0.35)
          .setRestitution(0.2)
          .setCollisionGroups(groups(G_STUMPS, G_BALL | G_GROUND | G_STUMPS)),
        body
      );
      this.stumpBodies.push(body);
    }
  }

  /* ---------------------------------------------------------------- *
   * Delivery lifecycle
   * ---------------------------------------------------------------- */

  release(d: DeliveryRelease): void {
    // The ball is deliberately filtered out of colliding with the ground (see
    // the header), so between deliveries there is nothing to stop it falling
    // through the world forever and accumulating a nonsense speed. Gravity is
    // therefore switched off while it is parked and back on at release.
    this.ballBody.setGravityScale(1, true);
    this.ballBody.setTranslation(d.position, true);
    this.ballBody.setLinvel(d.velocity, true);
    this.ballBody.setAngvel(d.spin, true);
    this.ball.seamAngle = d.seamAngle;
    this.hasPitched = false;
    this.lastBounce = null;
    this.live = true;
    this.accumulator = 0;
    this.syncBallState();
  }

  /** Stop simulating the ball and park it where it lies. */
  deaden(): void {
    this.live = false;
    this.ballBody.setLinvel(v3(), true);
    this.ballBody.setAngvel(v3(), true);
    this.ballBody.resetForces(false);
    this.ballBody.setGravityScale(0, true);
  }

  /** Put the ball exactly here — used to seat it on the bat's middle at contact. */
  placeBall(position: Vec3): void {
    this.ballBody.setTranslation(position, true);
    this.syncBallState();
  }

  /** Overwrite the ball's velocity — used when the bat strikes it. */
  setBallVelocity(velocity: Vec3, spin?: Vec3): void {
    this.ballBody.setLinvel(velocity, true);
    if (spin) this.ballBody.setAngvel(spin, true);
    this.syncBallState();
  }

  /* ---------------------------------------------------------------- *
   * Stepping
   * ---------------------------------------------------------------- */

  /**
   * Advance by a wall-clock delta. Runs zero or more fixed 240 Hz steps.
   * Returns the number of steps taken, which the caller can use for
   * interpolation.
   */
  step(dt: number): number {
    this.accumulator += Math.min(dt, MAX_CATCHUP);
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.substep();
      steps++;
    }
    this.syncBallState();
    return steps;
  }

  private substep(): void {
    if (this.live) {
      this.applyAero();
    }
    this.world.step();
    if (this.live) {
      this.resolvePitchContact();
    }
  }

  private applyAero(): void {
    const v = this.ballBody.linvel();
    const w = this.ballBody.angvel();
    const f = aeroForce(
      {
        velocity: v3(v.x, v.y, v.z),
        spin: v3(w.x, w.y, w.z),
        seamAngle: this.ball.seamAngle,
        shine: this.ball.shine,
      },
      this.aero
    );
    // Rapier does NOT clear the force accumulator between steps — addForce
    // persists until resetForces. Without this line the drag from every
    // previous step is still being applied, the sum diverges within a few
    // hundred steps, and the ball drops out of the sky a metre from the
    // bowler's hand.
    this.ballBody.resetForces(false);
    this.ballBody.addForce(f, true);
  }

  /**
   * Detect and resolve the ball meeting the pitch.
   *
   * Done by position test rather than by a Rapier contact event because the
   * ball is deliberately filtered out of colliding with the ground — see the
   * header. The ball is snapped back to rest on the surface before the new
   * velocity is applied, so a deep step never leaves it buried.
   */
  private resolvePitchContact(): void {
    const p = this.ballBody.translation();
    const v = this.ballBody.linvel();
    if (p.y > BALL_RADIUS || v.y >= 0) return;

    const w = this.ballBody.angvel();
    // The strip only extends over the square; everywhere else is outfield.
    const onPitch = Math.abs(p.x) < PITCH_WIDTH / 2 && Math.abs(p.z) < CREASE_Z + 1.6;
    const result = bounce({
      velocity: v3(v.x, v.y, v.z),
      spin: v3(w.x, w.y, w.z),
      conditions: onPitch ? this.pitch : this.outfield,
    });

    this.ballBody.setTranslation({ x: p.x, y: BALL_RADIUS, z: p.z }, true);
    this.ballBody.setLinvel(result.velocity, true);
    this.ballBody.setAngvel(result.spin, true);

    // Only the FIRST contact is "the pitch of the ball" for length purposes;
    // later ones are just the ball bouncing across the outfield.
    if (!this.hasPitched) {
      this.hasPitched = true;
      const event: BounceEvent = {
        position: v3(p.x, 0, p.z),
        // Striker's stumps are at -10.06; distance in front of them.
        lengthFromStumps: p.z + 20.12 / 2,
        deviation: result.deviation,
      };
      this.lastBounce = event;
      this.onBounce?.(event);
    }
  }

  private syncBallState(): void {
    const p = this.ballBody.translation();
    const v = this.ballBody.linvel();
    const w = this.ballBody.angvel();
    this.ball.position.x = p.x;
    this.ball.position.y = p.y;
    this.ball.position.z = p.z;
    this.ball.velocity.x = v.x;
    this.ball.velocity.y = v.y;
    this.ball.velocity.z = v.z;
    this.ball.spin.x = w.x;
    this.ball.spin.y = w.y;
    this.ball.spin.z = w.z;
  }

  /* ---------------------------------------------------------------- *
   * Queries
   * ---------------------------------------------------------------- */

  /** World-space transforms of the six stumps, for the renderer. */
  stumpTransforms(): { position: Vec3; rotation: RAPIER.Rotation }[] {
    return this.stumpBodies.map((b) => {
      const t = b.translation();
      return { position: v3(t.x, t.y, t.z), rotation: b.rotation() };
    });
  }

  /** True if any stump at the striker's end has been knocked out of true. */
  strikerStumpsBroken(): boolean {
    return this.stumpBodies.slice(0, 3).some((b) => {
      const r = b.rotation();
      // A standing stump has an identity-ish rotation; w falls away as it tips.
      return Math.abs(r.w) < 0.985;
    });
  }

  resetStumps(): void {
    this.stumpBodies.forEach((b, i) => {
      const end = i < 3 ? -1 : 1;
      const x = STUMP_X_OFFSETS[i % 3];
      b.setTranslation({ x, y: STUMP_HEIGHT / 2, z: end * (20.12 / 2) }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel(v3(), true);
      b.setAngvel(v3(), true);
    });
  }

  dispose(): void {
    this.world.free();
  }
}

/** Rapier ships as WASM and must be initialised before any of the above. */
let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}
