<#
.SYNOPSIS
  Daily unattended dictionary-coverage harvest job.

.DESCRIPTION
  Operational wrapper around run-bilibili-auto-coverage.ps1 for scheduling.
  The underlying engine (runCoverageHarvestLoop.js / runCorpusMiningLoop.js) is
  already resilient (cycle retry, exponential backoff, checkpointed state,
  prune-exhausted). This script adds only the three things a scheduled job needs
  that the engine does not provide itself:

    1. CWD pin    — Set-Location to the repo root so the child script's relative
                    paths (.\set-deepseek-env.ps1, .\server\scripts\...) resolve
                    no matter what directory Task Scheduler launched from.
    2. Mutex lock — a Global mutex blocks overlapping runs. Two concurrent runs
                    would double-spend the DeepSeek budget and race on the shared
                    dictionary + harvest-state files.
    3. Dated log  — Start-Transcript captures all host output (Write-Host, node
                    stdout/stderr, errors) to logs\harvest-YYYYMMDD.log.

  Tuning (rate limits, cycles, discovery mode, pruning, model) is delegated
  entirely to run-bilibili-auto-coverage.ps1. Extra args forward through.

.PARAMETER MaxCycles
  Coverage-loop cycles per run (default 5). Bounds runtime + budget.
.PARAMETER MaxQueries
  Harvest queries per cycle, a budget cap (default 12).
.PARAMETER CorpusMining
  Run Phase 0 offline local-corpus mining before the online harvest loop
  (uses runCorpusMiningLoop.js). Cheapest source of new evidence; recommended
  when new dictionary terms may have been added since the last run.
.PARAMETER LogDir
  Log directory (default .\logs). *.log is gitignored.

.EXAMPLE
  .\daily-harvest.ps1
  .\daily-harvest.ps1 -CorpusMining -MaxCycles 3
  .\daily-harvest.ps1 -MaxQueries 20 -Strict

.NOTES
  Register the daily schedule with register-daily-harvest.ps1.
  Requires set-deepseek-env.ps1 (gitignored) with a real DEEPSEEK_API_KEY and
  BILIBILI_COOKIE. Runs LOCAL only — never in CI (the key must not leave this
  machine).
#>
param(
  [int]$MaxCycles = 5,
  [int]$MaxQueries = 12,
  [switch]$CorpusMining,
  [string]$LogDir = (Join-Path $PSScriptRoot 'logs'),
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

# Pin CWD to the repo root: the child script and set-deepseek-env.ps1 both use
# paths relative to the repo root, and Task Scheduler launches from System32.
Set-Location $PSScriptRoot

$stamp = Get-Date -Format 'yyyyMMdd'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
$logFile = Join-Path $LogDir "harvest-$stamp.log"

$exitCode = 0
Start-Transcript -Path $logFile -Append | Out-Null
$acquired = $false
try {
  Write-Host "================================================================"
  Write-Host "[daily-harvest] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') START"
  Write-Host "[daily-harvest] MaxCycles=$MaxCycles MaxQueries=$MaxQueries CorpusMining=$([bool]$CorpusMining)"
  Write-Host "[daily-harvest] log=$logFile"

  # ponytail: Global mutex — one daily run at a time across all sessions.
  $mutex = New-Object System.Threading.Mutex($false, 'Global\BilibiliDailyHarvest')
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) {
    Write-Host "[daily-harvest] SKIP: another run holds the lock. Exiting 0."
    return
  }

  $passArgs = @('-MaxCycles', $MaxCycles, '-MaxQueries', $MaxQueries)
  if ($CorpusMining) { $passArgs += '-CorpusMining' }
  if ($Rest)          { $passArgs += $Rest }

  & (Join-Path $PSScriptRoot 'run-bilibili-auto-coverage.ps1') @passArgs
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
  Write-Host "[daily-harvest] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') END exit=$exitCode"
}
catch {
  Write-Host "[daily-harvest] FATAL: $($_.Exception.Message)"
  $exitCode = 1
}
finally {
  if ($acquired) { try { $mutex.ReleaseMutex() } catch { } }
  Stop-Transcript | Out-Null
}
exit $exitCode
