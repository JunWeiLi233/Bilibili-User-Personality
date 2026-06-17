$projectDir = "D:\Bilibili_User_Personality"
$logDir = Join-Path $projectDir "server\data\scraper-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$ranges = @(
    @{ Start = 1; End = 20000; Progress = "uid-range-progress-1-20000.json" },
    @{ Start = 20001; End = 40000; Progress = "uid-range-progress-20001-40000.json" },
    @{ Start = 40001; End = 60000; Progress = "uid-range-progress-40001-60000.json" },
    @{ Start = 60001; End = 80000; Progress = "uid-range-progress-60001-80000.json" },
    @{ Start = 80001; End = 100000; Progress = "uid-range-progress-80001-100000.json" }
)

foreach ($range in $ranges) {
    $logFile = Join-Path $logDir ("uid-range-" + $range.Start + "-" + $range.End + ".log")
    $scriptPath = Join-Path $projectDir "server\scripts\uidRangeScrape.js"
    $nodeArgs = @($scriptPath, "--start=$($range.Start)", "--end=$($range.End)", "--progress=$($range.Progress)")

    $proc = Start-Process -FilePath "node" -ArgumentList $nodeArgs -WorkingDirectory $projectDir -RedirectStandardOutput $logFile -RedirectStandardError ($logFile -replace '\.log$', '-stderr.log') -WindowStyle Hidden -PassThru
    Write-Host "Launched: UID $($range.Start)-$($range.End) (PID $($proc.Id)) -> $logFile"
    Start-Sleep -Seconds 3
}

Write-Host "`nAll 5 range scrapers launched. Logs in: $logDir"
