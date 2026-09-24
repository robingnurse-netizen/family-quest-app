// One download per sprite frame for the life of the page.
//
// Every frame URL is loaded once into an Image that's kept here, so the
// browser keeps it decoded and never needs to fetch it again, however often
// an animation restarts or a sprite remounts. (Frame URLs are versioned and
// served immutable — next.config.ts — so even a fresh page load comes from
// the HTTP cache.) A frame that fails (a dropped connection on a phone) is
// retried with backoff, on the next request for it; until it loads,
// SpriteAnimator keeps showing the last good frame instead.

type Entry = {
  state: "loading" | "ready" | "failed";
  image: HTMLImageElement;
  promise: Promise<boolean>;
  failures: number;
  /** Failed: don't retry before this time (ms). */
  retryAt: number;
};

const frames = new Map<string, Entry>();

/** Backoff after the nth failure: 1s, 2s, 4s … up to 30s. */
export const retryDelayMs = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));

function start(url: string, failures: number): Entry {
  const image = new Image();
  image.decoding = "async";
  const entry: Entry = { state: "loading", image, failures, retryAt: 0, promise: Promise.resolve(false) };
  entry.promise = new Promise<boolean>((resolve) => {
    image.onload = () => {
      // Decoded before it's shown, so a swap never flashes.
      image
        .decode()
        .catch(() => undefined)
        .then(() => {
          entry.state = "ready";
          resolve(true);
        });
    };
    image.onerror = () => {
      entry.state = "failed";
      entry.failures += 1;
      entry.retryAt = Date.now() + retryDelayMs(entry.failures);
      resolve(false);
    };
  });
  image.src = url;
  frames.set(url, entry);
  return entry;
}

/**
 * Load a frame (once). Resolves true when it's ready to show, false if it
 * failed this time. A failed frame is retried here once its backoff is up.
 */
export function loadFrame(url: string): Promise<boolean> {
  const entry = frames.get(url);
  if (!entry) return start(url, 0).promise;
  if (entry.state === "failed" && Date.now() >= entry.retryAt) return start(url, entry.failures).promise;
  return entry.promise;
}

/** Is this frame loaded and decoded (safe to show without a flash)? */
export function frameReady(url: string): boolean {
  return frames.get(url)?.state === "ready";
}

/** Start loading these frames (idempotent). */
export function preloadFrames(urls: readonly string[]) {
  for (const url of urls) void loadFrame(url);
}
