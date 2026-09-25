// Generated manifests (scripts/slice-sprites.mjs), keyed by character.
// Boss keys match bosses.sprite_key.
import abyssal_kraken from "./manifests/abyssal_kraken.json";
import alarm_clock_swarm from "./manifests/alarm_clock_swarm.json";
import cable_spider from "./manifests/cable_spider.json";
import chronosphinx from "./manifests/chronosphinx.json";
import hero from "./manifests/hero.json";
import laundry_goblin from "./manifests/laundry_goblin.json";
import magma_behemoth from "./manifests/magma_behemoth.json";
import rogue from "./manifests/rogue.json";
import shogun_bot from "./manifests/shogun_bot.json";
import swamp_bag_ooze from "./manifests/swamp_bag_ooze.json";
import trash_bag_slime from "./manifests/trash_bag_slime.json";
import type { SpriteAnimation, SpriteManifest } from "./types";

// JSON imports widen each animation's `facing` to string; the slicer only
// writes Facing values.
type Typed<T extends { animations: object }> = Omit<T, "animations"> & {
  animations: { [K in keyof T["animations"]]: SpriteAnimation };
};
const typed = <T extends { animations: object }>(json: T) => json as unknown as Typed<T>;

export const SPRITES = {
  hero: typed(hero),
  rogue: typed(rogue),
  trash_bag_slime: typed(trash_bag_slime),
  alarm_clock_swarm: typed(alarm_clock_swarm),
  laundry_goblin: typed(laundry_goblin),
  cable_spider: typed(cable_spider),
  swamp_bag_ooze: typed(swamp_bag_ooze),
  magma_behemoth: typed(magma_behemoth),
  chronosphinx: typed(chronosphinx),
  abyssal_kraken: typed(abyssal_kraken),
  shogun_bot: typed(shogun_bot),
} satisfies Record<string, SpriteManifest>;

export type SpriteKey = keyof typeof SPRITES;
