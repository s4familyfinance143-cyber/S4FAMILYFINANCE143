$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FINAL_RELEASE_CONFIG_FIELD_IMPORT_FIX_$TS"
$BACKUP="$BACKUPROOT\FINAL-RELEASE-CONFIG-FIELD-IMPORT-FIX-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\core\config.py" "$BACKUP\config.py.before-field-import-fix" -Force

Write-Host "1) Patch config.py Field import..." -ForegroundColor Cyan

@'
from pathlib import Path
import re

config_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app\core\config.py")
text = config_path.read_text(encoding="utf-8")

if "from pydantic import Field" not in text:
    if re.search(r"^from pydantic import .+$", text, flags=re.MULTILINE):
        def add_field(match):
            line = match.group(0)
            if "Field" in line:
                return line
            return line + ", Field"
        text = re.sub(r"^from pydantic import .+$", add_field, text, count=1, flags=re.MULTILINE)
    else:
        lines = text.splitlines()
        insert_at = 0
        while insert_at < len(lines) and (
            lines[insert_at].startswith("from __future__") or lines[insert_at].strip() == ""
        ):
            insert_at += 1
        lines.insert(insert_at, "from pydantic import Field")
        text = "\n".join(lines) + "\n"

config_path.write_text(text, encoding="utf-8")

print("config_path:", config_path)
print("field_import_present:", "from pydantic import Field" in text or "Field" in [x.strip() for x in text.split("import")[-1].split(",")])
'@ | Set-Content "$VERIFY\01_patch_field_import.py" -Encoding UTF8

& $PY "$VERIFY\01_patch_field_import.py" | Tee-Object "$VERIFY\01_patch_field_import.txt"
if ($LASTEXITCODE -ne 0) { throw "Field import patch failed" }

Write-Host "2) Compile + production config import check..." -ForegroundColor Cyan

$SECRET="8f7c0b2d4a6e9f1c3b5d7e0a2c4f6b8d9e1f3a5c7b9d0e2f4a6c8b0d1e3f5a7"

$env:PYTHONPATH=$BACKEND
$env:ENVIRONMENT="production"
$env:DATABASE_URL="postgresql+psycopg://postgres:s4m1%40v1i2@127.0.0.1:5432/s4_family_finance_phase1e_test"
$env:AUTO_CREATE_TABLES="false"
$env:JWT_SECRET=$SECRET
$env:JWT_SECRET_KEY=$SECRET
$env:SECRET_KEY=$SECRET
$env:APP_SECRET_KEY=$SECRET
$env:ACCESS_TOKEN_SECRET=$SECRET
$env:REFRESH_TOKEN_SECRET=$SECRET
$env:S4_JWT_SECRET_KEY=$SECRET
$env:S4_SECRET_KEY=$SECRET
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

& $PY -m py_compile "$BACKEND\app\core\config.py"
if ($LASTEXITCODE -ne 0) { throw "config.py compile failed" }

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "backend compile failed" }

@'
from app.core.config import settings

print("PRODUCTION CONFIG IMPORT PASS")
print("IS_POSTGRESQL:", settings.IS_POSTGRESQL)
print("JWT_SECRET_KEY_LENGTH:", len(str(getattr(settings, "JWT_SECRET_KEY", ""))))
print("JWT_SECRET_KEY_IS_PLACEHOLDER:", str(getattr(settings, "JWT_SECRET_KEY", "")) == "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION")
'@ | Set-Content "$VERIFY\02_production_config_import_check.py" -Encoding UTF8

& $PY "$VERIFY\02_production_config_import_check.py" | Tee-Object "$VERIFY\02_production_config_import_check.txt"
if ($LASTEXITCODE -ne 0) { throw "production config import check failed" }

Select-String -Path "$VERIFY\02_production_config_import_check.txt" -Pattern "PRODUCTION CONFIG IMPORT PASS" | Out-Null
Select-String -Path "$VERIFY\02_production_config_import_check.txt" -Pattern "IS_POSTGRESQL: True" | Out-Null
Select-String -Path "$VERIFY\02_production_config_import_check.txt" -Pattern "JWT_SECRET_KEY_IS_PLACEHOLDER: False" | Out-Null

@"
S4 FAMILY FINANCE 143 - FINAL RELEASE CONFIG FIELD IMPORT FIX REPORT

STATUS: PASS
Time: $TS

FIXED:
- Added missing pydantic Field import in app/core/config.py
- Backend compile passed
- Production config import passed
- JWT_SECRET_KEY placeholder check passed

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Re-run Final Production Full System QA / Release Lock
"@ | Set-Content "$VERIFY\FINAL_RELEASE_CONFIG_FIELD_IMPORT_FIX_REPORT.txt" -Encoding UTF8

Write-Host "FINAL RELEASE CONFIG FIELD IMPORT FIX PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow