$projectDir = "D:\Bilibili_User_Personality"
$logDir = Join-Path $projectDir "server\data\scraper-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$ranges = @(
    @{ Start = 1; End = 20000 },
    @{ Start = 20001; End = 40000 },
    @{ Start = 40001; End = 60000 },
    @{ Start = 60001; End = 80000 },
    @{ Start = 80001; End = 100000 }
)

foreach ($range in $ranges) {
    $logFile = Join-Path $logDir ("uid-pipeline-fast-" + $range.Start + "-" + $range.End + ".log")
    $errFile = Join-Path $logDir ("uid-pipeline-fast-" + $range.Start + "-" + $range.End + "-stderr.log")
    $scriptPath = Join-Path $projectDir "server\scripts\uidPipelineFast.js"

    # Use cmd /c to properly pass arguments
    $cmdArgs = "/c node `"$scriptPath`" --start=$($range.Start) --end=$($range.End)"

    $proc = Start-Process -FilePath "cmd" -ArgumentList $cmdArgs -WorkingDirectory $projectDir -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden -PassThru
    Write-Host "Launched: UID $($range.Start)-$($range.End) (PID $($proc.Id))"
    Start-Sleep -Seconds 5
}

Write-Host "`nAll 5 fast pipeline workers launched."
