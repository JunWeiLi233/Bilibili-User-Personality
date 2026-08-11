/**
 * Route-level test for the analyze-uid coalescing behavior.
 *
 * Proves the contract that protects against multi-user IP blocks: N concurrent
 * identical-UID requests to the analyze-uid path share ONE underlying crawl.
 * The mechanism is the route's singleFlight wrapper around analyzeUid; this
 * test drives that wrapper pattern with a mocked analyzeUid (counting
 * invocations) since the real one hits the network.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { singleFlight } from '../utils/singleFlight.js';

// Mirror the route's exact coalescer config (server/routes/bilibili.js) so this
// test exercises the same shape the production handler relies on.
function makeRouteCoalescer() {
  const counter = { invocations: 0 };
  const coalesced = singleFlight(
    async (payload) => {
      counter.invocations += 1;
      return { ok: true, uid: payload.uid, coalesced: true };
    },
    {
      key: (payload) => {
        const uid = String(payload?.uid || '').trim();
        const cookie = String(payload?.bilibiliCookie || payload?.cookie || '').trim().slice(0, 16);
        return `${uid}\u0001${cookie}`;
      },
      ttlMs: 30_000,
    },
  );
  return { coalesced, counter };
}

describe('analyze-uid route coalescing', () => {
  test('5 concurrent identical-UID requests trigger exactly ONE underlying crawl', async () => {
    const { coalesced, counter } = makeRouteCoalescer();

    const results = await Promise.all([
      coalesced({ uid: '111' }),
      coalesced({ uid: '111' }),
      coalesced({ uid: '111' }),
      coalesced({ uid: '111' }),
      coalesced({ uid: '111' }),
    ]);

    assert.equal(counter.invocations, 1, 'concurrent same-UID must crawl once');
    assert.equal(results.length, 5);
    for (const r of results) assert.equal(r.coalesced, true);
  });

  test('different UIDs are NOT coalesced (independent crawls)', async () => {
    const { coalesced, counter } = makeRouteCoalescer();
    await Promise.all([coalesced({ uid: '111' }), coalesced({ uid: '222' }), coalesced({ uid: '333' })]);
    assert.equal(counter.invocations, 3);
  });

  test('same UID with DIFFERENT cookies are NOT coalesced (per-cookie namespacing)', async () => {
    const { coalesced, counter } = makeRouteCoalescer();
    await Promise.all([
      coalesced({ uid: '111', bilibiliCookie: 'SESSDATA=aaa' }),
      coalesced({ uid: '111', bilibiliCookie: 'SESSDATA=bbb' }),
      coalesced({ uid: '111' }), // anonymous
    ]);
    assert.equal(counter.invocations, 3, 'different cookies → independent crawls');
  });

  test('a non-numeric UID still passes through (route validates separately; coalescer is key-only)', async () => {
    const { coalesced } = makeRouteCoalescer();
    const r = await coalesced({ uid: '' });
    assert.equal(r.ok, true); // coalescer doesn't validate — route does
  });
});
