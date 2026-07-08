param(
  [string[]]$SearchQuery = @(),
  [string[]]$ControversyQuery = @(),
  [int]$MaxCycles = 3,
  [int]$RoundsPerCycle = 1,
  [int]$MaxQueries = 8,
  [int]$QueryConcurrency = 1,
  [int]$DiscoveryLimit = 5,
  [int]$DiscoveryPages = 1,
  [int]$CommentPages = 2,
  [int]$QueryTimeoutSeconds = 180,
  [int]$TargetEvidence = 3,
  [double]$MinCoverageRatio = 1.0,
  [string]$CoverageMode = "all-weak",
  [string]$DiscoveryMode = "controversial",
  [switch]$AllowNewTerms,
  [switch]$StopOnNoProgress,
  [switch]$IncludeDanmaku,
  [int]$PruneExhaustedAfter = 0,
  [switch]$ResetHarvestState,
  [switch]$Strict,
  [int]$CrawlerMinDelayMs = 0,
  [int]$CrawlerJitterMs = 0,
  [string]$HarvestModel = ""
)

# ── WBI-mode coverage harvest loop (no Bilibili cookie required) ──────────────
# Uses Decodo CN residential proxy + WBI-signed search to bypass Bilibili's
# geo-restrictions and v_voucher anti-bot challenges. The harvest loop will
# auto-detect the lack of BILIBILI_COOKIE and switch to WBI search.
#
# Prerequisites:
#   1. set-deepseek-env.ps1 — DeepSeek API key
#   2. set-decodo-env.ps1  — Decodo proxy credentials

# ── Load DeepSeek credentials ──────────────────────────────────────────────────
if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 not found. DeepSeek extraction will fail unless DEEPSEEK_API_KEY is already set."
}

# ── Load Decodo proxy ──────────────────────────────────────────────────────────
if (Test-Path ".\set-decodo-env.ps1") {
  . ".\set-decodo-env.ps1"
  if ($env:BILIBILI_PROXY_LIST) {
    Write-Host "Decodo CN proxy active — WBI search will bypass v_voucher" -ForegroundColor Green
  } else {
    Write-Warning "set-decodo-env.ps1 loaded but BILIBILI_PROXY_LIST is empty. Check your Decodo credentials."
  }
} else {
  Write-Warning "set-decodo-env.ps1 not found. Copy set-decodo-env.example.ps1 and fill in your Decodo credentials."
  Write-Warning "Without a CN proxy, WBI search from non-CN IPs may be blocked by Bilibili's v_voucher."
}

# ── WBI mode (no cookie) ───────────────────────────────────────────────────────
# Explicitly clear any stale cookie so the auto-detection kicks in.
# The harvest loop's videoKeywordSearch.js will auto-detect the lack of
# BILIBILI_COOKIE and use discoverVideosByKeywordWbi() instead of the old
# search/all/v2 endpoint.
Remove-Item Env:\BILIBILI_COOKIE -ErrorAction SilentlyContinue
$env:BILIBILI_USE_WBI = "1"

# ── Model ──────────────────────────────────────────────────────────────────────
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
$env:DEEPSEEK_REASONING_EFFORT = "max"

# ── Search queries ─────────────────────────────────────────────────────────────
if ($SearchQuery.Count -gt 0) {
  $env:BILIBILI_VIDEO_SEARCH_QUERIES = ($SearchQuery -join "`n")
}
if ($ControversyQuery.Count -gt 0) {
  $env:BILIBILI_CONTROVERSY_SEARCH_QUERIES = ($ControversyQuery -join "`n")
}

# ── Loop config ────────────────────────────────────────────────────────────────
$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES = [string]$MaxCycles
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE = [string]$RoundsPerCycle
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_QUERY_CONCURRENCY = [string]$QueryConcurrency
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
$env:BILIBILI_VIDEO_DISCOVERY_PAGES = [string]$DiscoveryPages
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS = [string]($QueryTimeoutSeconds * 1000)
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode
$env:BILIBILI_COVERAGE_AUDIT_MIN_RATIO = [string]$MinCoverageRatio

if ($AllowNewTerms) {
  Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_EXISTING_TERMS_ONLY = "1"
}

if ($StopOnNoProgress) {
  $env:BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS = "1"
}
if ($IncludeDanmaku) {
  $env:BILIBILI_HARVEST_INCLUDE_DANMAKU = "1"
}
if ($ResetHarvestState) {
  $env:BILIBILI_HARVEST_RESET = "1"
}
if ($Strict) {
  $env:BILIBILI_COVERAGE_LOOP_STRICT = "1"
}
if ($HarvestModel) {
  $env:BILIBILI_HARVEST_MODEL = $HarvestModel
}

# ── Prune exhausted terms ──────────────────────────────────────────────────────
if ($PruneExhaustedAfter -gt 0) {
  $env:BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER = [string]$PruneExhaustedAfter
}

# ── Rate limiting (gentle defaults for proxy) ──────────────────────────────────
if ($CrawlerMinDelayMs -gt 0) {
  $env:BILIBILI_CRAWLER_MIN_DELAY_MS = [string]$CrawlerMinDelayMs
} else {
  $env:BILIBILI_CRAWLER_MIN_DELAY_MS = "2500"
}
if ($CrawlerJitterMs -gt 0) {
  $env:BILIBILI_CRAWLER_JITTER_MS = [string]$CrawlerJitterMs
} else {
  $env:BILIBILI_CRAWLER_JITTER_MS = "2000"
}

# ── Require source-backed + comment-backed evidence ────────────────────────────
$env:BILIBILI_HARVEST_REQUIRE_SOURCES = "1"
$env:BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES = "1"
$env:BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS = "1"

Write-Host ""
Write-Host "=== Bilibili Coverage Harvest (WBI + Decodo, NO COOKIE) ===" -ForegroundColor Cyan
Write-Host "Max cycles: $MaxCycles | Rounds/cycle: $RoundsPerCycle | Max queries: $MaxQueries"
Write-Host "Concurrency: $QueryConcurrency | Discovery limit: $DiscoveryLimit"
Write-Host "Comment pages: $CommentPages | Timeout: ${QueryTimeoutSeconds}s"
Write-Host "Target evidence: $TargetEvidence | Min coverage: $MinCoverageRatio"
Write-Host "Discovery mode: $DiscoveryMode | Coverage mode: $CoverageMode"
Write-Host "Danmaku: $IncludeDanmaku | New terms: $AllowNewTerms"
Write-Host "Prune exhausted after: $(if ($PruneExhaustedAfter -gt 0) { $PruneExhaustedAfter } else { 'off' })"
Write-Host "Proxy: $(if ($env:BILIBILI_PROXY_LIST) { 'Decodo CN' } else { 'DIRECT (may hit v_voucher)' })"
Write-Host ""

Write-Host "Auditing coverage, harvesting via WBI, repeating until gate passes or cycle limit..."
node .\server\scripts\runCoverageHarvestLoop.js
