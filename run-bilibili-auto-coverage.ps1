param(
  [string[]]$SearchQuery = @(),
  [string[]]$ControversyQuery = @(),
  [string[]]$ExtraQueryTemplate = @(),
  [int]$MaxCycles = 3,
  [int]$RoundsPerCycle = 1,
  [int]$DiscoveryLimit = 6,
  [int]$DiscoveryPages = 1,
  [int]$ControversialPopularQueryLimit = 4,
  [string]$ControversialPopularSearchOrder = "click",
  [int]$CommentPages = 2,
  [int]$QueryTimeoutSeconds = 180,
  [int]$MaxQueries = 12,
  [int]$QueryConcurrency = 1,
  [int]$TermsPerFamily = 4,
  [int]$QueryVariantsPerTerm = 2,
  [int]$RetryBeforeUnattemptedLimit = 3,
  [int]$MaxHardMissedQueries = 0,
  [int]$StaleMissedDiscoveryLimit = 4,
  [int]$StaleMissedCommentPages = 3,
  [int]$TargetEvidence = 3,
  [double]$MinCoverageRatio = 1.0,
  [ValidateSet("balanced", "all-weak")]
  [string]$CoverageMode = "all-weak",
  [ValidateSet("search", "popular", "mixed", "controversial")]
  [string]$DiscoveryMode = "controversial",
  [switch]$AllowNewTerms,
  [switch]$AllowUnsourcedEvidence,
  [switch]$AllowContextOnlyEvidence,
  [switch]$StopOnNoProgress,
  [switch]$IncludeGenericPopular,
  [switch]$NoDanmaku,
  [switch]$NoCommentTargetExpansion,
  [switch]$NoPreFilter,
  [switch]$NoDeepenReplies,
  [switch]$NoCommentPoolTargets,
  [int]$CommentPoolTargetLimit = 200,
  [int]$DeepenRootLimit = 6,
  [int]$DeepenPages = 2,
  [string]$HarvestModel = "",
  [switch]$NoNearTarget,
  [int]$PruneExhaustedAfter = 0,
  [switch]$PruneIncludePartial,
  [switch]$ResetHarvestState,
  [switch]$Strict,
  [switch]$Firecrawl,
  [switch]$CorpusMining,
  [int]$CrawlerBlockCooldownMs = 0,
  [int]$CrawlerMinDelayMs = 0,
  [int]$CrawlerJitterMs = 0,
  [int]$CrawlerCacheTtlMs = 0,
  [int]$CrawlerRateBurst = 0,
  [int]$CrawlerRateSustain = 0,
  [string]$BilibiliCookie = ""
)

# Runs the backend coverage loop. It audits weak dictionary terms, exports priority
# queries, harvests Bilibili comments, and repeats until coverage passes or MaxCycles is reached.

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 was not found. DeepSeek extraction will use the local fallback unless DEEPSEEK_API_KEY is already set."
}

$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
$env:DEEPSEEK_REASONING_EFFORT = "max"

if ($SearchQuery.Count -gt 0) {
  $env:BILIBILI_VIDEO_SEARCH_QUERIES = ($SearchQuery -join "`n")
} else {
  Remove-Item Env:\BILIBILI_VIDEO_SEARCH_QUERIES -ErrorAction SilentlyContinue
}
if ($ControversyQuery.Count -gt 0) {
  $env:BILIBILI_CONTROVERSY_SEARCH_QUERIES = ($ControversyQuery -join "`n")
} else {
  Remove-Item Env:\BILIBILI_CONTROVERSY_SEARCH_QUERIES -ErrorAction SilentlyContinue
}
if ($ExtraQueryTemplate.Count -gt 0) {
  $env:BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES = ($ExtraQueryTemplate -join "`n")
} else {
  Remove-Item Env:\BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES -ErrorAction SilentlyContinue
}

