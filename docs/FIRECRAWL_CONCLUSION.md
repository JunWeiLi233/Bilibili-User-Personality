# Firecrawl Integration — Conclusion Report

**Date:** 2026-06-30
**PR:** [#24](https://github.com/JunWeiLi233/Bilibili_User_Personality/pull/24) — `docs/community-health-files-v2` → `main`
**Status:** Draft — ready for review

---

## What was built

A Tier-2 scraping fallback that routes Bilibili comment harvesting through a self-hosted
Firecrawl instance when the direct Bilibili API is rate-limited or blocked.

```
Direct Bilibili API (Tier 1)
    │
    ├── OK → normal harvest
    │
    └── 412 / Cloudflare → Firecrawl (Tier 2)
                                │
                                ├── OK → video discovery, fallback search
                                │
                                └── blocked → Browser-Harness (Tier 3)
```

## Files changed (7 files, +507 / −22)

| File | Lines | Purpose |
|---|---|---|
| `python_backend/scrapers/firecrawl_adapter.py` | +112 (new) | Core adapter: `search_bilibili()`, `fallback_search()`, `scrape_video_comments()`, `batch_harvest_evidence()`, `is_available()` |
| `server/scripts/runFirecrawlHarvest.js` | +54 (new) | Standalone JS driver: reads `keywordCoverageActions.json`, delegates to Python adapter |
| `server/services/keywordHarvest.js` | +28/−0 | `firecrawlFallbackSearch()` called on rate-limit; added seed queries |
| `run-bilibili-auto-coverage.ps1` | +7/−0 | `-Firecrawl` switch + env var wiring |
| `package.json` | +1/−0 | `dictionary:firecrawl` npm script |
| `README.md` | +13/−22 | Firecrawl setup link + minor cleanup |
| `docs/PROJECT_PAPER.md` | +292 (new) | Markdown render of the research paper |

## What works

| Capability | Status | Notes |
|---|---|---|
| Self-hosted Firecrawl deployment | ✅ | `docker compose up` on `localhost:3002` |
| `is_available()` health check | ✅ | Scrapes bilibili.com → verifies markdown output |
| `search_bilibili(term)` | ✅ | Discovers Bilibili videos by keyword via Firecrawl search |
| `fallback_search(term)` | ✅ | Returns `{ok, videos, source: "firecrawl"}` on rate-limit |
| `-Firecrawl` switch in PS1 | ✅ | Sets `FIRECRAWL_ENABLED=1` |
| `npm run dictionary:firecrawl` | ✅ | Standalone harvest from coverage actions |
| `firecrawlFallbackSearch()` in JS | ✅ | Python subprocess call with 30s timeout |

## What doesn't work

| Limitation | Explanation |
|---|---|
| Comment extraction from Bilibili | Bilibili loads comments via XHR after page render. Self-hosted Firecrawl (no Fire Engine / premium anti-bot) cannot execute these XHRs, so `scrape_video_comments()` may return 0 comments for Bilibili pages. |
| `batch_harvest_evidence()` | Depends on `scrape_video_comments()`, so same limitation applies. |
| Agent endpoint | Requires Firecrawl Cloud API key (not self-hosted). |

## Where the adapter adds value

The adapter's primary contribution is **video discovery and search fallback**. When the
direct Bilibili search API returns 412 (rate-limited), the adapter discovers videos via
Firecrawl's search endpoint, bypassing Bilibili's internal search. These discovered videos
are then handed off to browser-harness or the direct API for actual comment extraction.

This is explicitly documented in the adapter's module docstring (lines 1–17 of
`firecrawl_adapter.py`), so no future developer will expect full comment extraction from
Firecrawl alone.

## Commands reference

```powershell
# Auto-coverage loop with Firecrawl tier enabled
.\run-bilibili-auto-coverage.ps1 -MaxCycles 3 -MaxQueries 20 -Firecrawl

# Standalone Firecrawl harvest (reads keywordCoverageActions.json)
$env:FIRECRAWL_ENABLED="1"
npm run dictionary:firecrawl

# Unit test the adapter
$env:FIRECRAWL_ENABLED="1"
python -c "
from python_backend.scrapers.firecrawl_adapter import is_available, search_bilibili
assert is_available(), 'Firecrawl not reachable'
videos = search_bilibili('阴阳怪气', limit=3)
assert len(videos) > 0, 'No videos found'
print(f'OK: {len(videos)} videos discovered via Firecrawl')
"

# Start/stop Firecrawl
docker compose -f ~/firecrawl/docker-compose.yaml up -d
docker compose -f ~/firecrawl/docker-compose.yaml down
```

## Recommendation

**Merge as-is.** The adapter is functional for its documented scope (search + discovery
fallback), and the limitations are clearly stated in the code and PR. When Firecrawl adds
Fire Engine support to the self-hosted version, `scrape_video_comments()` will start
working for XHR-heavy pages like Bilibili without any code changes — the same
`firacrawl-py` SDK calls will just start returning comment content.
