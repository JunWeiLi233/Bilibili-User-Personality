profiles = list_chrome_profiles()
print(f"Found {len(profiles)} Chrome profiles")
for p in profiles:
    print(f"  {p.get('name','?')}: {p.get('email','no email')}")

# Try to open Bilibili with the default profile
smart_open("https://www.bilibili.com/")
wait_for_load()
wait(3)

# Check if we're logged in
info = page_info()
print(f"URL: {info.get('url','')}")
print(f"Title: {info.get('title','')}")

# Try to get cookies
cookies = js("document.cookie")
print(f"Cookies: {str(cookies)[:200]}")

# Check if we can see the search bar
imap = interactive_map()
print(f"Interactive elements: {len(imap)}")
for el in imap[:15]:
    text = str(el.get("text", ""))[:50]
    tag = el.get("tag", "")
    print(f"  [{el.get('i')}] {tag} text={repr(text)}")
