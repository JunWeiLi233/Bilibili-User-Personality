"""Scrape Tieba for weak-coverage keywords using browser-harness."""
import json
import os
import sys
import time

# Weak keywords that need more evidence (from strict coverage audit)
WEAK_KEYWORDS = [
    "说八百遍了", "都说八百遍了", "就是鬼畜标签", "就算六个齐上也不是我对手",
    "没有成为炒饭的资格", "男的就是这样", "男的就是这样爱推卸责任",
    "缺点只有一个", "缺点只有一个贵", "茶庄10个有9个洗钱的",
    "谁都受不住", "8打5的雷霆", "一个多亿", "侮辱乐手",
    "分不清轻重", "分不清轻重就乱套", "基本没有音乐理解",
    "就是要干你", "换个地方再就业", "有什么值得炫耀的",
]

def scrape_tieba_keyword(keyword, max_results=5):
    """Search Tieba for a keyword and extract thread snippets."""
    import urllib.parse
    encoded = urllib.parse.quote(keyword)
    url = f"https://tieba.baidu.com/f/search/res?ie=utf-8&qw={encoded}"

    smart_open(url)
    wait(3)

    info = page_info()
    results = {"keyword": keyword, "url": info["url"], "threads": []}

    # Extract thread titles and snippets from Tieba search results
    try:
        thread_data = js("""
        (function() {
            var results = [];
            // Tieba search result selectors
            var items = document.querySelectorAll('.s_post, .search_post, .thread_list .thread_item, .p_content');
            items.forEach(function(item) {
                var title = item.querySelector('.p_title, .thread_title, .title, a') || item;
                var content = item.querySelector('.p_content, .thread_abstract, .content') || item;
                var titleText = (title.textContent || '').trim();
                var contentText = (content.textContent || '').trim();
                if (titleText || contentText) {
                    results.push({
                        title: titleText.substring(0, 200),
                        snippet: contentText.substring(0, 500)
                    });
                }
            });
            return results.slice(0, 10);
        })()
        """)
        if isinstance(thread_data, list):
            results["threads"] = thread_data
    except Exception as e:
        results["error"] = str(e)

    # Fallback: try getting all visible text if no structured results
    if not results["threads"]:
        try:
            text = js("document.body.innerText.substring(0, 3000)")
            results["body_text"] = text
        except:
            pass

    return results


# Test with first keyword
kw = WEAK_KEYWORDS[0]
print(f"Searching Tieba for: {kw}")
result = scrape_tieba_keyword(kw)
print(json.dumps(result, ensure_ascii=False, indent=2))
