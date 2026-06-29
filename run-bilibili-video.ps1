param(
  [string[]]$SearchQuery = @(),
  [string]$SearchQueryFile = "",
  [string]$PriorityQueryFile = "",
  [string]$PriorityActionFile = "",
  [string]$VideoLink = "",
  [string]$FavoriteLink = "",
  [string]$BilibiliCookie = "",
  [string[]]$ControversyQuery = @(),
  [string[]]$ExtraQueryTemplate = @(),
  [int]$DiscoveryLimit = 6,
  [int]$ControversialPopularQueryLimit = 4,
  [string]$ControversialPopularSearchOrder = "click",
  [int]$CommentPages = 2,
  [int]$MaxQueries = 12,
  [int]$TermsPerFamily = 4,
  [int]$QueryVariantsPerTerm = 2,
  [int]$RetryBeforeUnattemptedLimit = 3,
  [int]$StaleMissedDiscoveryLimit = 4,
  [int]$StaleMissedCommentPages = 3,
  [int]$TargetEvidence = 3,
  [int]$QueryTimeoutMs = 180000,
  [int]$Rounds = 1,
  [ValidateSet("balanced", "all-weak")]
  [string]$CoverageMode = "all-weak",
  [ValidateSet("search", "popular", "mixed", "controversial")]
  [string]$DiscoveryMode = "controversial",
  [switch]$RequireEvidenceSources,
  [switch]$RequireCommentEvidence,
  [switch]$ExistingTermsOnly,
  [switch]$IncludeDanmaku,
  [switch]$NoDanmaku,
  [switch]$IncludeGenericPopular,
  [switch]$SkipPriorityActionRefresh,
  [switch]$ResetHarvestState,
  [switch]$Force,
  [switch]$ResetMemory,
  [switch]$FriendshipCrawl,
  [switch]$FriendshipDeep,
  [string]$FriendshipMaxFollower = "50000",
  [int]$FriendshipMaxUsers = 20
)

# Runs dictionary-seeded backend video discovery and keyword training without manually entering Bilibili video links.
# Example:
#   .\run-bilibili-video.ps1
#   .\run-bilibili-video.ps1 -SearchQuery "your search term 1","your search term 2" -MaxQueries 20 -DiscoveryLimit 8 -CommentPages 3
#
# =============================================================================
# PASTE YOUR LINKS in run-bilibili-video.links.ps1 (gitignored — stays local).
# =============================================================================
$InlineLinks = @()
$InlineCookie = ""
if (Test-Path ".\run-bilibili-video.links.ps1") {
  . ".\run-bilibili-video.links.ps1"
} else {
  Write-Warning "run-bilibili-video.links.ps1 not found — no inline links loaded."
  Write-Warning "See run-bilibili-video.example.ps1 for the template. Copy it:"
  Write-Warning "  cp run-bilibili-video.example.ps1 run-bilibili-video.links.ps1"
}
# =============================================================================
#
# Also supports command-line overrides:
#   .\run-bilibili-video.ps1 -VideoLink "https://www.bilibili.com/video/BV..."
#   .\run-bilibili-video.ps1 -SearchQuery "阴阳怪气 评论区" -MaxQueries 20

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
if ($SearchQueryFile) {
  $env:BILIBILI_VIDEO_SEARCH_QUERY_FILE = $SearchQueryFile
} else {
  Remove-Item Env:\BILIBILI_VIDEO_SEARCH_QUERY_FILE -ErrorAction SilentlyContinue
}
if ($PriorityQueryFile) {
  $env:BILIBILI_HARVEST_PRIORITY_QUERY_FILE = $PriorityQueryFile
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITY_QUERY_FILE -ErrorAction SilentlyContinue
}
if ($PriorityActionFile) {
  $env:BILIBILI_HARVEST_PRIORITY_ACTION_FILE = $PriorityActionFile
  $env:BILIBILI_COVERAGE_ACTION_FILE_PATH = $PriorityActionFile
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITY_ACTION_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:\BILIBILI_COVERAGE_ACTION_FILE_PATH -ErrorAction SilentlyContinue
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
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
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
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = [string]$TermsPerFamily
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = [string]$QueryVariantsPerTerm
$effectiveRetryBeforeUnattemptedLimit = $RetryBeforeUnattemptedLimit
if ($RequireCommentEvidence -and -not $PSBoundParameters.ContainsKey("RetryBeforeUnattemptedLimit")) {
  $effectiveRetryBeforeUnattemptedLimit = 1
}
$env:BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT = [string]$effectiveRetryBeforeUnattemptedLimit
$env:BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT = [string]$StaleMissedDiscoveryLimit
$env:BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES = [string]$StaleMissedCommentPages
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS = [string]$QueryTimeoutMs
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS) {
  $strictCooldownMs = [Math]::Max(1000, [Math]::Floor($QueryTimeoutMs / 10))
  $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS = [string]$strictCooldownMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS) {
  $strictRequestTimeoutMs = [Math]::Max(5000, [Math]::Floor($QueryTimeoutMs / 2))
  $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS = [string]$strictRequestTimeoutMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_MIN_DELAY_MS) {
  $strictMinDelayMs = [Math]::Max(200, [Math]::Floor($QueryTimeoutMs / 100))
  $env:BILIBILI_CRAWLER_MIN_DELAY_MS = [string]$strictMinDelayMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_JITTER_MS) {
  $strictJitterMs = [Math]::Max(100, [Math]::Floor($QueryTimeoutMs / 200))
  $env:BILIBILI_CRAWLER_JITTER_MS = [string]$strictJitterMs
}
$env:BILIBILI_HARVEST_ROUNDS = [string]$Rounds
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode
if ($RequireEvidenceSources -or $RequireCommentEvidence) {
  $env:BILIBILI_HARVEST_REQUIRE_SOURCES = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_REQUIRE_SOURCES -ErrorAction SilentlyContinue
}
if ($RequireCommentEvidence) {
  $env:BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS -ErrorAction SilentlyContinue
}
if ($ExistingTermsOnly) {
  $env:BILIBILI_HARVEST_EXISTING_TERMS_ONLY = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue
}
if ($ResetHarvestState) {
  $env:BILIBILI_HARVEST_RESET = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_RESET -ErrorAction SilentlyContinue
}