$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES = [string]$MaxCycles
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE = [string]$RoundsPerCycle
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
$env:BILIBILI_VIDEO_DISCOVERY_PAGES = [string]$DiscoveryPages
$env:BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT = [string]$ControversialPopularQueryLimit
$env:BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER = $ControversialPopularSearchOrder
if ($IncludeGenericPopular) {
  $env:BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR = "1"
} else {
  Remove-Item Env:\BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR -ErrorAction SilentlyContinue
}
if ($NoDanmaku) {
  Remove-Item Env:\BILIBILI_HARVEST_INCLUDE_DANMAKU -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_INCLUDE_DANMAKU = "1"
}
if ($NoCommentTargetExpansion) {
  Remove-Item Env:\BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS = "1"
}
# Corpus-mode yield mechanisms: pre-filter, reply-tree deepening, and comment-pool
# targeting are on by default because they materially raise per-cycle yield on the
# niche-slang tail. Use the -No* switches to opt out.
if ($NoPreFilter) {
  Remove-Item Env:\BILIBILI_HARVEST_PREFILTER_COMMENTS -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_PREFILTER_COMMENTS = "1"
}
if ($NoDeepenReplies) {
  Remove-Item Env:\BILIBILI_HARVEST_DEEPEN_REPLIES -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_DEEPEN_REPLIES = "1"
  $env:BILIBILI_HARVEST_DEEPEN_ROOT_LIMIT = [string]$DeepenRootLimit
  $env:BILIBILI_HARVEST_DEEPEN_PAGES = [string]$DeepenPages
}
if ($NoCommentPoolTargets) {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS = "1"
  $env:BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT = [string]$CommentPoolTargetLimit
}
if ($HarvestModel) {
  $env:BILIBILI_HARVEST_MODEL = $HarvestModel
}
# Near-target prioritization (resolve one-evidence-away terms first) is on by default.
if ($NoNearTarget) {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET = "1"
}
# Prune-after-N-tries: drop terms that stay un-attestable after this many harvest
# attempts, so coverage can converge toward 100%. 0 disables pruning.
if ($PruneExhaustedAfter -gt 0) {
  $env:BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER = [string]$PruneExhaustedAfter
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER -ErrorAction SilentlyContinue
}
if ($PruneIncludePartial) {
  $env:BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL -ErrorAction SilentlyContinue
}
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS = [string]($QueryTimeoutSeconds * 1000)
$queryTimeoutMs = $QueryTimeoutSeconds * 1000

# ── Crawler rate-limit tuning ──────────────────────────────────────────────
# Params (-Crawler*) override auto-computed values. Auto-computed values
# have a raised floor to avoid being more aggressive than the crawler defaults.
# The env var always wins if already set (back-compat).

if ($BilibiliCookie) {
  $env:BILIBILI_COOKIE = $BilibiliCookie
}

if (-not $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS) {
  if ($CrawlerBlockCooldownMs -gt 0) {
    $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS = [string]$CrawlerBlockCooldownMs
  } else {
    $cooldownMs = [Math]::Max(60000, [Math]::Floor($queryTimeoutMs / 3))
    $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS = [string]$cooldownMs
  }
}
if (-not $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS) {
  $strictRequestTimeoutMs = [Math]::Max(5000, [Math]::Floor($queryTimeoutMs / 2))
  $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS = [string]$strictRequestTimeoutMs
}
if (-not $env:BILIBILI_CRAWLER_MIN_DELAY_MS) {
  if ($CrawlerMinDelayMs -gt 0) {
    $env:BILIBILI_CRAWLER_MIN_DELAY_MS = [string]$CrawlerMinDelayMs
  } else {
    $delayMs = [Math]::Max(2500, [Math]::Floor($queryTimeoutMs / 60))
    $env:BILIBILI_CRAWLER_MIN_DELAY_MS = [string]$delayMs
  }
}
if (-not $env:BILIBILI_CRAWLER_JITTER_MS) {
  if ($CrawlerJitterMs -gt 0) {
    $env:BILIBILI_CRAWLER_JITTER_MS = [string]$CrawlerJitterMs
  } else {
    $jitterMs = [Math]::Max(1500, [Math]::Floor($queryTimeoutMs / 120))
    $env:BILIBILI_CRAWLER_JITTER_MS = [string]$jitterMs
  }
}
if ($CrawlerCacheTtlMs -gt 0 -and -not $env:BILIBILI_CRAWLER_CACHE_TTL_MS) {
  $env:BILIBILI_CRAWLER_CACHE_TTL_MS = [string]$CrawlerCacheTtlMs
}
if ($CrawlerRateBurst -gt 0 -and -not $env:BILIBILI_RATE_BURST) {
  $env:BILIBILI_RATE_BURST = [string]$CrawlerRateBurst
}
if ($CrawlerRateSustain -gt 0 -and -not $env:BILIBILI_RATE_SUSTAIN) {
  $env:BILIBILI_RATE_SUSTAIN = [string]$CrawlerRateSustain
}
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = [string]$TermsPerFamily
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = [string]$QueryVariantsPerTerm
$env:BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT = [string]$RetryBeforeUnattemptedLimit
if ($MaxHardMissedQueries -gt 0) {
  $env:BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES = [string]$MaxHardMissedQueries
} else {
  Remove-Item Env:\BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES -ErrorAction SilentlyContinue
}
$env:BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT = [string]$StaleMissedDiscoveryLimit
$env:BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES = [string]$StaleMissedCommentPages
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_HARVEST_QUERY_CONCURRENCY = [string]$QueryConcurrency

if ($Firecrawl) {
  $env:FIRECRAWL_ENABLED = "1"
  Write-Host "Firecrawl tier enabled (http://localhost:3002)"
}
if ($CorpusMining) {
  $env:CORPUS_MINING_ENABLED = "1"
  Write-Host "Offline corpus mining enabled"
}

