import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const USER_AGENTS = [
  // Chrome 123-126 (5 variants: Windows + macOS)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Firefox 124-126 (3 variants: Windows + macOS)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Edge 124-126 (3 variants)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  // Safari 17.x mobile (2 variants)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // Safari 17.x desktop (2 variants)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';
const BLOCK_CODES = new Set([-101, -111, -352, -412, -509, -799]);
const MAX_COOLDOWN_MULTIPLIER = 8;
const CACHE_MAX_SIZE = 500;
const cookieJar = new Map();
let nextRequestAt = 0;
let cooldownUntil = 0;
let consecutiveBlocks = 0;
let cookiesInitialized = false;
let cachePruneGate = 0;
let sessionAuthenticated = null; // null=unchecked, true=valid, false=invalid
let lastSessionCheck = 0;

// ── SessionIdentity: per-session UA + platform + sec-ch-ua ──────────────────────
// Replaces the old module-level globals (sessionUaPicked, sessionUserAgent,
// sessionPlatform). Picks a fresh UA once per fetch cycle, rotates on block,
// and resets cleanly for test isolation.

class SessionIdentity {
  #uaPicked = false;
  #userAgent = USER_AGENTS[0];
  #platform = 'Windows';

  ensurePicked(randomFn) {
    if (this.#uaPicked) return;
    this.#uaPicked = true;
    const envUa = String(process.env.BILIBILI_CRAWLER_UA || '').trim();
    if (envUa) {
      this.#userAgent = envUa;
      this.#platform = SessionIdentity.#detectPlatform(envUa);
      return;
    }
    const pick = Math.floor(randomFn() * USER_AGENTS.length);
    const idx = ((pick % USER_AGENTS.length) + USER_AGENTS.length) % USER_AGENTS.length;
    this.#userAgent = USER_AGENTS[idx] || USER_AGENTS[0];
    this.#platform = SessionIdentity.#detectPlatform(this.#userAgent);
  }

  rotate(randomFn) {
    const envUa = String(process.env.BILIBILI_CRAWLER_UA || '').trim();
    if (envUa) return; // env override is pinned — rotation is a no-op
    const pick = Math.floor(randomFn() * USER_AGENTS.length);
    const idx = ((pick % USER_AGENTS.length) + USER_AGENTS.length) % USER_AGENTS.length;
    this.#userAgent = USER_AGENTS[idx] || USER_AGENTS[0];
    this.#platform = SessionIdentity.#detectPlatform(this.#userAgent);
  }

  reset() {
    this.#uaPicked = false;
    this.#userAgent = USER_AGENTS[0];
    this.#platform = 'Windows';
  }

  get userAgent() { return this.#userAgent; }
  get platform() { return this.#platform; }

  get secChUa() {
    const uaStr = this.#userAgent;
    if (uaStr.includes('Edg/')) {
      const m = uaStr.match(/Edg\/(\d+)/);
      const v = m ? m[1] : '124';
      return `"Chromium";v="${v}", "Microsoft Edge";v="${v}", "Not.A/Brand";v="99"`;
    }
    if (uaStr.includes('Chrome/')) {
      const m = uaStr.match(/Chrome\/(\d+)/);
      const v = m ? m[1] : '124';
      return `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not.A/Brand";v="99"`;
    }
    return ''; // Firefox and Safari don't send sec-ch-ua
  }

  static #detectPlatform(ua) {
    return /Macintosh|iPhone|iPad/i.test(ua) ? 'macOS' : 'Windows';
  }
}

const sessionIdentity = new SessionIdentity();

// LRU cache with TTL-aware eviction. Bounded to CACHE_MAX_SIZE entries;
// least-recently-used entries are evicted first when the cap is exceeded.
// Expired TTL entries are pruned on access and periodically on insert.
class LruCache {
  #map = new Map();
  #maxSize;

  constructor(maxSize = 500) {
    this.#maxSize = maxSize;
  }

  get(key) {
    const entry = this.#map.get(key);
    if (entry === undefined) return undefined;
    // Promote to most-recently-used
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry;
  }

  set(key, value) {
    if (this.#map.has(key)) {
      this.#map.delete(key); // re-insert at MRU position
    } else if (this.#map.size >= this.#maxSize) {
      // Evict least-recently-used (first key in insertion order)
      const lru = this.#map.keys().next().value;
      this.#map.delete(lru);
    }
    this.#map.set(key, value);
  }

  delete(key) { return this.#map.delete(key); }

  clear() { this.#map.clear(); }

  get size() { return this.#map.size; }

  // Scan and remove entries whose expiresAt <= now. Safe to call during iteration.
  pruneExpired(now) {
    for (const [key, entry] of this.#map) {
      if (entry.expiresAt <= now) this.#map.delete(key);
    }
  }
}

const responseCache = new LruCache(CACHE_MAX_SIZE);

function pruneExpiredCacheEntries(nowFn) {
  responseCache.pruneExpired(nowFn());
}

// ── Token bucket rate limiter ─────────────────────────────────────────────────
// Proactive throttling — tokens refill at sustainPerSec, never exceed burst cap.
// Applied before every fetch() to prevent hitting Bilibili's rate-limit wall
// in the first place, rather than reacting after a -412 block code.

class TokenBucket {
  #burst;
  #sustainPerSec;
  #tokens;
  #lastRefill;
  #nowFn;

  constructor(burst, sustainPerSec, nowFn) {
    this.#burst = Math.max(1, Number(burst) || 8);
    this.#sustainPerSec = Math.max(0.1, Number(sustainPerSec) || 2);
    this.#tokens = this.#burst;
    this.#lastRefill = (nowFn || Date.now)();
    this.#nowFn = nowFn || Date.now;
  }

  // Wait until a token is available, then consume it.
  // Returns the wait time in ms (0 if token was immediately available).
  async take(waitFn) {
    this.#refill();
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return 0;
    }
    const deficit = 1 - this.#tokens;
    const waitMs = Math.ceil((deficit / this.#sustainPerSec) * 1000);
    if (waitFn && waitMs > 0) await waitFn(waitMs);
    this.#lastRefill = this.#nowFn();
    // After waiting for the deficit, exactly deficit tokens have been refilled.
    // Consume 1 token — leave deficit − 1 (typically 0 for a 1-token deficit).
    this.#tokens = Math.max(0, deficit - 1);
    return waitMs;
  }

  #refill() {
    const now = this.#nowFn();
    const elapsed = Math.max(0, (now - this.#lastRefill) / 1000);
    this.#tokens = Math.min(this.#burst, this.#tokens + elapsed * this.#sustainPerSec);
    this.#lastRefill = now;
  }

  // Peek at available tokens without consuming
  get available() {
    this.#refill();
    return this.#tokens;
  }

  reset() {
    this.#tokens = this.#burst;
    this.#lastRefill = this.#nowFn();
  }
}

// Per-endpoint token buckets (lazily initialised).
// Endpoint groups keyed by URL path prefix — search gets stricter limits
// because Bilibili rate-limits search more aggressively than content reads.
const endpointBuckets = new Map();

const ENDPOINT_BUCKET_DEFAULTS = {
  '/x/web-interface/search':     { burst: 5,  sustain: 1 },   // search: strict
  '/x/web-interface/wbi/search': { burst: 5,  sustain: 1 },
  '/x/v2/reply':                 { burst: 10, sustain: 3 },   // comments: moderate
  '/x/v2/reply/main':            { burst: 10, sustain: 3 },   // deprecated, kept as fallback
  '/x/v2/reply/reply':           { burst: 10, sustain: 3 },
  '/x/v2/reply/search':          { burst: 10, sustain: 3 },
  '/x/web-interface/view':       { burst: 12, sustain: 4 },   // video info: loose
  '/x/web-interface/card':       { burst: 12, sustain: 4 },   // user card: loose
  '/x/space/arc/search':         { burst: 8,  sustain: 2 },   // space: normal
  '/x/polymer/web-dynamic':      { burst: 8,  sustain: 2 },   // dynamics: normal
  '/x/v2/dm/web/view':           { burst: 10, sustain: 3 },   // danmaku protobuf
  '/x/v1/dm/list.so':            { burst: 15, sustain: 5 },   // deprecated, kept as fallback
  '/x/web-interface/popular':    { burst: 6,  sustain: 2 },   // popular: moderate
  '/x/v3/fav/resource/list':     { burst: 6,  sustain: 2 },   // favorites: moderate
};

function getEndpointBucket(url, nowFn, env) {
  const burstOverride = Number(env?.BILIBILI_RATE_BURST || 0);
  const sustainOverride = Number(env?.BILIBILI_RATE_SUSTAIN || 0);

  // Match the longest prefix
  let bestKey = '/';  // default
  for (const prefix of Object.keys(ENDPOINT_BUCKET_DEFAULTS)) {
    if (String(url).includes(prefix) && prefix.length > bestKey.length) {
      bestKey = prefix;
    }
  }

  const cacheKey = `${bestKey}|${burstOverride}|${sustainOverride}`;
  let bucket = endpointBuckets.get(cacheKey);
  if (!bucket) {
    const defaults = ENDPOINT_BUCKET_DEFAULTS[bestKey] || { burst: 8, sustain: 2 };
    const burst = burstOverride > 0 ? burstOverride : defaults.burst;
    const sustain = sustainOverride > 0 ? sustainOverride : defaults.sustain;
    bucket = new TokenBucket(burst, sustain, nowFn);
    endpointBuckets.set(cacheKey, bucket);
  }
  return bucket;
}

function resetAllBuckets() {
  for (const bucket of endpointBuckets.values()) bucket.reset();
}

// ── WAF / endpoint exhaustion tracking ────────────────────────────────────────
// Tracks WAF (Cloudflare 1015 / HTML challenge) per endpoint+proxy.
// After 3 consecutive WAFs on the same endpoint → mark exhausted, skip.
// After 5 total WAFs across all endpoints → abort run.

const wafCounts = new Map();           // key: "endpoint|proxy" → count
const exhaustedEndpoints = new Set();  // endpoints to skip
let totalWafs = 0;

const WAF_HTTP_CODES = new Set([403, 503]);
const WAF_BLOCK_CODES = new Set([-101, -111]);

function isWafResponse(status, payload) {
  if (WAF_HTTP_CODES.has(status)) return true;
  if (payload && WAF_BLOCK_CODES.has(Number(payload?.code))) return true;
  return false;
}

function endpointKey(url) {
  try {
    const u = new URL(String(url));
    return u.pathname;
  } catch {
    return String(url).split('?')[0] || String(url);
  }
}

function recordWaf(url, proxy) {
  const ep = endpointKey(url);
  const key = proxy ? `${ep}|${proxy}` : ep;
  const count = (wafCounts.get(key) || 0) + 1;
  wafCounts.set(key, count);
  totalWafs += 1;

  if (count >= 3) {
    exhaustedEndpoints.add(ep);
    console.warn(`[bilibili-crawler] Endpoint exhausted after ${count} WAFs: ${ep}`);
  }

  if (totalWafs >= 5) {
    throw new Error(
      `Bilibili scraper aborted: ${totalWafs} total WAF detections across endpoints. ` +
      `IP or proxy pool likely flagged. Exhausted endpoints: ${[...exhaustedEndpoints].join(', ')}`,
    );
  }

  return count;
}

function isEndpointExhausted(url) {
  return exhaustedEndpoints.has(endpointKey(url));
}

function resetWafState() {
  wafCounts.clear();
  exhaustedEndpoints.clear();
  totalWafs = 0;
}

// ── Proxy rotation ────────────────────────────────────────────────────────────

let proxyRotator = null;
let proxyFetchAgent = null; // http.Agent for the current proxy

function getProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  // node:http Agent for proxied requests — we use the URL as a hint;
  // actual proxy integration happens via fetchImpl override in production.
  // For tests, this returns null so mock fetchImpl works unchanged.
  return null;
}

function initProxyRotator(env) {
  const raw = String(env?.BILIBILI_PROXY_LIST || '').trim();
  if (!raw) {
    proxyRotator = null;
    return;
  }
  let list;
  if (existsSync(raw)) {
    list = readFileSync(raw, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  } else {
    list = raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (list.length > 0) {
    proxyRotator = {
      proxies: list,
      index: 0,
      consecutiveBlocks: Object.fromEntries(list.map(p => [p, 0])),
      quarantinedUntil: Object.fromEntries(list.map(p => [p, 0])),
      current() {
        if (this.proxies.length === 0) return null;
        return this.proxies[this.index];
      },
      rotate(now) {
        if (this.proxies.length === 0) return null;
        const t = now || Date.now();
        const start = this.index;
        do {
          this.index = (this.index + 1) % this.proxies.length;
          const p = this.proxies[this.index];
          if ((this.quarantinedUntil[p] || 0) <= t) return p;
        } while (this.index !== start);
        return null; // all quarantined
      },
      markBlock(proxy, nowFn) {
        if (!proxy) return 0;
        const t = (nowFn || Date.now)();
        const count = (this.consecutiveBlocks[proxy] || 0) + 1;
        this.consecutiveBlocks[proxy] = count;
        if (count >= 3) {
          const mult = Math.min(8, 2 ** (count - 1));
          this.quarantinedUntil[proxy] = t + 120000 * mult;
        }
        // Rotate away from the blocked proxy
        this.rotate(t);
        return count;
      },
      markSuccess(proxy) {
        if (!proxy) return;
        this.consecutiveBlocks[proxy] = 0;
      },
    };
  }
}

function resetProxyState() {
  proxyRotator = null;
  proxyFetchAgent = null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readCrawlerConfig(env = process.env) {
  return {
    minDelayMs: Math.max(0, Number(env.BILIBILI_CRAWLER_MIN_DELAY_MS || 2500)),
    jitterMs: Math.max(0, Number(env.BILIBILI_CRAWLER_JITTER_MS || 2000)),
    blockCooldownMs: Math.max(0, Number(env.BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS || 120000)),
    cacheTtlMs: Math.max(0, Number(env.BILIBILI_CRAWLER_CACHE_TTL_MS || 300000)),
    longPauseProbability: Math.min(
      1,
      Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_PROBABILITY ?? 0.15)),
    ),
    longPauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_MIN_MS || 3000)),
    longPauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_MAX_MS || 8000)),
    pagePauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_PAGE_PAUSE_MIN_MS || 1500)),
    pagePauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_PAGE_PAUSE_MAX_MS || 3000)),
    objectPauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_OBJECT_PAUSE_MIN_MS || 2000)),
    objectPauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_OBJECT_PAUSE_MAX_MS || 5000)),
    requestTimeoutMs: Math.max(0, Number(env.BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS || 30000)),
  };
}

