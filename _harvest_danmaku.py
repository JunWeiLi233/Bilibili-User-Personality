# Extract top video BV IDs from Bilibili ranking page
import time

smart_open("https://www.bilibili.com/v/popular/rank/all")
time.sleep(3)
print(page_info())

# Extract video BV IDs from ranking page
script = """(function() {
  var items = document.querySelectorAll('a[href*="BV"]');
  var result = [];
  for (var i = 0; i < Math.min(items.length, 50); i++) {
    var a = items[i];
    if (a.href && a.href.indexOf('/video/BV') !== -1) {
      result.push({title: a.textContent.trim().substring(0, 80), href: a.href});
    }
  }
  return result.slice(0, 25);
})()"""

links = js(script)
print(f"Found {len(links)} video links")
for l in links:
    print(f"  {l['title'][:50]}")
    print(f"    {l['href']}")

# Extract BV IDs
import re
bv_ids = []
for l in links:
    m = re.search(r'BV[A-Za-z0-9]+', l['href'])
    if m:
        bv_ids.append(m.group(0))

print(f"\nExtracted {len(bv_ids)} BV IDs: {bv_ids[:5]}...")

# Store BV IDs for next step
import json
with open('D:/Bilibili_User_Personality/_trending_bvids.json', 'w') as f:
    json.dump(bv_ids, f, ensure_ascii=False)
print("\nBV IDs saved to _trending_bvids.json")
