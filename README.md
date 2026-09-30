# Cricket — WebGL

A browser cricket game in the spirit of EA Cricket 07: same camera grammar, same
HUD layout, same interaction feel. Built on three.js and Rapier.

**Iteration 1 delivers a playable batting loop** — a bowler runs in and delivers
with real ball physics, you time and direct a shot, fielders chase, runs score,
and the HUD updates.

## Running it

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:3000.

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

**TV** is the broadcast framing from behind the bowler's arm.

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
a front leg and a keeper can sit on their haunches. The bat is placed first and
both hands are solved onto its handle (`holdBat` in `assets/kit.ts`), so the grip
cannot float; if a keyframe is out of arm's reach the grip is pulled toward the
shoulders until both hands can reach it.

Figures face -Z. `Object3D.lookAt` points +Z at its target, which turns them to
face away, so use `faceYaw` in the engine instead.

## Fielding

Fielders chase for real. The nearest man by running time is re-evaluated every
frame while the ball is live, so a shot that beats one fielder gets picked up by
the next rather than being followed by whoever happened to be closest at
contact. Stride rate is driven by ground speed covered, so nobody skates.

## Testing

```bash
pnpm test
```

120 tests. The physics, shot resolution and scoring are pure modules with no
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

```bash
pnpm typecheck
```

## Looking at the assets

Every model and texture is generated in code — there are no `.gltf`, `.obj` or
image files anywhere in this project. To see what the code produced:

```bash
pnpm preview:assets
```

This transpiles the asset sources, serves them to headless Chrome, and writes
labelled screenshots next to the source with a 1m grid and a triangle count per
asset, so a scale mistake or a blown budget is visible rather than mysterious.

## Layout

```
app/                     page shell
components/              canvas host + HUD (score plate, radar, shot meter, delivery panel)
lib/game/
  dimensions.ts          Laws-of-cricket measurements + the coordinate convention
  engine.ts              the Game class: scene, loops, camera, delivery state machine
  physics/
    aero.ts              drag, Magnus, swing            [pure, tested]
    pitch.ts             bounce, spin grip, seam         [pure, tested]
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
manual running between the wickets, DRS, audio, gamepad. Gamepad is deferred
rather than designed out: `input/controller.ts` emits one intent shape and the
keyboard is merely today's source of it.

## Assets and copyright

No EA models, textures, audio, logos or player likenesses are used. Everything
is generated procedurally. What is being matched is the visual language — HUD
layout, camera work, interaction grammar.
