# Scraper Plan 01 — TokenBucket Rate Limiter

> **Status: ✅ IMPLEMENTED** (2026-06-28)

## What It Solves

Proactive rate capping instead of the old reactive block-and-sleep model. Before: requests fire as fast as the delay allows, hit `-412`/`-799`, then sleep. After: token bucket throttles requests before they reach Bilibili's rate-limit wall.

## Implementation (already done)

**File:** `server/services/bilibiliCrawler.js`

| Component | Lines | What It Does |
|-----------|-------|-------------|
| `TokenBucket` class | 104–154 | Constructor(burst, sustainPerSec, nowFn). `take()` returns Promise that resolves when a token is available. `#refill()` tops up at sustain rate. |
| `ENDPOINT_BUCKET_DEFAULTS` | 161–175 | Per-endpoint config: search strict (burst=5, sustain=1), reply moderate (10/3), video loose (12/4), danmaku loosest (15/5) |
| `getEndpointBucket()` | 177–199 | Lazy-init per-endpoint bucket, respects `BILIBILI_RATE_BURST` / `BILIBILI_RATE_SUSTAIN` env overrides, longest-prefix matching |
| Integration in `fetchJson()` | 676–679 | `bucket.take(waitFn)` called before every API fetch |
| Integration in `fetchText()` | 736–739 | Same for danmaku XML text fetches |
| `resetAllBuckets()` | 201–203 | Reset all buckets for test isolation |

## Configuration

```env
BILIBILI_RATE_BURST=8        # Max burst tokens (override per-endpoint defaults)
BILIBILI_RATE_SUSTAIN=2      # Tokens refilled per second
```

## Verification

```bash
# Run 50 rapid card requests — all should complete without a single -412
node --test --test-name-pattern="token bucket" server/services/bilibiliCrawler.test.js

# Or: watch logs during any scrape task — look for "TokenBucket" or absence of -412 storms
```

## Interaction with Other Components

- Works with **WAF early-exit** (Plan 04): if a WAF fires, WAF tracking takes over. Token bucket prevents rate-limit blocks; WAF tracking handles Cloudflare blocks — different failure modes.
- Works with **proxy rotation** (Plan 02): token bucket is IP-agnostic. Proxy rotation happens at the block-cooldown layer, token bucket at the request layer.
