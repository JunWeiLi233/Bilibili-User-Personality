Set-Location 'D:\Bilibili_User_Personality'

# Load DeepSeek + any BILIBILI_COOKIE env (if set locally).
if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
}

# ── v4 tuned config (gate AllowNewTerms to drain weak pool toward 100%) ──
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
$env:DEEPSEEK_REASONING_EFFORT = "max"

$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES = "1000"
$env:BILIBILI_HARVEST_MAX_QUERIES = "48"
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE = "1"
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = "1"
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = "4"
$env:BILIBILI_VIDEO_DISCOVERY_MODE = "search"
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = "4"
$env:BILIBILI_VIDEO_DISCOVERY_PAGES = "1"
$env:BILIBILI_VIDEO_COMMENT_PAGES = "1"
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS = "600000"
$env:BILIBILI_HARVEST_QUERY_CONCURRENCY = "5"
$env:BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER = "2"
$env:BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL = "1"

# Danmaku + comments ON (always)
$env:BILIBILI_HARVEST_INCLUDE_DANMAKU = "1"
$env:BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS = "1"
$env:BILIBILI_HARVEST_PREFILTER_COMMENTS = "1"
$env:BILIBILI_HARVEST_DEEPEN_REPLIES = "1"
$env:BILIBILI_HARVEST_DEEPEN_ROOT_LIMIT = "6"
$env:BILIBILI_HARVEST_DEEPEN_PAGES = "2"
$env:BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS = "1"
$env:BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT = "200"
$env:BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET = "1"

# Accept new keywords from the harvest process (objective requirement).
# Comments and danmaku are also fully harvested. Convergence toward 100% relies
# on PruneExhaustedAfter=2 to drain dead-weight terms faster than new-term inflow.
Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue

# Coverage audit gate: target 3 evidence/term, require complete, source+comment backed.
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = "3"
$env:BILIBILI_HARVEST_COVERAGE_MODE = "all-weak"
$env:BILIBILI_COVERAGE_AUDIT_MIN_RATIO = "1"
$env:BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES = "1"
$env:BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS = "1"

# Checkpoint cadence: snapshot to the coverage-checkpoints git branch every ~3 min
# (at cycle boundaries, so checkpoints never interrupt a running query). Combined
# with the per-cycle checkpoints this caps worst-case data loss from a power-loss
# at ~3 min of harvest progress. More snapshots = smaller loss window.
$env:BILIBILI_COVERAGE_CHECKPOINT_INTERVAL_MS = "180000"
# Keep ~24h of snapshots at 3-min cadence (480 snapshots); pruned automatically.
$env:BILIBILI_COVERAGE_CHECKPOINT_MAX_SNAPSHOTS = "480"

# Watchdog: auto-restart the loop up to 200 times, stop only after 5 consecutive
# no-progress runs. This makes the run resilient to crashes/power blips — the
# watchdog relaunches the loop from the checkpointed state each time.
$env:BILIBILI_COVERAGE_WATCHDOG_MAX_RESTARTS = "200"
$env:BILIBILI_COVERAGE_WATCHDOG_MAX_NO_PROGRESS = "5"
$env:BILIBILI_COVERAGE_WATCHDOG_BACKOFF_BASE_MS = "15000"
$env:BILIBILI_COVERAGE_WATCHDOG_BACKOFF_CAP_MS = "300000"

Write-Host "=== Watchdog coverage loop (accept new keywords + comments + danmaku) ==="
Write-Host "Target: harvest toward 100% coverage, prune dead-weight terms"
Write-Host "Watchdog: up to 200 restarts, stop after 5 no-progress runs"
Write-Host "DeepSeek model: $env:DEEPSEEK_MODEL / effort $env:DEEPSEEK_REASONING_EFFORT"

node .\server\scripts\runCoverageHarvestWatchdog.js
