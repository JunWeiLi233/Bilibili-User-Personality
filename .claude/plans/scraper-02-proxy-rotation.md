# Scraper Plan 02 — Proxy Rotation

> **Status: ✅ IMPLEMENTED** (2026-06-28)

## What It Solves

All traffic from one IP = single point of failure. One block code blacks out every scraping task. Proxy rotation spreads requests across multiple IPs so a block on one doesn't kill the run.

## Implementation (already done)

**File:** `server/services/bilibiliCrawler.js`

| Component | Lines | What It Does |
|-----------|-------|-------------|
| `initProxyRotator(env)` | 277–329 | Loads proxies from `BILIBILI_PROXY_LIST` (comma-separated URLs or newline-delimited file). Tracks `consecutiveBlocks` per proxy. Quarantines proxies with ≥3 consecutive blocks (exponential: `2^(n-1) × 120s` up to 8×). `rotate()` skips quarantined proxies. |
| `markBlock()` | 318–322 | Increments block count, quarantines at threshold, auto-rotates to next proxy |
| `markSuccess()` | 323–326 | Resets block counter on healthy response |
| Integration in `applyBlockCooldown()` | 642–647 | On rate-limit block → marks proxy, rotates |
| Integration in `applyWafCooldown()` | 649–657 | On WAF block → marks proxy (with per-proxy WAF tracking), rotates |
| Integration in `fetchJson()` success | 710–713 | On `code === 0` → `proxyRotator.markSuccess(current)` |

## Configuration

```env
BILIBILI_PROXY_LIST="http://user:pass@proxy1:8080,http://user:pass@proxy2:8080"
# OR point to a file (one proxy URL per line):
BILIBILI_PROXY_LIST="D:\Bilibili_User_Personality\.claude\proxies.txt"
```

## Verification

```bash
# Set up 3 proxies in BILIBILI_PROXY_LIST
# Trigger a block on proxy #1 (e.g., burst 20 rapid requests)
# Check logs for rotation event and proxy #2 taking over
```

## Note on Cost

This is the **only scraper hardening problem that costs money**. All other problems are pure code. If you don't have proxies:
- Skip this — set `BILIBILI_PROXY_LIST` to empty and the rotator stays inactive
- The other 4 free problems together give 5–10× block reduction without proxies
- When you do get proxies (e.g., PacketStream at $1/GB), just set the env var — no code changes needed
