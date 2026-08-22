/**
 * singleFlight — in-flight promise coalescing primitive.
 *
 * Wraps an async function so that concurrent calls with the same key share a
 * single underlying promise. The wrapped fn runs at most once per in-flight
 * key; additional callers await the same promise and receive the same result
 * (or rejection).
 *
 * Primary use: collapse redundant concurrent scrapes of the same resource
 * (Bilibili UID, AICU UID) when N web users search the same subject at once.
 * Without this, each HTTP request spawns an independent crawl and the server's
 * single IP gets hammered by an N× multiplier — a leading cause of Bilibili
 * IP blocks under multi-user load (AGENTS.md §8).
 *
 * Contract:
 *   - Same key, concurrent (in-flight) → fn runs ONCE, all callers share result.
 *   - Distinct keys → independent runs.
 *   - After a key's promise settles, the slot clears; the next call runs again.
 *   - Optional `ttlMs` keeps a resolved result hot briefly so a fast follow-up
 *     call still coalesces (default 0 = no sticky TTL; the crawler's own LRU
 *     cache handles long-term freshness).
 *
 * This primitive does NOT bypass or weaken any rate limiter, throttle, or
 * cooldown — it only removes redundant duplicate work on top of the existing
 * protection layers.
 *
 * @module server/utils/singleFlight
 */

/**
 * Wrap an async function with single-flight coalescing.
 *
 * @param {(arg: A, ...rest: any[]) => Promise<T>} fn  the async work to coalesce
 * @param {{ key?: (arg: A, ...rest: any[]) => any, ttlMs?: number }} [options]
 *   - key: derives the coalesce key from the arguments (default: first argument)
 *   - ttlMs: post-resolution window during which the result stays hot (default 0)
 * @returns {(arg: A, ...rest: any[]) => Promise<T>}
 */
export function singleFlight(fn, options = {}) {
  const keyFn = typeof options.key === 'function' ? options.key : (first) => first;
  const ttlMs = Math.max(0, Number(options.ttlMs) || 0);

  /** @type {Map<any, { promise: Promise<any> }>} */
  const inflight = new Map();

  return async function coalesced(arg, ...rest) {
    const key = keyFn(arg, ...rest);

    const existing = inflight.get(key);
    if (existing) {
      // An in-flight or TTL-hot entry exists: ride on it.
      return existing.promise;
    }

    const entry = {};
    entry.promise = (async () => {
      try {
        const value = await fn(arg, ...rest);
        if (ttlMs > 0) {
          // Keep the slot hot for ttlMs after success so a fast follow-up
          // (refresh, double-click) still coalesces.
          setTimeout(() => {
            if (inflight.get(key) === entry) inflight.delete(key);
          }, ttlMs).unref?.();
        }
        return value;
      } catch (err) {
        // Rejections clear the slot immediately so the next caller retries.
        inflight.delete(key);
        throw err;
      } finally {
        if (ttlMs <= 0) {
          // No sticky window: clear as soon as the promise settles.
          if (inflight.get(key) === entry) inflight.delete(key);
        }
      }
    })();
    inflight.set(key, entry);
    return entry.promise;
  };
}
