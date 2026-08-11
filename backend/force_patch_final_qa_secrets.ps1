$ErrorActionPreference="Stop"

$FILE="S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1"
$BACKUP="$FILE.before-force-secret-patch-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $FILE $BACKUP -Force

$SECRET='8f7c0b2d4a6e9f1c3b5d7e0a2c4f6b8d9e1f3a5c7b9d0e2f4a6c8b0d1e3f5a7'

$lines = Get-Content $FILE

# Remove all old secret env lines
$clean = @()
foreach ($line in $lines) {
    if ($line -match '^\s*\$env:(JWT_SECRET|JWT_SECRET_KEY|SECRET_KEY|APP_SECRET_KEY|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET)\s*=') {
        continue
    }
    $clean += $line
}

# Insert full secret env block right after PostgreSQL DATABASE_URL line
$out = @()
$inserted = $false

foreach ($line in $clean) {
    $out += $line

    if (($line -match '^\s*\$env:DATABASE_URL="postgresql\+psycopg://') -and (-not $inserted)) {
        $out += '$env:JWT_SECRET="' + $SECRET + '"'
        $out += '$env:JWT_SECRET_KEY="' + $SECRET + '"'
        $out += '$env:SECRET_KEY="' + $SECRET + '"'
        $out += '$env:APP_SECRET_KEY="' + $SECRET + '"'
        $out += '$env:ACCESS_TOKEN_SECRET="' + $SECRET + '"'
        $out += '$env:REFRESH_TOKEN_SECRET="' + $SECRET + '"'
        $inserted = $true
    }
}

if (-not $inserted) {
    throw "PostgreSQL DATABASE_URL line not found; secret block not inserted"
}

Set-Content $FILE $out -Encoding UTF8

Write-Host "FORCE FINAL QA SECRET PATCH PASS" -ForegroundColor Green
Write-Host "Patched file:" -ForegroundColor Yellow
Write-Host $FILE -ForegroundColor Yellow
Write-Host "Backup file:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Write-Host "`nSecret lines now:" -ForegroundColor Cyan
Select-String -Path $FILE -Pattern 'JWT_SECRET|SECRET_KEY|APP_SECRET_KEY|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET'

Write-Host "`nOld TEST secret check:" -ForegroundColor Cyan
$old = Select-String -Path $FILE -Pattern 'THIS_IS_A_STRONG_TEST_SECRET_123456789'
if ($old) {
    Write-Host "OLD SECRET STILL FOUND ❌" -ForegroundColor Red
    $old
    exit 1
} else {
    Write-Host "OLD SECRET REMOVED ✅" -ForegroundColor Green
}