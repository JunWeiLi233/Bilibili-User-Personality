import json
# Visit a Tieba thread and dump its structure
smart_open("https://tieba.baidu.com/p/5538495945")
wait_for_load()
wait(3)

info = page_info()
print("Page: " + info.get("title","")[:80])

# Get all text
body_result = cdp("Runtime.evaluate", {
    "expression": "document.body ? document.body.innerText.substring(0, 3000) : 'no body'"
})
body_val = ""
if body_result and isinstance(body_result, dict):
    body_val = body_result.get("result", {}).get("value", "") or ""
print("Body text (first 2000 chars):")
print(body_val[:2000])

# Count various elements
counts = cdp("Runtime.evaluate", {
    "expression": """JSON.stringify({
        divs: document.querySelectorAll('div').length,
        spans: document.querySelectorAll('span').length,
        d_post: document.querySelectorAll('.d_post_content').length,
        p_content: document.querySelectorAll('.p_content').length,
        all_classes: Array.from(document.querySelectorAll('[class]')).slice(0,5).map(function(el){return el.className.substring(0,100)})
    })"""
})
print()
print("Counts: " + str(counts.get("result",{}).get("value","") if counts else "no counts"))

# Try broader selectors
broad = cdp("Runtime.evaluate", {
    "expression": """JSON.stringify(Array.from(document.querySelectorAll('*')).filter(function(el){var txt=(el.innerText||el.textContent||'').trim();return txt.length>50 && txt.length<500 && el.children.length===0}).slice(0,10).map(function(el){return{tag:el.tagName,cls:el.className?el.className.substring(0,60):'',txt:el.innerText.substring(0,200)}}))"""
})
print()
print("Broad text elements: " + str(broad.get("result",{}).get("value","")[:2000] if broad else "no broad"))