export function isBilibiliBlockResponse(payload) {
  return BLOCK_CODES.has(Number(payload?.code));
}

export function resetBilibiliRequestState() {
  responseCache.clear();
  cookieJar.clear();
  nextRequestAt = 0;
  cooldownUntil = 0;
  consecutiveBlocks = 0;
  sessionIdentity.reset();
  cookiesInitialized = false;
  sessionAuthenticated = null;
  lastSessionCheck = 0;
  resetAllBuckets();
  resetWafState();
  resetProxyState();
}

function cacheKey(url, referer) {
  return `${referer || ''} ${String(url)}`;
}

function randomHex(len, randomFn) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += Math.floor(randomFn() * 16).toString(16);
  }
  return out.toUpperCase();
}

// Dynamic sec-ch-ua matching a UA string. Kept as a standalone utility so
// it can be called with an arbitrary UA (e.g. for logging / debugging).
function buildSecChUa(ua) {
  const uaStr = String(ua || sessionIdentity.userAgent);
  if (uaStr.includes('Edg/')) {
    const m = uaStr.match(/Edg\/(\d+)/);
    const v = m ? m[1] : '124';
    return `"Chromium";v="${v}", "Microsoft Edge";v="${v}", "Not.A/Brand";v="99"`;
  }
  if (uaStr.includes('Chrome/')) {
    const m = uaStr.match(/Chrome\/(\d+)/);
    const v = m ? m[1] : '124';
    return `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not.A/Brand";v="99"`;
  }
  if (uaStr.includes('Firefox/')) return ''; // Firefox doesn't send sec-ch-ua
  // Safari
  return '';
}

