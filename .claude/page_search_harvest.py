"""Harvest evidence using the Bilibili search PAGE (not API — avoids 412).

Strategy: Search page → extract BVIDs from HTML → visit videos → fetch comments.
Also captures video titles from search page data as evidence.
"""
import json, time, sys, os, re, urllib.parse

ROOT = r"D:\Bilibili_User_Personality"
TERMS_PATH = os.path.join(ROOT, ".claude", "zero_evidence_terms.json")
ENV_PATH = os.path.join(ROOT, "set-deepseek-env.ps1")
OUTPUT_PATH = os.path.join(ROOT, ".claude", "page_search_results.json")


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


def search_page_get_bvids(term, max_results=10):
    """Search via the Bilibili search PAGE and extract BVIDs from HTML."""
    query = urllib.parse.quote(term)
    smart_open("https://search.bilibili.com/all?keyword=" + query + "&order=totalrank")
    wait_for_load()
    wait(2)

    raw = js("""
    (function() {
      var html = document.body.innerHTML;
      var re = /bvid:"BV([a-zA-Z0-9]{8,12})"/g;
      var found = [];
      var m;
      while ((m = re.exec(html)) !== null) found.push("BV" + m[1]);
      var seen = {};
      var unique = [];
      found.forEach(function(bv) { if (!seen[bv]) { seen[bv] = true; unique.push(bv); } });
      return unique.slice(0, """ + str(max_results) + """);
    })()
    """)
    return raw if isinstance(raw, list) else []


def get_video_info(bvid):
    """Navigate to video page and get aid + title."""
    smart_open("https://www.bilibili.com/video/" + bvid + "/")
    wait_for_load()
    wait(1.5)
    state = js("(function() { try { var s = window.__INITIAL_STATE__; return s ? {aid: s.aid, title: (s.videoData||{}).title||''} : {}; } catch(e) { return {}; } })()")
    return state if isinstance(state, dict) else {}


def fetch_comments(aid, pages=2):
    """Fetch comments via the comment API (this API still works)."""
    all_comments = []
    for pn in range(1, pages + 1):
        js_code = (
            '(async function() {'
            '  try {'
            '    var resp = await fetch("https://api.bilibili.com/x/v2/reply?type=1&oid=' + str(aid) + '&pn=' + str(pn) + '&ps=20", {"credentials": "include"});'
            '    var data = await resp.json();'
            '    if (data && data.code === 0 && data.data && data.data.replies) {'
            '      return data.data.replies.map(function(r) {'
            '        return {message: (r.content && r.content.message) || "", like: r.like || 0, uname: (r.member && r.member.uname) || ""};'
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
    return all_comments


def main():
    print("=" * 60)
    print("Page-Search Harvest (bypasses 412)")
    print("=" * 60)

    if not inject_cookies():
        print("WARNING: Could not inject cookies")

    # Load targets — focus on shortest terms first (most likely in comments)
    targets = []
    if os.path.exists(TERMS_PATH):
        with open(TERMS_PATH, "r", encoding="utf-8") as f:
            targets = json.load(f)
    targets.sort(key=lambda t: len(t["term"]))
    print("Loaded " + str(len(targets)) + " targets (sorted by length)")

    all_evidence = []
    terms_with_evidence = 0

    for i, t in enumerate(targets):
        term = t["term"]
        family = t.get("family", "unknown")
        print("\n[" + str(i+1) + "/" + str(len(targets)) + "] [" + family + "] " + term)

        try:
            bvids = search_page_get_bvids(term, max_results=5)
            print("  BVIDs: " + str(len(bvids)))

            if not bvids:
                continue

            term_evidence = {"term": term, "family": family, "titles": [], "comments": []}

            for vi, bvid in enumerate(bvids[:3]):
                sys.stdout.write("  [" + str(vi+1) + "] " + bvid + "... ")
                sys.stdout.flush()

                info = get_video_info(bvid)
                aid = info.get("aid")
                title = info.get("title", "")

                if not aid:
                    print("no aid")
                    continue

                # Title evidence
                if term.lower() in title.lower():
                    term_evidence["titles"].append({
                        "bvid": bvid, "title": title,
                        "url": "https://www.bilibili.com/video/" + bvid + "/",
                    })

                # Comment evidence
                comments = fetch_comments(aid, pages=2)
                real = [c for c in comments if not (c.get("message") or "").startswith("ERR:")]
                matching = [c for c in real if term in (c.get("message") or "")]

                print(str(len(real)) + " comments, " + str(len(matching)) + " match, " + ("title!" if term.lower() in title.lower() else "no title"))

                if matching:
                    term_evidence["comments"].append({
                        "bvid": bvid, "totalComments": len(real),
                        "matching": len(matching),
                        "samples": [m.get("message", "")[:200] for m in matching[:5]],
                    })

            if term_evidence["titles"] or term_evidence["comments"]:
                all_evidence.append(term_evidence)
                terms_with_evidence += 1
                title_count = len(term_evidence["titles"])
                comment_count = sum(len(e["samples"]) for e in term_evidence["comments"])
                print("  => EVIDENCE: " + str(title_count) + " titles, " + str(comment_count) + " comment samples")

        except Exception as e:
            print("  ERROR: " + str(e))

        if i < len(targets) - 1:
            time.sleep(0.5)

    # Save
    output = {
        "harvestedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "type": "page_search_harvest",
        "totalTerms": len(targets),
        "termsWithEvidence": terms_with_evidence,
        "entries": all_evidence,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("Page-Search Harvest Results:")
    print("  Terms with evidence: " + str(terms_with_evidence) + "/" + str(len(targets)))
    print("  Output: " + OUTPUT_PATH)


main()
