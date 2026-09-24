// Instant loading state for the player dashboard (Next wraps page.tsx in a
// Suspense boundary with this as the fallback). The page waits on several
// Supabase round trips before it renders, and on a hard refresh the bare
// world background showed full-screen until it arrived. This paints the
// dashboard's frame straight away instead — the same outer pieces and sizes
// as the real page (battle-scene arena, quest board, shop stall), empty, so
// the content drops into place without a jump.
//
// No data, no client code: the arena is a dark well rather than a sky (the
// real sky depends on the family's time of day, which isn't known here).
//
// The (dashboard) route group (URL still /player) scopes it: a loading.tsx
// also covers every route below its folder, and /player/store and
// /player/quest-log shouldn't show a dashboard skeleton.

const pulse = "animate-pulse motion-reduce:animate-none";

export default function PlayerDashboardLoading() {
  return (
    <main className="flex-1 px-4 pb-12 pt-8">
      <div role="status" className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <span className="sr-only">Loading your quest…</span>

        {/* Header: the greeting's line (text-2xl / sm:text-3xl) and the gear. */}
        <div aria-hidden className="flex items-center justify-between gap-4">
          <div className={`h-8 w-56 rounded-[3px] bg-white/10 sm:h-9 sm:w-72 ${pulse}`} />
          <div className="h-10 w-10 rounded-[3px] bg-white/10" />
        </div>

        {/* Battle scene: stone frame, the arena at its real height (the same
            container-query size as ARENA_VARS' --arena), the HUD rows. */}
        <section
          aria-hidden
          className="panel panel-stone border-4 p-2 shadow-[inset_3px_3px_0_var(--panel-hi),inset_-3px_-3px_0_var(--panel-shade)] [container-type:inline-size] sm:p-3"
        >
          <div
            className={`panel panel-inset rounded-[2px] ${pulse}`}
            style={{ height: "min(270px, 58cqw)" }}
          />
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:mt-3 sm:gap-x-4">
            <div className="h-11 rounded-[3px] bg-black/25" />
            <div className="h-11 rounded-[3px] bg-black/25" />
            <div className="col-span-2 mt-2 h-14 rounded-[3px] bg-black/25" />
          </div>
        </section>

        {/* Quest board: wooden frame around the cork. */}
        <section aria-hidden className="panel panel-wood p-2 sm:p-3">
          <div className={`quest-cork h-72 rounded-[2px] border-2 border-wood-edge sm:h-80 ${pulse}`} />
        </section>

        {/* Shop stall: awning over a wooden counter. */}
        <section aria-hidden className="shop-stall">
          <div className="shop-awning shop-awning-slim" />
          <div className="panel panel-wood h-16 rounded-t-none" />
        </section>
      </div>
    </main>
  );
}
