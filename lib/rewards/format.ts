// Display helpers for the rewards store.

/** "Wed 23 Sep, 14:05" in the family's timezone (same on server and client). */
export function formatRequestTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
