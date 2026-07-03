<#
.SYNOPSIS
  Register, update, or remove the daily-harvest Windows Task Scheduler entry.

.DESCRIPTION
  Creates a scheduled task that runs daily-harvest.ps1 once per day. One-shot
  helper — run it once (from an elevated PowerShell) to install the schedule.

  Default: runs daily at 03:07 under the current user, only when logged on.
  For true unattended (run whether logged on or not), see DAILY_HARVEST.md —
  that variant re-registers under SYSTEM and needs node/python on the system
  PATH (not just the user PATH).

.PARAMETER TaskName
  Scheduled-task name (default 'BilibiliDailyHarvest').
.PARAMETER Time
  Daily start time HH:mm, 24h, off-minute to avoid fleet contention (default 03:07).
.PARAMETER Remove
  Delete the scheduled task instead of creating it.

.EXAMPLE
  .\register-daily-harvest.ps1
  .\register-daily-harvest.ps1 -Time '06:13'
  .\register-daily-harvest.ps1 -Remove
#>
param(
  [string]$TaskName = 'BilibiliDailyHarvest',
  [string]$Time = '03:07',
  [switch]$Remove
)

$scriptPath = Join-Path $PSScriptRoot 'daily-harvest.ps1'
if (-not (Test-Path $scriptPath)) {
  throw "daily-harvest.ps1 not found at $scriptPath — register from the repo root."
}

if ($Remove) {
  schtasks /Delete /TN $TaskName /F
  Write-Host "Removed scheduled task '$TaskName' (if it existed)."
  return
}

$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# /F overwrites any prior entry with the same name so re-running updates cleanly.
schtasks /Create /SC DAILY /TN $TaskName /ST $Time /TR $action /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) {
  Write-Error "schtasks /Create failed (exit $LASTEXITCODE). Run from an elevated PowerShell."
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Registered '$TaskName' — daily at $Time, highest privileges, current user."
Write-Host "Inspect:     schtasks /Query /TN $TaskName /V /FO LIST"
Write-Host "Run now:     schtasks /Run /TN $TaskName"
Write-Host "Unregister:  .\register-daily-harvest.ps1 -Remove"
Write-Host "Tail a run:  Get-Content -Wait .\logs\harvest-$(Get-Date -Format yyyyMMdd).log"
