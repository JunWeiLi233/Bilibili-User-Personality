# Firecrawl Integration Plan

## Why

Bilibili occasionally serves Cloudflare challenges that block the direct crawler. Firecrawl
adds anti-bot bypass + proxy rotation as a Tier-2 fallback: **Direct API → Firecrawl (scale)
→ Browser-Harness (auth + precision)**. Self-hosted = free, Docker, no API key.

## Phase 1 — Deploy Firecrawl (self-hosted)

```powershell
# 1. Clone and start
cd ~
git clone https://github.com/firecrawl/firecrawl.git firecrawl
cd firecrawl
docker compose up -d

# 2. Verify containers are up
docker ps --filter "name=firecrawl" --format "table {{.Names}}\t{{.Status}}"
# Expect: firecrawl-api, firecrawl-worker, redis, postgres — all "Up"

# 3. Smoke test: scrape Bilibili homepage
curl -s http://localhost:3002/v2/scrape `
  -H "Content-Type: application/json" `
  -d '{"url":"https://www.bilibili.com","formats":["markdown"]}' `
  | python -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('data',{}).get('markdown') else 'FAIL')"

# 4. Install Python SDK
pip install firecrawl-py
python -c "from firecrawl import Firecrawl; fc=Firecrawl(api_url='http://localhost:3002'); print('SDK OK')"
```

## Phase 2 — Create Firecrawl adapter

**Create file:** `python_backend/scrapers/firecrawl_adapter.py`

```python
"""Firecrawl adapter for Bilibili comment harvesting.

Tier-2 fallback when direct Bilibili API returns 412 (rate-limited)
or Cloudflare challenge. Self-hosted: http://localhost:3002 (no API key).
"""

import json, os, re, time
from typing import Any

from firecrawl import Firecrawl

API_URL  = os.environ.get("FIRECRAWL_BASE_URL", "http://localhost:3002")
API_KEY  = os.environ.get("FIRECRAWL_API_KEY", "")
ENABLED  = os.environ.get("FIRECRAWL_ENABLED", "0") == "1"

_fc: Firecrawl | None = None

def get_client() -> Firecrawl:
    global _fc
    if _fc is None:
        kw: dict[str, Any] = {"api_url": API_URL}
        if API_KEY: kw["api_key"] = API_KEY
        _fc = Firecrawl(**kw)
    return _fc

def is_available() -> bool:
    if not ENABLED: return False
    try:
        r = get_client().scrape("https://www.bilibili.com", formats=["markdown"])
        return bool(r.get("data", {}).get("markdown"))
    except Exception:
        return False

def search_bilibili(term: str, limit: int = 10) -> list[dict[str, str]]:
    """Search Bilibili for a keyword, return [{url, title, bv_id}, ...]."""
    if not ENABLED: return []
    query = f"{term} 评论 site:bilibili.com"
    try:
        results = get_client().search(query=query, limit=limit)
    except Exception:
        return []
    videos: list[dict[str, str]] = []
    for item in (results.get("data") or []):
        url = str(item.get("url", ""))
        if "bilibili.com/video/" not in url: continue
        m = re.search(r"(BV[\w]+)", url)
        videos.append({"url": url, "title": str(item.get("title", "")), "bv_id": m.group(1) if m else ""})
        if len(videos) >= limit: break
    return videos

def scrape_video_comments(url: str, pages: int = 2) -> list[str]:
    """Scrape comment text from a Bilibili video page."""
    if not ENABLED: return []
    comments: list[str] = []
    for page in range(1, pages + 1):
        page_url = f"{url}?p={page}" if page > 1 else url
        try:
            resp = get_client().scrape(page_url, formats=["markdown"])
        except Exception:
            continue
        md = resp.get("data", {}).get("markdown", "")
        for line in md.split("\n"):
            line = line.strip()
            if line.startswith("- **") or line.startswith("* **"):
                comments.append(line)
        time.sleep(0.5)
    return comments

def batch_harvest_evidence(terms: list[str], videos_per_term: int = 5) -> dict[str, list[dict[str, str]]]:
    """Harvest evidence for multiple terms. Returns {term: [{comment_text, video_url, video_title}, ...]}."""
    if not ENABLED: return {}
    results: dict[str, list[dict[str, str]]] = {}
    for term in terms:
        videos = search_bilibili(term, limit=videos_per_term)
        evidence: list[dict[str, str]] = []
        for v in videos:
            for c in scrape_video_comments(v["url"], pages=2):
                if term in c:
                    evidence.append({"comment_text": c, "video_url": v["url"], "video_title": v["title"]})
        results[term] = evidence
        time.sleep(1.0)
    return results

def fallback_search(term: str) -> dict[str, Any] | None:
    """Called when Bilibili direct API is rate-limited. Returns None if Firecrawl also fails."""
    if not ENABLED: return None
    try:
        videos = search_bilibili(term, limit=8)
        return {"ok": True, "videos": videos, "source": "firecrawl"} if videos else None
    except Exception:
        return None
```

**Verify:**

```powershell
$env:FIRECRAWL_ENABLED="1"
python -c "
from python_backend.scrapers.firecrawl_adapter import search_bilibili, is_available
print('Available:', is_available())
for v in search_bilibili('阴阳怪气', limit=3):
    print(f'  {v[\"title\"][:60]}')
