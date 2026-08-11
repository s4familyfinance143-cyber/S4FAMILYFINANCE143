$ErrorActionPreference="Stop"

$FILE="S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1"
$BACKUP="$FILE.before-jwt-secret-patch-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $FILE $BACKUP -Force

$text = Get-Content $FILE -Raw

# PostgreSQL production QA section needs BOTH JWT_SECRET and JWT_SECRET_KEY.
# Some settings validate JWT_SECRET directly in production.
$text = $text -replace '\$env:JWT_SECRET_KEY="THIS_IS_A_STRONG_TEST_SECRET_123456789"', @'
$env:JWT_SECRET="THIS_IS_A_STRONG_TEST_SECRET_123456789"
$env:JWT_SECRET_KEY="THIS_IS_A_STRONG_TEST_SECRET_123456789"
'@

Set-Content $FILE $text -Encoding UTF8

Write-Host "FINAL QA JWT_SECRET PATCH PASS" -ForegroundColor Green
Write-Host "Patched file:" -ForegroundColor Yellow
Write-Host $FILE -ForegroundColor Yellow
Write-Host "Backup file:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Select-String -Path $FILE -Pattern 'JWT_SECRET'