Write-Host "Backend Bilibili video discovery queries:"
if ($SearchQuery.Count -gt 0) {
  $SearchQuery | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host " - using backend default search query"
}
if ($SearchQueryFile) {
  Write-Host "Search query file: $SearchQueryFile"
}
if ($PriorityQueryFile) {
  Write-Host "Priority query file: $PriorityQueryFile"
}
if ($PriorityActionFile) {
  Write-Host "Priority action file: $PriorityActionFile"
}
if ($DiscoveryMode -eq "controversial") {
  Write-Host "Controversy discovery queries:"
  if ($ControversyQuery.Count -gt 0) {
    $ControversyQuery | ForEach-Object { Write-Host " - $_" }
  } else {
    Write-Host " - using backend default controversy seeds"
  }
}
Write-Host "Discovery limit: $DiscoveryLimit"
Write-Host "Controversial popular query limit: $ControversialPopularQueryLimit"
Write-Host "Controversial popular search order: $ControversialPopularSearchOrder"
Write-Host "Include generic popular feed in controversial mode: $IncludeGenericPopular"
Write-Host "Include public danmaku in video scans: $(!$NoDanmaku)"
Write-Host "Comment pages per video: $CommentPages"
Write-Host "Max harvest queries: $MaxQueries"
Write-Host "Dictionary terms per family: $TermsPerFamily"
Write-Host "Query variants per term: $QueryVariantsPerTerm"
Write-Host "Retry-before-unattempted limit: $effectiveRetryBeforeUnattemptedLimit"
Write-Host "Stale missed discovery limit: $StaleMissedDiscoveryLimit"
Write-Host "Stale missed comment pages: $StaleMissedCommentPages"
Write-Host "Extra query templates: $($ExtraQueryTemplate.Count)"
Write-Host "Target evidence per term: $TargetEvidence"
Write-Host "Per-query timeout ms: $QueryTimeoutMs"
Write-Host "Harvest rounds: $Rounds"
Write-Host "Coverage mode: $CoverageMode"
Write-Host "Discovery mode: $DiscoveryMode"
Write-Host "Require evidence sources: $($RequireEvidenceSources -or $RequireCommentEvidence)"
Write-Host "Require Bilibili comment evidence: $RequireCommentEvidence"
Write-Host "Existing dictionary terms only: $ExistingTermsOnly"
Write-Host "Reset harvest state: $ResetHarvestState"
Write-Host "Refresh priority action file: $($PriorityActionFile -and -not $SkipPriorityActionRefresh)"
Write-Host ""

