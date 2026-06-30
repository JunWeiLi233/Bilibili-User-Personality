"""
Fast Bilibili comment scraper using browser-harness CDP.
Searches Bilibili for diverse queries, opens videos, scrolls comments, saves to corpus.
Usage:
  browser-harness -c "exec(open('.claude/browser_scrape_comments.py').read())"
Or with specific queries:
  BU_QUERY='["编程 争论","原神 争议"]' browser-harness -c "exec(open('.claude/browser_scrape_comments.py').read())"
"""
import time
import json
import os
import re
from urllib.parse import quote

# ── Config ──
MAX_VIDEOS_PER_QUERY = 5
MAX_COMMENTS_PER_VIDEO = 50
SCROLL_PAUSE = 1.5
PAGE_LOAD_WAIT = 4
OUTPUT_DIR = ".claude/corpus_batches"

# ── Default diverse queries ──
DEFAULT_QUERIES = [
    "编程 争论 评论区",
    "AI 人工智能 争议",
    "原神 争议",
    "LOL 吵架 评论",
    "综艺 争议 评论区",
    "社会 热点 争论",
    "电影 差评 争议",
    "健身 争论 评论区",
    "科学 争议 讨论",
    "动漫 争议 评论",
    "哲学 争论 讨论",
    "游戏 节奏 评论区",
    "手机 争议 评测",
    "美食 争议 评论",
    "教育 争论 评论",
]

def parse_queries():
    raw = os.environ.get("BU_QUERY", "")
    if raw:
        try:
            return json.loads(raw)
        except:
            return [q.strip() for q in raw.split("\n") if q.strip()]
    return DEFAULT_QUERIES

def ensure_output_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_bvid_from_url(url):
    """Extract BV ID from bilibili URL."""
    m = re.search(r'BV[\w]+', url)
    return m.group(0) if m else None

def search_bilibili(query, max_results=MAX_VIDEOS_PER_QUERY):
    """Search Bilibili and return list of video BV IDs."""
    encoded = quote(query)
    search_url = f"https://search.bilibili.com/all?keyword={encoded}&order=click"
    smart_open(search_url)
    time.sleep(PAGE_LOAD_WAIT)

    # Get search result links
    try:
        links_js = js("""
            (() => {
                const links = document.querySelectorAll('a[href*="www.bilibili.com/video/"]');
                const bvids = [];
                links.forEach(a => {
                    const href = a.getAttribute('href');
                    const match = href && href.match(/BV[\\\\w]+/);
                    if (match && !bvids.includes(match[0])) bvids.push(match[0]);
                });
                return JSON.stringify(bvids.slice(0, 10));
            })()
        """)
        if links_js:
            return json.loads(links_js)[:max_results]
    except Exception as e:
        print(f"  Search error: {e}")

    # Fallback: parse page text for BV IDs
    try:
        text = js("document.body.innerText.slice(0, 20000)")
        bvids = list(set(re.findall(r'BV[\w]{10}', text or "")))[:max_results]
        return bvids
    except:
        pass

    return []

def scrape_video_comments(bvid, max_comments=MAX_COMMENTS_PER_VIDEO):
    """Open a video page, scroll through comments, extract them."""
    video_url = f"https://www.bilibili.com/video/{bvid}"
    smart_open(video_url, prune=False)
    time.sleep(PAGE_LOAD_WAIT)

    # Scroll down to load comments
    for i in range(5):
        js("window.scrollBy(0, 800)")
        time.sleep(SCROLL_PAUSE)

    # Extract comments
    try:
        comments_js = js("""
            (() => {
                const comments = [];
                // Try multiple selectors for comments
                const selectors = [
                    '.reply-item .reply-content',
                    '.comment-list .comment-item .text',
                    '.reply-content',
                    '[class*="reply-content"]',
                    '[class*="comment-content"]',
                ];
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) {
                        els.forEach(el => {
                            const text = el.innerText.trim();
                            if (text && text.length > 2) comments.push(text);
                        });
                        break;
                    }
                }
                return JSON.stringify(comments.slice(0, 50));
            })()
        """)
        if comments_js:
            return json.loads(comments_js)
    except Exception as e:
        print(f"  Comment extraction error for {bvid}: {e}")

    return []

def scrape_bilibili_popular():
    """Scrape Bilibili popular/trending page for video links."""
    smart_open("https://www.bilibili.com/v/popular/all")
    time.sleep(PAGE_LOAD_WAIT)

    try:
        bvids_js = js("""
            (() => {
                const links = document.querySelectorAll('a[href*="/video/BV"]');
                const bvids = [];
                links.forEach(a => {
                    const href = a.getAttribute('href');
                    const match = href && href.match(/BV[\\\\w]+/);
                    if (match && !bvids.includes(match[0])) bvids.push(match[0]);
                });
                return JSON.stringify(bvids.slice(0, 20));
            })()
        """)
        if bvids_js:
            return json.loads(bvids_js)
    except:
        pass
    return []

def main():
    queries = parse_queries()
    ensure_output_dir()

    all_data = []
    total_comments = 0

    print(f"=== Bilibili Comment Scraper ===")
    print(f"Queries: {len(queries)}")
    print(f"Max videos/query: {MAX_VIDEOS_PER_QUERY}")
    print(f"Max comments/video: {MAX_COMMENTS_PER_VIDEO}")

    # Also scrape popular page
    print(f"\n--- Scraping popular page ---")
    popular_bvids = scrape_bilibili_popular()
    print(f"Found {len(popular_bvids)} popular videos")

    for bvid in popular_bvids[:10]:
        print(f"  Scraping popular video: {bvid}")
        comments = scrape_video_comments(bvid)
        if comments:
            all_data.append({"bvid": bvid, "source": "popular", "comments": comments})
            total_comments += len(comments)
            print(f"    Got {len(comments)} comments")

    # Search and scrape per query
    for qi, query in enumerate(queries):
        print(f"\n--- Query {qi+1}/{len(queries)}: {query} ---")

        bvids = search_bilibili(query)
        print(f"  Found {len(bvids)} videos: {bvids}")

        for vi, bvid in enumerate(bvids):
            print(f"  [{vi+1}/{len(bvids)}] Scraping: {bvid}")
            comments = scrape_video_comments(bvid)
            if comments:
                all_data.append({"bvid": bvid, "source": query, "comments": comments})
                total_comments += len(comments)
                print(f"    Got {len(comments)} comments (total: {total_comments})")

    # Save batch
    batch_file = os.path.join(OUTPUT_DIR, f"batch_{int(time.time())}.json")
    with open(batch_file, 'w', encoding='utf8') as f:
        json.dump({"queries": queries, "videos": all_data, "total_comments": total_comments}, f, ensure_ascii=False, indent=2)

    print(f"\n=== Done ===")
    print(f"Total videos: {len(all_data)}")
    print(f"Total comments: {total_comments}")
    print(f"Saved to: {batch_file}")

main()
