# Edit this link, then run this script from PowerShell:
#   .\run-bilibili-video.ps1

$env:BILIBILI_DEFAULT_VIDEO_LINK = "https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=d3f6474bdf9e6de8d027785f1120afd4"

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 was not found. DeepSeek extraction will use the local fallback unless DEEPSEEK_API_KEY is already set."
}

Write-Host "Backend default Bilibili video:"
Write-Host $env:BILIBILI_DEFAULT_VIDEO_LINK
Write-Host ""
Write-Host "Starting API and frontend. Open the Vite URL printed below, then click 后端默认视频."

npm run server
