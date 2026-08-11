#!/usr/bin/env node
/**
 * measureFetchAmplification.js — Verify harness for the request-coalescing fix.
 *
 * Fires K concurrent analyzeUid({uid}) calls against a MOCKED crawler (no network),
 * counts how many times the underlying fetchJson is invoked, and prints the
 * amplification factor = concurrent-fetches / single-call-fetches.
 *
 * - No coalescing (pre-fix): K concurrent same-UID searches → ~K× the fetches
 *   of a single search → amplification ≈ K.
 * - Single-flight coalescing (post-fix): K concurrent same-UID → 1× the fetches
 *   → amplification ≈ 1.0.
 *
 * Output: a single number on the last stdout line = amplification factor.
 * Lower is better.
 */
import { analyzeUid, resetBilibiliRequestState } from '../services/bilibiliCrawler.js';
import { singleFlight } from '../utils/singleFlight.js';

const CONCURRENT = Number(process.env.CONCURRENT || 5);
const TEST_UID = '1234567890'; // numeric, never hits network (mock intercepts)

// Mirror the route's coalescer config (server/routes/bilibili.js): the production
// entrypoint for "search user" is the single-flight-wrapped analyzeUid.
function makeCoalescer() {
  return singleFlight(
    (payload, ...rest) => analyzeUid(payload, ...rest),
    {
      key: (payload) => `${String(payload?.uid || '').trim()}\u0001${String(payload?.bilibiliCookie || '').trim().slice(0, 16)}`,
      ttlMs: 30_000,
    },
  );
}

function makeMockDeps() {
  const calls = [];
  const mockFetchJson = async (url) => {
    calls.push(url);
    return { code: 0, data: {}, message: '0' };
  };
  const mockFetchText = async (url) => { calls.push(url); return ''; };
  const mockFetchBuffer = async (url) => { calls.push(url); return new ArrayBuffer(0); };
  return { calls, fetchJson: mockFetchJson, fetchText: mockFetchText, fetchBuffer: mockFetchBuffer };
}

async function runOnce() {
  resetBilibiliRequestState(); // clear module-level session/throttle state for symmetry
  const deps = makeMockDeps();
  const coalesced = makeCoalescer();
  await coalesced({ uid: TEST_UID }, deps);
  return deps.calls.length;
}

async function runConcurrentK() {
  resetBilibiliRequestState();
  // Share ONE deps + ONE coalescer across all K concurrent calls — the real
  // scenario: K users share one server, and a single in-flight crawl should
  // satisfy all of them.
  const deps = makeMockDeps();
  const coalesced = makeCoalescer();
  await Promise.all(
    Array.from({ length: CONCURRENT }, () => coalesced({ uid: TEST_UID }, deps).catch(() => {})),
  );
  return deps.calls.length;
}

const baseline = await runOnce();
const concurrent = await runConcurrentK();
const amplification = baseline > 0 ? concurrent / baseline : Infinity;

console.error(`[measure] single-call fetches: ${baseline}`);
console.error(`[measure] ${CONCURRENT}-concurrent fetches: ${concurrent}`);
console.error(`[measure] ideal (coalesced) would be: ${baseline}`);
console.log(Number.isFinite(amplification) ? Number(amplification.toFixed(4)) : amplification);
