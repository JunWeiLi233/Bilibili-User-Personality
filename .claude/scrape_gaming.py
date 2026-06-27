smart_open("https://www.bilibili.com/v/game/")
wait_for_load()
wait(3)
imap = interactive_map()
print(f"Found {len(imap)} interactive elements")
for el in imap[:30]:
    text = str(el.get("text", ""))[:60]
    tag = el.get("tag", "")
    idx = el.get("i")
    print(f"  [{idx}] {tag} text={repr(text)} clickable={el.get('clickable')}")