function ensureCookies(randomFn, nowFn) {
  if (cookiesInitialized) return;
  cookiesInitialized = true;

  const envCookie = (process.env.BILIBILI_COOKIE || '').trim();
  if (envCookie) {
    const keys = [];
    for (const part of envCookie.split(/;\s*/)) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) { cookieJar.set(name, value); keys.push(name); }
      }
    }
    console.log(`[bilibili-crawler] Loaded ${keys.length} cookie(s) from BILIBILI_COOKIE env: ${keys.join(', ')}`);
    return;
  }

  const r = randomFn || Math.random;
  const epochSec = Math.floor((nowFn ? nowFn() : Date.now()) / 1000);
  cookieJar.set(
    'buvid3',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(13, r)}infoc`,
  );
  cookieJar.set(
    'buvid4',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(12, r)}-${epochSec}-1`,
  );
  // buvid_fp reduces HTTP 412s on guest requests
  cookieJar.set('buvid_fp', `${randomHex(32, r)}`);
  cookieJar.set('b_nut', String(epochSec));
  cookieJar.set(
    '_uuid',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(15, r)}infoc`,
  );
  cookieJar.set('b_lsid', `${randomHex(8, r)}_${randomHex(10, r)}`);
  cookieJar.set('bsource', 'search_bing');
  cookieJar.set('home_feed', 'recommend');
  cookieJar.set('enable_web_push', 'DISABLE');
  cookieJar.set('header_theme_version', 'undefined');
}

export function normalizeBilibiliCookie(value) {
  return String(value || '')
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return false;
      const name = part.slice(0, eq).trim();
      const cookieValue = part.slice(eq + 1).trim();
      return Boolean(name && cookieValue) && !/[\r\n:]/.test(name) && !/[\r\n]/.test(cookieValue);
    })
    .join('; ');
}

function cookieHeader(requestCookie = '') {
  const merged = new Map(cookieJar);
  for (const part of normalizeBilibiliCookie(requestCookie).split(/;\s*/).filter(Boolean)) {
    const eq = part.indexOf('=');
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) merged.set(name, value);
  }
  if (!merged.size) return '';
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function depsWithBilibiliCookie(deps = {}, cookie = '') {
  const bilibiliCookie = normalizeBilibiliCookie(cookie);
  if (!bilibiliCookie) return deps;
  const requestJson = deps.fetchJson || fetchJson;
  const requestText = deps.fetchText || fetchText;
  return {
    ...deps,
    fetchJson: (url, referer, options = {}) => requestJson(url, referer, { ...options, bilibiliCookie }),
    fetchText: (url, referer, options = {}) => requestText(url, referer, { ...options, bilibiliCookie }),
  };
}

function captureSetCookies(response) {
  const headers = response?.headers;
  if (!headers) return;
  let raw;
  if (typeof headers.getSetCookie === 'function') {
    try { raw = headers.getSetCookie(); } catch { raw = undefined; }
  }
  if (!raw && typeof headers.raw === 'function') {
    try { raw = headers.raw()?.['set-cookie']; } catch { raw = undefined; }
  }
  if (!raw && typeof headers.get === 'function') {
    const v = headers.get('set-cookie');
    if (v) raw = [v];
  }
  if (!raw) return;
  for (const line of raw) {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name && value) cookieJar.set(name, value);
  }
}

function siteRelation(url, referer) {
  try {
    const A = new URL(url);
    const B = new URL(referer);
    if (A.host === B.host) return 'same-origin';
    const baseA = A.hostname.split('.').slice(-2).join('.');
    const baseB = B.hostname.split('.').slice(-2).join('.');
    return baseA === baseB ? 'same-site' : 'cross-site';
  } catch {
    return 'cross-site';
  }
}

function buildHeaders(url, referer, randomFn, nowFn, requestCookie = '') {
  sessionIdentity.ensurePicked(randomFn);
  ensureCookies(randomFn, nowFn);
  let origin = 'https://www.bilibili.com';
  try { origin = new URL(referer).origin; } catch {}
  const ua = sessionIdentity.userAgent;
  const dynamicSecChUa = buildSecChUa(ua);
  const isMobile = /iPhone|iPad|Android.*Mobile/i.test(ua);
  const headers = {
    'user-agent': ua,
    referer,
    origin,
    accept: 'application/json, text/plain, */*',
    'accept-language': ACCEPT_LANGUAGE,
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': siteRelation(url, referer),
  };
  if (dynamicSecChUa) {
    headers['sec-ch-ua'] = dynamicSecChUa;
    headers['sec-ch-ua-mobile'] = isMobile ? '?1' : '?0';
    headers['sec-ch-ua-platform'] = isMobile && ua.includes('iPhone') ? '"iOS"' : `"${sessionIdentity.platform}"`;
  }
  const cookies = cookieHeader(requestCookie);
  if (cookies) headers.cookie = cookies;
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, init, config) {
  const timeoutMs = Math.max(0, Number(config?.requestTimeoutMs) || 0);
  if (!timeoutMs || typeof AbortController === 'undefined') {
    return fetchImpl(url, init);
  }

  const controller = new AbortController();
  const callerSignal = init?.signal;
  const signal =
    callerSignal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([callerSignal, controller.signal])
      : callerSignal || controller.signal;
  if (callerSignal && typeof callerSignal.addEventListener === 'function' && signal === controller.signal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (controller.signal.aborted && !(callerSignal?.aborted)) {
      throw new Error(`Bilibili request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function fetchConfigWithSignal(config, signal) {
  if (!signal) return config;
  return { ...config, signal };
}

function pickRange(randomFn, minMs, maxMs) {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor((randomFn ? randomFn() : Math.random()) * (maxMs - minMs));
}

export function humanPause(minMs, maxMs, options = {}) {
  if (maxMs <= 0) return Promise.resolve();
  const waitFn = options.waitFn || wait;
  return waitFn(pickRange(options.randomFn || Math.random, minMs, maxMs));
}

async function scheduleBilibiliRequest(options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const nowFn = options.nowFn || Date.now;
  const waitFn = options.waitFn || wait;
  const randomFn = options.randomFn || Math.random;
  const now = nowFn();
  const waitUntil = Math.max(cooldownUntil, nextRequestAt);
  if (waitUntil > now) {
    await waitFn(waitUntil - now);
  }
  // Occasional "user reading content" pause on top of the normal rate cap.
  // Condition is inverted (> 1 - p) so a randomFn returning 0 never triggers it,
  // keeping deterministic test pacing stable.
  if (
    config.longPauseProbability > 0 &&
    config.longPauseMaxMs > config.longPauseMinMs &&
    randomFn() > 1 - config.longPauseProbability
  ) {
    const pause =
      config.longPauseMinMs + Math.floor(randomFn() * (config.longPauseMaxMs - config.longPauseMinMs));
    await waitFn(pause);
  }
  const jitter = Math.floor(randomFn() * config.jitterMs);
  nextRequestAt = nowFn() + config.minDelayMs + jitter;
  return config;
}

