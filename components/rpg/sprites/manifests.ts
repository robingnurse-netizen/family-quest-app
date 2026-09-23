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
import trash_bag_slime from "./manifests/trash_bag_slime.json";
import type { SpriteManifest } from "./types";

export const SPRITES = {
  hero,
  rogue,
  trash_bag_slime,
  alarm_clock_swarm,
  laundry_goblin,
  cable_spider,
  magma_behemoth,
  chronosphinx,
  abyssal_kraken,
  shogun_bot,
} satisfies Record<string, SpriteManifest>;

export type SpriteKey = keyof typeof SPRITES;
