# Cricket — WebGL

A browser cricket game in the spirit of EA Cricket 07: same camera grammar, same
HUD layout, same interaction feel. Built on three.js and Rapier.

**Five arcade batting challenges** — chase increasing targets against pace and
spin, move around the crease, read the animated pitch marker, and time ground
shots or lofts. Fielders chase, gather and throw; batsmen run automatically.
Unlocks and best successful scores are saved locally in this browser.

**Player bowling** — choose a pace or spin specialist, steer the pitch marker
during the run-up and defend 24 runs in two overs against an automated batsman.

## Running it

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:3000, choose the first challenge, and press R to bowl.
Choose **Try bowling** on the challenge menu to play as the fielding side instead.

## Challenge ladder

| Level | Target | Overs | Wickets |
|---|---:|---:|---:|
| Find the gaps | 12 | 2 | 3 |
| Clear the rope | 20 | 2 | 3 |
| Read the spin | 28 | 3 | 3 |
| Handle the pace | 38 | 3 | 3 |
| Finish the chase | 48 | 3 | 3 |

Reach the target to unlock the next level. Retry or replay unlocked levels from
the result screen. A reload starts a fresh attempt and retains unlocks; if browser
storage is unavailable, progress lasts for the current session.

Timing stays forgiving throughout: perfect within 60 ms and good within 120 ms
of the ideal press. Difficulty comes from targets, pace, length and bowling variety.
The final level mixes all five bowling styles between deliveries.

## Controls

These are Cricket 07's own keyboard controls, not a scheme of our own.

| Keys | Action |
|---|---|
| S | Front-foot shot |
| W | Back-foot shot |
| ↑ + S / W | Defend |
| Shift + S / W | Loft it |
| ← / → | Aim square of the wicket, screen-left / screen-right |
| ↓ + ← / → | Play the same stroke straighter |
| A | Leave it |
| D | Come down the wicket |
| ← ↑ ↓ → | Move about the crease, until the ball is out of the hand |

Every one of these except S and W is a modifier that moves nothing on its own,
so the gauge carries a live readout of what is held — the foot, the stroke the
next press will play, the aim, and whether you are leaving or charging. Without
it a working modifier is indistinguishable from an unbound key, and the first
you learn that Shift registered is when the ball is already in the air.

The part that is easy to miss: **S and W are the shot**, not modifiers. One press
commits the footwork, the swing and the timing together, which is why the
original feels the way it does. Timing is judged on *when* that key goes down
relative to the ball; press it as the meter enters green. Which stroke it is
comes from what is held at that instant, so the modifier has to be down first.

The arrows do double duty exactly as the original's left stick does: before the
ball is bowled they walk the batsman about his crease, and once it is out of the
hand they are the shot's direction. Nothing switches them by hand — the
delivery's phase does. Footwork is chosen automatically from the length unless
S or W is already held during the run-up.

These three are ours, on keys the original leaves free:

| Keys | Action |
|---|---|
| Space / Enter (or R) | Bowl the next delivery |
| C | Switch batting / TV camera |
| L | Show or hide the ball line |

The cyan pitch ring pulses and drifts during the run-up, then locks green as the
bowler enters the delivery stride. It marks the predicted first bounce, including
aerodynamic drift, and fades after pitching. Crease movement stops at release and
resets before the next ball.

### The ball line

The delivery and the shot are not the same drawing problem, and are not drawn
alike.

**The delivery is information.** Two thin flat lines — pale cyan in the air out
of the hand, amber once it is off the deck. The kink between them *is* the seam
or spin deviation, and a scuff mark is left at the exact point it pitched. That
is all they are for.

**The shot is the moment.** Off the bat it becomes proper ball tracking, built
from three passes drawn over each other:

| Pass | What it does |
|---|---|
| Shadow | The arc projected flat onto the turf, directly beneath itself. This is the one that sells **height** — without it a six and a flat drive read the same from behind, because the screen is two-dimensional. |
| Core | The arc, graded along its length from deep red where the bat met it to white-hot at the ball, so it reads as *travelling* rather than as a line that happens to be there. |
| Glow | A wide additive bloom over the leading stretch only, so the head burns and the tail falls away: a comet, not a stripe. |

