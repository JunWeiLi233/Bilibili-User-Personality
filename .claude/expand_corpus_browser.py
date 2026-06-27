"""Expand local corpus with diverse Bilibili comments via browser-harness.

Scrapes comments from top videos in diverse categories (gaming, tech,
entertainment, lifestyle) to diversify the corpus beyond history/education.
Also checks scraped comments against zero-evidence terms for matches.
"""

import json
import time
import sys
import os
import re
import urllib.parse

ROOT = r"D:\Bilibili_User_Personality"
OUTPUT_PATH = os.path.join(ROOT, ".claude", "corpus_expansion_results.json")
TERMS_PATH = os.path.join(ROOT, ".claude", "zero_evidence_terms.json")
ENV_PATH = os.path.join(ROOT, "set-deepseek-env.ps1")

# Diverse search queries for different content categories
CATEGORY_QUERIES = [
    # Gaming
    "游戏实况", "独立游戏推荐", "电竞比赛",
    # Tech
    "手机评测", "电脑装机", "编程教程",
    # Entertainment
    "搞笑合集", "综艺节目", "日常vlog",
    # Lifestyle
    "美食制作", "旅游vlog", "健身教程",
    # Anime
    "动漫推荐", "新番点评",
    # Music
    "音乐推荐", "翻唱",
    # Knowledge
    "科普", "历史讲解",
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


def search_bvids(query, count=3):
    """Search for videos and return their BVIDs."""
    url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + urllib.parse.quote(query) + "&order=click&page=1"
    raw = js(
        '(async function() {'
        '  try {'
        '    var resp = await fetch(' + json.dumps(url) + ', {"credentials": "include"});'
        '    var data = await resp.json();'
        '    if (data && data.code === 0 && data.data && data.data.result) {'
        '      return data.data.result.slice(0, ' + str(count) + ').map(function(r) {'
        '        return r.bvid || "";'
        '      });'
        '    }'
        '    return [];'
        '  } catch(e) { return []; }'
        '})()'
    )
    return [b for b in (raw if isinstance(raw, list) else []) if b]


def fetch_comments(bvid, pages=2):
    """Fetch all comments for a video."""
    # First get aid
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
            '          like: r.like || 0,'
            '          ctime: r.ctime || 0,'
            '          rpid: r.rpid || "",'
            '          uname: (r.member && r.member.uname) || ""'
            '        };'
            '      });'
            '    }'
            '    return [];'
            '  } catch(e) { return []; }'
            '})()'
        )
        if isinstance(raw, list):
            all_comments.extend(raw)
        time.sleep(0.5)
    return all_comments


def main():
    print("=" * 60)
    print("Corpus Expansion via Browser Pipeline")
    print("=" * 60)

    if not inject_cookies():
        print("WARNING: Could not inject cookies")

    # Load zero-evidence terms for checking
    targets = []
    if os.path.exists(TERMS_PATH):
        with open(TERMS_PATH, "r", encoding="utf-8") as f:
            targets = json.load(f)
    target_terms = {t["term"] for t in targets}
    print("Loaded " + str(len(target_terms)) + " target terms for matching")

    total_comments = 0
    total_matches = 0
    all_matches = {}
    all_comments_data = []

    for qi, query in enumerate(CATEGORY_QUERIES):
        print("\n[" + str(qi+1) + "/" + str(len(CATEGORY_QUERIES)) + "] Category: " + query)
        bvids = search_bvids(query, count=3)
        print("  Found " + str(len(bvids)) + " videos")

        for vi, bvid in enumerate(bvids):
            sys.stdout.write("  Video " + str(vi+1) + ": " + bvid + "... ")
            sys.stdout.flush()
            comments = fetch_comments(bvid, pages=2)
            real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
            total_comments += len(real)
            print(str(len(real)) + " comments")

            # Check against zero-evidence terms
            for c in real:
                msg = c.get("message", "")
                for term in target_terms:
                    if term in msg:
                        if term not in all_matches:
                            all_matches[term] = []
                        all_matches[term].append({
                            "message": msg[:200],
                            "bvid": bvid,
                            "uname": c.get("uname", ""),
                            "like": c.get("like", 0),
                        })
                        total_matches += 1

            # Add to corpus
            all_comments_data.append({
                "bvid": bvid,
                "query": query,
                "commentCount": len(real),
                "comments": real,
            })

            time.sleep(1)

    # Save results
    output = {
        "harvestedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "type": "corpus_expansion",
        "queriesRun": len(CATEGORY_QUERIES),
        "totalCommentsScraped": total_comments,
        "totalTermMatches": total_matches,
        "termsFound": len(all_matches),
        "matches": {k: v[:5] for k, v in all_matches.items()},
        "comments": all_comments_data,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("Corpus Expansion Results:")
    print("  Comments scraped: " + str(total_comments))
    print("  Term matches found: " + str(total_matches))
    print("  Terms found: " + str(len(all_matches)))
    if all_matches:
        for term, matches in sorted(all_matches.items()):
            print("    " + term + ": " + str(len(matches)) + " matches")
    print("  Output: " + OUTPUT_PATH)


main()
