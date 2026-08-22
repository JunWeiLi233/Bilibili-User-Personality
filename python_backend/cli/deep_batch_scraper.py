"""
Multi-round deep batch scraper — Python contract for server/scripts/deepBatchScraper.js.

Scrapes Bilibili history seed videos across 3 rounds of increasing depth.
Supports resume, progress tracking, and per-seed result persistence.

Usage:
  python -m python_backend.cli.deep_batch_scraper --round 1 [--write]
  python -m python_backend.cli.deep_batch_scraper --round 2 [--write]
  python -m python_backend.cli.deep_batch_scraper --round 3 [--write]
  python -m python_backend.cli.deep_batch_scraper --round 1 --dry-run  # plan only
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

ROUND_CONFIGS = {
    1: {
        "label": "Round 1 — Deepen top-5 (pages=5, danmaku 1000, deepenMatch)",
        "inputFile": ".claude/top5_per_seed.json",
        "outputDir": ".claude/seed_results_deep",
        "progressFile": ".claude/scrape_progress_deep.json",
        "pages": 5,
        "danmakuCap": 1000,
        "enableDeepenMatch": True,
        "deepenRootLimit": 10,
        "deepenPages": 3,
    },
    2: {
        "label": "Round 2 — Videos 6-10 (pages=3, danmaku 500)",
        "inputFile": "server/data/bilibiliHistoryTagCorpus.json",
        "outputDir": ".claude/seed_results_batch2",
        "progressFile": ".claude/scrape_progress_batch2.json",
        "pages": 3,
        "danmakuCap": 500,
        "enableDeepenMatch": False,
        "videoRankStart": 6,
        "videoRankEnd": 10,
    },
    3: {
        "label": "Round 3 — Videos 11-15 (pages=2, danmaku 300)",
        "inputFile": "server/data/bilibiliHistoryTagCorpus.json",
        "outputDir": ".claude/seed_results_batch3",
        "progressFile": ".claude/scrape_progress_batch3.json",
        "pages": 2,
        "danmakuCap": 300,
        "enableDeepenMatch": False,
        "videoRankStart": 11,
        "videoRankEnd": 15,
    },
}

EXISTING_RESULT_DIRS = [
    ".claude/seed_results",
    ".claude/seed_results_deep",
    ".claude/seed_results_batch2",
    ".claude/seed_results_batch3",
]


def load_json(relative_path: str) -> dict[str, Any]:
    path = PROJECT_ROOT / relative_path
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def load_progress(progress_file: str) -> dict[str, Any]:
    path = PROJECT_ROOT / progress_file
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "completed": [], "blocked": [], "lastSeed": None,
        "totalVideos": 0, "totalComments": 0, "totalDanmaku": 0,
    }


def save_progress(progress_file: str, progress: dict[str, Any]):
    path = PROJECT_ROOT / progress_file
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")


def save_seed_results(output_dir: str, seed: str, results: dict[str, Any]):
    dir_path = PROJECT_ROOT / output_dir
    dir_path.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in seed)
    file_path = dir_path / f"{safe_name}.json"
    file_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def select_videos_by_rank(corpus: dict, start: int, end: int, existing_bvids: set) -> dict[str, list]:
    """Select videos ranked N-M per seed, excluding already-scraped BVIDs."""
    by_seed: dict[str, list] = {}
    for video in corpus.get("videos", []):
        seed = video.get("sourceQuery") or (video.get("tags") or [None])[0]
        if not seed:
            continue
        by_seed.setdefault(seed, []).append(video)

    selected: dict[str, list] = {}
    for seed, videos in by_seed.items():
        ranked = sorted(
            [v for v in videos if v.get("bvid") and v["bvid"] not in existing_bvids],
            key=lambda v: -(int(v.get("replyCount") or 0)),
        )
        slice_ = ranked[start - 1:end]
        if slice_:
            selected[seed] = slice_
    return selected


def collect_existing_bvids(dirs: list[str]) -> set[str]:
    """Collect all already-scraped BVIDs from existing result directories."""
    bvids: set[str] = set()
    for d in dirs:
        dir_path = PROJECT_ROOT / d
        if not dir_path.is_dir():
            continue
        for f in dir_path.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                for v in data.get("videos", []):
                    if v.get("bvid") and not v.get("error"):
                        bvids.add(v["bvid"])
            except (json.JSONDecodeError, OSError):
                pass
    return bvids


def run_round(config: dict, write_mode: bool) -> dict[str, Any]:
    """Execute one round of deep batch scraping. Returns summary."""
    result = {"ok": True, "round": config["label"], "processed": 0, "errors": 0}

    if not write_mode:
        result["dryRun"] = True
        # Load and report what would be processed
        target_videos = _resolve_targets(config)
        seeds = list(target_videos.keys())
        result["wouldProcessSeeds"] = len(seeds)
        result["sample"] = [
            {"seed": s, "videos": len(target_videos[s])}
            for s in seeds[:10]
        ]
        return result

    # --- LIVE MODE ---
    # 2. Resolve target videos
    target_videos = _resolve_targets(config)
    seeds = list(target_videos.keys())

    # 3. Load progress for resume
    progress = load_progress(config["progressFile"])
    completed = set(progress.get("completed", []))
    blocked = set(progress.get("blocked", []))
    remaining = [s for s in seeds if s not in completed and s not in blocked]

    total_videos = progress.get("totalVideos", 0)
    total_comments = progress.get("totalComments", 0)
    total_danmaku = progress.get("totalDanmaku", 0)

    # 4. Process seeds
    from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerRunner, BilibiliCrawlerRuntimePolicy

    policy = BilibiliCrawlerRuntimePolicy.from_env(os.environ)
    dict_terms = []
    if config.get("enableDeepenMatch"):
        from python_backend.corpus.dictionary import DictionaryLoader
        dictionary = DictionaryLoader(PROJECT_ROOT / "server/data/deepseekKeywordDictionary.json").load()
        dict_terms = [e.get("term", "") for e in dictionary.entries if e.get("term")]

    for i, seed in enumerate(remaining):
        videos = target_videos.get(seed, [])
        seed_results = {
            "seed": seed,
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
            "round": config["label"],
            "videos": [],
        }

        for j, v in enumerate(videos):
            bvid = v.get("bvid", "")
            try:
                runner = BilibiliCrawlerRunner(policy=policy)
                fetch_result = runner.run_json({
                    "bvid": bvid,
                    "pages": config["pages"],
                    "includeDanmaku": True,
                })

                if fetch_result.get("ok"):
                    # Flatten comments
                    all_comments = fetch_result.get("comments", [])
                    regular = [c for c in all_comments if c.get("kind") not in ("danmaku", "dm")]
                    danmaku = [c for c in all_comments if c.get("kind") in ("danmaku", "dm")]

                    seed_results["videos"].append({
                        "bvid": bvid,
                        "title": v.get("title", fetch_result.get("video", {}).get("title", "")),
                        "replyCount": v.get("replyCount", 0),
                        "comments": len(regular),
                        "danmaku": min(len(danmaku), config["danmakuCap"]),
                        "commentMessages": [
                            {"message": str(c.get("message", ""))[:300],
                             "time": c.get("time") or c.get("ctime") or 0,
                             "likes": int(c.get("like") or 0)}
                            for c in regular
                        ],
                        "danmakuMessages": [
                            {"message": str(d.get("message") or d.get("content", ""))[:200],
                             "time": d.get("time") or d.get("ctime") or 0}
                            for d in danmaku[:config["danmakuCap"]]
                        ],
                    })
                    total_comments += len(regular)
                    total_danmaku += min(len(danmaku), config["danmakuCap"])
                else:
                    seed_results["videos"].append({"bvid": bvid, "error": fetch_result.get("error", "unknown")})

            except Exception as e:
                seed_results["videos"].append({"bvid": bvid, "error": str(e)})
                result["errors"] += 1

            # Block check: first 2 videos both fail → block seed
            failures = sum(1 for vv in seed_results["videos"] if vv.get("error"))
            if j == 1 and failures >= 2:
                blocked.add(seed)
                break

        total_videos += len(videos)
        if write_mode:
            save_seed_results(config["outputDir"], seed, seed_results)

        if seed not in blocked:
            completed.add(seed)
        progress.update({
            "completed": list(completed),
            "blocked": list(blocked),
            "lastSeed": seed,
            "totalVideos": total_videos,
            "totalComments": total_comments,
            "totalDanmaku": total_danmaku,
        })
        save_progress(config["progressFile"], progress)
        result["processed"] = i + 1

        # Throttle between seeds
        time.sleep(2)

    result.update({
        "seedsCompleted": len(completed),
        "seedsBlocked": len(blocked),
        "totalSeeds": len(seeds),
        "totalVideos": total_videos,
        "totalComments": total_comments,
        "totalDanmaku": total_danmaku,
    })
    return result


def _resolve_targets(config: dict) -> dict[str, Any]:
    """Resolve target videos for the round (dry-run and live)."""
    if config.get("videoRankStart"):
        corpus = load_json(config["inputFile"])
        existing_bvids = collect_existing_bvids(EXISTING_RESULT_DIRS)
        return select_videos_by_rank(
            corpus, config["videoRankStart"], config["videoRankEnd"], existing_bvids
        )
    else:
        return load_json(config["inputFile"])


def main():
    parser = argparse.ArgumentParser(description="Multi-round deep batch scraper")
    parser.add_argument("--round", type=int, required=True, choices=[1, 2, 3],
                        help="Which round to run (1, 2, or 3)")
    parser.add_argument("--write", action="store_true",
                        help="Actually scrape and write (default: dry-run)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Explicit dry-run (show plan only)")
    args = parser.parse_args()

    config = ROUND_CONFIGS.get(args.round)
    if not config:
        print(f"Invalid round: {args.round}. Use 1, 2, or 3.", file=sys.stderr)
        sys.exit(1)

    write_mode = args.write and not args.dry_run

    if not write_mode:
        print(f"\n{'='*60}")
        print(config["label"])
        print(f"{'='*60}\n")
        print(f"Input:  {config['inputFile']}")
        print(f"Output: {config['outputDir']}")
        print(f"Pages:  {config['pages']}")
        print(f"Danmaku cap: {config['danmakuCap']}")
        if config.get("enableDeepenMatch"):
            print(f"Deepen match: enabled (root limit={config['deepenRootLimit']}, pages={config['deepenPages']})")
        print("\nDRY RUN — set --write to actually scrape.")

        result = run_round(config, write_mode=False)
        would_process = result.get("wouldProcessSeeds", 0)
        print(f"Would process {would_process} seeds.")
        for item in (result.get("sample") or [])[:5]:
            print(f"  {item['seed']}: {item['videos']} videos")
        if would_process > 5:
            print(f"  ... and {would_process - 5} more seeds")
    else:
        print(f"\n{'='*60}")
        print(config["label"])
        print(f"{'='*60}\n")
        result = run_round(config, write_mode=True)
        print(f"\n=== {config['label']} DONE ===")
        print(f"Seeds: {result.get('seedsCompleted', 0)}/{result.get('totalSeeds', 0)} "
              f"({result.get('seedsBlocked', 0)} blocked)")
        print(f"Videos: {result.get('totalVideos', 0)}")
        print(f"Comments: {result.get('totalComments', 0)}")
        print(f"Danmaku: {result.get('totalDanmaku', 0)}")
        if result.get("errors"):
            print(f"Errors: {result['errors']}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
