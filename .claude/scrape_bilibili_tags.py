import json
import time
import urllib.parse

# Navigate to Bilibili to establish cookies/session
smart_open("https://www.bilibili.com/")
wait_for_load()
wait(3)

# Now use browser to explore Bilibili's history content pages
# 1. Check the history partition page
smart_open("https://www.bilibili.com/v/knowledge/history/")
wait_for_load()
wait(3)
print("=== Browser page URL after navigation ===")
print(page_info().get("url"))

# 2. Try to extract tag data from the page via JS
tag_data = js("""(function() {
  var allText = [];
  // Find all links that might be tag/category links
  var links = document.querySelectorAll('a[href*="tag"], a[href*="search"], a[href*="channel"], a[href*="category"], [class*="tag"], [class*="channel"]');
  links.forEach(function(el) {
    var txt = el.textContent.trim();
    var href = el.getAttribute('href') || '';
    if (txt && txt.length >= 2 && txt.length < 40) {
      allText.push(txt);
    }
  });
  return JSON.stringify({found: allText, url: window.location.href, title: document.title});
})()""")
print("Tag data:", tag_data)

# 3. Also try the history search page with tag filters visible
smart_open("https://search.bilibili.com/all?keyword=%E5%8E%86%E5%8F%B2&search_type=video&order=click")
wait_for_load()
wait(4)

# Extract any tag filters from search page
search_tags = js("""(function() {
  var items = [];
  document.querySelectorAll('a, span, div, button').forEach(function(el) {
    var txt = el.textContent.trim();
    if (txt && txt.length >= 2 && txt.length <= 40) {
      var cls = el.className || '';
      var href = (el.getAttribute && el.getAttribute('href')) || '';
      if (cls.includes('tag') || cls.includes('filter') || cls.includes('category') || cls.includes('channel') ||
          href.includes('tag') || href.includes('keyword')) {
        items.push(txt);
      }
    }
  });
  return JSON.stringify({
    url: window.location.href,
    title: document.title,
    items: items.slice(0, 100)
  });
})()""")
print("Search page tags:", search_tags)

# 4. Read previously collected API tags
with open(".claude/bilibili_discovered_tags.json", "r", encoding="utf-8") as f:
    api_data = json.load(f)
api_tags = set(api_data.get("tags", []))
print()
print("=== Previously collected API tags: %d ===" % len(api_tags))
