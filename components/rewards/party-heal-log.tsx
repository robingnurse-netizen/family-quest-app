import type { PartyLog, Potion } from "@/lib/supabase/types";
import { formatRequestTime } from "@/lib/rewards/format";

/**
 * Parent HQ: recent party heals — potions the kids bought (who, which,
 * gold spent) and perfect-day heals from the nightly reset. Read from
 * party_log (server-rendered; refreshes on page load).
 */
export function PartyHealLog({
  entries,
  potions,
  names,
  timeZone,
}: {
  entries: PartyLog[];
  potions: Potion[];
  names: Record<string, string>;
  timeZone: string;
}) {
  const potionName = Object.fromEntries(potions.map((p) => [p.id, p.name]));
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold text-slate-900">Party healing</h2>
      <p className="mb-3 text-sm text-slate-600">
        Potions are bought with gold and used straight away (no approval needed). Perfect days — every quest
        done — heal the party at the nightly reset.
      </p>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
          No heals yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 text-slate-800">
                <strong>{e.child_id ? (names[e.child_id] ?? "A player") : "The party"}</strong>{" "}
                {e.event_type === "potion"
                  ? `bought a ${potionName[e.potion_id ?? ""] ?? "potion"} for ${e.gold_spent} gold`
                  : `had a perfect day${e.day ? ` (${e.day})` : ""}`}
                : +{e.amount} HP
              </span>
              <span className="shrink-0 text-slate-500">{formatRequestTime(e.created_at, timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
