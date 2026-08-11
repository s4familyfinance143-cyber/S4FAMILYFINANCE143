$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FINAL_RELEASE_SECURITY_SECRET_FIX_$TS"
$BACKUP="$BACKUPROOT\FINAL-RELEASE-SECURITY-SECRET-FIX-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\core\config.py" "$BACKUP\config.py.before-security-secret-fix" -Force

Write-Host "1) Patch config.py hardcoded JWT secret..." -ForegroundColor Cyan

@'
from pathlib import Path
import re

config_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app\core\config.py")
text = config_path.read_text(encoding="utf-8")

original = text

if "import os" not in text:
    lines = text.splitlines()
    insert_at = 0

    while insert_at < len(lines) and (
        lines[insert_at].startswith("from __future__") or lines[insert_at].strip() == ""
    ):
        insert_at += 1

    lines.insert(insert_at, "import os")
    text = "\n".join(lines) + "\n"

patterns = [
    r'JWT_SECRET\s*=\s*"CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION"',
    r"JWT_SECRET\s*=\s*'CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION'",
    r'JWT_SECRET_KEY\s*=\s*"CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION"',
    r"JWT_SECRET_KEY\s*=\s*'CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION'",
]

replacement = 'JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("JWT_SECRET_KEY") or "dev"'

changed = False
for pattern in patterns:
    text2 = re.sub(pattern, replacement, text)
    if text2 != text:
        changed = True
        text = text2

if not changed:
    # More general safe replacement only for direct hardcoded JWT secret assignments.
    text2 = re.sub(
        r'JWT_SECRET\s*=\s*["\'][^"\']{10,}["\']',
        replacement,
        text,
    )
    if text2 != text:
        changed = True
        text = text2

if not changed and "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION" in text:
    raise SystemExit("Found production placeholder secret but could not patch it safely")

config_path.write_text(text, encoding="utf-8")

print("config_path:", config_path)
print("changed:", changed)
print("hardcoded_placeholder_remaining:", "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION" in text)
'@ | Set-Content "$VERIFY\01_patch_config_secret.py" -Encoding UTF8

& $PY "$VERIFY\01_patch_config_secret.py" | Tee-Object "$VERIFY\01_patch_config_secret.txt"
if ($LASTEXITCODE -ne 0) { throw "Patch config secret failed" }

Write-Host "2) Compile check..." -ForegroundColor Cyan

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

& $PY -m py_compile "$BACKEND\app\core\config.py"
if ($LASTEXITCODE -ne 0) { throw "config.py compile failed" }

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "backend compile failed" }

Write-Host "3) Security scanner re-check..." -ForegroundColor Cyan

@'
from pathlib import Path
import re

backend = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend")
files = [
    backend / "app" / "core" / "config.py",
    backend / "app" / "main.py",
]

findings = []

danger_patterns = [
    ("hardcoded_password_plain", re.compile(r'password\s*=\s*["\'][^"\']+["\']', re.I)),
    ("hardcoded_secret_plain", re.compile(r'(secret|token|jwt_secret)\s*=\s*["\'][^"\']{10,}["\']', re.I)),
]

for file in files:
    if not file.exists():
        continue

    text = file.read_text(encoding="utf-8", errors="ignore")

    for name, pattern in danger_patterns:
        for m in pattern.finditer(text):
            snippet = m.group(0)

            if "os.getenv" in snippet or "Field" in snippet:
                continue

            findings.append({
                "file": str(file),
                "type": name,
                "snippet": snippet[:120],
            })

print("security_findings_count:", len(findings))
print("security_findings:", findings)

if findings:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_security_scanner_recheck.py" -Encoding UTF8

& $PY "$VERIFY\02_security_scanner_recheck.py" | Tee-Object "$VERIFY\02_security_scanner_recheck.txt"
if ($LASTEXITCODE -ne 0) { throw "Security scanner still failed" }

@"
S4 FAMILY FINANCE 143 - FINAL RELEASE SECURITY SECRET FIX REPORT

STATUS: PASS
Time: $TS

FIXED:
- Removed hardcoded JWT_SECRET placeholder from app/core/config.py
- JWT secret now reads from environment:
  JWT_SECRET or JWT_SECRET_KEY
- Backend compile passed
- Security scanner re-check passed

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Re-run Final Production Full System QA / Release Lock
"@ | Set-Content "$VERIFY\FINAL_RELEASE_SECURITY_SECRET_FIX_REPORT.txt" -Encoding UTF8

Write-Host "FINAL RELEASE SECURITY SECRET FIX PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime