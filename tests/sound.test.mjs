// Sound effect rules (lib/sound/sound-rules.ts): the mute setting, the
// attack pool, rate limiting, and that every listed file exists. (The
// no-repeat random pick is in random.test.mjs.)
// Playback itself (Howler) isn't tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const rules = await importTs(fileURLToPath(new URL("../lib/sound/sound-rules.ts", import.meta.url)));
const publicDir = fileURLToPath(new URL("../public", import.meta.url));

/** A Map-backed stand-in for localStorage. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

// --- Mute -----------------------------------------------------------------------

test("mute starts off, persists to storage, and a fresh page load reads it back", () => {
  const storage = memoryStorage();
  const first = rules.createMuteStore(() => storage);
  assert.equal(first.isMuted(), false);

  first.setMuted(true);
  assert.equal(first.isMuted(), true);
  assert.equal(storage.map.get(rules.MUTE_STORAGE_KEY), "1");

  const reloaded = rules.createMuteStore(() => storage);
  assert.equal(reloaded.isMuted(), true);
  reloaded.setMuted(false);
  assert.equal(rules.createMuteStore(() => storage).isMuted(), false);
});

test("mute notifies subscribers on a change only, and unsubscribes", () => {
  const store = rules.createMuteStore(() => memoryStorage());
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.setMuted(true);
  store.setMuted(true); // no change
  assert.equal(calls, 1);
  off();
  store.setMuted(false);
  assert.equal(calls, 1);
});

test("broken or missing storage: unmuted by default, and muting still works for the page", () => {
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  for (const storage of [() => throwing, () => null, () => { throw new Error("no localStorage"); }]) {
    const store = rules.createMuteStore(storage);
    assert.equal(store.isMuted(), false);
    store.setMuted(true);
    assert.equal(store.isMuted(), true);
  }
});

// --- Random attack pool ------------------------------------------------------------

test("the attack pool has all 8 files, mixed formats, and each one exists", () => {
  assert.equal(rules.SOUNDS.attack.files.length, 8);
  assert.ok(rules.SOUNDS.attack.files.some((f) => f.endsWith(".mp3")));
  for (const [name, spec] of Object.entries(rules.SOUNDS)) {
    assert.ok(spec.files.length > 0, name);
    for (const file of spec.files) assert.ok(existsSync(`${publicDir}${file}`), `${name}: ${file} missing`);
    assert.ok(spec.volume > 0 && spec.volume <= 1, `${name} volume`);
  }
});

// --- Rate limiting -------------------------------------------------------------------

test("the same sound within its gap is dropped; other sounds aren't affected", () => {
  const allow = rules.createSoundGate({ attack: { minGapMs: 120 }, bossDefeated: { minGapMs: 4000 } });
  assert.equal(allow("attack", 1000), true);
  assert.equal(allow("attack", 1050), false, "too soon");
  assert.equal(allow("bossDefeated", 1050), true, "separate sounds overlap freely");
  assert.equal(allow("attack", 1120), true, "gap measured from the last one played");
  assert.equal(allow("bossDefeated", 4000), false, "one fanfare per defeat");
  assert.equal(allow("bossDefeated", 5050), true);
});

test("one-off sounds have gaps long enough to swallow a duplicate report", () => {
  // The K.O. beat and the boss row can both report a defeat ~1s apart; the
  // nightly reset logs one miss per child at once.
  assert.ok(rules.SOUNDS.bossDefeated.minGapMs >= 2000);
  assert.ok(rules.SOUNDS.partyDamage.minGapMs >= 1000);
  // Rapid ticks still each get a sound.
  assert.ok(rules.SOUNDS.questComplete.minGapMs <= 150);
  assert.ok(rules.SOUNDS.attack.minGapMs <= 150);
});
