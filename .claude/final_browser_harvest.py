"""Final browser harvest: Corpus expansion + Comment probing.

Runs in a single browser session:
1. Scrape comments from 8 diverse Bilibili videos (gaming, tech, entertainment, lifestyle)
2. Probe comments for hardest remaining terms

Uses the same working API call pattern as extract_title_evidence.py.
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
OUTPUT_PATH = os.path.join(ROOT, ".claude", "final_harvest_results.json")

# Diverse search queries for corpus expansion
# Search via the working API pattern to find real BVIDs dynamically
DIVERSE_QUERIES = [
    "我的世界",     # Gaming - Minecraft (huge comment volume)
    "搞笑盘点",     # Entertainment
    "手机推荐",     # Tech
    "日常vlog",     # Lifestyle
    "动漫杂谈",     # Anime
    "音乐合集",     # Music
    "电影解说",     # Movies
    "科普知识",     # Knowledge
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


def search_bvids(query, count=2):
    """Search Bilibili API for BVIDs using the working JS pattern."""
    js_code = (
        '(async function() {'
        '  try {'
        '    var term = ' + json.dumps(query) + ';'
        '    var url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(term) + "&order=click&page=1";'
        '    var resp = await fetch(url, {"credentials": "include"});'
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
    raw = js(js_code)
    return raw if isinstance(raw, list) else []


def fetch_comments_for_bvid(bvid, pages=2):
    """Fetch comments for a video."""
    smart_open("https://www.bilibili.com/video/" + bvid + "/")
    wait_for_load()
    wait(1.5)

    state = js("(function() { try { var s = window.__INITIAL_STATE__; return s ? {aid: s.aid, title: (s.videoData||{}).title||''} : {}; } catch(e) { return {}; } })()")
    aid = (state or {}).get("aid")
    title = (state or {}).get("title", "")

    if not aid:
        return [], title

    all_comments = []
    for pn in range(1, pages + 1):
        js_code = (
            '(async function() {'
            '  try {'
            '    var resp = await fetch("https://api.bilibili.com/x/v2/reply?type=1&oid=' + str(aid) + '&pn=' + str(pn) + '&ps=20", {"credentials": "include"});'
            '    var data = await resp.json();'
            '    if (data && data.code === 0 && data.data && data.data.replies) {'
            '      return data.data.replies.map(function(r) {'
            '        return {'
            '          message: (r.content && r.content.message) || "",'
            '          like: r.like || 0,'
            '          uname: (r.member && r.member.uname) || ""'
            '        };'
            '      });'
            '    }'
            '    return [];'
            '  } catch(e) { return []; }'
            '})()'
        )
        raw = js(js_code)
        if isinstance(raw, list):
            all_comments.extend(raw)
        time.sleep(0.3)
    return all_comments, title


def search_comments_for_term(bvid, term, pages=4):
    """Fetch comments and check for term matches."""
    comments, title = fetch_comments_for_bvid(bvid, pages)
    real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
    matching = [c for c in real if term in (c.get("message") or "")]
    return {
        "bvid": bvid,
        "title": title,
        "totalComments": len(real),
        "matchingComments": len(matching),
        "samples": [m.get("message", "")[:200] for m in matching[:5]],
    }


def main():
    print("=" * 60)
    print("Final Browser Harvest: Corpus Expansion + Comment Probing")
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
        "corpusExpansion": {"commentsScraped": 0, "termMatchesFound": 0, "matchesByTerm": {}, "videos": []},
        "commentProbe": [],
    }

    # ============================================================
    # Phase 1: Corpus expansion — scrape diverse videos
    # ============================================================
    print("\n" + "=" * 60)
    print("PHASE 1: Corpus Expansion (" + str(len(DIVERSE_QUERIES)) + " diverse queries)")
    print("=" * 60)

    total_new_comments = 0
    all_term_matches = {}
    all_videos_found = []

    for qi, query in enumerate(DIVERSE_QUERIES):
        print("\n[" + str(qi+1) + "/" + str(len(DIVERSE_QUERIES)) + "] " + query)
        videos = search_bvids(query, count=2)
        print("  Found " + str(len(videos)) + " videos")

        for vi, v in enumerate(videos):
            bvid = v.get("bvid", "")
            title = v.get("title", "")
            sys.stdout.write("  [" + str(vi+1) + "] " + bvid + "... ")
            sys.stdout.flush()

            comments, _ = fetch_comments_for_bvid(bvid, pages=2)
            real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
            total_new_comments += len(real)
            print(str(len(real)) + " comments | " + title[:50])

            all_videos_found.append({
                "bvid": bvid, "title": title, "query": query, "commentCount": len(real),
            })

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

    all_results["corpusExpansion"]["videos"] = all_videos_found
    all_results["corpusExpansion"]["commentsScraped"] = total_new_comments
    all_results["corpusExpansion"]["termMatchesFound"] = sum(len(v) for v in all_term_matches.values())
    all_results["corpusExpansion"]["matchesByTerm"] = {k: v[:5] for k, v in sorted(all_term_matches.items(), key=lambda x: -len(x[1]))}

    print("\nPhase 1 done: " + str(total_new_comments) + " new comments, " + str(len(all_term_matches)) + " terms matched")
    for term, matches in sorted(all_term_matches.items(), key=lambda x: -len(x[1])):
        print("  " + term + ": " + str(len(matches)) + " matches")

    # ============================================================
    # Phase 2: Comment probing for hardest terms
    # ============================================================
    print("\n" + "=" * 60)
    print("PHASE 2: Comment Probing (terms without corpus matches)")
    print("=" * 60)

    # Terms that still need evidence
    terms_with_matches = set(all_term_matches.keys())
    hardest_terms = [t for t in targets if t["term"] not in terms_with_matches]
    print("  Terms still needing evidence: " + str(len(hardest_terms)))

    # Sort by length (shorter terms more likely to appear in comments)
    hardest_terms.sort(key=lambda t: len(t["term"]))

    comment_probe_results = []
    for i, t in enumerate(hardest_terms[:30]):  # Probe 30 hardest
        term = t["term"]
        family = t.get("family", "unknown")
        sys.stdout.write("\n[" + str(i+1) + "/" + str(min(len(hardest_terms), 30)) + "] [" + family + "] " + term + " ")

        # The search API approach from extract_title_evidence.py works reliably
        # Search Bilibili API for the term
        js_code = (
            '(async function() {'
            '  try {'
            '    var term = ' + json.dumps(term) + ';'
            '    var url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(term) + "&order=totalrank&page=1";'
            '    var resp = await fetch(url, {"credentials": "include"});'
            '    var data = await resp.json();'
            '    if (data && data.code === 0 && data.data && data.data.result) {'
            '      return data.data.result.slice(0, 3).map(function(r) {'
            '        return {bvid: r.bvid || "", title: (r.title || "").replace(/<[^>]*>/g, "")};'
            '      });'
            '    }'
            '    return [];'
            '  } catch(e) { return []; }'
            '})()'
        )
        raw = js(js_code)
        videos = raw if isinstance(raw, list) else []

        if not videos:
            print("no videos found")
            continue

        print(str(len(videos)) + " videos: ", end="")
        term_matches = []

        for vi, v in enumerate(videos):
            bvid = v.get("bvid", "")
            sys.stdout.write(bvid[:12] + "... ")
            sys.stdout.flush()

            result = search_comments_for_term(bvid, term, pages=3)
            if result["matchingComments"] > 0:
                term_matches.append(result)
                sys.stdout.write("(" + str(result["matchingComments"]) + " matches) ")

        if term_matches:
            comment_probe_results.append({
                "term": term,
                "family": family,
                "videoMatches": term_matches,
            })

        time.sleep(0.3)

    all_results["commentProbe"] = comment_probe_results

    # Summary
    new_terms_from_probe = {e["term"] for e in comment_probe_results}
    print("\n\nPhase 2 done: " + str(len(comment_probe_results)) + " terms with comment matches")
    for e in comment_probe_results:
        total_m = sum(m["matchingComments"] for m in e["videoMatches"])
        print("  " + e["term"] + ": " + str(total_m) + " total matches across " + str(len(e["videoMatches"])) + " videos")

    # Save
    all_results["harvestedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    all_results["summary"] = {
        "newCommentsScraped": total_new_comments,
        "corpusTermMatches": len(all_term_matches),
        "commentProbeTermsFound": len(comment_probe_results),
        "totalUniqueTermsFound": len(set(all_term_matches.keys()) | new_terms_from_probe),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("FINAL HARVEST COMPLETE")
    print("  New comments scraped: " + str(total_new_comments))
    print("  Corpus term matches: " + str(len(all_term_matches)))
    print("  Comment probe matches: " + str(len(comment_probe_results)))
    print("  Unique terms found: " + str(all_results["summary"]["totalUniqueTermsFound"]))
    print("  Output: " + OUTPUT_PATH)


main()
