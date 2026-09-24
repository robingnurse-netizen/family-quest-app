// Print a day's sunrise / sunset and the sky period for lib/sun-times.ts.
//
// Usage: node scripts/sun-times-check.mjs [ISO date-time] [timezone]
//   node scripts/sun-times-check.mjs                       # now, Europe/London
//   node scripts/sun-times-check.mjs 2026-12-21T12:00:00Z  # another moment
import { fileURLToPath } from "node:url";
import { importTs } from "../tests/helpers/load-ts.mjs";

const { SUN_LOCATION, DAWN_WINDOW, DUSK_WINDOW, skyPeriod } = await importTs(
  fileURLToPath(new URL("../lib/sun-times.ts", import.meta.url)),
);
const { timeOf } = await importTs(fileURLToPath(new URL("../lib/calendar/dates.ts", import.meta.url)));

const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
const timeZone = process.argv[3] ?? "Europe/London";
const { period, times, windows } = skyPeriod(now, timeZone);
const at = (d) => (d ? `${timeOf(d, timeZone)}  (${d.toISOString()})` : "none");

console.log(`${SUN_LOCATION.name} (${SUN_LOCATION.lat}, ${SUN_LOCATION.lon}), ${timeZone}, ${times.dayKey}`);
console.log(`  sunrise  ${at(times.sunrise)}`);
console.log(`  sunset   ${at(times.sunset)}`);
if (windows) {
  console.log(`  dawn     ${timeOf(windows.dawnStart, timeZone)}–${timeOf(windows.dawnEnd, timeZone)}` +
    `  (${DAWN_WINDOW.beforeMin} min before / ${DAWN_WINDOW.afterMin} after sunrise)`);
  console.log(`  day      ${timeOf(windows.dawnEnd, timeZone)}–${timeOf(windows.duskStart, timeZone)}`);
  console.log(`  dusk     ${timeOf(windows.duskStart, timeZone)}–${timeOf(windows.duskEnd, timeZone)}` +
    `  (${DUSK_WINDOW.beforeMin} min before / ${DUSK_WINDOW.afterMin} after sunset)`);
  console.log(`  night    otherwise`);
}
if (times.polar) console.log(`  polar: ${times.polar}`);
console.log(`now ${timeOf(now, timeZone)} -> ${period}`);
