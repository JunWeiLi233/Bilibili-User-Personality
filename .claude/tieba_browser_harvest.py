"""
Tieba keyword harvest via browser-harness (real Chrome, avoids anti-scraper).
Scrapes search results + thread comments for terms from keywordCoverageActions.json.
"""
import json
import time
import re
import os
import sys

ACTIONS_FILE = "server/data/keywordCoverageActions.json"
PROGRESS_FILE = "server/data/tieba-scrape-progress.json"
CORPUS_FILE = "server/data/tiebaKeywordCorpus.json"
DICT_FILE = "server/data/deepseekKeywordDictionary.json"
DICT_EVIDENCE_DIR = "server/data/deepseekKeywordDictionary.evidence"

# Rate limits
MIN_DELAY = 5  # seconds
JITTER = 3
BLOCK_COOLDOWN = 120
BATCH_SIZE = 3  # terms per invocation

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def search_tieba(query, page=0):
    """Search Tieba and return thread links + previews."""
    import urllib.parse
    encoded = urllib.parse.quote(query)
    url = f"https://tieba.baidu.com/f/search/res?qw={encoded}&sm=2&pn={page * 50}"
    smart_open(url)
    wait_for_load()
    wait(2)

    # Extract thread links
    raw = js("""
    JSON.stringify(
      Array.from(document.querySelectorAll('.s_post, .search_post, a.bluelink, .p_title a, a[href*="/p/"]'))
        .map(el => ({
          tag: el.tagName,
          href: el.href || '',
          text: (el.innerText || el.textContent || '').substring(0, 200)
        }))
        .filter(x => x.href && x.href.includes('/p/'))
        .slice(0, 20)
    )
    """)
    threads = json.loads(raw) if raw else []

    # Also try getting all thread-like elements
    if not threads:
        # Fallback: get all links from page
        raw2 = js("""
        JSON.stringify(
          Array.from(document.querySelectorAll('a'))
            .filter(a => a.href && a.href.includes('/p/'))
            .map(a => ({
              href: a.href,
              text: (a.innerText || a.textContent || '').substring(0, 200)
            }))
            .filter(x => x.text.trim())
            .slice(0, 20)
        )
        """)
        threads = json.loads(raw2) if raw2 else []

    return threads

def get_thread_comments(thread_url, keyword):
    """Extract comments from a Tieba thread page."""
    smart_open(thread_url)
    wait_for_load()
    wait(2)

    # Get all post content
    raw = js("""
    JSON.stringify(
      Array.from(document.querySelectorAll('.d_post_content, .p_content, .lzl_content, .j_d_post_content'))
        .map(el => ({
          text: (el.innerText || el.textContent || '').trim()
        }))
        .filter(x => x.text.length > 0)
        .slice(0, 50)
    )
    """)

    posts = json.loads(raw) if raw else []
    return [p for p in posts if keyword in p.get("text", "")]

def search_and_extract(query_term, keyword_term, forum_pages=2):
    """Search for a query and extract matching comments."""
    all_threads = []
    all_comments = []

    for page in range(forum_pages):
        if page > 0:
            time.sleep(MIN_DELAY + (JITTER * (page % 3)))
        try:
            threads = search_tieba(query_term, page)
            all_threads.extend(threads)
            if not threads:
                break
        except Exception as e:
            print(f"  Search page {page} error: {e}")
            break

    # Deduplicate threads by href
    seen = set()
    unique_threads = []
    for t in all_threads:
        href = t.get("href", "")
        if href and href not in seen:
            seen.add(href)
            unique_threads.append(t)

    print(f"  Found {len(unique_threads)} unique threads")

    # Scrape top threads for matching comments
    for i, thread in enumerate(unique_threads[:5]):
        if i > 0:
            time.sleep(MIN_DELAY + JITTER)
        try:
            comments = get_thread_comments(thread["href"], keyword_term)
            if comments:
                print(f"  Thread {i+1}: {len(comments)} matching comments")
                all_comments.extend(comments)
        except Exception as e:
            print(f"  Thread {i+1} error: {e}")

    return unique_threads, all_comments

def main():
    actions = load_json(ACTIONS_FILE)
    print(f"Loaded {len(actions)} action items")

    # Load or init progress
    try:
        progress = load_json(PROGRESS_FILE)
    except:
        progress = {"completed": [], "blocked": [], "lastTerm": None, "totalResults": 0}

    completed = set(progress.get("completed", []))
    blocked = set(progress.get("blocked", []))

    # Find next batch
    pending = [a for a in actions if a["term"] not in completed and a["term"] not in blocked]

    if not pending:
        print("All terms processed!")
        return

    batch = pending[:BATCH_SIZE]
    print(f"Processing {len(batch)} terms (batch). {len(pending) - len(batch)} remaining after this.")

    all_threads = []
    all_comments = []

    for i, action in enumerate(batch):
        term = action["term"]
        query = action.get("query") or action.get("nextQuery") or term
        keyword = term

        print(f"\n[{i+1}/{len(batch)}] {term} (family: {action.get('family','?')})")
        print(f"  Query: {query}")

        try:
            threads, comments = search_and_extract(query, keyword, forum_pages=2)
            all_threads.extend(threads)
            all_comments.extend(comments)

            if comments:
                print(f"  -> {len(comments)} matching comments found")
                completed.add(term)
            else:
                print(f"  -> No matching comments")
                completed.add(term)  # Mark attempted even if no results

        except Exception as e:
            print(f"  ERROR: {e}")
            blocked.add(term)

        # Save progress after each term
        progress["completed"] = list(completed)
        progress["blocked"] = list(blocked)
        progress["lastTerm"] = term
        progress["totalResults"] = progress.get("totalResults", 0) + len(all_comments)
        save_json(PROGRESS_FILE, progress)

        # Save results
        if all_comments:
            result_file = f".claude/tieba_harvest_results.json"
            results = {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "term": term,
                "threads": [{"href": t["href"], "text": t["text"]} for t in all_threads],
                "comments": [{"text": c["text"][:300]} for c in all_comments]
            }
            save_json(result_file, results)

        # Delay between terms
        if i < len(batch) - 1:
            delay = MIN_DELAY + JITTER
            print(f"  Waiting {delay}s...")
            time.sleep(delay)

    print(f"\n=== Batch complete ===")
    print(f"Processed: {len(batch)} terms")
    print(f"Threads found: {len(all_threads)}")
    print(f"Comments matched: {len(all_comments)}")
    print(f"Total completed: {len(completed)}")
    print(f"Total blocked: {len(blocked)}")
    print(f"Remaining: {len(actions) - len(completed) - len(blocked)}")

if __name__ == "__main__":
    main()