if ($PriorityActionFile -and -not $SkipPriorityActionRefresh) {
  Write-Host "Refreshing priority action file from current dictionary coverage..."
  $previousMaxActions = $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS
  $previousStrict = $env:BILIBILI_COVERAGE_AUDIT_STRICT
  if (-not $previousMaxActions) {
    $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS = [string]([Math]::Max(20, $MaxQueries * 4))
  }
  $env:BILIBILI_COVERAGE_AUDIT_STRICT = "0"
  node .\server\scripts\runDictionaryCoverageAudit.js
  $coverageExitCode = $LASTEXITCODE
  if ($previousMaxActions) {
    $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS = $previousMaxActions
  } else {
    Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS -ErrorAction SilentlyContinue
  }
  if ($previousStrict) {
    $env:BILIBILI_COVERAGE_AUDIT_STRICT = $previousStrict
  } else {
    Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_STRICT -ErrorAction SilentlyContinue
  }
  if ($coverageExitCode -ne 0) {
    exit $coverageExitCode
  }
  Write-Host ""
}

$allLinks = @()
# Gather from inline list
foreach ($link in $InlineLinks) {
  $trimmed = $link.Trim()
  if ($trimmed -and -not $trimmed.StartsWith("#")) { $allLinks += $trimmed }
}
# Gather from command-line params
if ($VideoLink) { $allLinks += $VideoLink }
if ($FavoriteLink) { $allLinks += $FavoriteLink }

# Track friendship-crawl UID files for post-processing
$friendshipUidFiles = @()

