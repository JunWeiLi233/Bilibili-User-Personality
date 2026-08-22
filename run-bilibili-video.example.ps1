# =============================================================================
# BILIBILI LINKS TEMPLATE — Copy this file and rename it to use.
#
#   1. Copy this file:
#        cp run-bilibili-video.example.ps1 run-bilibili-video.links.ps1
#
#   2. Replace the placeholder links below with your own Bilibili links.
#
#   3. run-bilibili-video.links.ps1 is gitignored — your links stay local.
#
#   4. Links are automatically removed from the file after they've been
#      successfully processed. You can just keep pasting new links.
#
# Supported formats (one per line):
#   - Video:       "https://www.bilibili.com/video/BVxxxxxxxxxx/"
#   - b23 short:   "https://b23.tv/xxxxxx"
#   - Space:       "https://space.bilibili.com/123456789"
#   - Raw UID:     "123456789"  or  "UID: 123456789"
#   - Favorite:    "https://space.bilibili.com/123/favlist?fid=456"
#   - Collection:  "https://www.bilibili.com/medialist/detail/ml123456"
# =============================================================================
$InlineLinks = @(
  "https://www.bilibili.com/video/BVxxxxxxxxxx/"
  "https://space.bilibili.com/123456789"
)
# =============================================================================
# Optional: fill in a Bilibili cookie to fetch more comment pages.
# Get your cookie from browser DevTools → Application → Cookies → bilibili.com
#   $InlineCookie = "SESSDATA=...; bili_jct=...; DedeUserID=..."
# =============================================================================
