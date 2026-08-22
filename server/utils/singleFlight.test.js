/**
 * Tests for the singleFlight (in-flight promise coalescing) primitive.
 *
 * singleFlight ensures that when N concurrent calls are made with the same key
 * while one is already in flight, they all share the single underlying promise
 * — the wrapped fn runs exactly once. This is the core mechanism for collapsing
 * redundant concurrent Bilibili/AICU scrapes of the same UID so multi-user load
 * does not multiply Bilibili requests (IP-block protection, AGENTS.md §8).
 *
 * Distinct keys run independently. After the in-flight promise resolves, the
 * next call with the same key runs the fn again (no long-term caching — the
 * crawler's own LRU cache handles freshness).
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { singleFlight } from './singleFlight.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('singleFlight — coalescing contract', () => {
  test('N concurrent calls with the same key share one underlying fn invocation', async () => {
    let runCount = 0;
    const fn = singleFlight(async (uid) => {
      runCount += 1;
      await delay(20);
      return { uid, ok: true };
    });

    const results = await Promise.all([
      fn('111'), fn('111'), fn('111'), fn('111'), fn('111'),
    ]);

    assert.equal(runCount, 1, 'fn must run exactly once for 5 concurrent same-key calls');
    assert.equal(results.length, 5);
    for (const r of results) assert.deepEqual(r, { uid: '111', ok: true });
  });

  test('distinct keys run independently (no cross-key coalescing)', async () => {
    let runCount = 0;
    const fn = singleFlight(async (uid) => {
      runCount += 1;
      await delay(10);
      return uid;
    });

    const [a, b, c] = await Promise.all([fn('111'), fn('222'), fn('333')]);
    assert.equal(runCount, 3);
    assert.deepEqual([a, b, c], ['111', '222', '333']);
  });

  test('after the in-flight promise resolves, a new call runs the fn again', async () => {
    let runCount = 0;
    const fn = singleFlight(async (uid) => {
      const myRun = (++runCount);
      await delay(10);
      return myRun;
    });

    const first = await fn('111');
    const second = await fn('111'); // previous in-flight already resolved
    assert.equal(first, 1);
    assert.equal(second, 2); // ran again — no sticky caching
    assert.equal(runCount, 2);
  });

  test('mixed: some same-key, some distinct — coalesces only the same-key batch', async () => {
    let runCount = 0;
    const fn = singleFlight(async (uid) => {
      const myRun = (++runCount); // capture at entry — avoids delay-resume race
      await delay(10);
      return `${uid}-${myRun}`;
    });

    const results = await Promise.all([
      fn('A'), fn('A'), fn('A'), fn('B'), fn('B'),
    ]);

    assert.equal(runCount, 2); // one for 'A' batch, one for 'B' batch
    assert.deepEqual(results, ['A-1', 'A-1', 'A-1', 'B-2', 'B-2']);
  });

  test('the key function derives the coalesce key from the arguments', async () => {
    let runCount = 0;
    const fn = singleFlight(
      async (uid, _pages) => {
        runCount += 1;
        await delay(10);
        return uid;
      },
      { key: (uid) => uid },
    );

    await Promise.all([fn('111', 2), fn('111', 3), fn('111', 5)]);
    assert.equal(runCount, 1);
  });

  test('a rejected in-flight promise rejects all coalesced callers', async () => {
    let runCount = 0;
    const fn = singleFlight(async () => {
      runCount += 1;
      await delay(10);
      throw new Error('boom');
    });

    const results = await Promise.allSettled([fn('X'), fn('X'), fn('X')]);
    assert.equal(runCount, 1);
    for (const r of results) {
      assert.equal(r.status, 'rejected');
      assert.match(r.reason.message, /boom/);
    }
    await assert.rejects(() => fn('X'), /boom/);
    assert.equal(runCount, 2);
  });

  test('after the in-flight promise settles, the slot is cleared', async () => {
    let runCount = 0;
    const fn = singleFlight(async () => {
      const myRun = (++runCount);
      await delay(5);
      return myRun;
    });
    await fn('K');
    await fn('K');
    assert.equal(runCount, 2);
  });

  test('zero-arg and undefined-key calls still coalesce on a stable key', async () => {
    let runCount = 0;
    const fn = singleFlight(async () => {
      runCount += 1;
      await delay(5);
      return 'ok';
    });
    await Promise.all([fn(), fn(), fn()]);
    assert.equal(runCount, 1);
  });

  test('default ttlMs=0 → no sticky post-resolution window', async () => {
    let runCount = 0;
    const fn = singleFlight(async () => {
      const myRun = (++runCount);
      await delay(5);
      return myRun;
    }, { ttlMs: 0 });
    await fn('K');
    await fn('K');
    assert.equal(runCount, 2);
  });
});