$env:BILIBILI_COVERAGE_AUDIT_MIN_RATIO = [string]$MinCoverageRatio
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode

if ($AllowNewTerms) {
  Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_EXISTING_TERMS_ONLY = "1"
}
if ($AllowUnsourcedEvidence) {
  Remove-Item Env:\BILIBILI_HARVEST_REQUIRE_SOURCES -ErrorAction SilentlyContinue
  Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES -ErrorAction SilentlyContinue
  Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_REQUIRE_SOURCES = "1"
  $env:BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES = "1"
  if ($AllowContextOnlyEvidence) {
    Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS -ErrorAction SilentlyContinue
  } else {
    $env:BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS = "1"
  }
}
if ($StopOnNoProgress) {
  $env:BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS -ErrorAction SilentlyContinue
}
if ($ResetHarvestState) {
  $env:BILIBILI_HARVEST_RESET = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_RESET -ErrorAction SilentlyContinue
}
if ($Strict) {
  $env:BILIBILI_COVERAGE_LOOP_STRICT = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_LOOP_STRICT -ErrorAction SilentlyContinue
}

Write-Host "Backend Bilibili dictionary coverage loop"
Write-Host "Max cycles: $MaxCycles"
Write-Host "Rounds per cycle: $RoundsPerCycle"
Write-Host "Max harvest queries per cycle: $MaxQueries"
Write-Host "Per-cycle query concurrency: $QueryConcurrency"
Write-Host "Retry-before-unattempted limit: $RetryBeforeUnattemptedLimit"
Write-Host "Max hard missed queries: $(if ($MaxHardMissedQueries -gt 0) { $MaxHardMissedQueries } else { 'auto' })"
Write-Host "Stale missed discovery limit: $StaleMissedDiscoveryLimit"
Write-Host "Stale missed comment pages: $StaleMissedCommentPages"
Write-Host "Min coverage ratio: $MinCoverageRatio"
Write-Host "Target evidence per term: $TargetEvidence"
Write-Host "Coverage mode: $CoverageMode"
Write-Host "Discovery mode: $DiscoveryMode"
Write-Host "Discovery limit: $DiscoveryLimit"
Write-Host "Discovery pages: $DiscoveryPages"
Write-Host "Comment pages per video: $CommentPages"
Write-Host "Per-query timeout: ${QueryTimeoutSeconds}s"
Write-Host "Controversial popular query limit: $ControversialPopularQueryLimit"
Write-Host "Controversial popular search order: $ControversialPopularSearchOrder"
Write-Host "Include generic popular feed in controversial mode: $IncludeGenericPopular"
Write-Host "Include public danmaku in video scans: $(!$NoDanmaku)"
Write-Host "Expand weak targets from collected comments: $(!$NoCommentTargetExpansion)"
Write-Host "Pre-filter comments to dictionary terms: $(!$NoPreFilter)"
Write-Host "Deepen reply threads of term-bearing comments: $(!$NoDeepenReplies) (roots $DeepenRootLimit, pages $DeepenPages)"
Write-Host "Priority comment-pool targets: $(!$NoCommentPoolTargets) (limit $CommentPoolTargetLimit)"
Write-Host "Prioritize near-target (one-away) terms: $(!$NoNearTarget)"
Write-Host "Prune exhausted terms after N attempts: $(if ($PruneExhaustedAfter -gt 0) { $PruneExhaustedAfter } else { 'off' })$(if ($PruneIncludePartial) { ' (incl. partial)' } else { '' })"
Write-Host "Harvest validation model: $(if ($HarvestModel) { $HarvestModel } else { 'deepseek-v4-flash (default)' })"
Write-Host "Existing dictionary terms only: $(!$AllowNewTerms)"
Write-Host "Require Bilibili evidence sources: $(!$AllowUnsourcedEvidence)"
Write-Host "Require Bilibili comment evidence: $(!$AllowUnsourcedEvidence -and !$AllowContextOnlyEvidence)"
Write-Host "Reset harvest state: $ResetHarvestState"
Write-Host "Offline corpus mining: $(if ($CorpusMining) { 'yes (Phase 0)' } else { 'no' })"
Write-Host "DeepSeek model: $env:DEEPSEEK_MODEL"
Write-Host "DeepSeek reasoning effort: $env:DEEPSEEK_REASONING_EFFORT"
Write-Host ""

if ($CorpusMining) {
  Write-Host "Mining offline corpora, then harvesting priority queries, and repeating until the gate passes or the cycle limit is reached..."
  node .\server\scripts\runCorpusMiningLoop.js
} else {
  Write-Host "Auditing coverage, harvesting priority queries, and repeating until the gate passes or the cycle limit is reached..."
  node .\server\scripts\runCoverageHarvestLoop.js
}
