"""Harvest additional pages and time-sorted comments from trending videos."""
import json, time

with open("D:/Bilibili_User_Personality/_trending_bvids.json") as f:
    bv_ids = json.load(f)

print("Harvesting extra comment pages from {} trending videos...".format(len(bv_ids[:8])))
all_new = []

for i, bv in enumerate(bv_ids[:8]):
    print("\n[{}/8] {}...".format(i+1, bv))

    # Get aid
    info_js = (
        "(async function() {"
        "var resp = await fetch(\"https://api.bilibili.com/x/web-interface/view?bvid=" + bv + "\");"
        "var data = await resp.json();"
        "return JSON.stringify({title: data.data.title, aid: data.data.aid});"
        "})()"
    )
    try:
        info = json.loads(js(info_js))
        title = info.get("title", "?")
        aid = info.get("aid", 0)
    except:
        continue
    if not aid:
        continue

    vcount = 0
    # Fetch pages 4-5 (hot sort) and page 1 (time sort = mode 2)
    for page in [4, 5]:
        cjs = (
            "(async function() {"
            "var resp = await fetch(\"https://api.bilibili.com/x/v2/reply/main?oid=" + str(aid) + "&type=1&mode=3&ps=20&pn=" + str(page) + "\");"
            "var data = await resp.json();"
            "return JSON.stringify(data);"
            "})()"
        )
        try:
            resp = json.loads(js(cjs))
            for r in resp.get("data", {}).get("replies", []):
                msg = (r.get("content", {}).get("message", "") or "").strip()
                if msg:
                    all_new.append({"bvid": bv, "title": title, "uname": r.get("member", {}).get("uname", ""), "message": msg, "like": r.get("like", 0)})
                    vcount += 1
        except:
            pass
        time.sleep(0.5)
    print("  {}... +{} comments (pages 4-5)".format(title[:55], vcount))

print("\nTotal new comments: {}".format(len(all_new)))

# Merge with existing
with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "r", encoding="utf-8") as f:
    existing = json.load(f)
existing_msgs = set(c["message"] for c in existing["comments"])
new_only = [c for c in all_new if c["message"] not in existing_msgs]
existing["comments"].extend(new_only)
existing["total_comments"] = len(existing["comments"])
with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)
print("Merged: {} total unique comments ({} new added)".format(existing["total_comments"], len(new_only)))
