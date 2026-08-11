$ErrorActionPreference="Stop"

$FILE="S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1"
$BACKUP="$FILE.before-alembic-safe-patch-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Copy-Item $FILE $BACKUP -Force

$text = Get-Content $FILE -Raw

$old = @'
& $PY -m alembic current | Tee-Object "$VERIFY\08_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL Alembic current failed" }
'@

$new = @'
$alembicOutput = & $PY -c "import subprocess, sys; p=subprocess.run([sys.executable, '-m', 'alembic', 'current'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True); print(p.stdout, end=''); sys.exit(p.returncode)"
$alembicCode = $LASTEXITCODE
$alembicOutput | Tee-Object "$VERIFY\08_postgres_alembic_current.txt"
if ($alembicCode -ne 0) { throw "PostgreSQL Alembic current failed" }
'@

if ($text.Contains($old)) {
    $text = $text.Replace($old, $new)
    Set-Content $FILE $text -Encoding UTF8
    Write-Host "FINAL QA ALEMBIC SAFE PATCH PASS" -ForegroundColor Green
} elseif ($text -match "alembicOutput") {
    Write-Host "Already patched ✅" -ForegroundColor Green
} else {
    throw "Alembic block not found. Do not continue."
}

Write-Host "Patched file:" -ForegroundColor Yellow
Write-Host $FILE
Write-Host "Backup file:" -ForegroundColor Yellow
Write-Host $BACKUP

Select-String -Path $FILE -Pattern "alembicOutput|08_postgres_alembic_current"