function applyBlockCooldown(config, nowFn, randomFn) {
  consecutiveBlocks += 1;
  const multiplier = Math.min(2 ** (consecutiveBlocks - 1), MAX_COOLDOWN_MULTIPLIER);
  cooldownUntil = nowFn() + config.blockCooldownMs * multiplier;
  // Rotate UA and proxy on block
  sessionIdentity.rotate(randomFn || Math.random);
  if (proxyRotator) {
    const current = proxyRotator.current();
    proxyRotator.markBlock(current, nowFn);
  }
}

function applyWafCooldown(url, config, nowFn, randomFn) {
  const proxy = proxyRotator ? proxyRotator.current() : null;
  recordWaf(url, proxy);
  // WAF blocks also trigger normal block cooldown + UA rotation
  applyBlockCooldown(config, nowFn, randomFn);
}

export async function fetchJson(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const requestCookie = normalizeBilibiliCookie(options.bilibiliCookie || options.cookie);
  const key = requestCookie ? '' : cacheKey(url, referer);
  const nowFn = options.nowFn || Date.now;
  const randomFn = options.randomFn || Math.random;
  const cached = key ? responseCache.get(key) : null;
  if (cached && config.cacheTtlMs > 0 && cached.expiresAt > nowFn()) {
    return cached.payload;
  }
  if (cached) responseCache.delete(key);

  await scheduleBilibiliRequest({ ...options, config });
  // WAF early-exit: skip exhausted endpoints.
  if (isEndpointExhausted(url)) {
    throw new Error(`Bilibili endpoint exhausted (WAF early-exit): ${endpointKey(url)}`);
  }
  // Token bucket: wait for rate-limit token before issuing the request.
  const waitFn = options.waitFn || wait;
  const bucket = getEndpointBucket(url, nowFn, options.env);
  const tokenWaitMs = await bucket.take(waitFn);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      headers: buildHeaders(url, referer, randomFn, nowFn, requestCookie),
      ...(config.signal ? { signal: config.signal } : {}),
    },
    config,
  );
  if (!response.ok) {
    const status = Number(response.status);
    if (isWafResponse(status)) {
      applyWafCooldown(url, config, nowFn, randomFn);
    } else if ([412, 429].includes(status)) {
      applyBlockCooldown(config, nowFn, randomFn);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  captureSetCookies(response);
  const payload = await response.json();
  if (isBilibiliBlockResponse(payload)) {
    // -101/-111 are WAF blocks; others are rate-limit blocks
    if (isWafResponse(200, payload)) {
      applyWafCooldown(url, config, nowFn, randomFn);
    } else {
      applyBlockCooldown(config, nowFn, randomFn);
    }
  } else if (payload?.code === 0) {
    consecutiveBlocks = 0;
    // Mark proxy as healthy on success
    if (proxyRotator) proxyRotator.markSuccess(proxyRotator.current());
    if (key && config.cacheTtlMs > 0) {
      responseCache.set(key, {
        expiresAt: nowFn() + config.cacheTtlMs,
        payload,
      });
      // Prune expired entries every 100th insert to prevent unbounded growth.
      cachePruneGate = (cachePruneGate + 1) % 100;
      if (cachePruneGate === 0) pruneExpiredCacheEntries(nowFn);
    }
  }
  return payload;
}

export async function fetchText(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const nowFn = options.nowFn || Date.now;
  const randomFn = options.randomFn || Math.random;
  const requestCookie = normalizeBilibiliCookie(options.bilibiliCookie || options.cookie);
  await scheduleBilibiliRequest({ ...options, config });
  // WAF early-exit: skip exhausted endpoints.
  if (isEndpointExhausted(url)) {
    throw new Error(`Bilibili endpoint exhausted (WAF early-exit): ${endpointKey(url)}`);
  }
  // Token bucket: wait for rate-limit token before issuing the request.
  const waitFn = options.waitFn || wait;
  const bucket = getEndpointBucket(url, nowFn, options.env);
  const tokenWaitMs = await bucket.take(waitFn);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      headers: buildHeaders(url, referer, randomFn, nowFn, requestCookie),
      ...(config.signal ? { signal: config.signal } : {}),
    },
    config,
  );
  if (!response.ok) {
    const status = Number(response.status);
    if (isWafResponse(status)) {
      applyWafCooldown(url, config, nowFn, randomFn);
    } else if ([412, 429].includes(status)) {
      applyBlockCooldown(config, nowFn, randomFn);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  captureSetCookies(response);
  consecutiveBlocks = 0;
  if (proxyRotator) proxyRotator.markSuccess(proxyRotator.current());
  return response.text();
}

export async function fetchBuffer(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const nowFn = options.nowFn || Date.now;
  const randomFn = options.randomFn || Math.random;
  const requestCookie = normalizeBilibiliCookie(options.bilibiliCookie || options.cookie);
  await scheduleBilibiliRequest({ ...options, config });
  if (isEndpointExhausted(url)) {
    throw new Error(`Bilibili endpoint exhausted (WAF early-exit): ${endpointKey(url)}`);
  }
  const waitFn = options.waitFn || wait;
  const bucket = getEndpointBucket(url, nowFn, options.env);
  const tokenWaitMs = await bucket.take(waitFn);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      headers: buildHeaders(url, referer, randomFn, nowFn, requestCookie),
      ...(config.signal ? { signal: config.signal } : {}),
    },
    config,
  );
  if (!response.ok) {
    const status = Number(response.status);
    if (isWafResponse(status)) {
      applyWafCooldown(url, config, nowFn, randomFn);
    } else if ([412, 429].includes(status)) {
      applyBlockCooldown(config, nowFn, randomFn);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  captureSetCookies(response);
  consecutiveBlocks = 0;
  if (proxyRotator) proxyRotator.markSuccess(proxyRotator.current());
  return response.arrayBuffer();
}

export function parseBvidPool(raw) {
  return String(raw || '')
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => /^BV[0-9A-Za-z]+$/.test(item));
}

export function extractBvid(input) {
  const text = String(input || '').trim();
  const match = text.match(/BV[0-9A-Za-z]+/);
  return match?.[0] || '';
}

function textSnippet(text, fallback) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

function videoObjectFromView(bvid, data) {
  return {
    id: `video-1-${data.aid}`,
    kind: 'video',
    bvid,
    oid: String(data.aid),
    replyType: 1,
    title: data.title || bvid,
    authorMid: String(data.owner?.mid || ''),
    sourceUrl: `https://www.bilibili.com/video/${bvid}/`,
    replyCount: Number(data.stat?.reply || 0),
    cid: String(data.cid || data.pages?.[0]?.cid || ''),
  };
}

function videoObjectFromSpaceItem(item, uid) {
  return {
    id: `video-1-${item.aid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid),
    replyType: 1,
    title: item.title || item.bvid,
    authorMid: String(item.mid || uid || ''),
    sourceUrl: `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.comment || 0),
  };
}

function cleanSearchTitle(title, fallback) {
  // Bilibili search API now wraps matched keywords in <em class="keyword"> tags.
  // Strip HTML tags (complete and incomplete) then decode XML character entities.
  const clean = String(title || '')
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/&(?:quot|amp|#39);/g, (entity) => ({ '&quot;': '"', '&amp;': '&', '&#39;': "'" })[entity] || entity)
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback;
}

function videoObjectFromSearchItem(item) {
  return {
    id: `video-1-${item.aid || item.id || item.bvid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid || item.id || ''),
    replyType: 1,
    title: cleanSearchTitle(item.title, item.bvid),
    authorMid: String(item.mid || item.author_mid || ''),
    sourceUrl: item.arcurl || `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.review || item.comment || 0),
  };
}

function videoObjectFromPopularItem(item) {
  return {
    id: `video-1-${item.aid || item.bvid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid || ''),
    replyType: 1,
    title: item.title || item.bvid,
    authorMid: String(item.owner?.mid || item.mid || ''),
    sourceUrl: item.short_link_v2 || `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.stat?.reply ?? item.stat?.danmaku ?? 0),
  };
}

