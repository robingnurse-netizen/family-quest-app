import { SpriteAnimator } from "@/components/rpg/sprites/SpriteAnimator";
import { SPRITES } from "@/components/rpg/sprites/manifests";

// Display heights in CSS px: the hero ~150px, Rogue about half that.
const HERO_SCALE = 150 / SPRITES.hero.animations.idle.height;
const ROGUE_SCALE = 80 / SPRITES.rogue.animations.idle.height;

/**
 * The player's party on the dashboard: the hero idling with Rogue beside
 * him (Rogue faces right, so he stands on the hero's left). Both sprites'
 * canvases end at the characters' feet, so bottom-aligning them puts them on
 * the same ground line.
 */
export function HeroParty({ heroName }: { heroName: string }) {
  return (
    <div className="relative flex items-end justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-indigo-900/40 to-indigo-950/60 px-4 pt-6">
      {/* Ground: painted first and at z-0 so it sits behind the characters' feet. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 z-0 h-3 bg-emerald-900/50" />
      <SpriteAnimator
        animation={SPRITES.rogue.animations.idle}
        scale={ROGUE_SCALE}
        alt="Rogue the dog"
        className="relative z-10"
      />
      <SpriteAnimator
        animation={SPRITES.hero.animations.idle}
        scale={HERO_SCALE}
        alt={heroName}
        className="relative z-10"
      />
    </div>
  );
}