The line runs from the bowler's hand to wherever the ball ends up. It stops when
a fielder gathers it, so a throw back to the keeper is never drawn as though it
came off the bat, and it is cleared behind the cut to the next delivery rather
than blinking out. Press **L** to turn it off.

Note the lines deliberately do *not* use `alphaToCoverage`: it turns alpha into
MSAA coverage samples, and this pipeline renders to a plain half-float target
and anti-aliases with FXAA. There are no samples to resolve, so a
semi-transparent line comes out as a harsh dither — which is what was drawing
the ground shadow as a dotted line.

The path is sampled by distance rather than per frame — a 40 m/s delivery covers
0.66 m in a frame and a ball trickling to a fielder covers 0.01 m, so per-frame
sampling gives a sparse line through the air and hundreds of stacked points at
the end of it. A struck ball that runs a long way thins its line rather than
truncating it.

### What the strip shows

The score bar is derived from the scorebook on every render rather than stored,
so a number on it can never disagree with the balls that produced it:

- score, overs and both batsmen's runs (balls faced)
- the release speed, held from the moment of release and unaffected by bat
  contact or a fielder's throw
- the over in progress, read out as a commentator would: `1 • 4 W •`
- the partnership — runs and balls since the last wicket
- the bowler's figures in `O-M-R-W` form. Runs are what is *charged* to him:
  wides and no-balls are his, byes and leg-byes are not, and a run-out is not
  his wicket. An over that costs him nothing is a maiden even if byes were run
  off it.
- the run rate, and the required rate while there is still something to ask for

Items drop from the middle outwards as the viewport narrows; the score, the pace
and the figures are the last to go.

Well-timed attacking shots have enough power for fours and sixes against pace
and spin. Placement still matters: ground shots into a fielder can be stopped,
poor timing loses power, and balls beyond your reach can beat the bat.

## Bowling mode

Keep the AI below 24 runs across 12 legal deliveries, or take three wickets.
The selected player determines the delivery action, stock seam/spin and available
pace range. Select a different bowler between deliveries; his style stays fixed
throughout the run-up. Batting-ladder progress is separate and unaffected.
After six legal balls, an unfinished innings pauses at the bowler picker.
Choose the next bowler and pace, then click **Start next over**; the bowl key
cannot skip this pause, and wides do not advance the over.

Bowling uses the original's same four keys:

| Controls | Bowling action |
|---|---|
| Space / Enter (or Bowl button) | Start the run-up |
| ← / → | Move the landing circle screen-left/right |
| ↑ / ↓ | Fuller / shorter length |
| W / S or pace slider | The quicker and slower ball, within the bowler's range |
| A / D | Seam or revolutions (see below) |
| Space | Lock line, length and pace early |
| C | Switch camera; bowling starts in the behind-bowler TV view |

A / D mean different things depending on who is bowling, and the panel names
them for whoever it is. For a seamer they tilt the seam, so the ball swings away
from the right-hander or into him — up to just short of the 20-degree angle
where the side force peaks. For a spinner the direction of turn belongs to his
action and cannot be chosen, so the same keys are how hard the ball is spun:
a big ripper one way, an arm ball the other.

The ring pulses cyan while editable, then turns green when locked. If Space is
not pressed, it locks automatically near the end of the run-up. The locked
delivery compensates for aerodynamic drift and uses the live physics integrator
to locate the landing point. Late inputs cannot change the ball already chosen.

The AI observes after release and commits to a leave, defence, ground stroke or
loft with its own footwork, aim and timing error. It uses the same contact/shot
solver, reach checks, running and fielding as a human. Loose balls invite attacks;
awkward lengths and changes of pace make timing harder. Outcomes are physical,
not preselected wickets or scores. Untouched balls outside the arcade 1.2 m
crease corridor count as wides: one extra, no legal ball or ball faced consumed.
This first version does not model manual field placement, no-ball foot faults,
LBW or signature deliveries. Bowlers and tuning are fictional, not EA roster data.

After the live dismissal hold, player-earned wickets show a brief close-up fist pump, raised arms or a
competitive point/stare before the team huddle and existing short walk-off.
Fours and sixes remain umpire-only.

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

The field radar rotates with the actual camera, including chase shots and cuts,
so its ball and fielders move in the same directions as the main view.