export async function resolveBvid(bvid, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const data = await requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0) throw new Error(data.message || `Cannot resolve ${bvid}`);
  return videoObjectFromView(bvid, data.data);
}

export async function discoverVideosByKeyword(query, limit = 6, deps = {}) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  const requestJson = deps.fetchJson || fetchJson;
  const pageSize = Math.max(1, Math.min(Number(limit || 6), 20));
  const order = String(deps.searchOrder || '').trim();
  const searchPages = Math.max(1, Math.min(Number(deps.searchPages || deps.discoveryPages || 1), 5));
  const videos = [];
  const seen = new Set();
  for (let page = 1; page <= searchPages && videos.length < pageSize; page += 1) {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/all/v2');
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('page', String(page));
    if (order) url.searchParams.set('order', order);
    const data = await requestJson(url.toString(), `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`);
    if (data.code !== 0) {
      throw new Error(data.message || `video search failed with code ${data.code}`);
    }
    const groups = Array.isArray(data.data?.result) ? data.data.result : [];
    for (const group of groups) {
      if (group.result_type !== 'video') continue;
      for (const item of group.data || []) {
        if (!item?.bvid || seen.has(item.bvid)) continue;
        seen.add(item.bvid);
        videos.push(videoObjectFromSearchItem(item));
        if (videos.length >= pageSize) break;
      }
    }
  }
  return videos;
}

export async function discoverPopularVideos(limit = 6, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const pageSize = Math.max(1, Math.min(Number(limit || 6), 20));
  const url = `https://api.bilibili.com/x/web-interface/popular?pn=1&ps=${pageSize}`;
  const data = await requestJson(url, 'https://www.bilibili.com/v/popular/all');
  if (data.code !== 0) {
    throw new Error(data.message || `popular video discovery failed with code ${data.code}`);
  }
  return (data.data?.list || [])
    .filter((item) => item?.bvid)
    .slice(0, pageSize)
    .map(videoObjectFromPopularItem);
}

export async function fetchUserCard(uid, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const data = await requestJson(
    `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(uid)}&photo=false`,
    `https://space.bilibili.com/${uid}`,
  );
  if (data.code !== 0) throw new Error(data.message || `user card failed with code ${data.code}`);
  return {
    mid: String(data.card?.mid || uid),
    name: data.card?.name || `UID ${uid}`,
    sign: data.card?.sign || '',
  };
}

export async function discoverVideosByUid(uid, limit, deps = {}) {
  await maybeRevalidateSession(deps);
  deps = depsWithBilibiliCookie(deps, deps.bilibiliCookie || deps.cookie);
  const requestJson = deps.fetchJson || fetchJson;
  const url = `https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(uid)}&pn=1&ps=${limit}&order=pubdate`;
  guardAuthEndpoint(url);
  const data = await requestJson(url, `https://space.bilibili.com/${uid}`);
  if (data.code !== 0) {
    throw new Error(data.message || `space video discovery failed with code ${data.code}`);
  }
  const list = data.data?.list?.vlist || [];
  return list.slice(0, limit).map((item) => videoObjectFromSpaceItem(item, uid));
}

export async function discoverVideosByFavorite(mediaId, limit, deps = {}) {
  await maybeRevalidateSession(deps);
  guardAuthEndpoint('/x/v3/fav/resource/list');
  deps = depsWithBilibiliCookie(deps);
  const requestJson = deps.fetchJson || fetchJson;
  let effectiveLimit = limit;
  const pageSize = Math.min(30, effectiveLimit);
  const objects = [];
  let totalFromApi = 0;

  for (let pn = 1; objects.length < effectiveLimit; pn += 1) {
    const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(mediaId)}&pn=${pn}&ps=${pageSize}&platform=web`;
    let data;
    try {
      data = await requestJson(url, `https://space.bilibili.com`);
    } catch (error) {
      if (objects.length === 0) throw error;
      break;
    }
    if (!data || data.code !== 0) break;
    if (pn === 1 && data.data?.info?.cnt_info?.collect) {
      totalFromApi = Number(data.data.info.cnt_info.collect);
      if (totalFromApi > 0 && totalFromApi < effectiveLimit) {
        effectiveLimit = totalFromApi;
      }
    }
    const medias = data.data?.medias || [];
    if (medias.length === 0) break;
    for (const item of medias) {
      if (objects.length >= effectiveLimit) break;
      if (item.type !== 2 || !item.bvid) continue;
      objects.push({
        id: `video-1-${item.id}`,
        kind: 'video',
        bvid: item.bvid,
        oid: String(item.id || ''),
        replyType: 1,
        title: item.title || item.bvid,
        authorMid: String(item.upper?.mid || ''),
        sourceUrl: `https://www.bilibili.com/video/${item.bvid}/`,
        replyCount: Number(item.cnt_info?.reply || 0),
      });
    }
    await humanPause(600, 1600);
  }

  return objects;
}

function getDynamicText(item) {
  const dynamic = item?.modules?.module_dynamic || {};
  const descText = dynamic.desc?.text;
  const major = dynamic.major || {};
  const opusText = major.opus?.summary?.text || major.opus?.title;
  const archiveText = major.archive?.desc || major.archive?.title;
  const articleText = major.article?.desc || major.article?.title;
  return String(descText || opusText || archiveText || articleText || '').trim();
}

function getDynamicTitle(item, text) {
  const dynamic = item?.modules?.module_dynamic || {};
  const major = dynamic.major || {};
  return (
    major.archive?.title ||
    major.article?.title ||
    major.opus?.title ||
    textSnippet(text, `动态 ${item.id_str || item.id || ''}`)
  );
}

export function extractDynamicRecords(items, uid) {
  const objects = [];
  const authoredPosts = [];

  for (const item of items || []) {
    const dynamicId = String(item.id_str || item.id || '');
    const commentType = Number(item.basic?.comment_type || 0);
    const commentOid = String(item.basic?.comment_id_str || item.basic?.comment_id || '');
    const text = getDynamicText(item);
    const title = getDynamicTitle(item, text);
    const sourceUrl = dynamicId ? `https://t.bilibili.com/${dynamicId}` : `https://space.bilibili.com/${uid}/dynamic`;

    if (text) {
      authoredPosts.push({
        sourceKind: 'dynamic-post',
        oid: commentOid || dynamicId,
        replyType: commentType || 17,
        sourceTitle: title,
        sourceUrl,
        rpid: `dynamic-${dynamicId || commentOid}`,
        like: 0,
        ctime: Number(item.modules?.module_author?.pub_ts || 0),
        uname: item.modules?.module_author?.name || '',
        mid: String(uid),
        message: text,
      });
    }

    if (commentType > 0 && commentOid) {
      objects.push({
        id: `dynamic-${commentType}-${commentOid}`,
        kind: 'dynamic',
        oid: commentOid,
        replyType: commentType,
        title: `动态：${textSnippet(title, commentOid)}`,
        authorMid: String(uid),
        sourceUrl,
        replyCount: Number(item.modules?.module_stat?.comment?.count || 0),
      });
    }
  }

  return { objects, authoredPosts };
}

