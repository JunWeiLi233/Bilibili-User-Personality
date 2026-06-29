. .\set-deepseek-env.ps1
$env:DEEPSEEK_MODEL = 'deepseek-v4-pro'
Write-Host "Running direct DeepSeek term generator..."
Write-Host "Key length: $($env:DEEPSEEK_API_KEY.Length)"
node .claude/direct_generate.js 2>&1
Write-Host "Done. Exit code: $LASTEXITCODE"