Fours and sixes trigger a large boundary graphic and a short confetti burst as
soon as the ball crosses the rope. After a brief wide shot, the broadcast cuts
to the umpire waving for four or raising both arms for six. Both finish after
the signal (2.6 seconds), without batsman or bowler reaction cuts. Confetti and the
graphic's bounce respect reduced-motion settings.

Wickets stay in the live camera for one second so the falling stumps or completed
catch remain visible, followed by a 5.2-second broadcast sequence: all eleven fielders gather around
the bowler, with staggered arrivals, high-fives, shoulder pats, applause and
fist pumps, then a shorter 2.2-second close-up of the dismissed batsman walking off.
Walk-offs vary between a bowed head, a straightforward exit and a hand on the
helmet; the bottom card shows name, dismissal, runs and balls including the
dismissal delivery. Reaction variants do not repeat consecutively and use a
separate random source so they cannot change bowling or shot outcomes. Live
HUD panels hide during these moments, and scoring happens once at the fade
before the next delivery. Cinematic players are reusable visual doubles, not
changes to the fielders' live positions or the batsmen's running state.

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

199 tests cover pure rules/decisions, procedural animation and real Rapier
delivery integration. Rapier wiring is confined to `lib/game/physics/world.ts`.

- `physics/aero.test.ts` — drag, Magnus, swing; includes integration checks that
  a delivery loses 8–20% of its pace over 20m and swings 15–90cm
- `physics/pitch.test.ts` — bounce, spin grip, seam movement
- `physics/world.test.ts` — the bowling machine: real Rapier deliveries, aimed
  and measured
- `match/shot.test.ts` — timing bands, footwork, aim, exit speed
- `match/state.test.ts` — the laws: wides don't count as balls, byes don't go to
  the batsman, strike rotates on odd runs *and* at the end of the over
- `match/over.test.ts` — a full over end to end, no renderer
- `match/player-bowling.test.ts` — specialist pace ranges, aiming bounds, landing
  accuracy for full/good/short lengths, wides and defending a target
- `match/ai-batsman.test.ts` — varied shot selection, leaves, imperfect footwork,
  timing mistakes, attacks on loose balls and difficulty after changes of pace
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

### Browser gameplay regression

With a dev server running, use an isolated headless browser profile:

```bash
GAME_URL=http://localhost:3000 node scripts/game-smoke.mjs
```

The script locates Playwright Chromium, Chrome or Edge; set `CHROME_PATH` for
another installation. It exercises the actual engine (batting animation and
fielding included), completes the ladder, verifies fours/sixes, tests movement
in both cameras, and checks failure/retry and saved unlocks. Bowling checks cover
UI start/Space focus, all four specialists, manual/automatic locking, landing
accuracy, actual AI bat contact, wide penalties, winning/losing defences, live
wicket impact holds, wicket close-ups, the end-of-over bowler picker and returning
to batting. It writes screenshots to the system
temporary directory. It requires the development-only `__game`
handle and does not use personal browser data.

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

Bowling as the player, full matches, team select,
manual running between the wickets, run-outs, LBW, byes, left-handers, DRS,
audio, gamepad. Gamepad is deferred
rather than designed out: `input/controller.ts` emits one intent shape and the
keyboard is merely today's source of it.

## Gameplay reference

The [Cricket 07 producer diary](https://worthplaying.com/article/2006/11/2/news/37478-cricket-07-ps2pc-developer-diary-1/)
describes crease movement, automatic/manual footwork and generous timing windows
for accessible boundary hitting. Those behaviors guide this implementation;
the tuning values and short challenge ladder are original, not recovered EA data.

For bowling, [GameSpot's contemporary Cricket 07 review](https://www.gamespot.com/reviews/cricket-07-review/1900-6162251/)
describes bowler-specific deliveries and controlling pace and the landing marker
during the run-up. This implementation follows that sequence with bounded,
steadier keyboard aiming and automatic locking rather than reproducing its
pace-overrun/no-ball meter.

## Assets and copyright

No EA models, textures, audio, logos or player likenesses are used. Everything
is generated procedurally. What is being matched is the visual language — HUD
layout, camera work, interaction grammar.
