import time
import json
import sys

mid = sys.argv[1] if len(sys.argv) > 1 else "100001"
max_videos = int(sys.argv[2]) if len(sys.argv) > 2 else 3

smart_open(f"https://api.bilibili.com/x/space/arc/search?mid={mid}&pn=1&ps={max_videos}&order=pubdate")
time.sleep(5)
result = js("document.body.innerText.slice(0, 5000)")
data = json.loads(result)
videos = data.get("data", {}).get("list", {}).get("vlist", [])
for v in videos:
    aid = v["aid"]
    bvid = v.get("bvid", "")
    comment = v.get("comment", 0)
    print(f"{aid}|{bvid}|{comment}")
