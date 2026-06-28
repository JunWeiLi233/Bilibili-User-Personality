# Scraper Anti-Detection Plan

> Generated 2026-06-28. Evaluated `server/services/bilibiliCrawler.js` (1195 lines), `python_backend/scrapers/`, `server/scripts/batchScrapeAicu.js`, `.claude/tasks/*.json` task configs.

## Problems the evaluation surfaced (10 total, 6 code-solvable)

### 1. No proactive rate limiting — reactionary block-and-sleep model

**Current behavior:** Requests fire as fast as the delay allows. When Bilibili returns `-412` or `-799`, the crawler sleeps `2^(n-1) × 120s`. This *guarantees* periodic block storms — the crawler hits the wall, backs off, then immediately hits it again.

**Root cause:** No sliding window, token bucket, or rate budget. The delay (`2500ms + jitter 2000ms`) is between-request spacing, not a rate cap. A burst of 5 fast pages still goes through.

**Fix:** Add a `TokenBucket` class to `bilibiliCrawler.js`:
- Configurable burst size (default 8) and sustain rate (default 2/sec)
- Applied before every `fetch()` call — if no tokens, await refill
- Per-endpoint buckets: search gets stricter limits, video/reply gets looser
- Config via env vars: `BILIBILI_RATE_BURST`, `BILIBILI_RATE_SUSTAIN`

**Files:** `server/services/bilibiliCrawler.js` (~60 lines new, ~10 lines integration)

**Verification:** Run a 50-request burst against `api.bilibili.com/x/web-interface/card?mid=1`. With token bucket, all 50 complete without a single `-412`.

---

### 2. No IP rotation — single point of failure

**Current behavior:** All traffic originates from one IP. A single block code blacks out *every* scraping task simultaneously. Four consecutive blocks = 16 minutes of total downtime.

**Root cause:** `node-fetch` calls go direct. No proxy support exists anywhere in the crawler.

**Fix:** Add proxy rotation to `bilibiliCrawler.js`:
- Load proxy list from `BILIBILI_PROXY_LIST` env var (comma-separated URLs or newline-delimited file path)
- `ProxyRotator` class: tracks `consecutiveBlocks` per proxy, skips proxies with ≥3 consecutive blocks
- On `applyBlockCooldown()`, rotate to next healthy proxy
- Fallback to direct connection when pool is exhausted
- Health check: ping `api.bilibili.com/x/web-interface/card?mid=1` with each proxy on init

**Files:** `server/services/bilibiliCrawler.js` (~80 lines new, ~5 lines integration)

**Verification:** Set `BILIBILI_PROXY_LIST` with 3 proxies. Trigger a block on proxy #1. Next request uses proxy #2. Proxy #1 stays quarantined for cooldown duration then rejoins pool.

---

### 3. Global UA state leaks identity across sessions

**Current behavior:** `sessionUaPicked` is a module-level global. All `BilibiliCrawler` instances share one UA. Server restarts reuse the same UA. Bilibili can correlate: same IP + same UA + different synthetic cookies = obvious scraper fingerprint.

**Root cause:** UA selection happens once at module load time, not per-instance.

**Fix:** 
- Move UA selection into the `BilibiliCrawler` constructor (per-instance, not per-module)
- Expand UA pool from 5 to 15 entries: add Firefox 124-126, Safari 17.x mobile, Edge 124-126
- Each instance picks independently
- Add `BILIBILI_CRAWLER_UA` env var override for testing

**Files:** `server/services/bilibiliCrawler.js` (~30 lines change)

**Verification:** Create 3 `BilibiliCrawler` instances. Each has a different `userAgent`. No shared mutable state.

---

### 4. No early-exit on persistent WAF — infinite retry loops

**Current behavior:** When Cloudflare (1015) or HTML WAF is detected, the crawler sleeps 2 minutes and retries. If the IP is permanently flagged, it retries *forever*, wasting 2 minutes per cycle.

**Root cause:** WAF detection triggers a generic cooldown but no per-endpoint abandonment logic.

**Fix:**
- Track WAF count per endpoint + per proxy
- After 3 consecutive WAFs on the same endpoint, mark it exhausted and skip remaining work
- After 5 total WAFs across all endpoints, abort the run with a clear error
- Log each abandonment with endpoint + proxy + attempt count

