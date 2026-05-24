param(
  [string[]]$SearchQuery = @(),
  [int]$DiscoveryLimit = 6,
  [int]$CommentPages = 2
)

# Runs backend video discovery and keyword training without manually entering Bilibili video links.
# Example:
#   .\run-bilibili-video.ps1
#   .\run-bilibili-video.ps1 -SearchQuery "your search term 1","your search term 2" -DiscoveryLimit 8 -CommentPages 3

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 was not found. DeepSeek extraction will use the local fallback unless DEEPSEEK_API_KEY is already set."
}

if ($SearchQuery.Count -gt 0) {
  $env:BILIBILI_VIDEO_SEARCH_QUERIES = ($SearchQuery -join "`n")
} else {
  Remove-Item Env:\BILIBILI_VIDEO_SEARCH_QUERIES -ErrorAction SilentlyContinue
}
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages

Write-Host "Backend Bilibili video discovery queries:"
if ($SearchQuery.Count -gt 0) {
  $SearchQuery | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host " - using backend default search query"
}
Write-Host "Discovery limit: $DiscoveryLimit"
Write-Host "Comment pages per video: $CommentPages"
Write-Host ""
Write-Host "Discovering videos, scanning comments, and training the local keyword dictionary..."

node .\server\runVideoKeywordDiscovery.js
