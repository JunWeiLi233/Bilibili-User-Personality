# Scraper Plan 04 — WAF Early-Exit

> **Status: ✅ IMPLEMENTED** (2026-06-28)

## What It Solves

Before: when Cloudflare (1015) or HTML WAF was detected, the crawler slept 2 minutes and retried. If the IP was permanently flagged, it retried **forever** — wasting 2 minutes per cycle and burning through the task budget with zero progress.

After: 3 consecutive WAFs on the same endpoint → mark exhausted, skip remaining work. 5 total WAFs across all endpoints → abort entire run with clear error.

## Implementation (already done)

**File:** `server/services/bilibiliCrawler.js`

| Component | Lines | What It Does |
|-----------|-------|-------------|
| `wafCounts` Map | 210 | Tracks WAF count per `"endpoint\|proxy"` key |
| `exhaustedEndpoints` Set | 211 | Endpoints to skip |
| `totalWafs` counter | 212 | Global WAF count for run-abort threshold |
| `WAF_HTTP_CODES` | 214 | `Set([403, 503])` — HTTP status codes treated as potential WAF |
| `WAF_BLOCK_CODES` | 215 | `Set([-101, -111])` — Bilibili API codes treated as WAF (not rate-limit) |
| `isWafResponse()` | 217–221 | Classifies a response as WAF by HTTP status OR API code |
| `endpointKey()` | 223–230 | Extracts pathname from URL for grouping |
| `recordWaf()` | 232–252 | Increments per-endpoint count, marks exhausted at ≥3, aborts run at ≥5 total |
| `isEndpointExhausted()` | 254–256 | Check before fetch — returns true if endpoint is done |
| `resetWafState()` | 258–262 | Reset for test isolation |
| Integration in `fetchJson()` | 672–674 | `isEndpointExhausted(url)` check → throw before fetch |
| Integration in `fetchText()` | 732–734 | Same for danmaku XML fetches |
| Integration in `fetchJson()` error | 690–698 | HTTP 403/503 → `applyWafCooldown()` |
| Integration in `fetchJson()` block | 702–708 | API code -101/-111 → `applyWafCooldown()` |
| `applyWafCooldown()` | 649–657 | Records WAF + applies block cooldown + rotates proxy |

## Behavior Flow

```
Request → isEndpointExhausted? → YES → throw "endpoint exhausted"
                ↓ NO
           fetch → HTTP 403/503? → YES → recordWaf → cooldown → next request
                ↓ NO
           payload.code = -101/-111? → YES → recordWaf → cooldown → next request
                ↓ NO
           payload.code = -412/-799? → applyBlockCooldown (rate-limit, not WAF)
                ↓ NO
           success → reset consecutiveBlocks
```

## Abort Thresholds

| Threshold | Action | Rationale |
|-----------|--------|-----------|
| 3 WAFs on same endpoint | Mark exhausted, skip | Persistent Cloudflare on one endpoint = wasting time |
| 5 WAFs total across all endpoints | Throw, abort run | IP/pool likely broadly flagged, stop before burning quota |

## Verification

```bash
# Mock 3 consecutive 1015 responses on search endpoint
# 4th attempt should be skipped with log:
#   "Bilibili endpoint exhausted (WAF early-exit): /x/web-interface/search/type"

# Mock 5 total WAFs across endpoints
# Should throw:
#   "Bilibili scraper aborted: 5 total WAF detections..."
```
