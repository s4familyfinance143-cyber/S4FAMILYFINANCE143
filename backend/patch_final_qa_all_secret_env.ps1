$ErrorActionPreference="Stop"

$FILE="S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1"
$BACKUP="$FILE.before-all-secret-env-patch-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $FILE $BACKUP -Force

$SECRET='8f7c0b2d4a6e9f1c3b5d7e0a2c4f6b8d9e1f3a5c7b9d0e2f4a6c8b0d1e3f5a7'

$text = Get-Content $FILE -Raw

$text = $text -replace '\$env:JWT_SECRET="[^"]*"\s*\r?\n\$env:JWT_SECRET_KEY="[^"]*"', @"
`$env:JWT_SECRET="$SECRET"
`$env:JWT_SECRET_KEY="$SECRET"
`$env:SECRET_KEY="$SECRET"
`$env:APP_SECRET_KEY="$SECRET"
`$env:ACCESS_TOKEN_SECRET="$SECRET"
`$env:REFRESH_TOKEN_SECRET="$SECRET"
"@

Set-Content $FILE $text -Encoding UTF8

Write-Host "FINAL QA ALL SECRET ENV PATCH PASS" -ForegroundColor Green
Select-String -Path $FILE -Pattern 'JWT_SECRET|SECRET_KEY|APP_SECRET_KEY|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET'