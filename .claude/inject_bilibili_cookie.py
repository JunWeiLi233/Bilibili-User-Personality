"""Inject Bilibili cookies from set-deepseek-env.ps1 into the automation Chrome."""
import re
import time

# Read cookie from env file
with open(r"D:\Bilibili_User_Personality\set-deepseek-env.ps1", "r", encoding="utf-8") as f:
    content = f.read()

# Extract cookie line
m = re.search(r"\$env:BILIBILI_COOKIE\s*=\s*\"(.+?)\"", content)
if not m:
    print("ERROR: Could not extract BILIBILI_COOKIE from env file")
    exit(1)

cookie_str = m.group(1)
print("Cookie string length:", len(cookie_str))

# Parse individual cookies
cookies = {}
for part in cookie_str.split(";"):
    part = part.strip()
    if "=" in part:
        key, val = part.split("=", 1)
        cookies[key.strip()] = val.strip()

print("Found cookies:", list(cookies.keys()))

# Set each cookie for bilibili.com using CDP
for name, value in cookies.items():
    cdp("Network.setCookie", {
        "name": name,
        "value": value,
        "domain": ".bilibili.com",
        "path": "/",
        "secure": True,
        "httpOnly": name == "SESSDATA",
    })
    print("  Set cookie:", name, "=", value[:20] + "...")

wait(1)

# Verify login status
smart_open("https://api.bilibili.com/x/web-interface/nav")
wait_for_load()
wait(2)

raw = js("""
(async () => {
  try {
    var resp = await fetch("https://api.bilibili.com/x/web-interface/nav", {credentials: "include"});
    var data = await resp.json();
    return {isLogin: data.data && data.data.isLogin, uname: data.data && data.data.uname, mid: data.data && data.data.mid};
  } catch(e) { return {error: e.message}; }
})()
""")
print("Login status:", raw)

if raw and raw.get("isLogin"):
    print("\nSUCCESS: Logged in as", raw.get("uname", "unknown"))
else:
    print("\nFAILED: Not logged in. Check cookie values.")
