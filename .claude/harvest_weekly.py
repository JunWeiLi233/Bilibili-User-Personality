import time, json

# Navigate to weekly ranking
smart_open("https://www.bilibili.com/v/popular/rank/all?rid=0&day=7")
wait(4)
print(page_info())

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
# Deduplicate with existing
with open("D:/Bilibili_User_Personality/_trending_bvids.json") as f:
    existing = set(json.load(f))

new_bvs = []
for link in bv_links:
    if link["bvid"] not in existing:
        existing.add(link["bvid"])
        new_bvs.append(link["bvid"])

all_bvs = list(existing)
with open("D:/Bilibili_User_Personality/_trending_bvids.json", "w") as f:
    json.dump(all_bvs, f)

print("Existing: {}, New: {}, Total: {}".format(len(existing) - len(new_bvs), len(new_bvs), len(all_bvs)))

# Harvest danmaku from new videos
print("\nHarvesting danmaku from new videos...")
all_new_dm = []
for i, bv in enumerate(new_bvs[:10]):
    print("[{}/{}] {}".format(i+1, min(10, len(new_bvs)), bv))
    info_js = "(async function() {var resp = await fetch(\"https://api.bilibili.com/x/web-interface/view?bvid=" + bv + "\");var data = await resp.json();return JSON.stringify({cid: data.data.cid, title: data.data.title, dm: data.data.stat.danmaku});})()"
    try:
        info = json.loads(js(info_js))
        cid = info.get("cid")
        if not cid:
            continue
    except Exception as e:
        print("  Info error: {}".format(e))
        continue

    dm_js = "(async function() {var resp = await fetch(\"https://api.bilibili.com/x/v1/dm/list.so?oid=" + str(cid) + "\");return await resp.text();})()"
    try:
        dm_xml = js(dm_js)
        import xml.etree.ElementTree as ET
        root = ET.fromstring(dm_xml)
        dms = [d.text.strip() for d in root.iter("d") if d.text and d.text.strip()]
        all_new_dm.extend(dms)
        title = info.get("title", "?")
        print("  {}... {} danmaku".format(title[:50], len(dms)))
    except Exception as e:
        print("  Error: {}".format(e))
    time.sleep(0.8)

print("\nNew danmaku: {}".format(len(all_new_dm)))

# Append to existing
with open("D:/Bilibili_User_Personality/.claude/harvested_danmaku.json", "r", encoding="utf-8") as f:
    h = json.load(f)
h["danmaku"].extend(all_new_dm)
h["total_danmaku"] = len(h["danmaku"])
with open("D:/Bilibili_User_Personality/.claude/harvested_danmaku.json", "w", encoding="utf-8") as f:
    json.dump(h, f, ensure_ascii=False, indent=2)
print("Total danmaku in harvest: {}".format(h["total_danmaku"]))
