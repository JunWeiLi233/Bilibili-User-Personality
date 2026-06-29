# Copy this file to run-bilibili-video.links.ps1 and paste your Bilibili video links
# there. Then run:
#
#   .\run-bilibili-video.ps1
#
# The script auto-detects link types (video URL, favorite list, user space, raw UID).
# The links file is gitignored -- your URLs stay local.
#
# For dictionary-seeded search-based discovery (no links needed), pass search queries
# directly:
#
#   .\run-bilibili-video.ps1 -SearchQuery "游戏 评论区","科技 讨论" -MaxQueries 12 -DiscoveryLimit 8

# ─── PASTE YOUR BILIBILI LINKS BELOW ──────────────────────────────────────────
# Supported formats (one per line). The script auto-detects the type:
#
#   Video links:
#     "https://www.bilibili.com/video/BV1xx411c7mD"          # full URL
#     "https://www.bilibili.com/video/BV1xx/?vd_source=..."   # with tracking params
#     "bilibili.com/video/BV1xx/"                             # without https://
#     "https://b23.tv/BV1xx"                                  # short link
#
#   Favorite / collection lists:
#     "https://space.bilibili.com/12345/favlist?fid=...&ftype=create"
#     "https://space.bilibili.com/12345/medialist/67890"
#
#   User space (scrapes their recent videos):
#     "https://space.bilibili.com/1863862300"
#     "https://space.bilibili.com/3546376814200926"          # 16-digit UIDs ok
#     "space.bilibili.com/352468828"                          # without https://
#
#   Raw numeric UID:
#     "3546970553584110"
#     "128884225"
$InlineLinks = @(
    # "https://www.bilibili.com/video/BV1xx411c7mD"
    # "https://space.bilibili.com/1863862300"
)

# Optional: Bilibili cookie for authenticated scraping (SESSDATA format).
# Without this, public-only endpoints are used and some features are limited.
$InlineCookie = ""

# ─── Common CLI examples (for reference) ──────────────────────────────────────
#
# Single video link:
#   .\run-bilibili-video.ps1 -VideoLink "https://www.bilibili.com/video/BV1xx411c7mD"
#
# Single favorite list:
#   .\run-bilibili-video.ps1 -FavoriteLink "https://space.bilibili.com/1/favlist?fid=12345"
#
# Dictionary-seeded keyword discovery (scrapes Bilibili search, no links needed):
#   .\run-bilibili-video.ps1 -SearchQuery "阴阳怪气 评论区","原神 讨论" -DiscoveryLimit 8 -CommentPages 3
#
# Controversial discovery mode (finds argumentative content):
#   .\run-bilibili-video.ps1 -DiscoveryMode controversial -ControversyQuery "争议","对线" -MaxQueries 10
#
# Full coverage harvest with comment evidence required:
#   .\run-bilibili-video.ps1 -RequireCommentEvidence -ExistingTermsOnly -DiscoveryLimit 10 -MaxQueries 20
#
# Quick danmaku harvest:
#   .\run-bilibili-video.ps1 -IncludeDanmaku -CommentPages 1 -DiscoveryLimit 4
#
# Reset harvest state (start fresh):
#   .\run-bilibili-video.ps1 -ResetHarvestState -DiscoveryMode search -DiscoveryLimit 6
