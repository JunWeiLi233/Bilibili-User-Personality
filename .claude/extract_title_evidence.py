"""Extract video titles as evidence for zero-evidence dictionary terms.

Uses Bilibili search API (from browser context with real cookies) to find
video titles containing target terms. Titles are valid evidence because
they show the terms are used in real Bilibili discourse.

Much faster than full comment harvest (~2s/term vs ~60s/term).
"""

import json
import time
import sys
import os
import re
import urllib.parse

OUTPUT_PATH = r"D:\Bilibili_User_Personality\.claude\title_evidence_results.json"
TERMS_PATH = r"D:\Bilibili_User_Personality\.claude\zero_evidence_terms.json"
ENV_PATH = r"D:\Bilibili_User_Personality\set-deepseek-env.ps1"


def inject_cookies():
    """Read BILIBILI_COOKIE and inject into browser."""
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


def search_titles(term, max_results=20):
    """Search Bilibili API and extract titles containing the term."""
    # Use the Bilibili search API from browser context
    # Build JS snippet with proper escaping
    js_code = (
        '(async function() {'
        '  try {'
        '    var url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" '
        '      + encodeURIComponent(' + json.dumps(term) + ') + "&order=totalrank&page=1";'
        '    var resp = await fetch(url, {"credentials": "include"});'
        '    var data = await resp.json();'
        '    if (data && data.code === 0 && data.data && data.data.result) {'
        '      return data.data.result.map(function(r) {'
        '        return {'
        '          bvid: r.bvid || "",'
        '          aid: r.aid || 0,'
        '          title: (r.title || "").replace(/<[^>]*>/g, ""),'
        '          author: r.author || "",'
        '          play: r.play || 0,'
        '          tag: r.tag || ""'
        '        };'
        '      });'
        '    }'
        '    return [];'
        '  } catch(e) { return []; }'
        '})()'
    )
    raw = js(js_code)

    if not isinstance(raw, list):
        return []

    # Filter for titles containing the term
    matches = []
    for item in raw[:max_results]:
        bvid = item.get("bvid", "")
        title = item.get("title", "")
        if term.lower() in title.lower():
            matches.append({
                "bvid": bvid,
                "aid": item.get("aid", 0),
                "title": title,
                "author": item.get("author", ""),
                "play": item.get("play", 0),
                "url": "https://www.bilibili.com/video/" + bvid + "/",
            })
    return matches


def main():
    print("=" * 60)
    print("Video Title Evidence Extraction (Search API)")
    print("=" * 60)

    if not inject_cookies():
        print("WARNING: Could not inject cookies")

    # Load terms
    if os.path.exists(TERMS_PATH):
        with open(TERMS_PATH, "r", encoding="utf-8") as f:
            targets = json.load(f)
    else:
        print("ERROR: Terms file not found:", TERMS_PATH)
        return

    print("Loaded " + str(len(targets)) + " target terms")

    all_evidence = []
    terms_with_titles = 0
    total_titles_found = 0

    for i, t in enumerate(targets):
        term = t["term"]
        family = t.get("family", "unknown")
        sys.stdout.write("\r[" + str(i+1) + "/" + str(len(targets)) + "] " + term[:30].ljust(32))
        sys.stdout.flush()

        try:
            matches = search_titles(term, max_results=20)
            term_titles = len(matches)
            total_titles_found += term_titles

            if matches:
                terms_with_titles += 1
                all_evidence.append({
                    "term": term,
                    "family": family,
                    "titleMatches": matches,
                    "source": "Bilibili search-discovered video titles",
                })
        except Exception as e:
            pass  # Continue to next term

        # Brief pause
        if i < len(targets) - 1:
            time.sleep(0.5)

    print("\r" + " " * 80)  # clear line

    # Output results
    output = {
        "harvestedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "type": "video_title_evidence",
        "totalTerms": len(targets),
        "termsWithTitles": terms_with_titles,
        "totalTitlesFound": total_titles_found,
        "entries": all_evidence,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("Title Evidence Results:")
    print("  Terms with titles: " + str(terms_with_titles) + "/" + str(len(targets)))
    print("  Total titles found: " + str(total_titles_found))
    print("  Output: " + OUTPUT_PATH)

    # Show sample findings
    if all_evidence:
        print("\nSample findings:")
        for e in all_evidence[:10]:
            term = e["term"]
            count = len(e.get("titleMatches", []))
            sample = e["titleMatches"][0]["title"][:80] if e["titleMatches"] else "N/A"
            print("  " + term + " (" + str(count) + "): " + sample)


main()
