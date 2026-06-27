"""Combined browser harvest: corpus expansion + title evidence + comment probing.

Runs in a single browser session:
1. Scrape comments from 6 diverse categories (gaming, tech, entertainment, lifestyle, anime, knowledge)
2. Extract video titles for remaining zero-evidence terms via search API
3. Probe comments for the hardest remaining terms
"""

import json
import time
import sys
import os
import re
import urllib.parse

ROOT = r"D:\Bilibili_User_Personality"
TERMS_PATH = os.path.join(ROOT, ".claude", "zero_evidence_terms.json")
ENV_PATH = os.path.join(ROOT, "set-deepseek-env.ps1")
OUTPUT_PATH = os.path.join(ROOT, ".claude", "combined_harvest_results.json")

# Phase 1: Diverse categories for corpus expansion
DIVERSE_QUERIES = [
    "游戏实况",       # Gaming
    "手机评测",       # Tech
    "搞笑合集",       # Entertainment
    "美食制作",       # Lifestyle
    "动漫推荐",       # Anime
    "编程教程",       # Knowledge/Tech
]


def inject_cookies():
    if not os.path.exists(ENV_PATH):
        return False
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    m = re.search(r"\$env:BILIBILI_COOKIE\s*=\s*\"(.+?)\"", content)
    if not m:
        return False
    cookie_str = m.group(1)
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            key, val = part.split("=", 1)
            cdp("Network.setCookie", {
                "name": key.strip(), "value": val.strip(), "domain": ".bilibili.com",
                "path": "/", "secure": True, "httpOnly": key == "SESSDATA",
            })
    return True


def search_api(query, count=2):
    """Search Bilibili API for videos."""
    url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + urllib.parse.quote(query) + "&order=click&page=1"
    raw = js(
        '(async function() {'
        '  try {'
        '    var resp = await fetch(' + json.dumps(url) + ', {"credentials": "include"});'
        '    var data = await resp.json();'
        '    if (data && data.code === 0 && data.data && data.data.result) {'
        '      return data.data.result.slice(0, ' + str(count) + ').map(function(r) {'
        '        return {bvid: r.bvid || "", aid: r.aid || 0, title: (r.title || "").replace(/<[^>]*>/g, "")};'
        '      });'
        '    }'
        '    return [];'
        '  } catch(e) { return []; }'
        '})()'
    )
    return raw if isinstance(raw, list) else []


def search_titles_for_term(term, count=10):
    """Search API for a specific term and extract titles."""
    results = search_api(term, count)
    matches = []
    for r in results:
        title = r.get("title", "")
        if term.lower() in title.lower():
            matches.append({
                "bvid": r.get("bvid", ""),
                "title": title,
                "url": "https://www.bilibili.com/video/" + r.get("bvid", "") + "/",
            })
    return matches


def fetch_comments_for_bvid(bvid, pages=2):
    """Fetch comments for a video via browser API."""
    smart_open("https://www.bilibili.com/video/" + bvid + "/")
    wait_for_load()
    wait(1.5)

    state = js("(function() { try { var s = window.__INITIAL_STATE__; return s ? {aid: s.aid} : {}; } catch(e) { return {}; } })()")
    aid = (state or {}).get("aid")
    if not aid:
        return []

    all_comments = []
    for pn in range(1, pages + 1):
        raw = js(
            '(async function() {'
            '  try {'
            '    var resp = await fetch("https://api.bilibili.com/x/v2/reply?type=1&oid=' + str(aid) + '&pn=' + str(pn) + '&ps=20", {"credentials": "include"});'
            '    var data = await resp.json();'
            '    if (data && data.code === 0 && data.data && data.data.replies) {'
            '      return data.data.replies.map(function(r) {'
            '        return {'
            '          message: (r.content && r.content.message) || "",'
            '          like: r.like || 0, uname: (r.member && r.member.uname) || ""'
            '        };'
            '      });'
            '    }'
            '    return [];'
            '  } catch(e) { return []; }'
            '})()'
        )
        if isinstance(raw, list):
            all_comments.extend(raw)
        time.sleep(0.3)
    return all_comments


