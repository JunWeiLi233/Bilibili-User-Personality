# Boot/logon launcher for the coverage harvest watchdog.
# Registered as a Windows Scheduled Task so the harvest auto-resumes after any
# shutdown/reboot/logon. Guarded so multiple instances never run at once.
#
# What this does:
#   1. If a watchdog is already running -> exit (no double-launch).
#   2. Clean any stale dictionary lock (the prior power-loss victim).
#   3. Launch the watchdog detached (it auto-restores latest checkpoint if the
#      live dictionary is corrupt, then resumes harvesting toward 100%).

$ErrorActionPreference = 'Stop'
Set-Location 'D:\Bilibili_User_Personality'

$logPath = 'D:\Bilibili_User_Personality\.claude\jobs\boot-launcher.log'
function Log($msg) {
    $line = "$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')) $msg"
    Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
}

try {
    # Guard: if any node process is already running the watchdog or harvest
    # loop, do not start a second one.
    $existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*runCoverageHarvestWatchdog*' -or $_.CommandLine -like '*runCoverageHarvestLoop*' }
    if ($existing) {
        Log "Watchdog/loop already running (PID $($existing.ProcessId -join ',')). Exiting boot launcher."
        exit 0
    }

    # Clean stale lock from any prior crash/power-loss (the corruption we hit
    # left a zeroed owner.json that blocked fresh harvests).
    $lockPath = 'D:\Bilibili_User_Personality\server\data\deepseekKeywordDictionary.json.lock'
    if (Test-Path $lockPath) {
        Remove-Item -Path $lockPath -Recurse -Force -ErrorAction SilentlyContinue
        Log "Removed stale dictionary lock."
    }

    # Launch the watchdog detached. It will:
    #   - detect + restore corrupt live files from the latest checkpoint
    #   - relaunch the harvest loop, auto-restarting up to 200 times
    Log "Launching coverage harvest watchdog..."
    Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','D:\Bilibili_User_Personality\.claude\jobs\watchdog-coverage-launch.ps1' -WindowStyle Hidden -RedirectStandardOutput 'D:\Bilibili_User_Personality\.claude\jobs\watchdog-coverage.log' -RedirectStandardError 'D:\Bilibili_User_Personality\.claude\jobs\watchdog-coverage.err'
    Log "Watchdog launch issued."
} catch {
    Log "ERROR: $($_.Exception.Message)"
    exit 1
}
