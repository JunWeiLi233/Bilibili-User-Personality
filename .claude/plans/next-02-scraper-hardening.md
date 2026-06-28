# Next 02: Scraper Infrastructure Hardening (plans 01–06)

**Status**: Ready | **Estimate**: ~180 min total | **Depends on**: Nothing

## Why

The Bilibili crawler (`server/services/bilibiliCrawler.js`) is intentionally conservative — sequential requests, minimal caching, cooldown on rate limits. Six existing plans in `.claude/plans/scraper-0*.md` document hardening work that would make scraping more reliable and resilient without increasing aggression.

## Concrete steps (run in order)

### Phase 1: Token bucket rate limiter — scraper-01 (~30 min)
Replace the current `minDelay + jitter` approach with a proper token bucket. This allows burst-then-wait behavior that's more natural than fixed delays, while maintaining the same average rate.

**Files**: `server/services/bilibiliCrawler.js` (add TokenBucket class, swap delay logic)

### Phase 2: Proxy rotation — scraper-02 (~30 min)
Add optional proxy rotation via `BILIBILI_PROXY_LIST` env var (comma-separated `host:port` or `http://user:pass@host:port`). Round-robin with per-proxy rate limit tracking. Falls back to direct connection when no proxies configured.

**Files**: `server/services/bilibiliCrawler.js` (add proxy rotation, per-proxy bucket)

### Phase 3: Per-instance User-Agent — scraper-03 (~20 min)
Rotate UA strings from a pool of realistic Chrome/Firefox versions. Avoids fingerprinting when combined with proxy rotation.

**Files**: `server/services/bilibiliCrawler.js` (add UA pool, rotate per request)

### Phase 4: WAF early-exit — scraper-04 (~25 min)
Detect WAF challenge pages (Cloudflare, Bilibili CAPTCHA) by response signature, exit immediately with structured error instead of retrying into a block.

**Files**: `server/services/bilibiliCrawler.js` (add WAF detector, early-exit logic)

### Phase 5: Unified rate limit config — scraper-05 (~20 min)
Consolidate all rate-limit env vars (`BILIBILI_CRAWLER_MIN_DELAY_MS`, `BILIBILI_CRAWLER_JITTER_MS`, `BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS`, `BILIBILI_CRAWLER_CACHE_TTL_MS`, plus new proxy/UA/WAF vars) into a single `scraperConfig` module with validation.

**Files**: `server/services/scraperConfig.js` (new), `server/services/bilibiliCrawler.js` (import from config)

### Phase 6: Session validation — scraper-06 (~20 min)
Add pre-flight check before starting a scrape session: verify cookies are still valid, API endpoints respond, rate-limit state is clear. Fail fast instead of discovering mid-scrape.

**Files**: `server/services/bilibiliCrawler.js` (add `validateSession()`, call before scrape)

### Final: Integration test sweep (~35 min)
Add tests for token bucket math, proxy rotation, WAF detection, UA pool uniqueness, config validation, and session validation.

## Caveats
- Proxy and UA rotation are **defense in depth**, not bypass tools — the crawler stays single-threaded and conservative
- All new features are gated behind env vars and default **off** (except token bucket and unified config)
- Existing test suite (1463 tests) must pass at every phase

## Success criteria
| Metric | Target |
|---|---|
| Token bucket tests | ≥5 pass |
| Proxy rotation tests | ≥3 pass |
| UA pool tests | ≥3 pass |
| WAF detection tests | ≥4 pass |
| Config validation tests | ≥5 pass |
| Session validation tests | ≥3 pass |
| Existing tests | 1463 pass, 0 regressions |
