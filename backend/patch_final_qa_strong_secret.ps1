$ErrorActionPreference="Stop"

$FILE="S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1"
$BACKUP="$FILE.before-strong-secret-patch-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $FILE $BACKUP -Force

$text = Get-Content $FILE -Raw

$OLD='THIS_IS_A_STRONG_TEST_SECRET_123456789'
$NEW='8f7c0b2d4a6e9f1c3b5d7e0a2c4f6b8d9e1f3a5c7b9d0e2f4a6c8b0d1e3f5a7'

$text = $text.Replace($OLD, $NEW)

Set-Content $FILE $text -Encoding UTF8

Write-Host "FINAL QA STRONG SECRET PATCH PASS" -ForegroundColor Green
Write-Host "Patched file:" -ForegroundColor Yellow
Write-Host $FILE -ForegroundColor Yellow
Write-Host "Backup file:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Select-String -Path $FILE -Pattern 'JWT_SECRET'
Select-String -Path $FILE -Pattern $OLD