export async function discoverDynamicsByUid(uid, limit, deps = {}) {
  await maybeRevalidateSession(deps);
  guardAuthEndpoint('/x/polymer/web-dynamic/v1/feed/space');
  deps = depsWithBilibiliCookie(deps, deps.bilibiliCookie || deps.cookie);
  const requestJson = deps.fetchJson || fetchJson;
  const pageLimit = Math.max(1, Math.ceil(limit / 12));
  let offset = '';
  const objects = [];
  const authoredPosts = [];

  for (let page = 0; page < pageLimit && objects.length < limit; page += 1) {
    const url = new URL('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space');
    url.searchParams.set('host_mid', uid);
    url.searchParams.set('features', 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard');
    if (offset) url.searchParams.set('offset', offset);

    const data = await requestJson(url.toString(), `https://space.bilibili.com/${uid}/dynamic`);
    if (data.code !== 0) throw new Error(data.message || `dynamic discovery failed with code ${data.code}`);
    const records = extractDynamicRecords(data.data?.items || [], uid);
    objects.push(...records.objects);
    authoredPosts.push(...records.authoredPosts);
    if (!data.data?.has_more || !data.data?.offset) break;
    offset = data.data.offset;
    await humanPause(700, 1700);
  }

  return {
    objects: objects.slice(0, limit),
    authoredPosts: authoredPosts.slice(0, limit),
  };
}

export function collectReplyForUid(reply, targetUid, object, bucket) {
  if (!reply?.content || !reply?.member) return;
  const mid = String(reply.mid || reply.member.mid || '');
  if (mid === String(targetUid)) {
    bucket.push({
      sourceKind: object.kind,
      bvid: object.bvid,
      oid: String(object.oid || ''),
      replyType: Number(object.replyType || 1),
      sourceTitle: object.title || '',
      sourceUrl: object.sourceUrl || '',
      rpid: String(reply.rpid || ''),
      like: Number(reply.like || 0),
      ctime: Number(reply.ctime || 0),
      uname: reply.member.uname || '',
      mid,
      message: reply.content.message || '',
    });
  }
  for (const child of reply.replies || []) {
    collectReplyForUid(child, targetUid, object, bucket);
  }
}

export async function fetchRepliesForObject(object, uid, pages, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const found = [];
  let next = 0;
  const pageCount = Math.max(1, pages);
  for (let index = 0; index < pageCount; index += 1) {
    // Primary: /x/v2/reply (main is blocked/deprecated)
    let url = `https://api.bilibili.com/x/v2/reply?type=${encodeURIComponent(object.replyType || 1)}&oid=${encodeURIComponent(object.oid)}&pn=${index + 1}&ps=20&sort=2`;
    let data = await requestJson(url, object.sourceUrl || 'https://www.bilibili.com');
    let useCursor = false;
    if (data.code !== 0) {
      // Fallback: /x/v2/reply/main with cursor-based pagination
      url = `https://api.bilibili.com/x/v2/reply/main?type=${encodeURIComponent(object.replyType || 1)}&oid=${encodeURIComponent(object.oid)}&mode=3&next=${next}&ps=20`;
      data = await requestJson(url, object.sourceUrl || 'https://www.bilibili.com');
      if (data.code !== 0) break;
      useCursor = true;
    }
    for (const reply of data.data?.replies || []) {
      collectReplyForUid(reply, uid, object, found);
    }
    if (useCursor) {
      const cursor = data.data?.cursor;
      if (!cursor || cursor.is_end || cursor.next == null) break;
      next = cursor.next;
    } else {
      const page = data.data?.page;
      if (!page || index + 1 >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
    }
    await humanPause(600, 1600);
  }
  return found;
}

function collectPublicReply(reply, object, bucket) {
  if (!reply?.content || !reply?.member) return;
  bucket.push({
    sourceKind: object.kind,
    bvid: object.bvid,
    oid: String(object.oid || ''),
    replyType: Number(object.replyType || 1),
    sourceTitle: object.title || '',
    sourceUrl: object.sourceUrl || '',
    rpid: String(reply.rpid || ''),
    like: Number(reply.like || 0),
    ctime: Number(reply.ctime || 0),
    uname: reply.member.uname || '',
    mid: String(reply.mid || reply.member.mid || ''),
    message: reply.content.message || '',
  });
  for (const child of reply.replies || []) {
    collectPublicReply(child, object, bucket);
  }
}

function decodeXmlText(text) {
  return String(text || '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => {
      const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
      return map[entity] || entity;
    })
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16) || 0));
}

export function parseDanmakuXml(xml, video) {
  const items = [];
  const text = String(xml || '');
  const pattern = /<d\b[^>]*p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(text))) {
    const message = decodeXmlText(match[2]).replace(/\s+/g, ' ').trim();
    if (!message) continue;
    const meta = String(match[1] || '').split(',');
    items.push({
      bvid: video.bvid,
      oid: String(video.oid || ''),
      replyType: Number(video.replyType || 1),
      sourceTitle: video.title || '',
      sourceUrl: video.sourceUrl || '',
      rpid: `danmaku-${video.cid || video.oid || video.bvid}-${index}`,
      like: 0,
      ctime: Number(meta[4] || 0),
      uname: '',
      mid: String(meta[6] || ''),
      message,
      kind: 'danmaku',
    });
    index += 1;
  }
  return items;
}