def main():
    print("=" * 60)
    print("Combined Browser Harvest")
    print("=" * 60)

    if not inject_cookies():
        print("WARNING: Could not inject cookies")

    # Load target terms
    targets = []
    if os.path.exists(TERMS_PATH):
        with open(TERMS_PATH, "r", encoding="utf-8") as f:
            targets = json.load(f)
    target_term_set = {t["term"] for t in targets}
    print("Loaded " + str(len(targets)) + " target terms")

    all_results = {
        "corpusExpansion": {"commentsScraped": 0, "termMatchesFound": 0, "matchesByTerm": {}},
        "titleEvidence": [],
        "commentProbe": [],
    }

    # ============================================================
    # Phase 1: Corpus expansion — scrape diverse categories
    # ============================================================
    print("\n" + "=" * 60)
    print("PHASE 1: Corpus Expansion (diverse categories)")
    print("=" * 60)

    total_new_comments = 0
    all_term_matches = {}

    for qi, query in enumerate(DIVERSE_QUERIES):
        print("\n[" + str(qi+1) + "/" + str(len(DIVERSE_QUERIES)) + "] " + query)
        videos = search_api(query, count=2)
        print("  Found " + str(len(videos)) + " videos")

        for vi, v in enumerate(videos):
            bvid = v.get("bvid", "")
            sys.stdout.write("  [" + str(vi+1) + "] " + bvid + "... ")
            sys.stdout.flush()

            comments = fetch_comments_for_bvid(bvid, pages=2)
            real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
            total_new_comments += len(real)
            print(str(len(real)) + " comments")

            # Check against target terms
            for c in real:
                msg = c.get("message", "")
                for term in target_term_set:
                    if term in msg:
                        if term not in all_term_matches:
                            all_term_matches[term] = []
                        all_term_matches[term].append({
                            "message": msg[:200],
                            "bvid": bvid,
                            "uname": c.get("uname", ""),
                            "like": c.get("like", 0),
                        })

            time.sleep(0.5)

    all_results["corpusExpansion"]["commentsScraped"] = total_new_comments
    all_results["corpusExpansion"]["termMatchesFound"] = sum(len(v) for v in all_term_matches.values())
    all_results["corpusExpansion"]["matchesByTerm"] = {k: v[:5] for k, v in all_term_matches.items()}

    print("\n  Phase 1 done: " + str(total_new_comments) + " new comments, " + str(len(all_term_matches)) + " terms matched")

    # ============================================================
    # Phase 2: Title evidence for ALL target terms
    # ============================================================
    print("\n" + "=" * 60)
    print("PHASE 2: Title Evidence (search API)")
    print("=" * 60)

    title_evidence = []
    for i, t in enumerate(targets):
        term = t["term"]
        family = t.get("family", "unknown")
        sys.stdout.write("\r  [" + str(i+1) + "/" + str(len(targets)) + "] " + term[:30].ljust(32))
        sys.stdout.flush()

        try:
            matches = search_titles_for_term(term, count=15)
            if matches:
                title_evidence.append({
                    "term": term,
                    "family": family,
                    "titleMatches": matches,
                })
        except Exception:
            pass
        time.sleep(0.2)

    print("\r  Phase 2 done: " + str(len(title_evidence)) + " terms with titles".ljust(60))

    # ============================================================
    # Phase 3: Comment probing for hardest terms (those without title matches)
    # ============================================================
    print("\n" + "=" * 60)
    print("PHASE 3: Comment Probing (hardest terms)")
    print("=" * 60)

    # Focus on terms that had NO title matches — these are the hardest
    terms_with_titles = {e["term"] for e in title_evidence}
    hardest_terms = [t for t in targets if t["term"] not in terms_with_titles and t["term"] not in all_term_matches]
    print("  Hardest terms (no title/corpus match): " + str(len(hardest_terms)))

    comment_probe_results = []
    for i, t in enumerate(hardest_terms[:20]):  # Limit to 20 hardest
        term = t["term"]
        family = t.get("family", "unknown")
        print("\n  [" + str(i+1) + "/" + str(min(len(hardest_terms), 20)) + "] [" + family + "] " + term)

        videos = search_api(term, count=3)
        term_matches = []

        for vi, v in enumerate(videos):
            bvid = v.get("bvid", "")
            sys.stdout.write("    [" + str(vi+1) + "] " + bvid + "... ")
            sys.stdout.flush()

            comments = fetch_comments_for_bvid(bvid, pages=4)  # More pages for harder terms
            real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
            matching = [c for c in real if term in (c.get("message") or "")]

            print(str(len(real)) + " comments, " + str(len(matching)) + " matching")

            if matching:
                term_matches.append({
                    "bvid": bvid,
                    "url": "https://www.bilibili.com/video/" + bvid + "/",
                    "totalComments": len(real),
                    "matching": len(matching),
                    "samples": [m.get("message", "")[:200] for m in matching[:5]],
                })

        if term_matches:
            comment_probe_results.append({
                "term": term,
                "family": family,
                "source": "Bilibili browser comment probe",
                "videoMatches": term_matches,
            })

        time.sleep(0.5)

    print("\n  Phase 3 done: " + str(len(comment_probe_results)) + " terms with comment matches")

    all_results["titleEvidence"] = title_evidence
    all_results["commentProbe"] = comment_probe_results

    # Save
    all_results["harvestedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    all_results["summary"] = {
        "newCommentsScraped": total_new_comments,
        "corpusTermMatches": len(all_term_matches),
        "titleEvidenceTerms": len(title_evidence),
        "commentProbeTerms": len(comment_probe_results),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("COMBINED HARVEST COMPLETE")
    print("  New comments: " + str(total_new_comments))
    print("  Corpus term matches: " + str(len(all_term_matches)))
    print("  Title evidence: " + str(len(title_evidence)) + " terms")
    print("  Comment probes: " + str(len(comment_probe_results)) + " terms")
    print("  Output: " + OUTPUT_PATH)


main()
