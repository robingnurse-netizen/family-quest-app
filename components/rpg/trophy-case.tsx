import { SPRITES } from "@/components/rpg/sprites/manifests";
import type { SpriteManifest } from "@/components/rpg/sprites/types";
import { STATUE_EMPTY_ROWS_BELOW, STATUE_SINK_ROWS, type Trophy } from "@/lib/rpg/trophies";
import type { BossTier } from "@/lib/supabase/types";
import { TrophyCaseSounds, TrophyStatue } from "./trophy-statue";

// The Trophy Case: a wooden cabinet (the Item Shop's wall and plank) behind
// glass, with every boss standing on one shelf as a small statue, in the
// order they're fought. The shelf scrolls sideways instead of wrapping: one
// or two statues across a phone, four or five on a laptop. Read-only.
//
// Beaten bosses are lit — real colours and a gold trophy glow, with the
// defeat date and the damage dealt on a brass plaque. The rest — not reached
// yet, being fought now, or escaped — are black silhouettes with only a
// faint glow and a scratched-out nameplate (the name isn't even sent until
// the boss is beaten); only the line under it says which.
//
// The statues are buttons (./trophy-statue): a beaten one pulses gently,
// presses down and chimes when tapped; an unbeaten one stays rigid and
// clunks. Each stands on a small plinth; unbeaten ones have a dim cool glow
// behind them so the black shape separates from the wood.

/** Statue height by tier (bigger bosses, bigger statues), well under battle size. */
const STATUE_HEIGHT: Record<BossTier, string> = { low: "h-20", mid: "h-[5.5rem]", epic: "h-24" };
const TIER_LABEL: Record<BossTier, string> = { low: "Minion", mid: "Boss", epic: "Epic boss" };

export function TrophyCase({ trophies, timeZone }: { trophies: Trophy[]; timeZone: string }) {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
  const beaten = trophies.filter((t) => t.state === "defeated").length;

  return (
    <section aria-labelledby="trophy-case-title" className="panel panel-wood border-4 p-2 sm:p-3">
      <h2 id="trophy-case-title" className="sr-only">
        Trophy shelf: {beaten} of {trophies.length} bosses defeated
      </h2>
      <TrophyCaseSounds />
      <div className="shop-wall relative rounded-[3px] [container-type:inline-size]">
        {/* One shelf; scrolls sideways (focusable, so it scrolls from the keyboard too). */}
        <ul
          tabIndex={0}
          aria-label="Bosses, in the order they're fought"
          className="trophy-shelf flex snap-x snap-mandatory overflow-x-auto px-2 pb-3 pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {trophies.map((t) => (
            <TrophySlot key={t.id} trophy={t} date={date} />
          ))}
        </ul>
        {/* The glass front, over the whole shelf, and the frame's inner
            shadow (a recessed case) — over the contents, so statues and
            plaques pass under it at the edges. */}
        <div aria-hidden className="trophy-glass trophy-recess pointer-events-none absolute inset-0 rounded-[3px]" />
      </div>
    </section>
  );
}

function TrophySlot({ trophy: t, date }: { trophy: Trophy; date: Intl.DateTimeFormat }) {
  const lit = t.state === "defeated";
  const manifest = (SPRITES as Record<string, SpriteManifest>)[t.spriteKey];
  // The statue: the boss's front-facing still (its "front" animation, the
  // Trophy Case's own), else its battle idle's first frame.
  const pose = manifest?.animations.front ?? manifest?.animations.idle;
  const frame = pose?.frames[0];
  // Art that floats above its frame's bottom is set down onto the plinth,
  // plus any by-eye sink behind the plinth's top (a share of its own height,
  // so any tier size works).
  const setDownRows = (STATUE_EMPTY_ROWS_BELOW[t.spriteKey] ?? 0) + (STATUE_SINK_ROWS[t.spriteKey] ?? 0);
  const setDown = pose ? setDownRows / pose.height : 0;

  return (
    <li className="flex w-[clamp(8.5rem,48cqw,9.75rem)] shrink-0 snap-start flex-col">
      {/* The statue on its plinth, standing on the plank. A gold light
          behind a trophy (pulsing with its glow); a dim cool one behind a
          silhouette, so it reads against the wood. */}
      <div className="relative flex h-32 flex-col items-center justify-end px-2">
        <div aria-hidden className={`absolute inset-x-0 bottom-0 h-full ${lit ? "trophy-halo" : "trophy-cool-halo"}`} />
        <div className="relative min-h-0 w-full flex-1">
          <TrophyStatue unlocked={lit} label={lit ? `${t.name}, defeated` : `Unknown boss, ${statusText(t).toLowerCase()}`}>
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element -- a pixel-art frame, drawn at a fixed height
              <img
                src={frame}
                alt=""
                className={`sprite-pixelated max-w-full object-contain object-bottom ${STATUE_HEIGHT[t.tier]} ${
                  lit ? "trophy-lit" : "trophy-silhouette"
                }`}
                style={{
                  imageRendering: "pixelated",
                  ...(setDown ? { transform: `translateY(${(setDown * 100).toFixed(2)}%)` } : {}),
                }}
              />
            ) : (
              <span
                aria-hidden
                className={`flex aspect-square items-center justify-center rounded border-2 border-dashed border-stone-text/40 text-2xl font-black text-stone-text/60 ${STATUE_HEIGHT[t.tier]}`}
              >
                ?
              </span>
            )}
          </TrophyStatue>
        </div>
        <div aria-hidden className="trophy-plinth relative h-2.5 w-[70%]" />
      </div>
      <div aria-hidden className="shelf-plank h-3.5" />

      {/* The brass plaque. */}
      <div className="flex flex-1 justify-center px-1.5 pt-2">
        <div className="trophy-plaque w-full rounded-[3px] px-2 py-1.5 text-center text-[#26170a]">
          <p className="line-clamp-2 flex min-h-[2.5em] items-center justify-center font-display text-base font-semibold leading-tight">
            {t.name ?? (
              // Scratched out: the same bar for every unbeaten boss.
              <span role="img" aria-label="Name unknown" className="trophy-redacted" />
            )}
          </p>
          <p className="text-xs font-bold uppercase tracking-wide text-[#4a3014]">{TIER_LABEL[t.tier]}</p>
          {lit ? (
            <>
              <p className="mt-1 text-xs font-extrabold">
                {t.defeatedAt ? `Defeated ${date.format(new Date(t.defeatedAt))}` : "Defeated"}
              </p>
              <p className="text-xs font-extrabold">
                <span className="text-sm font-black">{t.damage}</span> damage
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs font-extrabold">{statusText(t)}</p>
          )}
        </div>
      </div>
    </li>
  );
}

/** The status line of an unbeaten boss (its identity stays hidden). */
function statusText(t: Trophy) {
  return t.state === "escaped" ? "Escaped" : t.state === "fighting" ? "Now fighting" : "Not yet faced";
}
