import json
ensure_real_tab()
smart_open("https://tieba.baidu.com/f/search/res?qw=%E7%B2%A5%E6%89%B9&sm=2")
wait_for_load()
wait(3)
info = page_info()
print("Page: " + info.get("url","")[:120])
print("Title: " + info.get("title","")[:80])

# Use raw CDP to get page content
expr = "document.title + ' SEPARATOR ' + document.body.innerText.substring(0, 3000)"
result = cdp("Runtime.evaluate", {"expression": expr})
if result and isinstance(result, dict):
    val = result.get("result", {}).get("value", "")
    print("Body text length: " + str(len(str(val))))
    print("First 2000 chars: " + str(val)[:2000])
else:
    print("CDP result: " + str(result)[:500])

# Also try getting links
links_expr = """JSON.stringify(Array.from(document.querySelectorAll('a')).filter(function(a){return a.href && a.href.indexOf('/p/')>=0}).map(function(a){return{href:a.href,text:a.innerText.substring(0,100)}}).slice(0,20))"""
links_result = cdp("Runtime.evaluate", {"expression": links_expr})
print()
print("Links raw: " + str(links_result)[:1000])
