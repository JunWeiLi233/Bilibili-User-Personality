# Multi-Round Deep Scrape Plan

**Goal:** Harvest deeper comments + danmaku from Bilibili history seed videos across 4 rounds with per-seed checkpointing.

**Current state:** 196 seeds scraped shallowly (`pages=1`, top 5 videos/seed) → 7,908 comments, 1.36M danmaku. The corpus holds 3,360 videos (~17/seed), so 2,385 videos are untouched. The crawler supports up to `pages=5` per video — currently only using 1.

## Tooling

| File | Purpose |
|---|---|
| `.claude/hooks/stop-goal-check.cjs` | Stop hook: blocks exit until all 4 rounds complete + coverage goal met |
| `.claude/resume_deep_scrape.js` | Self-resuming runner: detects active round, scrapes next batch, checkpoints |
| `.claude/multi_round_deep_scrape_plan.md` | This plan (reference for the runner + goal prompt) |

**Invocation:** `node .claude/resume_deep_scrape.js [round] [--batch=N]`

- Auto-detects active round from progress files
- Scrapes up to `--batch=N` seeds per turn (default 15)
- Checkpoints after every seed → survives interruption
- Next turn picks up exactly where it left off

---

## Round 1 — Deepen existing top-5 per seed (pages 1→5)

- **Input:** `.claude/top5_per_seed.json` (196 seeds × 5 BVIDs each)
- **Action:** Re-scrape the same top-5 BVIDs but with `pages: 5` (max) instead of `pages: 1`
- **Danmaku:** `includeDanmaku: true`, cap raised to 1000 (was 500)
- **Reply threads:** Enable `deepenMatch` — load keyword dictionary terms to identify high-value reply threads worth expanding
- **Output:** `.claude/seed_results_deep/{seed}.json`
- **Progress:** `.claude/scrape_progress_deep.json`
- **Expected gain:** ~5× more comments per video, ~40,000 total comments

### Crawler options for Round 1

```js
crawler.fetchRepliesForVideo(bvid, {
  pages: 5,
  includeDanmaku: true,
  deepenMatch: (reply) => dictTerms.some(t => (reply?.message || '').includes(t)),
  deepenRootLimit: 10,
  deepenPages: 3,
});
```

---

## Round 2 — Scrape next-5 videos per seed (videos 6-10)

- **Input:** `server/data/bilibiliHistoryTagCorpus.json` (3,360 videos)
- **Selection:** Per seed, find videos ranked 6-10 by `replyCount` whose BVID is NOT already in `seed_results/` or `seed_results_deep/`
- **Scrape:** `pages: 3`, `includeDanmaku: true` (cap 500)
- **Output:** `.claude/seed_results_batch2/{seed}.json`
- **Progress:** `.claude/scrape_progress_batch2.json`
- **Expected gain:** ~980 additional videos scraped

---

## Round 3 — Fill remaining videos 11-15 per seed

- **Selection:** Videos ranked 11-15 by `replyCount`, not yet scraped
- **Scrape:** `pages: 2`, `includeDanmaku: true` (cap 300)
- **Output:** `.claude/seed_results_batch3/{seed}.json`
- **Progress:** `.claude/scrape_progress_batch3.json`
- **Expected gain:** up to ~980 more videos

---

## Round 4 — Re-harvest evidence from all accumulated results

- **Input directories:**
  - `.claude/seed_results/` (original, 196 files)
  - `.claude/seed_results_deep/` (round 1)
  - `.claude/seed_results_batch2/` (round 2)
  - `.claude/seed_results_batch3/` (round 3)
- **Action:** Flatten all comments + danmaku across all directories, match against keyword dictionary terms, merge new evidence samples
- **Output:** Updated dictionary + `server/data/keywordCoverageAudit.json`
- **Script:** Follow the pattern in `server/scripts/harvestSeedCorpusEvidence.js`

---

## Constraints (all rounds)

- **API layer:** `server/services/bilibiliCrawler.js` — never bypass its rate limiting
- **Rate limits:** `BILIBILI_CRAWLER_MIN_DELAY_MS=900`, `BILIBILI_CRAWLER_JITTER_MS=700`, block cooldown 45s
- **Sequential only:** Never parallelize Bilibili API calls. Strictly one video at a time.
- **Anti-block:** On -412 / -509 / -799 → cooldown 45s, skip to next video
- **Seed-level guard:** If a seed's first 2 videos both fail → mark seed as `blocked`, move on
- **Checkpoint per seed:** Save progress after every seed so interruption loses zero work
- **Logging per video:** seed name, video index, pages fetched, comments collected, danmaku collected
- **Summary every 10 seeds:** print running totals

---

## Scaling Dimensions

| Dimension | Was | Target | ~Multiplier |
|---|---|---|---|
| Pages/video (top 5) | 1 | 5 | 5× |
| Videos/seed scraped | 5 | 15 | 3× |
| Total videos scraped | 975 | ~2,940 | 3× |
| Expected comments | 7,908 | ~40,000+ | 5× |
| Danmaku cap | 500 | 1000 (R1) | 2× |

---

## Progress File Schema

```json
{
  "completed": ["seed1", "seed2", ...],
  "blocked": ["blocked_seed", ...],
  "lastSeed": "last_seed_name",
  "totalVideos": 0,
  "totalComments": 0,
  "totalDanmaku": 0
}
```

---

## Resume / Interruption

If interrupted mid-round, the next invocation reads `scrape_progress_deep.json` (or the active round's progress file), skips seeds in `completed`, and resumes from the next uncompleted seed. The `lastSeed` field is informational only — the actual skip logic is `Set.has(seed)` on the completed array.
