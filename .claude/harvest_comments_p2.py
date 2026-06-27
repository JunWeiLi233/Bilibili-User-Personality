import json, time

with open("D:/Bilibili_User_Personality/_trending_bvids.json") as f:
    bv_ids = json.load(f)

print(f"Fetching comments pages 2-3 from {len(bv_ids[:10])} trending videos...")
all_comments = []

for i, bv in enumerate(bv_ids[:10]):
    print(f"\n[{i+1}/10] {bv}...")

    # Get aid
    info_js = (
        '(async function() {'
        'var resp = await fetch("https://api.bilibili.com/x/web-interface/view?bvid=' + bv + '");'
        'var data = await resp.json();'
        'return JSON.stringify({title: data.data.title, aid: data.data.aid});'
        '})()'
    )
    try:
        info = json.loads(js(info_js))
        title = info.get("title", "?")
        aid = info.get("aid", 0)
    except Exception as e:
        print(f"  Error: {e}")
        continue

    if not aid:
        continue

    video_comments = 0
    for page in [2, 3]:
        comment_js = (
            '(async function() {'
            'var resp = await fetch("https://api.bilibili.com/x/v2/reply/main?oid=' + str(aid) + '&type=1&mode=3&ps=20&pn=' + str(page) + '");'
            'var data = await resp.json();'
            'return JSON.stringify(data);'
            '})()'
        )
        try:
            resp_data = json.loads(js(comment_js))
        except Exception as e:
            continue

        replies = resp_data.get("data", {}).get("replies", [])
        for r in replies:
            msg = (r.get("content", {}).get("message", "") or "").strip()
            if msg:
                all_comments.append({
                    "bvid": bv,
                    "title": title,
                    "uname": r.get("member", {}).get("uname", ""),
                    "message": msg,
                    "like": r.get("like", 0),
                    "ctime": r.get("ctime", 0)
                })
                video_comments += 1
        time.sleep(0.6)

    print(f"  {title[:50]}... +{video_comments} comments (pages 2-3)")

print(f"\nTotal additional comments: {len(all_comments)}")

# Load existing and merge
try:
    with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "r", encoding="utf-8") as f:
        existing = json.load(f)
    existing["comments"].extend(all_comments)
    existing["total_comments"] = len(existing["comments"])
    with open("D:/Bilibili_User_Personality/.claude/harvested_comments.json", "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    print(f"Merged: {existing['total_comments']} total comments")
except Exception as e:
    print(f"Merge error: {e}")
