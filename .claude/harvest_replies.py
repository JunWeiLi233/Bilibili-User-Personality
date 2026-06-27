"""Harvest replies to top comments from trending Bilibili videos."""
import json, time

with open("D:/Bilibili_User_Personality/_trending_bvids.json") as f:
    bv_ids = json.load(f)

print("Harvesting comment replies from {} trending videos...".format(len(bv_ids[:10])))
all_replies = []

for i, bv in enumerate(bv_ids[:10]):
    print("\n[{}/10] {}...".format(i+1, bv))

    # Get video info and top-level comments with reply IDs
    info_js = (
        "(async function() {"
        "var resp = await fetch(\"https://api.bilibili.com/x/web-interface/view?bvid=" + bv + "\");"
        "var data = await resp.json();"
        "return JSON.stringify({title: data.data.title, aid: data.data.aid, videos: data.data.videos});"
        "})()"
    )
    try:
        info = json.loads(js(info_js))
        title = info.get("title", "?")
        aid = info.get("aid", 0)
    except Exception as e:
        print("  Info error: {}".format(e))
        continue

    if not aid:
        continue

    # Fetch top comments (page 1, hot)
    comment_js = (
        "(async function() {"
        "var resp = await fetch(\"https://api.bilibili.com/x/v2/reply/main?oid=" + str(aid) + "&type=1&mode=3&ps=20\");"
        "var data = await resp.json();"
        "return JSON.stringify(data);"
        "})()"
    )
    try:
        resp = json.loads(js(comment_js))
    except Exception as e:
        print("  Comment fetch error: {}".format(e))
        continue

    replies_data = resp.get("data", {}).get("replies", [])
    if not replies_data:
        print("  No comments found")
        continue

    video_replies = 0
    for comment in replies_data:
        # Check for sub-replies
        sub_replies = comment.get("replies", [])
        if sub_replies:
            for sr in sub_replies:
                msg = (sr.get("content", {}).get("message", "") or "").strip()
                if msg:
                    all_replies.append({
                        "bvid": bv,
                        "title": title,
                        "uname": sr.get("member", {}).get("uname", ""),
                        "message": msg,
                        "like": sr.get("like", 0),
                        "is_reply": True
                    })
                    video_replies += 1

        # Also add the main comment text for full context
        msg = (comment.get("content", {}).get("message", "") or "").strip()
        if msg:
            all_replies.append({
                "bvid": bv,
                "title": title,
                "uname": comment.get("member", {}).get("uname", ""),
                "message": msg,
                "like": comment.get("like", 0),
                "is_reply": False
            })

    print("  {}: {} top comments + {} sub-replies".format(title[:50], len(replies_data), video_replies))
    time.sleep(1.5)

print("\nTotal harvested (comments + sub-replies): {}".format(len(all_replies)))

# Save
with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "r", encoding="utf-8") as f:
    existing = json.load(f)
# Merge - deduplicate by message text
existing_msgs = set(c["message"] for c in existing["comments"])
new_items = [r for r in all_replies if r["message"] not in existing_msgs]
existing["comments"].extend(new_items)
existing["total_comments"] = len(existing["comments"])
with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)
print("Merged: {} total ({} new)".format(existing["total_comments"], len(new_items)))
