"""Scrape aicu.cc for user comments via browser."""
smart_open("https://www.aicu.cc/")
wait(5)
info = page_info()
print(f"AICU page: {info['title']} at {info['url']}")

# Try to get the page content
text = js("document.body.innerText.substring(0, 2000)")
print(f"Page text preview: {text[:500]}")
