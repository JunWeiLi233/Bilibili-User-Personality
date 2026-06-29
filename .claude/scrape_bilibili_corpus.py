# -*- coding: utf-8 -*-
"""Scrape Bilibili comments for diverse topics using browser-harness CDP.
Saves raw comments to corpus files for later DeepSeek analysis.

Usage:
  PYTHONUTF8=1 PYTHONIOENCODING=utf-8 browser-harness -c "exec(open('.claude/scrape_bilibili_corpus.py', encoding='utf-8').read())"
"""
import time
import json
import os
import re

# ---- Config ----
SEARCH_QUERIES = [
    # Tech/Software
    "编程 争论 评论区",
    "AI 人工智能 争议",
    "前端 后端 吵架",
    "程序员 争论 热评",
    # Gaming
    "原神 争议 评论区",
    "LOL 吵架 热评",
    "游戏 节奏 评论区",
    "黑神话 争议",
    # Entertainment
    "综艺 争议 评论区",
    "电影 差评 争议",
    "动漫 争议 评论",
    "番剧 吵架",
    # Social/Current Events
    "社会 热点 争论",
    "政策 讨论 争议",
    "教育 争论 评论",
    # Lifestyle
    "美食 争议 评论",
    "健身 争论 评论区",
    "数码 争议 评测",
    "汽车 争论 评论区",
    # Science
    "科学 争议 讨论",
    "哲学 争论 讨论",
    "医学 争论 评论",
]

MAX_VIDEOS_PER_QUERY = 3
SCROLL_TIMES = 4
SCROLL_PAUSE = 1.5
PAGE_WAIT = 4
OUTPUT_DIR = ".claude/corpus_batches"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_bvids_from_page():
    """Extract BV IDs from current search results page."""
    raw = js("""
    (() => {
        var links = document.querySelectorAll('a[href*="www.bilibili.com/video/"]');
        var bvids = [];
        links.forEach(function(a) {
            var href = a.getAttribute('href');
            var match = href && href.match(/BV[\\w]+/);
            if (match && bvids.indexOf(match[0]) === -1) bvids.push(match[0]);
        });
        return JSON.stringify(bvids.slice(0, 15));
    })()
    """)
    if raw:
        try:
            return json.loads(raw)
        except:
            pass
    # Fallback: parse page text for BVIDs
    try:
        text = js("document.body.innerText.slice(0, 30000)")
        if text:
            found = list(set(re.findall(r'BV[\w]{10}', text)))
            return found[:15]
    except:
        pass
    return []

def scrape_video_comments(bvid):
    """Navigate to a video, scroll, extract comments."""
    url = "https://www.bilibili.com/video/" + bvid
    smart_open(url, prune=False)
    time.sleep(PAGE_WAIT)

    # Scroll to load comments
    for i in range(SCROLL_TIMES):
        js("window.scrollBy(0, 800)")
        time.sleep(SCROLL_PAUSE)

    # Try to extract comments using JavaScript
    raw = js("""
    (() => {
        var comments = [];
        var selectors = [
            '.reply-content',
            '.comment-list .reply-content',
            '.bb-comment .comment-text',
            '[class*="reply-content"]',
            '[class*="comment-con"]'
        ];
        for (var s = 0; s < selectors.length; s++) {
            var els = document.querySelectorAll(selectors[s]);
            if (els.length > 0) {
                for (var i = 0; i < els.length; i++) {
                    var text = els[i].innerText.trim();
                    if (text && text.length > 2) comments.push(text);
                }
                if (comments.length > 0) break;
            }
        }
        return JSON.stringify(comments.slice(0, 80));
    })()
    """)
    if raw:
        try:
            return json.loads(raw)
        except:
            pass
    return []

def search_and_scrape(query):
    """Search Bilibili for a query and scrape comments from found videos."""
    import urllib.parse
    encoded = urllib.parse.quote(query)
    search_url = "https://search.bilibili.com/all?keyword=" + encoded + "&order=click"
    smart_open(search_url)
    time.sleep(PAGE_WAIT)

    bvids = extract_bvids_from_page()
    print("  Search '" + query + "': found " + str(len(bvids)) + " videos")

    all_video_data = []
    for idx, bvid in enumerate(bvids[:MAX_VIDEOS_PER_QUERY]):
        print("    [" + str(idx+1) + "/" + str(min(len(bvids), MAX_VIDEOS_PER_QUERY)) + "] Scraping " + bvid)
        comments = scrape_video_comments(bvid)
        if comments:
            all_video_data.append({"bvid": bvid, "comments": comments})
            print("      Got " + str(len(comments)) + " comments")

    return all_video_data

def main():
    total_comments = 0
    all_data = []

    print("=== Bilibili Corpus Scraper ===")
    print("Queries: " + str(len(SEARCH_QUERIES)))
    print("Max videos/query: " + str(MAX_VIDEOS_PER_QUERY))
    print("")

    for qi, query in enumerate(SEARCH_QUERIES):
        print("--- Query " + str(qi+1) + "/" + str(len(SEARCH_QUERIES)) + ": " + query + " ---")
        try:
            videos = search_and_scrape(query)
            for v in videos:
                total_comments += len(v["comments"])
            all_data.append({"query": query, "videos": videos})
        except Exception as e:
            print("  ERROR: " + str(e))

    # Save batch
    batch_file = os.path.join(OUTPUT_DIR, "batch_" + str(int(time.time())) + ".json")
    with open(batch_file, "w", encoding="utf-8") as f:
        json.dump({
            "queries": SEARCH_QUERIES,
            "data": all_data,
            "total_comments": total_comments,
            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }, f, ensure_ascii=False, indent=2)

    print("")
    print("=== Done ===")
    print("Total videos: " + str(sum(len(d["videos"]) for d in all_data)))
    print("Total comments: " + str(total_comments))
    print("Saved: " + batch_file)

main()
