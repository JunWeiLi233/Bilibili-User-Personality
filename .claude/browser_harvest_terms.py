"""Harvest evidence for zero-evidence dictionary terms via browser-harness.

Uses real Chrome with Bilibili session cookies to:
1. Inject Bilibili cookies from set-deepseek-env.ps1
2. Search Bilibili for each term
3. Extract video BVIDs from search results (embedded in page JS data)
4. Navigate to each video, get aid from __INITIAL_STATE__
5. Fetch comments via api.bilibili.com/x/v2/reply from within the browser context
6. Match comments against target terms (exact match)
7. Output evidence JSON for dictionary merge
"""

import json
import time
import sys
import os
import re
import urllib.parse

OUTPUT_PATH = r"D:\Bilibili_User_Personality\.claude\browser_harvest_results.json"
TERMS_PATH = r"D:\Bilibili_User_Personality\.claude\zero_evidence_terms.json"
ENV_PATH = r"D:\Bilibili_User_Personality\set-deepseek-env.ps1"


def inject_bilibili_cookies():
    """Read BILIBILI_COOKIE from env file and inject into browser via CDP."""
    if not os.path.exists(ENV_PATH):
        print("WARNING: " + ENV_PATH + " not found, skipping cookie injection")
        return False

    with open(ENV_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    m = re.search(r"\$env:BILIBILI_COOKIE\s*=\s*\"(.+?)\"", content)
    if not m:
        print("WARNING: Could not extract BILIBILI_COOKIE from env file")
        return False

    cookie_str = m.group(1)
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            key, val = part.split("=", 1)
            key = key.strip()
            val = val.strip()
            cdp("Network.setCookie", {
                "name": key,
                "value": val,
                "domain": ".bilibili.com",
                "path": "/",
                "secure": True,
                "httpOnly": key == "SESSDATA",
            })
    print("  Cookies injected: SESSDATA, bili_jct, DedeUserID")
    return True


def extract_bvids_from_search():
    """Extract BVIDs from Bilibili search results page.

    Bilibili embeds search results as JS objects in <script> tags:
    ...bvid:"BV1xxxxx",title:"...",aid:xxxx,...
    """
    raw = js("""
    (function() {
      var html = document.body.innerHTML;
      var re = /bvid:"BV([a-zA-Z0-9]{8,12})"/g;
      var found = [];
      var m;
      while ((m = re.exec(html)) !== null) {
        found.push("BV" + m[1]);
      }
      var seen = {};
      var unique = [];
      for (var i = 0; i < found.length; i++) {
        if (!seen[found[i]]) {
          seen[found[i]] = true;
          unique.push(found[i]);
        }
      }
      return unique.slice(0, 15);
    })()
    """)
    if raw and isinstance(raw, list):
        return raw
    return []


def get_aid_from_video_page():
    """Get the AV number (aid) from the video page's __INITIAL_STATE__."""
    raw = js("""
    (function() {
      try {
        var state = window.__INITIAL_STATE__;
        if (state) {
          return {aid: state.aid, bvid: state.bvid, title: (state.videoData || {}).title || ""};
        }
        return {error: "no __INITIAL_STATE__"};
      } catch(e) { return {error: e.message}; }
    })()
    """)
    if raw and isinstance(raw, dict):
        return raw
    return {}


def fetch_comments_for_aid(aid, pages=2):
    """Fetch comments using the Bilibili API from browser context.

    Uses api.bilibili.com with AV number (aid) as oid.
    """
    all_comments = []
    for pn in range(1, pages + 1):
        raw = js("""
        (async () => {
          try {
            var resp = await fetch(
              "https://api.bilibili.com/x/v2/reply?type=1&oid=""" + str(aid) + """&pn=""" + str(pn) + """&ps=20",
              { credentials: "include" }
            );
            var data = await resp.json();
            if (data && data.code === 0 && data.data && data.data.replies) {
              return data.data.replies.map(function(r) {
                return {
                  message: (r.content && r.content.message) || "",
                  like: r.like || 0,
                  ctime: r.ctime || 0,
                  rpid: r.rpid || "",
                  uname: (r.member && r.member.uname) || ""
                };
              });
            }
            return [];
          } catch(e) { return [{message: "ERR:" + e.message, like:0, ctime:0, rpid:"", uname:""}]; }
        })()
        """)
        if raw and isinstance(raw, list):
            all_comments.extend(raw)
        if pn < pages:
            time.sleep(0.8)
    return all_comments


def search_and_harvest(term, max_videos=5, comment_pages=2):
    """Search Bilibili for a term, then harvest comments from top videos."""
    evidence = []

    print("\n" + "=" * 60)
    print("Term: " + term)

    # Search
    query = urllib.parse.quote(term)
    search_url = "https://search.bilibili.com/all?keyword=" + query + "&order=totalrank"
    smart_open(search_url)
    wait_for_load()
    wait(3)

    bvids = extract_bvids_from_search()
    print("  Found " + str(len(bvids)) + " videos")

    if not bvids:
        print("  WARNING: No videos found")
        return evidence

    for i in range(min(len(bvids), max_videos)):
        bvid = bvids[i]
        sys.stdout.write("  [" + str(i+1) + "/" + str(min(len(bvids), max_videos)) + "] " + bvid + "... ")
        sys.stdout.flush()

        # Navigate to video page to get aid
        smart_open("https://www.bilibili.com/video/" + bvid + "/")
        wait_for_load()
        wait(2)

        page_data = get_aid_from_video_page()
        aid = page_data.get("aid")
        video_title = page_data.get("title", "")

        if not aid:
            print("no aid, skip")
            continue

        comments = fetch_comments_for_aid(aid, comment_pages)
        # Filter out error placeholders
        real_comments = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
        matching = [c for c in real_comments if term in (c.get("message") or "")]

        print(str(len(real_comments)) + " comments, " + str(len(matching)) + " matching")

        if matching:
            for m_idx in range(min(len(matching), 3)):
                msg = matching[m_idx].get("message", "")[:120]
                print("      -> " + msg)

            evidence.append({
                "term": term,
                "source": "Bilibili browser harvest: https://www.bilibili.com/video/" + bvid + "/",
                "uid": bvid,
                "samples": [m.get("message", "")[:200] for m in matching[:5]],
                "totalMatches": len(matching),
                "totalComments": len(real_comments),
            })

    return evidence


def main():
    # Inject cookies first
    print("=" * 60)
    print("Injecting Bilibili cookies...")
    inject_bilibili_cookies()

    # Load zero-evidence terms
    if os.path.exists(TERMS_PATH):
        with open(TERMS_PATH, "r", encoding="utf-8") as f:
            targets = json.load(f)
    else:
        print("ERROR: " + TERMS_PATH + " not found")
        return

    print("Loaded " + str(len(targets)) + " target terms")

    all_evidence = []
    total = len(targets)

    for i, t in enumerate(targets):
        term = t["term"]
        family = t.get("family", "unknown")
        print("\n[" + str(i+1) + "/" + str(total) + "] [" + family + "] " + term)

        try:
            evidence = search_and_harvest(term, max_videos=3, comment_pages=3)
            all_evidence.extend(evidence)
        except Exception as e:
            print("  ERROR: " + str(e))

        # Brief pause between searches to look natural
        if i < total - 1:
            wait(2)

    # Output results
    output = {
        "harvestedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "totalTerms": total,
        "termsWithEvidence": len(set(e["term"] for e in all_evidence)),
        "totalEvidenceSamples": sum(len(e.get("samples", [])) for e in all_evidence),
        "entries": all_evidence,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("Results: " + str(output["termsWithEvidence"]) + "/" + str(total) + " terms found")
    print("Samples: " + str(output["totalEvidenceSamples"]) + " total")
    print("Output: " + OUTPUT_PATH)


main()
