"""Single Tieba search + extract step using raw CDP for reliable extraction."""
import json, re, time, os, urllib.parse

OUT_DIR = ".claude/tieba_scrape"
ACTIONS_FILE = "server/data/keywordCoverageActions.json"
PROGRESS_FILE = "server/data/tieba-scrape-progress.json"
os.makedirs(OUT_DIR, exist_ok=True)

# Load state
try:
    with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
        progress = json.load(f)
except:
    progress = {"completed": [], "blocked": [], "lastTerm": None, "totalResults": 0}

with open(ACTIONS_FILE, "r", encoding="utf-8") as f:
    actions = json.load(f)

completed = set(progress.get("completed", []))
blocked = set(progress.get("blocked", []))

pending = [a for a in actions if a["term"] not in completed and a["term"] not in blocked]

if not pending:
    print("ALL_DONE: no pending actions")
    result = {"all_done": True}
    with open(os.path.join(OUT_DIR, "_final.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    exit()

action = pending[0]
term = action["term"]
query = action.get("query", term)
print("Processing: " + term)
print("Query: " + query)

MAX_THREADS = 3  # threads to visit

all_comments = []
all_threads = []

try:
    # Search
    encoded = urllib.parse.quote(query)
    search_url = "https://tieba.baidu.com/f/search/res?qw=" + encoded + "&sm=2"
    print("Search URL: " + search_url[:120])
    smart_open(search_url)
    wait_for_load()
    wait(3)

    # Verify we're on the right page
    info = page_info()
    print("Page: " + info.get("title", "")[:80])

    # Check for safety verification using CDP
    body_result = cdp("Runtime.evaluate", {
        "expression": "document.body ? document.body.innerText.substring(0, 500) : 'no body'"
    })
    body_val = ""
    if body_result and isinstance(body_result, dict):
        body_val = body_result.get("result", {}).get("value", "") or ""

    if "安全验证" in body_val or "请完成" in body_val:
        print("SAFETY_VERIFICATION blocked")
        blocked.add(term)
        progress["blocked"] = list(blocked)
        progress["lastTerm"] = term
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(progress, f, ensure_ascii=False, indent=2)
        exit()

    # Extract thread links using CDP
    links_raw = cdp("Runtime.evaluate", {
        "expression": """JSON.stringify(Array.from(document.querySelectorAll('a')).filter(function(a){return a.href && a.href.indexOf('/p/')>=0}).map(function(a){var id='';var m=a.href.match(/\\/p\\/(\\d+)/);if(m)id=m[1];return{href:a.href,id:id,text:(a.innerText||a.textContent||'').trim().substring(0,200)}}).filter(function(x){return x.text.length>0}).slice(0,25))"""
    })

    threads = []
    if links_raw and isinstance(links_raw, dict):
        links_val = links_raw.get("result", {}).get("value", "")
        if links_val:
            threads = json.loads(links_val)

    print("Thread links: " + str(len(threads)))

    # Deduplicate by thread ID
    seen = set()
    unique = []
    for t in threads:
        tid = t.get("id", "")
        if tid and tid not in seen:
            seen.add(tid)
            unique.append(t)
    print("Unique threads: " + str(len(unique)))

    # Also extract body text from search results (already contains comment snippets)
    full_body_result = cdp("Runtime.evaluate", {
        "expression": "document.body ? document.body.innerText : ''"
    })
    full_body = ""
    if full_body_result and isinstance(full_body_result, dict):
        full_body = full_body_result.get("result", {}).get("value", "") or ""

    # Match term in search result snippets
    term_lower = term.lower()
    body_lower = full_body.lower()
    found_in_search = False
    if term_lower in body_lower:
        found_in_search = True
        print("Term found in search result page body")
        # Extract snippets around matches
        idx = body_lower.find(term_lower)
        while idx >= 0:
            start = max(0, idx - 100)
            end = min(len(full_body), idx + 200)
            snippet = full_body[start:end].strip()
            all_comments.append({
                "source": "search_snippet",
                "text": snippet[:500]
            })
            idx = body_lower.find(term_lower, idx + 1)
            if len(all_comments) >= 10:
                break
        print("Search snippets: " + str(len(all_comments)))

    # Skip thread visits if term not found in search body at all
    # (avoids wasting time on threads that won't match)
    visit_count = MAX_THREADS if (found_in_search or len(unique) <= 5) else 1
    # Always visit at least 1 thread to verify
    if not found_in_search:
        print("Term not in search snippets - visiting 1 thread to verify")

    for i, t in enumerate(unique[:visit_count]):
        if i > 0:
            wait(3)

        thread_url = t["href"]
        tid = t.get("id", "")
        print("  Thread " + str(i+1) + ": /p/" + tid)

        try:
            smart_open(thread_url)
            wait_for_load()
            wait(2)

            # Extract post content using CDP with correct selectors
            posts_raw = cdp("Runtime.evaluate", {
                "expression": """JSON.stringify(Array.from(document.querySelectorAll('.pb-content-wrap, .pb-content-item, .comment-content, .pc-pb-reply-list')).map(function(el){return(el.innerText||el.textContent||'').trim()}).filter(function(txt){return txt.length>5}).slice(0,40))"""
            })

            posts = []
            if posts_raw and isinstance(posts_raw, dict):
                posts_val = posts_raw.get("result", {}).get("value", "")
                if posts_val:
                    posts = json.loads(posts_val)

            matching = [p for p in posts if term_lower in p.lower()]
            print("    Posts: " + str(len(posts)) + ", matches: " + str(len(matching)))
            for m in matching[:10]:
                all_comments.append({
                    "source": "thread_" + tid,
                    "text": m[:500]
                })
        except Exception as e:
            print("    Error: " + str(e))

    print("Total comments matched: " + str(len(all_comments)))
    completed.add(term)

    # Save per-term results
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in term)
    result = {
        "term": term,
        "query": query,
        "threads": [{"id": t.get("id",""), "href": t.get("href",""), "text": t.get("text","")[:200]} for t in unique[:10]],
        "comments": all_comments,
    }
    with open(os.path.join(OUT_DIR, safe_name + ".json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

except Exception as e:
    import traceback
    print("ERROR: " + str(e))
    traceback.print_exc()
    blocked.add(term)

# Update progress
progress["completed"] = list(completed)
progress["blocked"] = list(blocked)
progress["lastTerm"] = term
progress["totalResults"] = progress.get("totalResults", 0) + len(all_comments)
with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
    json.dump(progress, f, ensure_ascii=False, indent=2)

remaining = len(actions) - len(completed) - len(blocked)
print("Done: " + term)
print("Completed: " + str(len(completed)) + ", Blocked: " + str(len(blocked)) + ", Remaining: " + str(remaining))
