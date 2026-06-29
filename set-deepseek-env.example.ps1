# Copy this file to set-deepseek-env.ps1, then put your real API key and Bilibili
# cookie there.
# Run it from PowerShell with dot-sourcing so the variables stay in the current shell:
#   . .\set-deepseek-env.ps1
#
# Then start the app:
#   npm run server

$env:DEEPSEEK_API_KEY = "put-your-deepseek-api-key-here"
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
$env:DEEPSEEK_REASONING_EFFORT = "max"

# ---- Bilibili cookie (unblocks search API for Phase 2a + live coverage harvesting) ----
# Format: "SESSDATA=...; bili_jct=...; DedeUserID=..."
#
# How to get it:
#   a. Open public/export-cookie.html in a browser, follow the instructions
#   b. Or run: python extract_bilibili_cookie.py (reads from Chrome cookie DB)
#   c. Or from Chrome DevTools: Application tab > Cookies > bilibili.com
#      Copy the Value for SESSDATA, bili_jct, DedeUserID
$env:BILIBILI_COOKIE = "SESSDATA=replace-with-your-sessdata; bili_jct=replace-with-your-bili_jct; DedeUserID=replace-with-your-dedeuserid"

# ---- Admin portal token (for /admin keyword review dashboard) ----
$env:ADMIN_TOKEN = "your-admin-token-here"

if ($env:DEEPSEEK_API_KEY -eq "put-your-deepseek-api-key-here") {
  Write-Warning "Replace the placeholder in set-deepseek-env.ps1 with your real DeepSeek API key."
} else {
  Write-Host "DeepSeek environment configured for model $env:DEEPSEEK_MODEL with reasoning effort $env:DEEPSEEK_REASONING_EFFORT"
}

if ($env:BILIBILI_COOKIE -match "replace-with-your") {
  Write-Warning "BILIBILI_COOKIE has not been set - Bilibili search API (Phase 2a) and live coverage harvesting will be limited."
} else {
  Write-Host "Bilibili cookie configured (length $($env:BILIBILI_COOKIE.Length))"
}
