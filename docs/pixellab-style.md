# PixelLab style reference (boss art redo)

How new boss art is generated, so every boss matches the hero, Rogue and the
pilot boss (Trash-Bag Slime). Check the balance with `get_balance` and confirm
the cost before any paid generation (see CLAUDE.md, "TOOLING — PixelLab MCP").

## Size: pixel parity with the hero

Boss pixels should be the same size on screen as the hero's. The hero's idle
is 62 art px tall at `HERO_BODY` (0.5485) of the arena, so a boss's idle
(bob included) should be `HEIGHT.boss[tier] × 62 / 0.5485` art px tall
(components/rpg/battle/stage-layout.tsx):

| Tier | Target drawn height | Character canvas (`size`) |
|------|---------------------|---------------------------|
| low  | ~59 px              | 64                        |
| mid  | ~72 px              | 76                        |
| epic | ~84 px              | 88                        |

- PixelLab draws the character to (almost) fill its canvas: the hero is 60 px
  in a 64 canvas, the pilot slime exactly 59 px in 64. So the canvas is the
  target height plus a few px — not a larger canvas "for headroom".
- Headroom for lunges, hops and death frames comes from animation: v3
  animations grow their own canvas around the motion (the hero's 64 px
  character animates in 112 px cells). The slicer crops every frame tight.
- Width: keep the idle under ~90 art px wide where the design allows (above
  that, phones shrink the boss and its pixels stop matching). Flag designs
  that can't fit rather than cramping them; minor phone-only shrink is OK.
- Always measure the generated rotation (drawn height and width) before
  animating; re-generate if it misses the target.

## Character (`create_character`)

| Setting   | Value                                        |
|-----------|----------------------------------------------|
| mode      | `v3` (2 generations at 64)                   |
| size      | 64 / 76 / 88 by tier (above)                 |
| view      | `side` (the hero's)                          |
| outline   | `single color black outline`                 |
| detail    | `medium detail`                              |
| body_type | default (`humanoid`; v3 ignores the skeleton) |

Description pattern (the pilot's, word for word):

> Trash-Bag Slime, a small comical monster boss: a lumpy, squat, teal-green
> garbage bag come to life as a slime blob, wider than it is tall, with the
> bag's plastic top gathered and twisted into a knot with a dark tie on top.
> Big round white googly eyes with small black pupils, a wide jagged grin with
> a few crooked teeth. Glossy plastic highlights, a slightly darker slimy base
> where it meets the ground. No arms or legs. Clean crisp pixel art: single
> black outline, flat shading with 2-3 tones per colour, lighting from the
> top-left.

- Open with the boss's name and "a <size> comical monster boss", then its
  household-chore concept, then face / expression.
- Mood: goofy and comical rather than scary (the player is 10); epic bosses
  can be grander, still not frightening.
- Always end with the style line: "Clean crisp pixel art: single black
  outline, flat shading with 2-3 tones per colour, lighting from the
  top-left." (the same wording as Rogue's character).
- Keep each boss's existing design (colours, signature features) from its
  current sprite unless we're redesigning it.

## Non-humanoid bosses: describe the body plan

v3 only makes humanoid characters (it rejects `body_type: quadruped`), and
its humanoid skeleton wins over plain wording: "no legs", "hovers" and
"four legs tucked" still produced legs, feet and upright two-legged
poses (the first Alarm Clock Swarm stood on stubby legs; its first re-roll
became a walking clock-robot with boxing-glove fists; the first two
Chronosphinxes were upright lion-men). What worked was describing a
different BODY PLAN, so there's no body for the skeleton to stand up:

- A flying four-legged creature: "shown flying sideways through the air in
  a horizontal pose like a lying sphinx statue, its long lion body
  stretched out level from head to tail, all four legs folded underneath
  its belly, floating high above the ground" (Chronosphinx: four legs at
  last, crouched rather than visibly floating; the game can lift it).
- A swarm: "a loose flock of five small separate … flying through the air
  together like a flock of birds, scattered in a rough circle in mid-air
  with gaps between them. Not a creature with a body: there are no legs,
  no feet, no arms, no hands, no torso, only flying clocks." (Alarm Clock
  Swarm: a ring of separate winged clocks.)
- A cloud: "its main body is a big billowing cloud … soft wispy puffy
  edges, not a solid lump" (Swamp-Bag Ooze).