"
```

## Phase 3 — Wire into coverage loop

### 3.1 Add `-Firecrawl` flag to PowerShell driver

**Edit file:** `run-bilibili-auto-coverage.ps1`

Add parameter (near other `[switch]` params, ~line 43):

```powershell
[switch]$Firecrawl
```

Add env var setup (near other env var lines, ~line 170):

```powershell
if ($Firecrawl) {
  $env:FIRECRAWL_ENABLED = "1"
  Write-Host "Firecrawl tier enabled (http://localhost:3002)"
}
```

### 3.2 Add fallback in JS harvest pipeline

**Edit file:** `server/services/keywordHarvest.js`

Add function near the video discovery section:

```javascript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

async function firecrawlFallbackSearch(term) {
  if (process.env.FIRECRAWL_ENABLED !== '1') return null;
  try {
    const { stdout } = await execFileAsync('python', [
      '-c',
      `from python_backend.scrapers.firecrawl_adapter import fallback_search
import json
result = fallback_search(${JSON.stringify(term)})
print(json.dumps(result, ensure_ascii=False))`,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    return parsed && parsed.ok ? parsed : null;
  } catch {
    return null;
  }
}
```

Wire into video discovery — after the `discoverVideosByKeyword()` call, add a catch:

```javascript
// Existing: const result = await discoverVideosByKeyword(query, options);
// Add fallback on rate-limit:
// if (!result.ok && result.status === 412) {
//   const fb = await firecrawlFallbackSearch(term);
//   if (fb) return fb;
// }
```

### 3.3 Add npm script

**Edit file:** `package.json` — add to `"scripts"`:

```json
"dictionary:firecrawl": "node server/scripts/runFirecrawlHarvest.js"
```

### 3.4 Create Firecrawl harvest script

**Create file:** `server/scripts/runFirecrawlHarvest.js`

```javascript
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const ACTIONS_PATH = 'server/data/keywordCoverageActions.json';

async function main() {
  const actions = JSON.parse(await readFile(ACTIONS_PATH, 'utf8'));
  const terms = actions
    .filter(a => a.action === 'harvest')
    .slice(0, 20)
    .map(a => a.term);

  if (!terms.length) { console.log('No harvest terms found.'); return; }
  console.log(`Firecrawl harvest: ${terms.length} terms`);

  const { stdout } = await execFileAsync('python', [
    '-c', `
import json, sys, os
os.environ["FIRECRAWL_ENABLED"] = "1"
from python_backend.scrapers.firecrawl_adapter import batch_harvest_evidence
terms = json.loads(sys.argv[1])
results = batch_harvest_evidence(terms, videos_per_term=5)
print(json.dumps(results, ensure_ascii=False))
    `, JSON.stringify(terms),
  ], { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

  const evidence = JSON.parse(stdout);
  let total = 0;
  for (const [term, items] of Object.entries(evidence)) {
    if (items.length) { console.log(`  ${term}: ${items.length} hits`); total += items.length; }
  }
  console.log(`Total: ${total} evidence hits`);
}
main().catch(err => { console.error(err); process.exit(1); });
```

## Phase 4 — Verify end-to-end

```powershell
# 1. Unit test the adapter
$env:FIRECRAWL_ENABLED="1"
python -c "
from python_backend.scrapers.firecrawl_adapter import is_available, search_bilibili, scrape_video_comments
assert is_available(), 'Firecrawl not reachable'
videos = search_bilibili('阴阳怪气', limit=3)
assert len(videos) > 0, 'No videos found'
print(f'Search OK: {len(videos)} videos')
if videos:
    comments = scrape_video_comments(videos[0]['url'], pages=1)
    print(f'Scrape OK: {len(comments)} comments from {videos[0][\"title\"][:50]}')
"

# 2. Batch harvest test
$env:FIRECRAWL_ENABLED="1"
python -c "
from python_backend.scrapers.firecrawl_adapter import batch_harvest_evidence
results = batch_harvest_evidence(['阴阳怪气', '扣帽子'], videos_per_term=3)
for term, items in results.items():
    print(f'{term}: {len(items)} evidence hits')
"

# 3. Full pipeline
npm run dictionary:coverage          # generate coverage actions
npm run dictionary:firecrawl         # harvest via Firecrawl
npm run dictionary:coverage          # re-audit — should show improvement
npm run stats:update                 # refresh README

# 4. Auto-coverage loop with Firecrawl tier
.\run-bilibili-auto-coverage.ps1 -MaxCycles 1 -MaxQueries 10 -Firecrawl
```

## Files changed

| File | Action | Purpose |
|---|---|---|
| `python_backend/scrapers/firecrawl_adapter.py` | CREATE | Search, scrape, batch harvest, fallback |
| `server/scripts/runFirecrawlHarvest.js` | CREATE | JS driver for standalone Firecrawl harvest |
| `run-bilibili-auto-coverage.ps1` | MODIFY | Add `-Firecrawl` switch + env var |
| `server/services/keywordHarvest.js` | MODIFY | Add `firecrawlFallbackSearch()` on rate-limit |
| `package.json` | MODIFY | Add `dictionary:firecrawl` script |
