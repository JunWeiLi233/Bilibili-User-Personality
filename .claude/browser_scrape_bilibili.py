"""Browser-based Bilibili scraper for weak keyword evidence.

Usage via browser-harness:
  browser-harness -c 'exec(open(".claude/browser_scrape_bilibili.py").read())'

Uses the browser's authenticated session to call Bilibili APIs,
bypassing anti-scraping measures.
"""
import json
import os
import time

# --- Weak keywords that need more evidence ---
WEAK_KEYWORDS = [
    # From strict coverage audit (target-evidence 3)
    "就是鬼畜标签", "就算六个齐上也不是我对手", "没有成为炒饭的资格",
    "男的就是这样", "男的就是这样爱推卸责任", "缺点只有一个",
    "缺点只有一个贵", "茶庄10个有9个洗钱的", "说八百遍了",
    "谁都受不住", "都说八百遍了",
    "8打5的雷霆", "一个多亿", "侮辱乐手",
    "分不清轻重", "分不清轻重就乱套", "基本没有音乐理解",
    "就是要干你", "换个地方再就业", "有什么值得炫耀的",
]

OUTPUT_DIR = ".claude/browser_scrape_results"
os.makedirs(OUTPUT_DIR, exist_ok=True)

results = {}
keywords_processed = 0


def search_bilibili(keyword, page=1):
    """Search Bilibili via the browser's authenticated fetch."""
    import urllib.parse
    encoded = urllib.parse.quote(keyword)

    search_result = js(f"""
    (async function() {{
        try {{
            var url = "https://api.bilibili.com/x/web-interface/wbi/search/all/v2"
                + "?keyword={encoded}&page={page}&search_type=video";
            var resp = await fetch(url, {{
                headers: {{ "Referer": "https://search.bilibili.com" }},
                credentials: "include"
            }});
            var data = await resp.json();
            // Extract video results
            var videos = [];
            var result_list = data?.data?.result || [];
            for (var i = 0; i < result_list.length; i++) {{
                var r = result_list[i];
                if (r.result_type === "video" && Array.isArray(r.data)) {{
                    for (var j = 0; j < r.data.length; j++) {{
                        var v = r.data[j];
                        videos.push({{
                            bvid: v.bvid || "",
                            aid: v.aid || 0,
                            title: (v.title || "").substring(0, 200),
                            play: v.play || 0,
                            comment: v.video_review || 0,
                        }});
                    }}
                }}
            }}
            return videos.slice(0, 10);
        }} catch(e) {{
            return [{{error: e.message}}];
        }}
    }})()
    """)
    return search_result if isinstance(search_result, list) else []


def fetch_video_comments(bvid, max_pages=2):
    """Fetch comments for a Bilibili video through browser."""
    all_comments = []
    for page in range(1, max_pages + 1):
        result = js(f"""
        (async function() {{
            try {{
                var url = "https://api.bilibili.com/x/v2/reply/main"
                    + "?oid={bvid}&type=1&mode=3&ps=20&pn={page}";
                var resp = await fetch(url, {{
                    headers: {{ "Referer": "https://www.bilibili.com/video/{bvid}" }},
                    credentials: "include"
                }});
                var data = await resp.json();
                var replies = data?.data?.replies || [];
                return replies.map(function(r) {{
                    return {{
                        content: (r.content || {{}}).message || r.content || "",
                        like: r.like || 0,
                        rcount: r.rcount || 0,
                    }};
                }});
            }} catch(e) {{
                return [{{error: e.message}}];
            }}
        }})()
        """)
        if isinstance(result, list):
            valid = [c for c in result if isinstance(c, dict) and c.get("content")]
            all_comments.extend(valid)
            if len(valid) < 20:
                break
        wait(1.5)  # Rate limit between page requests
    return all_comments


# --- Main scraping loop ---
print(f"Starting browser-based Bilibili scrape for {len(WEAK_KEYWORDS)} keywords...")
print(f"Output dir: {OUTPUT_DIR}")

for idx, keyword in enumerate(WEAK_KEYWORDS):
    print(f"\n[{idx+1}/{len(WEAK_KEYWORDS)}] Searching: {keyword}")

    # Search for videos
    videos = search_bilibili(keyword)
    print(f"  Found {len(videos)} videos")

    if not videos or any(v.get("error") for v in videos):
        print(f"  Search failed, skipping...")
        results[keyword] = {"status": "search_failed", "videos": [], "comments": []}
        continue

    # Get comments from top videos
    keyword_evidence = []
    videos_with_comments = 0

    for vi, video in enumerate(videos[:3]):  # Top 3 videos per keyword
        bvid = video.get("bvid", "")
        if not bvid:
            continue

        print(f"  Fetching comments from {bvid} ({video.get('title', '')[:60]}...)")
        wait(2)  # Polite delay between video requests

        comments = fetch_video_comments(bvid, max_pages=2)
        print(f"    Got {len(comments)} comments")

        # Find comments containing the keyword
        matches = [c for c in comments if keyword in c.get("content", "")]
        if matches:
            print(f"    Found {len(matches)} matches for '{keyword}'!")
            for m in matches[:5]:
                keyword_evidence.append({
                    "keyword": keyword,
                    "bvid": bvid,
                    "video_title": video.get("title", ""),
                    "comment": m["content"][:500],
                    "source": f"Bilibili browser scrape: https://www.bilibili.com/video/{bvid}"
                })
            videos_with_comments += 1

    results[keyword] = {
        "status": "ok" if keyword_evidence else "no_matches",
        "videos_searched": len(videos[:3]),
        "comments_total": sum(len(fetch_video_comments(v.get("bvid",""), max_pages=1))
                              for v in videos[:3] if v.get("bvid")),
        "matches_found": len(keyword_evidence),
        "evidence": keyword_evidence,
    }
    keywords_processed += 1

    # Polite delay between keywords
    if idx < len(WEAK_KEYWORDS) - 1:
        delay = 3 + (idx % 3)  # 3-5 seconds between keywords
        wait(delay)

    # Save incremental results every 5 keywords
    if (idx + 1) % 5 == 0:
        out_path = os.path.join(OUTPUT_DIR, f"bilibili_scrape_progress_{idx+1}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  [Saved progress to {out_path}]")

# --- Final save ---
out_path = os.path.join(OUTPUT_DIR, "bilibili_scrape_results.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({
        "keywords_processed": keywords_processed,
        "total_keywords": len(WEAK_KEYWORDS),
        "results": results,
    }, f, ensure_ascii=False, indent=2)

print(f"\n=== SCRAPE COMPLETE ===")
print(f"Processed: {keywords_processed}/{len(WEAK_KEYWORDS)} keywords")
print(f"Results saved to: {out_path}")

# Summary
with_matches = sum(1 for r in results.values() if r.get("matches_found", 0) > 0)
total_matches = sum(r.get("matches_found", 0) for r in results.values())
print(f"Keywords with matches: {with_matches}/{len(WEAK_KEYWORDS)}")
print(f"Total evidence matches: {total_matches}")
