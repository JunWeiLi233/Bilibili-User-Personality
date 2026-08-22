import time
import json
import sys

uid = sys.argv[1] if len(sys.argv) > 1 else "100001"
max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 3

all_comments = []
all_danmaku = []

# Fetch comments
for page in range(1, max_pages + 1):
    url = f"https://api.aicu.cc/api/v3/search/getreply?uid={uid}&pn={page}&ps=20&mode=0&keyword="
    smart_open(url)
    time.sleep(3)
    result = js("document.body.innerText.slice(0, 10000)")
    try:
        data = json.loads(result)
        if data.get("code") != 0:
            break
        replies = data.get("data", {}).get("replies", [])
        if not replies:
            break
        for r in replies:
            all_comments.append({
                "rpid": r.get("rpid", ""),
                "message": r.get("message", ""),
                "time": r.get("time", 0),
                "rank": r.get("rank", 1),
                "oid": r.get("dyn", {}).get("oid", ""),
                "type": r.get("dyn", {}).get("type", 1),
            })
        if data.get("data", {}).get("cursor", {}).get("is_end", False):
            break
    except:
        break
    time.sleep(2)

# Fetch danmaku
for page in range(1, max_pages + 1):
    url = f"https://api.aicu.cc/api/v3/search/getvideodm?uid={uid}&pn={page}&ps=20&keyword="
    smart_open(url)
    time.sleep(3)
    result = js("document.body.innerText.slice(0, 10000)")
    try:
        data = json.loads(result)
        if data.get("code") != 0:
            break
        dm_list = data.get("data", {}).get("videodmlist", [])
        if not dm_list:
            break
        for d in dm_list:
            all_danmaku.append({
                "id": d.get("id", ""),
                "content": d.get("content", ""),
                "time": d.get("ctime", 0),
                "oid": d.get("oid", ""),
            })
        if data.get("data", {}).get("cursor", {}).get("is_end", False):
            break
    except:
        break
    time.sleep(2)

# Output results as JSON
result = {
    "uid": uid,
    "comments": all_comments,
    "danmaku": all_danmaku,
    "commentCount": len(all_comments),
    "danmakuCount": len(all_danmaku),
}
print(json.dumps(result, ensure_ascii=False))
