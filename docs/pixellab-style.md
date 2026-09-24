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

## Pilot record: Trash-Bag Slime

- Character `a380da4d-4c2a-402f-bf6b-f1063c735e15` (v3, 64, side, 8 dirs);
  south-west rotation 51 w × 59 h px. Cost: 2 + 5 + 2 (re-rolls) = 9
  generations.
- Chosen animations (9 frames each, 84×84 canvas): idle, hurt (peak frame
  3), move, attack-v2 (contact frame 5), death-v2. The first attack / death
  remain in the PixelLab character, unused.
