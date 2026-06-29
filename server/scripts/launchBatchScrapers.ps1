$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir | Split-Path -Parent
$logDir = Join-Path $projectDir "server\data"

$ranges = @(
    @{ Start = 1; End = 20000; Progress = "batch-uid-progress-1-20000.json" },
    @{ Start = 20001; End = 40000; Progress = "batch-uid-progress-20001-40000.json" },
    @{ Start = 40001; End = 60000; Progress = "batch-uid-progress-40001-60000.json" },
    @{ Start = 60001; End = 80000; Progress = "batch-uid-progress-60001-80000.json" },
    @{ Start = 80001; End = 100000; Progress = "batch-uid-progress-80001-100000.json" }
)

$delay = 0
$rangeCount = $ranges.Length
$rangeIndex = 0
foreach ($range in $ranges) {
    $rangeIndex++
    $logFile = Join-Path $logDir ("scraper-log-" + $range.Start + "-" + $range.End + ".txt")
    $scriptPath = Join-Path $scriptDir "batchUidScrape.js"

    $nodeArgs = @($scriptPath, "--start=$($range.Start)", "--end=$($range.End)", "--progress=$($range.Progress)")

    Start-Process -FilePath "node" -ArgumentList $nodeArgs -WorkingDirectory $projectDir -RedirectStandardOutput $logFile -RedirectStandardError ($logFile -replace '\.txt$', '-stderr.txt') -WindowStyle Hidden -PassThru | Select-Object Id, ProcessName | Format-Table -AutoSize

    Write-Host "Launched scraper: $($range.Start)-$($range.End) -> $logFile"

    # Inter-process delay to avoid -799 rate limiting
    if ($rangeIndex -lt $rangeCount) {
      $delaySec = Get-Random -Minimum 30 -Maximum 60
      Write-Host "Cool-down: $delaySec seconds before next scraper..."
      Start-Sleep -Seconds $delaySec
    }
}

Write-Host "`nAll 5 scrapers launched. Check logs in: $logDir"
Write-Host "Monitor progress with: Get-Content $logDir\batch-uid-progress-*.json | ConvertFrom-Json"
