"""Search Bilibili for debate-heavy keywords and harvest comments."""
import json, time, urllib.parse

# Controversial/debate-heavy search queries
queries = [
    "杠精 评论区",
    "阴阳怪气 评论区",
    "时政 争议",
    "游戏 吵架",
    "网络对线",
]

all_comments = []
all_danmaku = []
seen_bvs = set()

for query in queries:
    print("\n=== Searching: {} ===".format(query))
    encoded = urllib.parse.quote(query)
    search_url = "https://search.bilibili.com/video?keyword={}&order=click&duration=0&tids=0".format(encoded)

    smart_open(search_url)
    wait(3)

    # Extract BV IDs from search results
    extract_js = r"""(function() {
      var items = document.querySelectorAll('a[href*="/video/BV"]');
      var result = [];
      var seen = new Set();
      for (var i = 0; i < items.length; i++) {
        var a = items[i];
        var href = a.href;
        if (!href || href.indexOf('/video/BV') === -1) continue;
        var m = href.match(/BV[A-Za-z0-9]+/);
        if (!m) continue;
        var bv = m[0];
        if (seen.has(bv)) continue;
        seen.add(bv);
        result.push({bvid: bv, title: a.textContent.trim().substring(0, 80) || bv});
      }
      return result.slice(0, 10);
    })()"""

    bv_links = js(extract_js)
    print("Found {} videos for '{}'".format(len(bv_links), query))

    for j, link in enumerate(bv_links):
        bv = link["bvid"]
        if bv in seen_bvs:
            continue
        seen_bvs.add(bv)

        print("  [{}/{}] {}: {}...".format(j+1, len(bv_links), bv, link["title"][:50]))

        # Get video info
        info_js = (
            "(async function() {"
            "var resp = await fetch(\"https://api.bilibili.com/x/web-interface/view?bvid=" + bv + "\");"
            "var data = await resp.json();"
            "return JSON.stringify({title: data.data.title, aid: data.data.aid, cid: data.data.cid, dm: data.data.stat.danmaku});"
            "})()"
        )
        try:
            info = json.loads(js(info_js))
        except:
            continue

        aid = info.get("aid", 0)
        cid = info.get("cid", 0)
        title = info.get("title", "?")

        # Harvest danmaku (if any)
        if cid:
            dm_js = (
                "(async function() {"
                "var resp = await fetch(\"https://api.bilibili.com/x/v1/dm/list.so?oid=" + str(cid) + "\");"
                "return await resp.text();"
                "})()"
            )
            try:
                dm_xml = js(dm_js)
                import xml.etree.ElementTree as ET
                root = ET.fromstring(dm_xml)
                dms = [d.text.strip() for d in root.iter("d") if d.text and d.text.strip()]
                all_danmaku.extend(dms)
                print("    {} danmaku".format(len(dms)))
            except:
                pass

        # Harvest comments (page 1, hot)
        if aid:
            cjs = (
                "(async function() {"
                "var resp = await fetch(\"https://api.bilibili.com/x/v2/reply/main?oid=" + str(aid) + "&type=1&mode=3&ps=20\");"
                "var data = await resp.json();"
                "return JSON.stringify(data);"
                "})()"
            )
            try:
                resp = json.loads(js(cjs))
                for r in resp.get("data", {}).get("replies", []):
                    msg = (r.get("content", {}).get("message", "") or "").strip()
                    if msg:
                        all_comments.append({
                            "bvid": bv,
                            "title": title,
                            "search_query": query,
                            "uname": r.get("member", {}).get("uname", ""),
                            "message": msg,
                            "like": r.get("like", 0)
                        })
                        # Also get sub-replies
                        for sr in r.get("replies", []):
                            sr_msg = (sr.get("content", {}).get("message", "") or "").strip()
                            if sr_msg:
                                all_comments.append({
                                    "bvid": bv,
                                    "title": title,
                                    "search_query": query,
                                    "uname": sr.get("member", {}).get("uname", ""),
                                    "message": sr_msg,
                                    "like": sr.get("like", 0),
                                    "is_reply": True
                                })
                print("    {} comments".format(len(resp.get("data", {}).get("replies", []))))
            except Exception as e:
                print("    Comment error: {}".format(e))

        time.sleep(1.5)

print("\n" + "="*50)
print("Total danmaku harvested: {}".format(len(all_danmaku)))
print("Total comments harvested: {}".format(len(all_comments)))
print("Unique BVs covered: {}".format(len(seen_bvs)))

# Save
output = {
    "harvested_at": "2026-06-25",
    "search_queries": queries,
    "total_danmaku": len(all_danmaku),
    "total_comments": len(all_comments),
    "unique_bvs": list(seen_bvs),
    "danmaku": all_danmaku,
    "comments": all_comments
}
with open("D:/Bilibili_User_Personality/.claude/search_harvest.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print("Saved to .claude/search_harvest.json")
