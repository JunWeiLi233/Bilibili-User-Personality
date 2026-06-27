"""Harvest trending Bilibili video BV IDs and danmaku via browser-harness."""
import time, re, json

# Step 1: Extract BV IDs from trending page
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
    var title = a.textContent.trim().substring(0, 80) || bv;
    result.push({bvid: bv, title: title});
  }
  return result.slice(0, 30);
})()"""

bv_links = js(extract_js)
print(f"Found {len(bv_links)} video links")

# Deduplicate
seen_bv = set()
unique_links = []
for link in bv_links:
    if link["bvid"] not in seen_bv:
        seen_bv.add(link["bvid"])
        unique_links.append(link)

bv_ids = [l["bvid"] for l in unique_links]
print(f"Unique BV IDs: {len(bv_ids)}")
for i, l in enumerate(unique_links[:10]):
    print(f"  {i+1}. {l['bvid']} - {l['title'][:60]}")

# Save BV IDs
with open("D:/Bilibili_User_Personality/_trending_bvids.json", "w") as f:
    json.dump(bv_ids, f)
print(f"Saved {len(bv_ids)} BV IDs")

# Step 2: Harvest danmaku from top videos
print("\n=== Harvesting Danmaku ===")
all_danmaku = []
video_results = []

for i, bv in enumerate(bv_ids[:15]):
    print(f"\n[{i+1}/{min(15, len(bv_ids))}] {bv}...")

    # Get video info (CID, title, danmaku count)
    info_js = (
        '(async function() {'
        'var resp = await fetch("https://api.bilibili.com/x/web-interface/view?bvid=' + bv + '");'
        'var data = await resp.json();'
        'return JSON.stringify({cid: data.data.cid, title: data.data.title, dm: data.data.stat.danmaku, view: data.data.stat.view});'
        '})()'
    )

    try:
        info = json.loads(js(info_js))
    except Exception as e:
        print(f"  Error fetching info: {e}")
        continue

    cid = info.get("cid", 0)
    dm_count = info.get("dm", 0)
    title = info.get("title", "?")
    print(f"  {title[:60]}")
    print(f"  CID={cid}, DM={dm_count}, Views={info.get('view', 0)}")

    if not cid:
        print(f"  No CID, skipping")
        continue

    # Fetch danmaku XML
    dm_js = (
        '(async function() {'
        'var resp = await fetch("https://api.bilibili.com/x/v1/dm/list.so?oid=' + str(cid) + '");'
        'return await resp.text();'
        '})()'
    )

    try:
        dm_xml = js(dm_js)
        import xml.etree.ElementTree as ET
        root = ET.fromstring(dm_xml)
        dms = [d.text.strip() for d in root.iter("d") if d.text and d.text.strip()]
        all_danmaku.extend(dms)
        video_results.append({
            "bvid": bv,
            "cid": cid,
            "title": title,
            "danmaku_count": len(dms),
            "total_danmaku": dm_count
        })
        print(f"  Harvested {len(dms)} danmaku")
    except Exception as e:
        print(f"  Danmaku error: {e}")

    time.sleep(0.8)

print(f"\n{'='*50}")
print(f"Total danmaku harvested: {len(all_danmaku)}")
print(f"Videos scanned: {len(video_results)}")

# Save results
harvest = {
    "harvested_at": "2026-06-25",
    "total_danmaku": len(all_danmaku),
    "videos_scanned": video_results,
    "bv_ids": bv_ids,
    "danmaku": all_danmaku[:5000]  # cap at 5000 to keep file manageable
}
with open("D:/Bilibili_User_Personality/.claude/harvested_danmaku.json", "w", encoding="utf-8") as f:
    json.dump(harvest, f, ensure_ascii=False, indent=2)
print("Saved to .claude/harvested_danmaku.json")
