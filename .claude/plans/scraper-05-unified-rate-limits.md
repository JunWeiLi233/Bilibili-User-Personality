# Scraper Plan 05 — Unified Rate Limits Across Task Configs

> **Status: ✅ IMPLEMENTED** (2026-06-28)

## What It Solves

Before: different task configs used wildly different delays, and one task's aggressive pacing would trigger blocks that blacklisted all other tasks sharing the same IP.

| Task | Old minDelayMs | Old jitterMs | Problem |
|------|---------------|-------------|---------|
| `bilibiliCrawler.js` default | 2500 | 2000 | Baseline |
| `danmaku_deep.json` | **900** | **700** | 3× faster — triggered blocks for everyone |
| `keyword_search.json` | Inherited 2500 | Inherited 2000 | OK |

When `danmaku_deep` triggered a block, the same IP was now rate-limited for `keyword_search` and `seed_scrape` too. Tasks didn't know about each other.

## Implementation (already done)

### What Changed

1. **`danmaku_deep.json`**: Hardcoded `minDelayMs: 900` and `jitterMs: 700` were **removed** from the task config. The file now has no delay fields — it inherits defaults from `bilibiliCrawler.js`.

2. **`bilibiliCrawler.js`**: All delay configuration is centralized in `readCrawlerConfig()` (lines 338–356), which reads from env vars:
   ```env
   BILIBILI_CRAWLER_MIN_DELAY_MS=2500
   BILIBILI_CRAWLER_JITTER_MS=2000
   ```

3. **Token bucket** (Plan 01) is now the primary rate control, making per-request delays a secondary safety net rather than the only defense.

### Current State

All task types (`bilibili-seed-scrape`, `bilibili-keyword-search`, `bilibili-danmaku-deep`) import the same `bilibiliCrawler.js` module and go through the same `scheduleBilibiliRequest()` → `fetchJson()` / `fetchText()` path. There is one source of truth for rate limits.

## Configuration

```env
# All task types respect these:
BILIBILI_CRAWLER_MIN_DELAY_MS=2500    # Minimum ms between requests
BILIBILI_CRAWLER_JITTER_MS=2000       # Random jitter added on top
BILIBILI_RATE_BURST=8                 # Token bucket burst cap
BILIBILI_RATE_SUSTAIN=2               # Token bucket refill rate/sec

# If danmaku-specific tuning is ever needed later:
BILIBILI_DANMAKU_MIN_DELAY_MS=2500    # Override for danmaku-only (reserved, not yet wired)
```

## Verification

```bash
# Check danmaku task delay is >= 2500ms, not 900ms
# Run a danmaku task with logging:
node .claude/resume_task.js danmaku-deep --batch=3

# Check the log timestamps — gap between requests should be >= 2500ms
# The old 900ms behavior should never appear
```

## What This Doesn't Cover

- **AICU third-party API** (`server/scripts/batchScrapeAicu.js`): uses its own 10s delay between pages — this is OK since it hits a different API (aicu.cc, not api.bilibili.com)
- **Browser-harness CDP scraping**: separate path, not affected
