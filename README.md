# Cricket — WebGL

A browser cricket game in the spirit of EA Cricket 07: same camera grammar, same
HUD layout, same interaction feel. Built on three.js and Rapier.

**Iteration 1 delivers a playable batting loop** — a bowler runs in and delivers
with real ball physics, you time and direct a shot, fielders cut it off, gather
and throw it back to the keeper, the batsmen run, runs score, and the HUD
updates. Every contact in that chain is physical: nothing teleports and nothing
is decided off-screen.

## Running it

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:3000. Press R to bowl.

## Controls

| Keys | Action |
|---|---|
| ↑ / ↓ | Front foot / back foot |
| ← / → | Aim off side / leg side |
| Z | Defend |
| X or Space | Ground shot |
| C | Loft |
| Shift | Play squarer |
| R | Bowl the next delivery |
| V | Switch batting / TV camera |

Timing is judged on **when** the shot key goes down relative to the ball, not on
which key — that is why shot type sits on its own keys rather than as a modifier.

## Cameras

**Batting** (default) is third person over the striker's shoulder. It is the
default because it is the one you can play off: the striker is big enough to
read footwork from, the ball comes toward the camera so line and length are
judgeable, and left/right on screen maps directly to off and leg instead of
being mirrored.

**TV** is the broadcast framing from behind the bowler's arm: far back up the
ground (about 40 m behind the bowler's stumps) on a long lens. The distance is
what flattens the pitch the way a broadcast does, and it keeps the bowler's
stride, the umpire and the non-striker in the frame instead of filling it.

Once a shot is struck, both hand over to a chase camera that rises and pulls
back in proportion to how far the ball has gone, framing the midpoint between
bat and ball so the fielders chasing it stay in shot.

The arrow keys mean **the side of the screen you want to hit it to**, and the
engine converts that to an off/leg aim using the active camera. This matters
because a three.js camera looks down its own -Z: behind the batsman, screen
right maps to world -X, so the leg side is on the left; behind the bowler it is
on the right. Without the conversion, left sends the ball right in one camera
and left in the other.

## The look

The world is rendered the way the sibling city engine renders its streets:
flat cel bands with shadows that shift toward a cool violet instead of going
grey, then one full-screen pass for ink lines, depth haze, split-tone grade and
dither.

- `lib/game/fx/toon.ts` converts the finished scene to toon materials in one
  pass (`celify`), so nothing that builds an asset needs to know about the look.
  Noisy procedural surfaces (turf, pitch, concrete) collapse to their mean
  colour, because under flat bands that noise reads as dirt.
- `lib/game/render.ts` draws into a linear float target with a depth texture,
  then grades and FXAA-cleans it. Tone mapping lives in the grade pass, so the
  renderer's own must stay off.
- `lib/game/fx/presets.ts` holds the recipe (ink, tone, grade, haze).

Players follow the same source: tapered limbs, a sphere at every joint, a lathe
head, and two joints per limb (hip+knee, shoulder+elbow) so a bowler can brace
a front leg and a keeper can sit on their haunches (`assets/kit.ts`).

Figures face -Z. `Object3D.lookAt` points +Z at its target, which turns them to
face away, so use `faceYaw` instead.

## Animation

Everything under `lib/game/anim/` is procedural: channel poses, forward
kinematics plus IK, and Hermite keyframe tracks — no clips.

- `pose.ts` — a pose is a flat `Float32Array` of channels (pelvis, trunk, head,
  limbs, foot/hand/bat IK targets and weights). `applyPose` runs FK, then IK:
  feet planted on their targets (the pelvis drops if a grounded foot cannot
  reach), both hands solved onto the bat handle, arms aimed for windmill
  actions, and a trunk lean when the hands would otherwise fall short.
- `ik.ts` — two-bone IK and hinge-constrained aiming.
- `track.ts` — keyframe tracks with monotone tangents, so a planted foot cannot
  overshoot and slide; bat rotations are quaternions (no gimbal lock).
- `locomotion.ts` — gait from world-fixed footprints with heel/toe roll. Phase
  advances with distance covered and the stance/swing split changes with speed,
  so feet do not skate at any pace.
- `bowler.ts` — an accelerating run-up whose stride is stretched a few percent
  so the take-off lands on the left foot, then bound, back-foot contact,
  front-foot brace behind the popping crease, release from a vertical arm,
  follow-through. The ball is built at the release frame from where the hand
  actually is, so it leaves from the hand.
- `batsman.ts` — guard, trigger, backlift and footwork as one continuous
  parametric pose; a shot is built at the press from where the predictor says
  the ball will be. `fitToBall` then poses the contact key on the real rig and
  moves the hips toward the ball until the bat's middle is on it — the knees
  bend, the feet stay where they landed — which gets every stroke within 5 cm.
- `fielder.ts` — movement under acceleration, braking and turn-rate limits;
  walk-in, set, stoop-and-gather, side-on throw, catches (a keeper takes low
  balls from his crouch).
- `runner.ts` — running between the wickets: accelerate, brake before the
  crease, turn, go again, bat carried in the bottom hand, each batsman on his
  own side of the strip.

## A ball, end to end

1. The ball sits in the bowler's hand through the run-up and is released from
   it.
2. On the shot press, `physics/predict.ts` (the same forces as the Rapier world,
   within 5 cm) finds where the ball will cross the batsman's hitting plane for
   the chosen footwork. Timing is measured against the press timestamp, not the
   frame it was read on.
3. The bat is timed to arrive there. Contact is judged on the pose at the exact
   contact instant: if the bat's middle is within 25 cm of the ball, the ball is
   seated on it and struck; otherwise it carries on past. Misses log a
   `[shot]` warning with the gap, so one that looks wrong can be traced.
4. Fielding: a catch is planned if anyone can get under the ball before it
   lands; otherwise the fielder who can cut it off soonest along its predicted
   path goes, re-planned as the ball runs. He stoops, the ball goes into his
   hand on the gather frame, and he throws it — aimed through drag with
   `solveThrow` — at the keeper, who has come up to the stumps.
5. The batsmen judge the runs off the bat from how long the return will take,
   and run them. A run only counts if both complete it.
6. Dead ball: the picture holds, cuts to black, and everyone is back in place
   for the next delivery.

## Fielding

A standard one-day field (`match/fielding.ts`). Fielders walk in as the bowler
runs up and are set at release. A fielder who can stop the ball on its path is
sent to that point; if nobody can, the nearest goes to where it will stop or
cross the rope.

## Testing

```bash
pnpm test
```

153 tests. The physics, shot resolution and scoring are pure modules with no
three.js and no Rapier imports, which is what makes them testable — all Rapier
wiring is confined to `lib/game/physics/world.ts`.

- `physics/aero.test.ts` — drag, Magnus, swing; includes integration checks that
  a delivery loses 8–20% of its pace over 20m and swings 15–90cm
- `physics/pitch.test.ts` — bounce, spin grip, seam movement
- `physics/world.test.ts` — the bowling machine: real Rapier deliveries, aimed
  and measured
- `match/shot.test.ts` — timing bands, footwork, aim, exit speed
- `match/state.test.ts` — the laws: wides don't count as balls, byes don't go to
  the batsman, strike rotates on odd runs *and* at the end of the over
- `match/over.test.ts` — a full over end to end, no renderer
- `physics/predict.test.ts` — the predictor matches the live world to under 5 cm;
  a throw lands in the keeper's gloves despite drag
- `anim/ik.test.ts`, `anim/track.test.ts` — IK solutions and keyframe tangents
- `anim/controllers.test.ts` — the bat's middle reaches every contact point on a
  grid of 243 strokes; fielders reach targets inside their limits and turn to
  face; a keeper gets his gloves down to boot height; the bowler releases high
  from behind the crease; batsmen complete the runs they set off for

```bash
pnpm typecheck
```

## Looking at the assets

Every model, texture and animation the game uses is generated in code. To see
what the code produced:

```bash
pnpm preview:assets
```

This transpiles the asset sources, serves them to headless Chrome, and writes
labelled screenshots next to the source with a 1m grid and a triangle count per
asset, so a scale mistake or a blown budget is visible rather than mysterious.

```bash
pnpm preview:motion
```

Renders the animation as filmstrips (`assets/preview-motion-*.png`) — gait at
walk/jog/sprint, the bowling action, eight strokes from point and from the
bowler with the ball marked at contact, gather/throw/keeper — and prints metrics
such as foot slide, release height and the bat-to-ball gap for each stroke.

## Layout

```
app/                     page shell
components/              canvas host + HUD (score plate, radar, shot meter, delivery panel)
lib/game/
  dimensions.ts          Laws-of-cricket measurements + the coordinate convention
  engine.ts              the Game class: scene, loop, cameras, delivery state machine
  render.ts, fx/         cel pipeline: toon materials, ink/haze/grade pass
  anim/                  poses, IK, tracks, gait, bowler/batsman/fielder/runner [tested]
  physics/
    aero.ts              drag, Magnus, swing            [pure, tested]
    pitch.ts             bounce, spin grip, seam         [pure, tested]
    predict.ts           look-ahead + throw solver       [pure, tested]
    world.ts             Rapier: 240Hz fixed step + CCD
  match/
    bowling.ts           delivery generation + the aiming solver
    shot.ts              timing/footwork/aim -> outcome  [pure, tested]
    state.ts             over state machine              [pure, tested]
    fielding.ts          field placement, chase, runs
  assets/                procedural geometry + the preview harness
  mat/                   procedural PBR textures
```

## Two things worth knowing before changing the physics

**Rapier has no aerodynamics.** Swing, Magnus drift and drag are not rigid-body
effects. They are applied as external forces each step from `aero.ts`, and
Rapier does *not* clear its force accumulator between steps — `resetForces` must
be called or the sum diverges and the ball drops out of the sky.

**The timestep is load-bearing.** A delivery leaves the hand at ~40 m/s, which
at 60Hz is 0.66m of travel per step against a 36mm ball and a 36mm stump. The
world runs at a fixed **240Hz with CCD enabled** on the ball. Drop either and
the ball passes clean through the bat and the stumps every time.

The ball's contact with the pitch is resolved analytically by `pitch.bounce()`,
not by Rapier — a solver bouncing a sphere off a plane gives you a bounce, but
not spin gripping and turning or seam deviation, which are the whole character
of a surface. The ball is deliberately filtered out of colliding with the ground
so the two never fight.

## Not in iteration 1

Bowling as the player, full innings and match structure, menus and team select,
manual running between the wickets, run-outs, LBW, byes, left-handers, DRS,
audio, gamepad. Gamepad is deferred
rather than designed out: `input/controller.ts` emits one intent shape and the
keyboard is merely today's source of it.

## Assets and copyright

No EA models, textures, audio, logos or player likenesses are used. Everything
is generated procedurally. What is being matched is the visual language — HUD
layout, camera work, interaction grammar.