**Files:** `server/services/bilibiliCrawler.js` (~40 lines new)

**Verification:** Mock 3 consecutive 1015 responses on the search endpoint. Fourth attempt is skipped with log message "endpoint search exhausted after 3 WAFs."

---

### 5. Unify rate limits across all task configs

**Current behavior:** Different task configs use wildly different delays:

| Task | minDelayMs | jitterMs | Risk |
|------|-----------|----------|------|
| `bilibiliCrawler.js` default | 2500 | 2000 | Baseline |
| `danmaku_deep.json` | 900 | 700 | 3× faster — triggers blocks sooner |
| `keyword_search.json` | Inherits 2500 | Inherits 2000 | OK |
| `batchScrapeAicu.js` | 10000 | — | OK (third-party API) |

When `danmaku_deep` triggers a block, the *same IP* is now rate-limited for `keyword_search` and the default crawler too. Tasks don't know about each other.

**Root cause:** Each task config sets its own delays independently. No shared rate budget.

**Fix:**
- Read `minDelayMs` and `jitterMs` from env vars with defaults, not hardcoded in task JSON
- `BILIBILI_CRAWLER_MIN_DELAY_MS` and `BILIBILI_CRAWLER_JITTER_MS` already exist — task runners should respect them
- Add `BILIBILI_DANMAKU_MIN_DELAY_MS` (default matching crawler: 2500) to override the aggressive danmaku delay
- Remove hardcoded `minDelayMs: 900` from `danmaku_deep.json`

**Files:** `.claude/tasks/danmaku_deep.json` (1 line change), `.claude/resume_task.js` (read env vars, ~10 lines)

**Verification:** Run danmaku task with default env. Check logs — delay between requests is ≥2500ms, not 900ms.

---

### 6. Login session validation — silent data loss on cookie expiry

**Current behavior:** `BILIBILI_COOKIE` is a static string. When SESSDATA expires, authenticated endpoints (user space, favorites, dynamics) return empty data silently — no error, just `[]`. The crawler continues for hours scraping nothing.

**Root cause:** No pre-flight session check. No cookie expiry detection.

**Fix:**
- Add `validateSession()` method: `GET api.bilibili.com/x/web-interface/nav`
- If response has `data.isLogin: true` → log `mid` + `uname`, proceed
- If `data.isLogin: false` → log warning, set `this.authenticated = false`, skip auth-required endpoints
- Run once on crawler init, then every 30 minutes during long runs
- Configurable via `BILIBILI_SESSION_CHECK_INTERVAL_MS`

**Files:** `server/services/bilibiliCrawler.js` (~30 lines new)

**Verification:** Set an expired `BILIBILI_COOKIE`. Crawler logs "Session invalid — falling back to unauthenticated mode" and skips space/favorites/dynamics without error.

---

## What NOT to code (infrastructure / external service problems)

| # | Problem | Why not code-solvable |
|---|---------|----------------------|
| 7 | No captcha solving | Requires 2captcha/capsolver subscription + integration. Not a code fix. |
| 8 | No Cloudflare JS challenge bypass | Requires browser-level JS execution (already available via `browser-harness` but not wired as fallback). Hybrid approach possible but >200 lines. |
| 9 | No TLS fingerprint randomization | Requires modifying the Node.js TLS stack or using a custom HTTP client (e.g., `curl-impersonate` bindings). Not practical in pure JS. |
| 10 | No distributed scraping | Requires multi-machine orchestration (K8s, worker fleet, shared state). Infrastructure problem, not a code fix. |

---

## Dependency order

```
Problem 1 (token bucket) ── independent, blocks nothing
Problem 2 (proxy rotation) ── independent, blocks nothing
Problem 3 (per-instance UA) ── independent, blocks nothing
    │
    ├── These three can run in parallel. They touch different
    │   sections of bilibiliCrawler.js with no conflicts.
    │
Problem 4 (WAF early-exit) ── benefits from Problem 2 (per-proxy tracking)
Problem 5 (unify rate limits) ── benefits from Problem 1 (token bucket is the source of truth)
Problem 6 (session validation) ── independent

Recommended order: 1 → 2 → 3 (parallel), then 4 → 5 → 6
```

First three together: ~3 hours of work, ~170 lines of new code, 5-10× reduction in block frequency.