async function runPythonBilibiliParse(payload) {
  const tempDir = await mkdtemp(join(tmpdir(), 'bilibili-parse-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.bilibili_parse', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function parseDanmakuXmlWithPython(xml, video, options = {}) {
  const payload = { mode: 'danmaku', xml: String(xml || ''), video: video || {} };
  const runPythonParse = options.runPythonParse || runPythonBilibiliParse;
  const result = await runPythonParse(payload);
  return Array.isArray(result?.comments) ? result.comments : [];
}

export function parseDanmakuProtobuf(buffer, video) {
  const items = [];
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return items;
  try {
    const bytes = new Uint8Array(buffer);
    // Decode protobuf as UTF-8 and extract Chinese text segments
    // Protobuf embeds danmaku text as UTF-8 strings; non-text bytes become noise
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    // Scan for Chinese text segments (>=2 chars, <120 chars, contains CJK)
    let current = '';
    let index = 0;
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i);
      // CJK Unified Ideographs + CJK punctuation ranges
      const isCJK = (cp >= 0x4E00 && cp <= 0x9FFF)
        || (cp >= 0x3400 && cp <= 0x4DBF)
        || (cp >= 0x3000 && cp <= 0x303F)
        || (cp >= 0xFF00 && cp <= 0xFFEF);
      const isPrintable = cp >= 0x20 && cp <= 0x7E;
      if (isCJK || isPrintable) {
        current += text[i];
        // Handle surrogate pairs
        if (cp >= 0xD800 && cp <= 0xDBFF) {
          if (i + 1 < text.length) {
            current += text[i + 1];
            i++;
          }
        }
      } else {
        if (current.length >= 2 && current.length < 120
          && /[一-鿿]/.test(current)
          && !current.startsWith('{')
          && !current.startsWith('http')) {
          // Filter system messages and UI labels
          if (!/开启后|全站视频|弹幕|^[0-9]/.test(current)) {
            items.push({
              bvid: video.bvid,
              oid: String(video.oid || ''),
              replyType: Number(video.replyType || 1),
              sourceTitle: video.title || '',
              sourceUrl: video.sourceUrl || '',
              rpid: `danmaku-${video.cid || video.oid || video.bvid}-${index}`,
              like: 0,
              ctime: 0,
              uname: '',
              mid: '',
              message: current.trim(),
              kind: 'danmaku',
            });
            index += 1;
          }
        }
        current = '';
      }
    }
  } catch {
    // Protobuf parse failures are non-fatal; return whatever we extracted
  }
  return items;
}

async function fetchDanmakuForVideo(video, deps = {}) {
  const cid = String(video?.cid || '').trim();
  if (!cid) return [];
  // Try new protobuf endpoint first, fall back to legacy XML
  try {
    const requestBuffer = deps.fetchBuffer || fetchBuffer;
    const buffer = await requestBuffer(
      `https://api.bilibili.com/x/v2/dm/web/view?oid=${encodeURIComponent(cid)}&type=1`,
      video.sourceUrl,
    );
    const items = parseDanmakuProtobuf(buffer, video);
    if (items.length > 0) return items;
  } catch {
    // Fall through to legacy endpoint
  }
  // Legacy XML fallback
  try {
    const requestText = deps.fetchText || fetchText;
    const xml = await requestText(
      `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`,
      video.sourceUrl,
    );
    if (deps.usePythonParser || deps.runPythonParse) {
      return parseDanmakuXmlWithPython(xml, video, { runPythonParse: deps.runPythonParse });
    }
    return parseDanmakuXml(xml, video);
  } catch {
    return [];
  }
}

function replySubtreeMatches(reply, deepenMatch) {
  if (deepenMatch(reply?.content?.message || '')) return true;
  for (const child of reply?.replies || []) {
    if (replySubtreeMatches(child, deepenMatch)) return true;
  }
  return false;
}

// Reply-tree deepening: a comment that uses a rare term is often answered by replies
// that quote/echo the same term, so drilling the full sub-thread of a term-bearing
// root comment is the fastest way to reach the 3-evidence target for that term —
// far more reliable than hoping three separate videos each surface it verbatim.
export async function fetchReplyThread(video, rootRpid, options = {}, deps = {}) {
  const root = String(rootRpid || '').trim();
  if (!root) return [];
  const requestJson = deps.fetchJson || fetchJson;
  const pages = Math.max(1, Math.min(Number(options.pages || 2), 5));
  const signal = options.signal;
  const requestOptions = signal ? { signal } : {};
  const collected = [];
  for (let pn = 1; pn <= pages; pn += 1) {
    if (signal?.aborted) break;
    const url = `https://api.bilibili.com/x/v2/reply/reply?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&root=${encodeURIComponent(root)}&pn=${pn}&ps=20`;
    let data;
    try {
      data = await requestJson(url, video.sourceUrl, requestOptions);
    } catch {
      break;
    }
    if (!data || data.code !== 0) break;
    for (const reply of data.data?.replies || []) {
      collectPublicReply(reply, video, collected);
    }
    const page = data.data?.page;
    if (!page || pn >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
    await humanPause(600, 1600);
  }
  return collected;
}

export async function fetchRepliesForVideo(input, options = {}, deps = {}) {
  const bvid = extractBvid(input);
  if (!bvid) {
    return { ok: false, error: 'Video link must contain a valid BV id.' };
  }

  const requestJson = deps.fetchJson || fetchJson;
  const pages = Math.max(1, Math.min(Number(options.pages || 2), 5));
  const video = await resolveBvid(bvid, deps);
  const comments = [];
  const deepenMatch = typeof options.deepenMatch === 'function' ? options.deepenMatch : null;
  const deepenRootLimit = deepenMatch ? Math.max(0, Math.min(Number(options.deepenRootLimit ?? 6), 30)) : 0;
  const deepenPages = Math.max(1, Math.min(Number(options.deepenPages ?? 2), 5));
  const deepenRoots = new Set();
  const queueDeepenRoot = (reply) => {
    if (!deepenMatch || deepenRoots.size >= deepenRootLimit) return;
    const rpid = String(reply?.rpid || '').trim();
    if (!rpid || deepenRoots.has(rpid)) return;
    const shown = Array.isArray(reply?.replies) ? reply.replies.length : 0;
    const total = Number(reply?.rcount || 0);
    if (total > shown && replySubtreeMatches(reply, deepenMatch)) deepenRoots.add(rpid);
  };
  let next = 0;
  let useFallback = false;
  let fallbackPage = 1;
  for (let index = 0; index < pages; index += 1) {
    if (!useFallback) {
      // Primary: /x/v2/reply (main is blocked/deprecated)
      const url = `https://api.bilibili.com/x/v2/reply?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&pn=${index + 1}&ps=20&sort=2`;
      let data = await requestJson(url, video.sourceUrl);
      if (data.code !== 0) {
        useFallback = true;
        fallbackPage = 1;
        // Retry this iteration with the fallback
      } else {
        for (const reply of data.data?.replies || []) {
          collectPublicReply(reply, video, comments);
          queueDeepenRoot(reply);
        }
        const page = data.data?.page;
        if (!page || index + 1 >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
        await humanPause(600, 1600);
        continue;
      }
    }
    if (useFallback) {
      const fallbackUrl = `https://api.bilibili.com/x/v2/reply/main?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&mode=3&next=${next}&ps=20`;
      let data = await requestJson(fallbackUrl, video.sourceUrl);
      if (data.code !== 0) break;
      for (const reply of data.data?.replies || []) {
        collectPublicReply(reply, video, comments);
        queueDeepenRoot(reply);
      }
      const cursor = data.data?.cursor;
      if (!cursor || cursor.is_end || cursor.next == null) break;
      next = cursor.next;
      await humanPause(600, 1600);
    }
  }

  if (deepenMatch && deepenRoots.size > 0) {
    const signal = options.signal;
    for (const rootRpid of deepenRoots) {
      if (signal?.aborted) break;
      try {
        comments.push(...(await fetchReplyThread(video, rootRpid, { pages: deepenPages, signal }, deps)));
      } catch {
        // Thread deepening is supplemental; keep the base comment scan usable on failure.
      }
      await humanPause(600, 1600);
    }
  }

  if (options.includeDanmaku === true) {
    try {
      comments.push(...(await fetchDanmakuForVideo(video, {
        ...deps,
        usePythonParser: options.usePythonParser,
        runPythonParse: options.runPythonParse,
      })));
    } catch {
      // Danmaku is supplemental; keep comment crawling usable when the XML endpoint blocks.
    }
  }

  const uniqueComments = uniqueByRpid(comments);
  return {
    ok: true,
    video,
    comments: uniqueComments,
    commentText: uniqueComments.map((comment) => comment.message).filter(Boolean).join('\n'),
    source: 'Bilibili public video comment scan',
    confidenceHint:
      uniqueComments.length >= 80 ? 'large video comment sample' : uniqueComments.length >= 20 ? 'medium video comment sample' : 'small video comment sample',
  };
}

export async function fetchUserPublicComments(mid, pages, deps = {}) {
  await maybeRevalidateSession(deps);
  guardAuthEndpoint('/x/v2/reply/search');
  deps = depsWithBilibiliCookie(deps, deps.bilibiliCookie || deps.cookie);
  const requestJson = deps.fetchJson || fetchJson;
  const pageCount = Math.max(1, Math.min(Number(pages || 2), 5));
  const comments = [];

  for (let pn = 1; pn <= pageCount; pn += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/search?mid=${encodeURIComponent(mid)}&pn=${pn}&ps=20`;
    let data;
    try {
      data = await requestJson(url, `https://space.bilibili.com/${mid}`);
    } catch {
      break;
    }
    if (!data || data.code !== 0) break;
    for (const reply of data.data?.replies || []) {
      const object = {
        kind: reply.otype === 12 ? 'article' : 'video',
        bvid: reply.bvid || '',
        oid: String(reply.oid || ''),
        replyType: Number(reply.type || reply.replyType || 1),
        title: reply.title || '',
        sourceUrl: reply.url || (reply.bvid ? `https://www.bilibili.com/video/${reply.bvid}/` : `https://space.bilibili.com/${mid}`),
      };
      collectPublicReply(reply, object, comments);
    }
    const page = data.data?.page;
    if (!page || pn >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
    await humanPause(600, 1600);
  }

  return comments;
}

export function dedupePublicObjects(objects) {
  const seen = new Set();
  const unique = [];
  for (const object of objects || []) {
    const key = `${Number(object.replyType || 1)}:${String(object.oid || '')}`;
    if (!object.oid || seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...object,
      oid: String(object.oid),
      replyType: Number(object.replyType || 1),
    });
  }
  return unique;
}

function uniqueByRpid(items) {
  return [...new Map(items.filter((item) => item.rpid).map((item) => [item.rpid, item])).values()];
}

export async function analyzeUid(payload, deps = {}) {
  deps = depsWithBilibiliCookie(deps, payload.bilibiliCookie || payload.bilibiliCookieHeader || payload.cookie);
  const uid = String(payload.uid || '').trim();
  if (!/^\d+$/.test(uid)) {
    return { ok: false, error: 'UID must be a numeric Bilibili mid.' };
  }

  const objectLimit = Math.max(1, Math.min(Number(payload.objectLimit || payload.videoLimit || 8), 12));
  const dynamicLimit = Math.max(0, Math.min(Number(payload.dynamicLimit ?? 8), 12));
  const pagesPerObject = Math.max(1, Math.min(Number(payload.pagesPerObject || payload.pagesPerVideo || 2), 5));
  const warnings = [];
  const discoveredObjects = [];
  const authoredPosts = [];
  let user = { mid: uid, name: `UID ${uid}`, sign: '' };

  try {
    user = await fetchUserCard(uid, deps);
  } catch (error) {
    warnings.push(`profile: ${error.message}`);
  }

  await humanPause(600, 1600);

  try {
    discoveredObjects.push(...(await discoverVideosByUid(uid, objectLimit, deps)));
  } catch (error) {
    warnings.push(`uploads: ${error.message}`);
  }

  if (dynamicLimit > 0) {
    await humanPause(600, 1600);
    try {
      const dynamicRecords = await discoverDynamicsByUid(uid, dynamicLimit, deps);
      discoveredObjects.push(...dynamicRecords.objects);
      authoredPosts.push(...dynamicRecords.authoredPosts);
    } catch (error) {
      warnings.push(`dynamics: ${error.message}`);
    }
  }

  const bvidPool = parseBvidPool(payload.bvidPool);
  for (const bvid of bvidPool.slice(0, objectLimit)) {
    try {
      discoveredObjects.push(await resolveBvid(bvid, deps));
      await humanPause(600, 1600);
    } catch (error) {
      warnings.push(`${bvid}: ${error.message}`);
    }
  }

  const objects = dedupePublicObjects(discoveredObjects).slice(0, objectLimit + bvidPool.length);
  if (objects.length === 0 && authoredPosts.length === 0) {
    return {
      ok: false,
      error: 'No public Bilibili objects were discoverable for this UID.',
      details: warnings.join('; '),
      warnings,
      needsPublicObjects: true,
    };
  }

  const comments = [];
  for (let i = 0; i < objects.length; i += 1) {
    const object = objects[i];
    try {
      comments.push(...(await fetchRepliesForObject(object, uid, pagesPerObject, deps)));
    } catch (error) {
      warnings.push(`${object.title || object.oid}: ${error.message}`);
    }
    if (i < objects.length - 1) {
      await humanPause(800, 2000);
    }
  }

  // Fetch the user's public comment history (comments they wrote on any video)
  try {
    comments.push(...(await fetchUserPublicComments(uid, pagesPerObject, deps)));
  } catch (error) {
    warnings.push(`comment history: ${error.message}`);
  }

  // Fetch ALL public comments on the user's own videos (not just threads where they replied)
  const userVideos = objects.filter((o) => o.kind === 'video');
  for (const video of userVideos) {
    await humanPause(600, 1600);
    try {
      const scan = await fetchRepliesForVideo(video.sourceUrl || video.bvid, { pages: pagesPerObject }, deps);
      if (scan.ok && scan.comments.length > 0) {
        comments.push(...scan.comments);
      }
    } catch (error) {
      warnings.push(`video scan ${video.bvid || video.title}: ${error.message}`);
    }
  }

  const uniqueComments = uniqueByRpid(comments);
  const uniquePosts = uniqueByRpid(authoredPosts);
  const statements = [...uniquePosts, ...uniqueComments];
  return {
    ok: true,
    uid,
    uname: uniqueComments.find((comment) => comment.uname)?.uname || user.name,
    user,
    objects,
    videos: objects.filter((object) => object.kind === 'video'),
    dynamics: objects.filter((object) => object.kind === 'dynamic'),
    authoredPosts: uniquePosts,
    comments: uniqueComments,
    statements,
    commentText: statements.map((item) => item.message).filter(Boolean).join('\n'),
    source: 'Bilibili public UID object scan',
    warnings,
    confidenceHint:
      statements.length >= 12 ? 'sample sufficient' : statements.length >= 5 ? 'low-medium confidence' : 'sample insufficient',
  };
}

// ── Session validation ────────────────────────────────────────────────────────
// Checks whether the BILIBILI_COOKIE session is still valid by calling the
// Bilibili /nav endpoint. Returns { isLogin, mid, uname } or null on error.

export async function validateSession(deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  try {
    const data = await requestJson(
      'https://api.bilibili.com/x/web-interface/nav',
      'https://www.bilibili.com',
      { bilibiliCookie: deps.bilibiliCookie || deps.cookie, config: { minDelayMs: 0, jitterMs: 0, cacheTtlMs: 0, longPauseProbability: 0 } },
    );
    if (data?.code === 0 && data?.data?.isLogin) {
      sessionAuthenticated = true;
      lastSessionCheck = Date.now();
      const mid = String(data.data.mid || '');
      const uname = data.data.uname || '';
      console.log(`[bilibili-crawler] Session valid — logged in as ${uname} (mid=${mid})`);
      return { isLogin: true, mid, uname };
    }
    sessionAuthenticated = false;
    lastSessionCheck = Date.now();
    const reason = data?.code !== 0
      ? `API code ${data?.code}: ${data?.message || 'no message'}`
      : 'isLogin=false (cookie expired or invalid)';
    console.warn(`[bilibili-crawler] Session invalid — ${reason}`);
    console.warn(`[bilibili-crawler] → Check your SESSDATA cookie. Open public/export-cookie.html in a browser to refresh it.`);
    return { isLogin: false, mid: '', uname: '' };
  } catch (error) {
    console.warn(`[bilibili-crawler] Session check failed: ${error.message}`);
    sessionAuthenticated = false;
    lastSessionCheck = Date.now();
    return null;
  }
}

// Check session state, re-validating if the check interval has elapsed.
// Auth-required endpoints: space arc search, favorites, dynamics, nav.
// Returns true if authenticated, false otherwise.
export function isSessionValid() {
  return sessionAuthenticated === true;
}

export function isSessionChecked() {
  return sessionAuthenticated !== null;
}

// Re-validate the session if the configured interval has elapsed since the last
// check. No-op when the session was recently validated. Configurable via
// BILIBILI_SESSION_CHECK_INTERVAL_MS (default 30 min).
export async function maybeRevalidateSession(deps = {}) {
  const intervalMs = Math.max(0, Number(process.env.BILIBILI_SESSION_CHECK_INTERVAL_MS || 1800000));
  if (sessionAuthenticated !== null && (Date.now() - lastSessionCheck) < intervalMs) {
    return; // recently validated — skip
  }
  await validateSession(deps);
}

// Auth-required endpoint paths (used by callers to skip when session is invalid)
const AUTH_REQUIRED_PREFIXES = [
  '/x/space/arc/search',
  '/x/v3/fav/resource',
  '/x/polymer/web-dynamic',
  '/x/v2/reply/search',
];

export function isAuthRequiredEndpoint(url) {
  const urlStr = String(url || '');
  return AUTH_REQUIRED_PREFIXES.some((prefix) => urlStr.includes(prefix));
}

// Guard: throws if the session is known-invalid and the caller is about to hit
// an auth-required endpoint. Call after maybeRevalidateSession() at the top of
// each auth-gated function.
export function guardAuthEndpoint(url) {
  if (isSessionChecked() && !isSessionValid()) {
    throw new Error(
      `Bilibili session invalid — skipping auth-required endpoint: ${endpointKey(url)}. ` +
      `Set a valid BILIBILI_COOKIE to enable auth-dependent features (space, favorites, dynamics, comment history).`,
    );
  }
}

// ── Public API: exporter for TokenBucket, proxy state, WAF state ─────────────

export { TokenBucket, SessionIdentity, getEndpointBucket, initProxyRotator, resetWafState, isEndpointExhausted, isWafResponse, recordWaf, ENDPOINT_BUCKET_DEFAULTS, sessionIdentity, buildSecChUa, USER_AGENTS };