if ($allLinks.Count -gt 0) {
  # ── Scraper link memory: skip already-analyzed links unless -Force ──────
  $memoryFile = ".\server\data\scraper_link_memory.json"
  if ($ResetMemory -and (Test-Path $memoryFile)) {
    Remove-Item $memoryFile
    Write-Host "Memory reset."
  }
  $memory = if ((-not $Force) -and (Test-Path $memoryFile)) {
    Get-Content $memoryFile -Raw | ConvertFrom-Json
  } else {
    $null
  }

  foreach ($link in $allLinks) {
    # Normalize: strip leading/trailing whitespace
    $normalized = $link.Trim()

    # Detect link type (order matters — check favorites before generic space URLs)
    $isFav    = $normalized -match "(medialist|favlist|collectId)"
    $isSpace  = $normalized -match "space\.bilibili\.com/(\d+)"
    $isB23    = $normalized -match "b23\.tv/"
    # A raw numeric UID: the entire string is digits (optionally starting with "UID:" or "mid:")
    $isUid    = $normalized -match "^(?:UID\s*(?::|\uFF1A)?\s*)?(?:mid\s*(?::|\uFF1A)?\s*)?(\d{4,})$"
    $uidMatch = if ($isUid) { $matches[1] } else { "" }
    $spaceUid = if ($isSpace) { $matches[1] } else { "" }

    # ── Memory check: skip if already analyzed ──────────────────────────
    if ($memory) {
      $memType = ""
      $memId   = ""
      if ($isFav) {
        $memType = "favorite"
        $favFidMatch = $normalized -match "[?&]fid=(\d+)"
        $memId = if ($favFidMatch) { $matches[1] } else { $normalized }
      } elseif ($isUid) {
        $memType = "uid"
        $memId   = $uidMatch
      } elseif ($isSpace) {
        $memType = "uid"
        $memId   = $spaceUid
      } elseif ($isB23) {
        $memType = "video"
        $memId   = $normalized
      } else {
        $memType = "video"
        $bvidMatch = $normalized -match "BV[a-zA-Z0-9]{10}"
        $memId = if ($bvidMatch) { $matches[0] } else { $normalized }
      }

      $memKey = "${memType}:${memId}"
      if ($memory.entries.PSObject.Properties.Name -contains $memKey) {
        $entry = $memory.entries.$memKey
        Write-Host "Direct link: $normalized"
        Write-Host "  -> Already analyzed on $($entry.processedAt), skipping (use -Force to re-process)"
        Write-Host ""
        continue
      }
    }

    Write-Host "Direct link: $normalized"
    $nodeArgs = @(".\server\scripts\runVideoLinkDirect.js")
    if ($isFav) {
      Write-Host "  -> Detected as favorite / collection link"
      $nodeArgs += "--favorite-link"; $nodeArgs += $normalized
    } elseif ($isSpace) {
      Write-Host "  -> Detected as user space (UID: $spaceUid)"
      $nodeArgs += "--uid"; $nodeArgs += $spaceUid
    } elseif ($isUid) {
      Write-Host "  -> Detected as raw UID: $uidMatch"
      $nodeArgs += "--uid"; $nodeArgs += $uidMatch
    } elseif ($isB23) {
      Write-Host "  -> Detected as b23.tv short link"
      $nodeArgs += "--video-link"; $nodeArgs += $normalized
    } else {
      Write-Host "  -> Detected as video link"
      $nodeArgs += "--video-link"; $nodeArgs += $normalized
    }
    if ($InlineCookie) { $nodeArgs += "--cookie"; $nodeArgs += $InlineCookie }
    if ($BilibiliCookie) { $nodeArgs += "--cookie"; $nodeArgs += $BilibiliCookie }
    if ($CommentPages) { $nodeArgs += "--pages"; $nodeArgs += $CommentPages }

    # ── Friendship crawl: export commenter UIDs from this UID ─────────────────
    if ($FriendshipCrawl -and ($isSpace -or $isUid)) {
      $uidFile = [System.IO.Path]::GetTempFileName()
      $env:FRIENDSHIP_OUTPUT_UID_FILE = $uidFile
      $friendshipUidFiles += @{ uid = if ($isSpace) { $spaceUid } else { $uidMatch }; file = $uidFile }
    } else {
      Remove-Item Env:\FRIENDSHIP_OUTPUT_UID_FILE -ErrorAction SilentlyContinue
    }

    # ── Spinner animation while node processes the link ──────────────────────
    $tmpOut = New-TemporaryFile
    $tmpErr = New-TemporaryFile
    $proc = Start-Process -FilePath "node" -ArgumentList $nodeArgs -NoNewWindow -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr

    $spin  = @('|', '/', '-', '\')
    $frame = 0
    while (-not $proc.HasExited) {
        Write-Host "`r  Processing... $($spin[$frame % 4])" -NoNewline
        Start-Sleep -Milliseconds 250
        $frame++
    }
    $proc.WaitForExit()
    Write-Host "`r  Done.                   "

    # Print captured output
    if ((Get-Item $tmpOut).Length -gt 0) { Get-Content $tmpOut | ForEach-Object { Write-Host $_ } }
    if ((Get-Item $tmpErr).Length -gt 0) { Get-Content $tmpErr | ForEach-Object { Write-Host $_ } }

    # Surface non-zero exit
    if ($proc.ExitCode -ne 0) { Write-Warning "node exited with code $($proc.ExitCode)" }

    # Cleanup temp files
    Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
    Write-Host ""
  }

  # ── Auto-remove successfully processed links from the links file ──────
  $linksFile = ".\run-bilibili-video.links.ps1"
  if (Test-Path $linksFile) {
    # Re-read memory (node may have updated it after successful processing)
    $updatedMemory = if (Test-Path $memoryFile) {
      Get-Content $memoryFile -Raw | ConvertFrom-Json
    } else { $null }

    # Build set of normalized links whose memory entries exist
    $processedNormalized = @{}
    foreach ($link in $allLinks) {
      $n = $link.Trim()
      $isFav2    = $n -match "(medialist|favlist|collectId)"
      $isSpace2  = $n -match "space\.bilibili\.com/(\d+)"
      $isB232    = $n -match "b23\.tv/"
      $isUid2    = $n -match "^(?:UID\s*(?::|\uFF1A)?\s*)?(?:mid\s*(?::|\uFF1A)?\s*)?(\d{4,})$"
      $uidMatch2 = if ($isUid2) { $matches[1] } else { "" }
      $spaceUid2 = if ($isSpace2) { $matches[1] } else { "" }

      $memType2 = ""
      $memId2   = ""
      if ($isFav2) {
        $memType2 = "favorite"
        $favFidMatch2 = $n -match "[?&]fid=(\d+)"
        $memId2 = if ($favFidMatch2) { $matches[1] } else { $n }
      } elseif ($isUid2) {
        $memType2 = "uid"
        $memId2   = $uidMatch2
      } elseif ($isSpace2) {
        $memType2 = "uid"
        $memId2   = $spaceUid2
      } elseif ($isB232) {
        $memType2 = "video"
        $memId2   = $n
      } else {
        $memType2 = "video"
        $bvidMatch2 = $n -match "BV[a-zA-Z0-9]{10}"
        $memId2 = if ($bvidMatch2) { $matches[0] } else { $n }
      }

      $memKey2 = "${memType2}:${memId2}"
      if ($updatedMemory -and $updatedMemory.entries.PSObject.Properties.Name -contains $memKey2) {
        $processedNormalized[$n] = $true
      }
    }

    if ($processedNormalized.Count -gt 0) {
      $linksContent = Get-Content $linksFile -Raw
      foreach ($pl in $processedNormalized.Keys) {
        $escaped = [Regex]::Escape($pl)
        $linksContent = $linksContent -replace "(?m)^[ \t]*`"$escaped`",?[ \t]*\r?\n", ""
      }
      # Collapse triple+ blank lines to double
      $linksContent = $linksContent -replace "\r?\n\r?\n\r?\n+", "`r`n`r`n"
      $linksContent = $linksContent.TrimEnd() + "`r`n"
      Set-Content $linksFile -Value $linksContent -NoNewline
      Write-Host "Removed $($processedNormalized.Count) processed link(s) from run-bilibili-video.links.ps1"
    }
  }

  # Clean up stale FRIENDSHIP_OUTPUT_UID_FILE after link loop
  Remove-Item Env:\FRIENDSHIP_OUTPUT_UID_FILE -ErrorAction SilentlyContinue

  # ── FRIENDSHIP CRAWL PHASE ──────────────────────────────────────────────────────
  if ($FriendshipCrawl -and $friendshipUidFiles.Count -gt 0) {
    Write-Host "`n--- FRIENDSHIP CRAWL PHASE ---"

    foreach ($entry in $friendshipUidFiles) {
      $seedUid = $entry.uid
      $uidFile = $entry.file

      # Check if UID file was written (commenter UIDs found)
      if (-not (Test-Path $uidFile)) {
        Write-Host "  UID ${seedUid}: no commenter data available, skipping"
        continue
      }
      $uidContent = Get-Content $uidFile -Raw -ErrorAction SilentlyContinue
      if (-not $uidContent) {
        Write-Host "  UID ${seedUid}: empty commenter data, skipping"
        continue
      }
      $uidData = $uidContent | ConvertFrom-Json
      $commenterCount = ($uidData.commenterUids | Measure-Object).Count
      if ($commenterCount -eq 0) {
        Write-Host "  UID ${seedUid}: no commenters discovered ($commenterCount), skipping"
        continue
      }

      # Check memory (friendship output already exists?)
      $friendshipOutput = ".claude/friendship_harvest/output_${seedUid}.json"
      if ((-not $Force) -and (Test-Path $friendshipOutput)) {
        Write-Host "  UID ${seedUid}: friendship output already exists, skipping (use -Force to re-crawl)"
        continue
      }

      Write-Host "  UID ${seedUid}: $commenterCount commenter UIDs discovered — launching friendship crawl"

      # Set env vars for the friendship scraper
      $env:FRIENDSHIP_SEED_URL = "https://space.bilibili.com/$seedUid"
      $env:FRIENDSHIP_SEED_UIDS_FILE = $uidFile
      $env:FRIENDSHIP_MAX_FOLLOWER = $FriendshipMaxFollower
      $env:FRIENDSHIP_MAX_USERS = [string]$FriendshipMaxUsers
      if ($FriendshipDeep) {
        $env:FRIENDSHIP_MAX_DEPTH = "3"
      } else {
        Remove-Item Env:\FRIENDSHIP_MAX_DEPTH -ErrorAction SilentlyContinue
      }

      # Ensure PYTHONUTF8 for Windows encoding
      $env:PYTHONUTF8 = "1"

      # Run browser-harness CDP friendship scraper
      Write-Host "    Running browser-harness CDP scraper..."

      # Remove stale .env that poisons BU_CDP_URL (left by previous --setup-chrome runs)
      Remove-Item "C:\Users\Junwei\Downloads\browser-harness\.env" -ErrorAction SilentlyContinue
      # Clear stale BU_CDP_URL so --silent auto-start fires
      Remove-Item Env:\BU_CDP_URL -ErrorAction SilentlyContinue
      $env:BU_SILENT = "1"

      # Pass Bilibili cookies as fallback for js_fetch() when CDP browser cookies
      # aren't available (e.g. temp Chrome profile without prior Bilibili login)
      if ($InlineCookie) {
        $env:BILIBILI_COOKIE = $InlineCookie
      }

      $harnessOut = New-TemporaryFile
      $harnessExit = 0
      try {
        browser-harness --silent -c "exec(open(r'D:/Bilibili_User_Personality/.claude/friendship_scraper.py', encoding='utf-8').read()); main()" *>&1 | Tee-Object -FilePath $harnessOut.FullName
        $harnessExit = $LASTEXITCODE
      } catch {
        Write-Host "    browser-harness failed: $_"
        Write-Host "    (skip this seed and continue)"
        $harnessExit = -1
      }

      if ($harnessExit -eq 0 -and (Test-Path $friendshipOutput)) {
        # Feed friendship harvest into dictionary expansion
        Write-Host "    Feeding harvest into dictionary expansion..."
        $env:EXPAND_WRITE = "1"
        $prevExpandMax = $env:EXPAND_MAX_CHARS
        $env:EXPAND_MAX_CHARS = "50000"
        node .\server\scripts\expandDictionaryFromCDPHarvest.js
        if ($prevExpandMax) { $env:EXPAND_MAX_CHARS = $prevExpandMax }
        else { Remove-Item Env:\EXPAND_MAX_CHARS -ErrorAction SilentlyContinue }
        Remove-Item Env:\EXPAND_WRITE -ErrorAction SilentlyContinue

        Write-Host "    Friendship crawl for UID $seedUid complete"
      } elseif ($harnessExit -ne 0) {
        Write-Host "    Friendship crawl for UID $seedUid failed (exit code $harnessExit)"
      } else {
        Write-Host "    Friendship crawl produced no output for UID $seedUid"
      }

      # Clean up env vars
      Remove-Item Env:\FRIENDSHIP_SEED_URL -ErrorAction SilentlyContinue
      Remove-Item Env:\FRIENDSHIP_SEED_UIDS_FILE -ErrorAction SilentlyContinue
      Remove-Item Env:\FRIENDSHIP_MAX_FOLLOWER -ErrorAction SilentlyContinue
      Remove-Item Env:\FRIENDSHIP_MAX_USERS -ErrorAction SilentlyContinue
      Remove-Item Env:\FRIENDSHIP_MAX_DEPTH -ErrorAction SilentlyContinue
      Remove-Item Env:\PYTHONUTF8 -ErrorAction SilentlyContinue
      Remove-Item Env:\BILIBILI_COOKIE -ErrorAction SilentlyContinue
      Remove-Item Env:\BU_SILENT -ErrorAction SilentlyContinue
      Remove-Item $harnessOut -ErrorAction SilentlyContinue

      Write-Host ""
    }

    # Run coverage audit after all friendship crawls
    Write-Host "  Running final coverage audit..."
    node .\server\scripts\runDictionaryCoverageAudit.js
    Write-Host "--- FRIENDSHIP CRAWL PHASE COMPLETE ---`n"
  }

  # Clean up temp UID files
  foreach ($entry in $friendshipUidFiles) {
    Remove-Item $entry.file -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "Harvesting dictionary-seeded Bilibili videos, scanning comments, and training the local keyword dictionary..."
  node .\server\scripts\runVideoKeywordDiscovery.js
}
