import time
import json

# 1. Navigate to Bilibili search
smart_open("https://search.bilibili.com/all?keyword=争论 热评&order=click")
wait(4)

# 2. Get page info
info = page_info()
print(f"Page URL: {info.get('url', 'unknown')}")
print(f"Title: {info.get('title', 'unknown')[:80]}")

# 3. Get interactive elements
imap = interactive_map()
print(f"Interactive elements: {len(imap)}")

# 4. Show first few clickable elements
for el in imap[:5]:
    i = el.get('i', '?')
    tag = el.get('tag', '')
    text = (el.get('text', '') or '')[:60]
    cx = el.get('cx', 0)
    cy = el.get('cy', 0)
    clickable = el.get('clickable', False)
    print(f"  [{i}] {tag} text='{text}' at ({cx},{cy}) clickable={clickable}")

# 5. Try to extract video links from the page
raw = js("""
(() => {
    const links = document.querySelectorAll('a[href*="www.bilibili.com/video/BV"]');
    const results = [];
    links.forEach(a => {
        const href = a.getAttribute('href');
        const match = href.match(/BV[\\w]+/);
        if (match) results.push(match[0]);
    });
    return JSON.stringify([...new Set(results)].slice(0, 10));
})()
""")
if raw:
    bvids = json.loads(raw)
    print(f"\nFound {len(bvids)} video BVIDs: {bvids}")
else:
    print("\nNo video links found")

print("\nTest complete!")