- A key prop: lead with it and say where it is ("wields a large club …
  clearly visible, gripped in one big fist and held up ready to swing") —
  mentioned mid-description, the Tupperware Troll's club was dropped.
- To keep a design inside the canvas: "compact pose … with space on every
  side" (the first Chronosphinx touched all four edges).

Budget 1–2 re-rolls (2 generations each) for these. Small stray pixels can
appear (the swarm had 9 specks inside its ring): clean them locally
(remove clusters of < 10 px away from the art) rather than re-rolling;
the PixelLab character keeps them, so animation frames need the same
cleanup.

## Direction

- Bosses face LEFT in 3/4 view = PixelLab direction **`south-west`**.
  (The hero and Rogue are `south-east`, facing right.) Only south-west is
  animated. Set `facing: "left"` for every boss animation in the slicer's
  FACING; the game mirrors a fleeing boss itself.

## Animations (`animate_character`)

v3 custom, `directions: ["south-west"]`, `frame_count: 8` (stored as 9: the
rotation as frame 0 + 8 animated), 1 generation each at 64. Names and
wording used for the pilot:

| animation_name | action_description |
|----------------|--------------------|
| idle   | idle breathing loop: the slime bag gently squashes and stretches in place, wobbling softly, then returns to its starting pose |
| attack | attacks: the slime rears up tall, then slams forward in a big hopping lunge toward the left, mouth wide open, slimy tendrils reaching forward, clear forward motion toward camera-left, then hops back to its starting pose |
| hurt   | gets hit: flinches backward and squashes sharply from the blow, eyes squeezed shut, then wobbles and recovers to its starting pose |
| death  | is defeated: the bag splits open and collapses completely flat into a wide puddle of slime on the ground, only the tied knot left sticking up out of the mess, eyes become dizzy X shapes, ends lying flat and still |
| move   | moving loop: hops along, bouncing and squashing like a jelly slime with each hop, then lands back in its starting pose |

The attack and death rows are the re-rolls that worked. The first wording
("squashes down to wind up, then lunges forward…", "sags, deflates and
collapses…") gave barely any motion: the slime squashed a few px and just
changed its expression, and the death ended on a contented smile. What worked:
literal, visible actions with a direction ("toward the left, clear forward
motion toward camera-left"), the facial expression spelled out ("mouth wide
open"), and the end state stated ("ends lying flat and still"). v3 stays
close to the reference pose, so ask for big, specific changes. Details may
still be skipped (the death's "X eyes" came out closed eyes). Re-rolls are
1 generation each at 64.

Adapt the body verbs to the boss (a slime "squashes"; a robot "swings its
sword"), keep the structure: start pose → action → back to the start pose
(or, for death, ending lying still).

Record for each boss: the attack's **contact frame** (the blow lands) and
hurt's **peak frame** (deepest flinch). Put the contact frame in the
slicer's config (`attack: { row: 1, contact: 5 }`): it goes into the
manifest, and the game trims the attack's wind-up so that frame is on screen
as the blow lands (BOSS_ATTACK_IMPACT_MS, 210ms; lib/rpg/strike.ts
bossAttackAnimation). At 10 fps that drops the first 3 frames, so put the
wind-up's key pose within ~2 frames of contact.

## Checking a boss in the browser (dev console)

`next dev` only (`window.__fqBattle`, on /player). Nothing is written to the
database. First put the boss on stage in this tab:

```js
await __fqBattle.jumpToBoss("alarm_clock_swarm"); // any sprite_key, or a 1-based roster position
```

| Animation | Command |
|-----------|---------|
| idle   | plays on its own once the boss is on stage |
| attack | `__fqBattle.hurt(10)` (a missed quest: the boss hits the party) |
| hurt   | `__fqBattle.hit(15)` (a quest strikes it; also the hit overlay) |
| death  | `__fqBattle.finalBlow()` |
| move (escape) | the snippet below |

The escape needs the real boss row: `escaped` events for any other `id`
than the boss on stage are ignored, and `bosses()` only prints a table (it
returns nothing). `jumpToBoss` emits an `activated` event carrying exactly
the boss it put on stage, so catch it with `listen()` (which returns its
unsubscribe function):

```js
// Swap in any boss's sprite_key.
let boss;
const stop = __fqBattle.listen((e) => { if (e.type === "activated") boss = e.boss; });
await __fqBattle.jumpToBoss("alarm_clock_swarm");
stop();
__fqBattle.emit({ type: "escaped", boss: { ...boss, status: "escaped" } });
```

The boss plays `move`, slides off to the right (mirrored to face the way it
flees), the banner says "<Boss> escaped!", then the tab's active boss (the
same dev boss) re-enters. `__fqBattle.jumpToBoss(null)` goes back to the
database's boss. (`knockOut()` only empties the party; the escape itself
happens in the nightly reset.)

## Pilot record: Trash-Bag Slime

- Character `a380da4d-4c2a-402f-bf6b-f1063c735e15` (v3, 64, side, 8 dirs);
  south-west rotation 51 w × 59 h px. Cost: 2 + 5 + 2 (re-rolls) = 9
  generations.
- Chosen animations (9 frames each, 84×84 canvas): idle, hurt (peak frame
  3), move, attack-v2 (contact frame 5), death-v2. The first attack / death
  remain in the PixelLab character, unused.

## Alarm Clock Swarm record

- Character `fa3bd6fe-c464-43f2-bea0-24618512c504` (a ring of six winged
  clocks). Chosen animations: idle, attack (contact frame 4: the ring
  bunches up in frame 3, bursts in 4), hurt (peak spread frame 4), move,
  death-v3. The unused death / death-v2 remain in the PixelLab character.
- Cost: 2 generations per animation, not 1 — the swarm's silhouette grew
  the v3 canvas to 92×92. 5 + 1 re-roll (death-v2) at 2 each, death-v3 at 1
  (with an end frame the canvas stayed 64): 13 generations.
- Wording: every prompt restates the body plan ("a loose flock of six small
  separate alarm clocks with tiny bat-like wings … Not a creature with a
  body: no legs, no feet, only flying clocks"). The attack stayed in place
  (bunch up, burst) instead of diving left; the CSS lunge supplies the
  forward motion. Deaths without an end frame either fell into a tidy
  intact pile (v1) or shattered but kept floating (v2).
- What worked for the death: a hand-assembled END FRAME
  (`end_frame_base64`, same 64×64 canvas as the rotation): the six clocks
  cut from the rotation and rearranged into a low heap on the rotation's
  bottom row (on their sides / upside down, one split in half, blacked-out
  cracked faces, springs, bent hammers, shards, wings underneath). v3
  interpolates the ring into it and ends on it pixel for pixel. The
  weakness: little shattering in the air — breakage shows from the landing.
- Sheet: assets/alarm-clock-swarm-pixellab.png, assembled from the
  PixelLab frames (96px cells; v3 canvases differ per animation — 92×92,
  96×80 for the end-frame death — so each frame is placed with the
  rotation at the same spot in every cell). Speck cleanup, 8-connected:
  frame 0 of every row and all of idle / move lose every cluster under
  10 px; attack / hurt / death frames 1–7 keep their outer debris (sparks,
  scatter, shards) and lose only the specks inside the ring (under 20 px);
  the hand-drawn last death frame is untouched.
- Hovering: the slicer's `ground` option gives every row one shared ground
  line (the idle bob's lowest point); idle / attack / hurt / move are
  airborne throughout (frame 0 hovers 4 px up), the death's heap lands on
  the line.

## Remaining-roster pass (six bosses, one autonomous run)

Tools (rough helpers in scripts/pixellab-helpers/, inputs git-ignored):

- Frames: the character's download ZIP
  (`https://api.pixellab.ai/mcp/characters/<id>/download`) holds every
  animation as `<name>/south-west/frame_NNN.png`; unpack into
  `PIXELLAB_WORK/<name>/<n>.png`.
- `build-boss-sheet.cjs <key>`: the general form of build-sheet.cjs. One
  config entry per boss (file, cell, rows); frames copied at the same spot
  (every v3 animation of a character shares one canvas with the rotation).
  Speck cleanup (8-connected, < 10 px): idle / move / frames 0 and 8
  lose every small cluster; attack / hurt / death frames 1–7 keep the ones
  outside the body's bounding box (sparks, splashes, shards) unless they
  hang below frame 0's ground row.
- `preview-gif.cjs <key>`: a GIF of the sliced animations on one ground
  line (idle, attack, idle, hurt, idle, move, death held) →
  scripts/pixellab-helpers/previews/<key>.gif (git-ignored).

### Laundry Goblin record

- Character `6319df54-b5d0-4fb3-9a43-bb8adcb345d5`; v3 animations at an
  88×88 canvas, 1 generation each: 5 generations, no re-rolls.
- Sheet: assets/laundry-goblin-pixellab.png (88px cells). Idle 55×62.
- Hand fixes after browser review (scripts/pixellab-helpers/goblin-fixes.cjs,
  the builder's `fix` hook): v3 hung dark / water-blue drips off the wet
  sock in most frames (they read as noise, and touch the sock diagonally,
  so speck cleanup missed them) — removed below the sock loop, as
  detached droplets in the raised-sock attack frames, and pixel by pixel
  in hurt 4 / 6; the attack's strike splash (5–6) stays. A pale speck on
  the left ear's outline (frame 0 of every row) is now outline black, and
  the far eye's highlight under that ear, which flashed bright cream in
  some frames, is held dim grey.
- Wording (all first tries): idle "stands hunched … shoulders rising and
  falling … the wet grey sock dangling from its fist"; attack "raises the
  wet grey sock high over its head … lunges forward toward the left and
  whips the sock down hard in front of it like a whip, water droplets
  spraying, mouth open in a snarl, clear forward motion toward
  camera-left"; hurt "recoils sharply backward toward the right … arms
  flung up, knees buckling"; death "knees give way and it topples over
  backward, falling flat onto its back … ends lying flat and still on the
  ground"; move "scurries along in place with quick sneaky hunched steps".
- Contact frame 5 (the splash; the sock is raised in 2–4), 16 fps like the
  slime. Attack 5–7 are a small lunge hop (3 px up: airborne); hurt 3–7 a
  knock-back hop (airborne), peak frame 4. Death ends flat on his back
  (the hat stayed on; no X eyes — as with the slime, details get skipped).

### Cable Spider record

- Character `66d961db-4910-4fd5-a730-d7204ec457bc`; 88×88 canvas, 1
  generation each: 5 + 1 re-roll (attack-v2) + 2 deaths (death-v2,
  death-v3 with the end frame) = 8 generations.
- Sheet: assets/cable-spider-pixellab.png (88px cells). Idle 55×63.
- Every prompt restates the body plan up front: "the spider made of a green
  circuit-board body on eight tangled cable legs with plug connector feet,
  not a person" — no humanoid drift in any of the six.
- Attack re-rolled: v1 ("rears back … stabs both front plug legs down")
  barely moved and its ground sparks sank under the line. attack-v2
  ("crouches low, then springs forward toward the left in a big pouncing
  leap, its whole body shifting far to the left, front cable legs
  stretched out ahead … crackling with blue electric sparks") pounces:
  contact frame 4 (furthest reach), the leap 3–7 airborne (up to 8 px).
- Hurt peak 4–5 (legs splayed, sparks).
- Death needed the END-FRAME fallback (after browser review: the first
  death never reached the floor). v1 (a white short-circuit flash, then a
  splayed heap) and death-v2 ("all its cable legs give way at once and
  the body drops straight down and slams flat onto the ground … lying
  directly on the ground with no gap underneath") both ended standing on
  splayed legs with the body ~15 px up — v3 keeps the legs' pose. death-v3
  animates into a hand-drawn end frame (scripts/pixellab-helpers/
  spider-heap.cjs, 64×64 like the rotation): the body cut from the
  rotation dropped onto the ground row, cracked, eyes dark, a smoke wisp,
  eight cable legs drawn sprawled flat with plugs on their sides. The legs
  buckle and splay (4–6) and the body lands (6–8), ending on the drawn
  frame. Its canvas grew to 104×96, so the builder places it at off
  [-8, -4]; the end frame is exempt from speck cleanup (`keepAll`).
- Unused: attack (v1), death, death-v2 stay in the PixelLab character.

### Magma Behemoth record

- Character `7f1f6a34-a937-4d44-901b-d41c4c98edce`; the 88px character
  animates in a 116×116 canvas at 2 generations each: 5 + 1 re-roll
  (death-v2) = 12 generations.
- Sheet: assets/magma-behemoth-pixellab.png (116px cells). Idle 77×83.
- Attack (first try): "raises both giant rocky fists high above its head,
  then lunges forward … smashes both fists down onto the ground … a burst
  of orange lava sparks and rock chunks". Fists up 1–3, the whole body
  flashes white-hot on the smash (contact frame 4), lava bursts 5–7 —
  the burst splashed below his feet, so the builder clips 5–7 at the
  ground row (`clip`).
- Hurt: the lava cracks flare bright and he rocks back (peak 3–4).
- Death re-rolled: v1 ("cracks go dark … drops to its knees, then … crumbles
  down into a big heap of broken grey boulders") cooled grey nicely but
  only sank into a crouch with a few pebbles. death-v2 ("topples over and
  crashes face-down flat onto the ground, and on impact its body shatters
  apart into many separate loose grey boulders … ends as a low flat
  scattered pile … nothing left standing") falls and lands as a flat
  lumpy rock pile with chunks breaking off (it keeps its lava glow;
  lying frames 4–8 lifted 3–4 px onto the line). No end-frame fallback
  needed.

### Chronosphinx record

- Character `a88b0deb-f48b-46a4-9733-e827753a7fd7`; 124×124 v3 canvas,
  2 generations each: 10 generations, no re-rolls.
- Sheet: assets/chronosphinx-pixellab.png (124px cells). Idle 93×79 (a
  little over the ~90 px width guide: the wings and scythe).
- Wording: every prompt opens with "the winged sphinx, a lion body with two
  big dark feathered wings, a blue-and-gold pharaoh headdress and a long
  scythe", then says it's airborne explicitly: "floating in mid-air with a
  clear gap of empty air below its paws and scythe, never touching the
  ground" (idle), "staying airborne" (attack / hurt), "flies in place high
  in the air with a clear gap below it" (move). v3 still starts from the
  crouched rotation, but idle and move rise 8–9 px on the wing beats
  instead of settling.
- Hover: the slicer's `ground` puts every row on cell row 106 (the attack's
  slash arc, the lowest thing it draws), so frame 0 floats 8 px up; idle /
  attack / hurt / move are airborne throughout.
- Attack: scythe raised 2–4, a golden slash arc on contact frame 5. Hurt
  peak 4. Death: "its hourglass pendant cracks and spills its sand, its
  wings go limp and it drops out of the air" — the glowing sand spills in
  3–6 (still hovering), then it lies slumped with its wings draped (7–8,
  dropped 5 px onto the line: the crash). X eyes skipped again.

### Abyssal Kraken record

- Character `ab99db9a-f403-4f91-adcd-b6d77b91260b`; 112×112 v3 canvas,
  2 generations each: 10 generations, no re-rolls.
- Sheet: assets/abyssal-kraken-pixellab.png (112px cells). Idle 79×79.
- Loose tentacle removed (after browser review): the rotation has a
  tentacle piece floating free below-left of the body, carried into the
  early frames of every animation. kraken-fixes.cjs (the builder's `fix`
  hook) deletes it — any small non-body piece in that corner, counted
  4-connected since it touches a tentacle only at a corner in idle 3 / 6.
  Where it merges into a real curling tentacle (hurt 5–8, the death's
  sprawl) it stays.
- Wording: every prompt opens with "the giant dark octopus with a glowing
  blue whirlpool spiral on its round head, not a person, no legs, only
  eight curling tentacles" plus "floating in mid-air as if underwater with
  empty air below its tentacle tips" / "staying afloat" / "swims through
  the air in place like a squid, never touching the ground". No humanoid
  drift.
- Hover like the Chronosphinx: `ground` cell row 100 (frame 0 8 px up,
  clear of the attack splash's lowest pixel, 98); only the death lands.
- Attack: coils (1–4), then a big glowing water splash (contact frame 6);
  the tentacle lash itself is small — the CSS lunge carries the forward
  motion, as with the swarm. Hurt peak 4–5. Death: the spiral glow
  flashes out (1–2), the head goes dull and sags, it sinks and sprawls
  flat, tentacles splayed (7–8, dropped 4 px onto the line). No ink puddle
  or X eyes; a limp splat is the octopus's "broken", so no re-roll.

### Shogun-Bot record

- Character `1a1a4b4d-65c1-4713-befe-5e3976ebb006`; 124×124 v3 canvas,
  2 generations each: 5 + 1 re-roll (hurt-v2) = 12 generations.
- Sheet: assets/shogun-bot-pixellab.png (124px cells). Idle 71×86.
- Attack (first try): "raises its katana high above its head with both
  hands, then steps forward toward the left and swings the katana down in
  a big diagonal slash … a bright cyan energy arc trailing the blade":
  raised 2–3, arc 4, the blade lands in a cyan flash on contact frame 5.
- Hurt re-rolled: v1 ("knocked backward … staggering one step back")
  just turned to face the camera. hurt-v2 ("still facing left the whole
  time, recoils from a blow to the chest: its upper body jerks sharply
  backward toward the right and it hunches over … bright sparks bursting
  off its chest armour") hunches (3–4) and bursts sparks (peak 5–6); it
  ends with one arm still raised, so it snaps back into the idle — minor
  for a quick flinch, not worth a third roll.
- Death (first try): the core flashes, sparks burst, it falls face-down
  with armour pieces scattered (the dropped katana's tip is the lowest
  pixel, so lying frames lift 2–4 px).
- "Keep facing left the whole time" is worth adding to any humanoid
  flinch: "knocked backward" alone rotated him toward the camera.

### Roster pass totals

Six bosses, 57 generations: goblin 5, spider 8, behemoth 12, sphinx 10,
kraken 10, shogun 12. Four re-rolls (spider attack, spider death,
behemoth death, shogun hurt) and one end-frame fallback (the spider's
death, after browser review). Hand fixes after browser review: the
goblin's sock drips and ear speck (goblin-fixes.cjs), the kraken's loose
tentacle piece (kraken-fixes.cjs). Every accepted boss in the database
is now PixelLab art; the four mid bosses (not seeded) remain.

## Mid-tier pass (Ooze, Troll, Minotaur; one autonomous run)

The three grounded mid bosses (76px characters). The Scatter-Brick Serpent
is left for hand-guided work (its death needs the end-frame technique).
v3 animated each at a 104px canvas, 2 generations per animation. Rule for
the run: 1 generation per animation, up to 2 re-rolls if weak; a death
that still doesn't both land and look broken after 2 re-rolls falls back
to a hand-drawn end frame. build-boss-sheet.cjs now takes a per-boss
`work` folder, a row's `frames` remap and `align` (see its header).

### Swamp-Bag Ooze record

- Character `d8dc412c-48a9-46f8-952f-5b40429913cb`; 104×104 v3 canvas:
  5 + 3 re-rolls (attack-v2, hurt-v2, hurt-v3) = 16 generations.
- Sheet: assets/swamp-bag-ooze-pixellab.png (104px cells). Idle 59×71.
- Body plan: a green ooze cloud rising out of a navy gym bag, no legs.
  Every prompt says "not a person, no legs, the bag stays on the ground";
  no humanoid drift, the bag stayed planted in all five. Grounded (the
  bag is its feet), no hover.
- The small yellow stink-wisp squiggles are specks to the builder, so
  they're gone from idle / move / every frame 0 (consistently: they'd
  flicker otherwise).
- Attack re-rolled: v1 barely moved, its splatter arriving only at frame
  7. attack-v2 ("leans far back and puffs up … lunges far forward toward
  the left out of the bag, head thrust way out ahead, mouth wide open …
  a big glob of green slime spraying out in front of it"): the mouth
  opens wide (3–6), then a big glob bursts forward (7–8). It never
  retracts, so the contact is the last frame (8) at 16 fps: the game
  plays the roar (5–7) into the glob on the blow, then the idle takes
  over like a spit.
- Hurt re-rolled twice (the limit): v1 changed only the expression, v2
  flung a sock but hardly flinched. hurt-v3 ("takes a hard blow on its
  head and gets squashed: pressed down low and flattened wide like a
  squashed jelly, sinking halfway down into the gym bag") squashes into
  the bag, eyes shut (peak 4–5). Still modest; accepted.
- Death (first try): melts, the bag tips over and the ooze spills into a
  flat puddle with the socks limp. Its frame 8 faded the puddle's fill to
  a hollow outline ring (read like a drawn ground shadow), so the sheet
  holds frame 7 as the end frame (`frames: [0..7, 7]`). The spill spreads
  toward the camera, so lying frames lift 4–5 px onto the line.
- Unused: attack, hurt, hurt-v2 stay in the PixelLab character.

### Tupperware Troll record

- Character `6541a691-639b-410e-ace9-e2d882b04490`; 104×104 v3 canvas:
  5 + 3 re-rolls (attack-v2, hurt-v2, death-v2) = 16 generations.
- Sheet: assets/tupperware-troll-pixellab.png (104px cells). Idle 71×75.
- The club is the round orange one resting on his shoulder (what looks
  like a club in his low fist is his forearm armour).
- Attack re-rolled: v1 went off-model mid-swing (turned to the camera,
  slimmed down, the club became a thin staff). attack-v2 opens "still
  facing left the whole time, keeping its bulky plastic container armour
  and big round orange club": club overhead (3–4), slammed into the
  ground in an orange burst on contact frame 5, crumbs (6–7; the burst
  clipped at the ground row). It ends with the club down in front (a
  small snap back to the idle).
- Hurt re-rolled: v1 barely hunched. hurt-v2 ("struck hard in the face:
  its head snaps back and its whole body rocks far backward … a plastic
  lid flying off"): head back, helmet jolting, mouth open (peak 4–5).
- Death re-rolled: v1 fell flat face-down but only 2–3 crumbs came off —
  knocked out, not broken. death-v2 spells the break-up out ("the clear
  tub helmet flies off and rolls away, the shoulder containers crack open
  and tumble off, lids and broken plastic pieces scatter, the big orange
  club rolls away"): the helmet flies, the club rolls, bits scatter, he
  crashes face-down (helmet landing back on him). No end-frame fallback.
- Unused: attack, hurt, death stay in the PixelLab character.

## Accepted boss characters (still images; not animated yet)

South-west rotation sizes (drawn art, w × h). All v3, side view, 8
directions; rejected attempts are still in the PixelLab account.

| Boss | Tier (canvas) | PixelLab character | Size | Notes |
|------|---------------|--------------------|------|-------|
| Trash-Bag Slime | low (64) | a380da4d-4c2a-402f-bf6b-f1063c735e15 | 51 × 59 | animated + integrated (pilot) |
| Alarm Clock Swarm | low (64) | fa3bd6fe-c464-43f2-bea0-24618512c504 ("v3") | 62 × 55 | animated + integrated (see its record above) |
| Laundry Goblin | low (64) | 6319df54-b5d0-4fb3-9a43-bb8adcb345d5 | 49 × 61 | animated + integrated (roster pass); the wet sock reads as a hook/rope |
| Cable Spider | low (64) | 66d961db-4910-4fd5-a730-d7204ec457bc | 55 × 60 | animated + integrated (roster pass) |
| Swamp-Bag Ooze | mid (76) | d8dc412c-48a9-46f8-952f-5b40429913cb ("v2") | 57 × 71 | animated + integrated (mid-tier pass); seeded for new families only |
| Tupperware Troll | mid (76) | 6541a691-639b-410e-ace9-e2d882b04490 ("v2") | 70 × 71 | animated + integrated (mid-tier pass); seeded for new families only |
| Scatter-Brick Serpent | mid (76) | 1419f66d-8535-4fea-a557-795c17d499c7 | 66 × 71 | NEW boss; no limbs: hand-guide its animation |
| Mud-Track Minotaur | mid (76) | 46a04b65-be1f-4e65-be04-0689bb42db67 | 57 × 71 | NEW boss: needs a roster migration |
| Magma Behemoth | epic (88) | 7f1f6a34-a937-4d44-901b-d41c4c98edce | 71 × 78 | animated + integrated (roster pass); very dark: check it at night |
| Chronosphinx | epic (88) | a88b0deb-f48b-46a4-9733-e827753a7fd7 ("v3") | 83 × 79 | animated + integrated (roster pass); hovers via the slicer's `ground` |
| Abyssal Kraken | epic (88) | ab99db9a-f403-4f91-adcd-b6d77b91260b | 77 × 75 | animated + integrated (roster pass); hovers; dark: check it at night |
| Shogun-Bot | epic (88) | 1a1a4b4d-65c1-4713-befe-5e3976ebb006 | 68 × 85 | animated + integrated (roster pass); navy/gold more than cyan |

Batch cost: 22 (11 characters) + 12 (6 re-rolls) generations. Tier 1
allows 8 PixelLab jobs at once, PixelLab's own follow-up jobs included:
submit in waves.
