// The rescue card's wording (lib/rpg/rescue.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { rescueDeadline, friendlyRescueError } = await importTs(fileURLToPath(new URL("../lib/rpg/rescue.ts", import.meta.url)));

test("the deadline reads as today / tomorrow / a weekday", () => {
  assert.equal(rescueDeadline("2032-03-09", "2032-03-09"), "today");
  assert.equal(rescueDeadline("2032-03-10", "2032-03-09"), "tomorrow");
  assert.equal(rescueDeadline("2032-03-11", "2032-03-09"), "Thursday");
  assert.equal(rescueDeadline("2032-03-01", "2032-02-29"), "tomorrow", "across a month end (leap day)");
});

test("database errors become kid-friendly words; anything else gets the fallback", () => {
  assert.match(friendlyRescueError('ERROR: rescue_overdue', "x"), /time is up/);
  assert.match(friendlyRescueError("rescue_not_picked", "x"), /Pick a rescue quest/);
  assert.equal(friendlyRescueError("something else", "Couldn't do that."), "Couldn't do that.");
  assert.equal(friendlyRescueError(undefined, "Couldn't do that."), "Couldn't do that.");
});
