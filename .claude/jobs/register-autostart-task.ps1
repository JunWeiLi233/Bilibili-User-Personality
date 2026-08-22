# One-time registration of the auto-start scheduled task.
# Re-run this (as admin) if the task is ever deleted or the repo moves.
# Creates task 'CoverageHarvestWatchdog_AutoStart' with BOTH AtLogon + AtStartup
# triggers, so the watchdog resumes after any shutdown/reboot — no login needed.
#
# Usage (run as admin):
#   powershell -ExecutionPolicy Bypass -File .claude\jobs\register-autostart-task.ps1

$ErrorActionPreference = 'Stop'
$taskName = 'CoverageHarvestWatchdog_AutoStart'
$launcher = 'D:\Bilibili_User_Personality\.claude\jobs\boot-launch-coverage-watchdog.ps1'
$envUser = $env:USERNAME
$envDomain = $env:USERDOMAIN
$userFull = "$envDomain\$envUser"

if (-not (Test-Path $launcher)) { Write-Error "Launcher not found: $launcher"; exit 1 }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $userFull
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerLogon, $triggerBoot) -Settings $settings -RunLevel Highest -Force -Description 'Auto-resume Bilibili coverage harvest watchdog at boot/logon. Guarded against double-launch.' | Out-Null
Write-Host "Registered task '$taskName' with AtLogon + AtStartup triggers (RunLevel Highest)."
Write-Host "The watchdog will now auto-resume after any shutdown/reboot — no login required."
