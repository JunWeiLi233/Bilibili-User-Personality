import json
import time

# Phase 1: Collect tags via API (works for most seeds)
# Phase 2: Use browser to scrape tags from search results page (for seeds that fail API)
# Phase 3: Merge all collected tags, update the DEFAULT_HISTORY_TAG_SEEDS list

# First, save API results and identify failed seeds
api_tags = set()
browser_tags = set()
failed_seeds = []

# Go through each seed
for i, seed in enumerate(seeds):
    encoded = seed  # simplified, will encode properly below
    url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%s&page=1&page_size=15" % encoded
    referer = "https://search.bilibili.com/all?keyword=%s" % encoded

    # Try API first
    resp = http_get(url, headers={
        "Referer": referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })

    if resp and json.loads(resp).get("code") == 0:
        data = json.loads(resp)
        results = data.get("data", {}).get("result", [])
        for item in results:
            tag_str = item.get("tag", "")
            for tag in tag_str.split(","):
                tag = tag.strip()
                if tag and len(tag) >= 2:
                    api_tags.add(tag)
    else:
        failed_seeds.append(seed)

    time.sleep(2)

# Now use browser to scrape failed seeds
for seed in failed_seeds:
    smart_open("https://search.bilibili.com/all?keyword=%s&search_type=video" % seed)
    wait_for_load()
    wait(3)

    # Extract tags from DOM
    raw = js("""(function() {
  var results = [];
  var cards = document.querySelectorAll('.bili-video-card, .video-list-item, [class*="search"] [class*="card"], [class*="video"]');
  cards.forEach(function(el) {
    var txt = el.textContent.trim();
    var tagEls = el.querySelectorAll('[class*="tag"]');
    var tags = [];
    tagEls.forEach(function(t) {
      var tag = t.textContent.trim();
      if (tag && tag.length >= 2 && tag.length < 50) {
        tags.push(tag);
      }
    });
    results.push({title: el.querySelector('[class*="title"], h3, a[href*="video"]') ? el.querySelector('title, h3, a[href*="video"]').textContent.trim().substr(0, 80) : ''});
  });
  return JSON.stringify({results: results, tags: tags});
})()""")

    data = json.loads(raw) if raw else {}
    for r in data.get("results", []):
        title = r.get("title", "")
        browser_tags.append(title)
    for t in data.get("tags", []):
        browser_tags.append(t)

print("=== API TAGS (%d) ===" % len(api_tags))
for tag in sorted(api_tags):
    print("  %s" % tag)

print()
print("=== BROWSER TAGS (%d) ===" % len(browser_tags))
for tag in sorted(browser_tags):
    print("  %s" % tag)

print()
all_tags = api_tags | browser_tags
print("=== ALL UNIQUE TAGS (%d) ===" % len(all_tags))
for tag in sorted(all_tags):
    print("  %s" % tag)
