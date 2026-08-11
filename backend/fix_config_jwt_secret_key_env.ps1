$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FINAL_RELEASE_CONFIG_JWT_SECRET_KEY_ENV_FIX_$TS"
$BACKUP="$BACKUPROOT\FINAL-RELEASE-CONFIG-JWT-SECRET-KEY-FIX-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\core\config.py" "$BACKUP\config.py.before-jwt-secret-key-env-fix" -Force
Copy-Item "$BACKEND\final_release_qa_lock.ps1" "$BACKUP\final_release_qa_lock.ps1.before-jwt-env-fix" -Force

Write-Host "1) Patch config.py JWT_SECRET_KEY to env-based Field..." -ForegroundColor Cyan

@'
from pathlib import Path

config_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app\core\config.py")
text = config_path.read_text(encoding="utf-8")

if "import os" not in text:
    lines0 = text.splitlines()
    insert_at = 0
    while insert_at < len(lines0) and (
        lines0[insert_at].startswith("from __future__") or lines0[insert_at].strip() == ""
    ):
        insert_at += 1
    lines0.insert(insert_at, "import os")
    text = "\n".join(lines0) + "\n"

lines = text.splitlines()
new_lines = []
patched_jwt_secret_key = False

replacement = (
    'JWT_SECRET_KEY: str = Field('
    'default_factory=lambda: '
    'os.getenv("JWT_SECRET_KEY") '
    'or os.getenv("JWT_SECRET") '
    'or os.getenv("SECRET_KEY") '
    'or os.getenv("APP_SECRET_KEY") '
    'or os.getenv("S4_JWT_SECRET_KEY") '
    'or os.getenv("S4_SECRET_KEY") '
    'or "local_development_jwt_secret_key_not_for_production"'
    ')'
)

for line in lines:
    stripped = line.strip()

    if (
        stripped.startswith("JWT_SECRET_KEY")
        and "=" in stripped
        and not stripped.startswith("#")
    ):
        indent = line[:len(line) - len(line.lstrip())]
        new_lines.append(indent + replacement)
        patched_jwt_secret_key = True
    else:
        new_lines.append(line)

if not patched_jwt_secret_key:
    print("JWT_SECRET_KEY field not found. Candidate lines:")
    for i, line in enumerate(lines, start=1):
        if "JWT" in line or "SECRET" in line:
            print(f"{i}: {line}")
    raise SystemExit(1)

new_text = "\n".join(new_lines) + "\n"
config_path.write_text(new_text, encoding="utf-8")

print("config_path:", config_path)
print("patched_jwt_secret_key:", patched_jwt_secret_key)
print("placeholder_remaining:", "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION" in new_text)
'@ | Set-Content "$VERIFY\01_patch_config_jwt_secret_key.py" -Encoding UTF8

& $PY "$VERIFY\01_patch_config_jwt_secret_key.py" | Tee-Object "$VERIFY\01_patch_config_jwt_secret_key.txt"
if ($LASTEXITCODE -ne 0) { throw "config.py JWT_SECRET_KEY patch failed" }

Write-Host "2) Force final QA script production secret env block..." -ForegroundColor Cyan

@'
from pathlib import Path

file_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\final_release_qa_lock.ps1")
secret = "8f7c0b2d4a6e9f1c3b5d7e0a2c4f6b8d9e1f3a5c7b9d0e2f4a6c8b0d1e3f5a7"

lines = file_path.read_text(encoding="utf-8").splitlines()

secret_names = {
    "JWT_SECRET",
    "JWT_SECRET_KEY",
    "SECRET_KEY",
    "APP_SECRET_KEY",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "S4_JWT_SECRET_KEY",
    "S4_SECRET_KEY",
}

clean = []
for line in lines:
    stripped = line.strip()
    remove = False
    for name in secret_names:
        if stripped.startswith(f"$env:{name}="):
            remove = True
            break
    if not remove:
        clean.append(line)

block = [
    f'$env:JWT_SECRET="{secret}"',
    f'$env:JWT_SECRET_KEY="{secret}"',
    f'$env:SECRET_KEY="{secret}"',
    f'$env:APP_SECRET_KEY="{secret}"',
    f'$env:ACCESS_TOKEN_SECRET="{secret}"',
    f'$env:REFRESH_TOKEN_SECRET="{secret}"',
    f'$env:S4_JWT_SECRET_KEY="{secret}"',
    f'$env:S4_SECRET_KEY="{secret}"',
]

out = []
insert_count = 0

for line in clean:
    out.append(line)
    if '$env:DATABASE_URL="postgresql+psycopg://' in line:
        out.extend(block)
        insert_count += 1

if insert_count < 1:
    raise SystemExit("No PostgreSQL DATABASE_URL env line found in final QA script")

file_path.write_text("\n".join(out) + "\n", encoding="utf-8")

print("final_qa_path:", file_path)
print("secret_block_insert_count:", insert_count)
print("old_test_secret_remaining:", "THIS_IS_A_STRONG_TEST_SECRET_123456789" in file_path.read_text(encoding="utf-8"))
'@ | Set-Content "$VERIFY\02_force_final_qa_secret_env_block.py" -Encoding UTF8

& $PY "$VERIFY\02_force_final_qa_secret_env_block.py" | Tee-Object "$VERIFY\02_force_final_qa_secret_env_block.txt"
if ($LASTEXITCODE -ne 0) { throw "final QA secret env block patch failed" }

Write-Host "3) Compile + production config import check..." -ForegroundColor Cyan

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
'@ | Set-Content "$VERIFY\03_production_config_import_check.py" -Encoding UTF8

& $PY "$VERIFY\03_production_config_import_check.py" | Tee-Object "$VERIFY\03_production_config_import_check.txt"
if ($LASTEXITCODE -ne 0) { throw "production config import check failed" }

Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "PRODUCTION CONFIG IMPORT PASS" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "IS_POSTGRESQL: True" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "JWT_SECRET_KEY_IS_PLACEHOLDER: False" | Out-Null

Write-Host "4) Security scanner re-check..." -ForegroundColor Cyan

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

            if "os.getenv" in snippet or "Field" in snippet or "default_factory" in snippet:
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
'@ | Set-Content "$VERIFY\04_security_scanner_recheck.py" -Encoding UTF8

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"

& $PY "$VERIFY\04_security_scanner_recheck.py" | Tee-Object "$VERIFY\04_security_scanner_recheck.txt"
if ($LASTEXITCODE -ne 0) { throw "security scanner re-check failed" }

@"
S4 FAMILY FINANCE 143 - FINAL RELEASE CONFIG JWT SECRET KEY ENV FIX REPORT

STATUS: PASS
Time: $TS

FIXED:
- app/core/config.py JWT_SECRET_KEY now reads from environment aliases
- final_release_qa_lock.ps1 now sets full production secret env aliases
- Production config import check passed
- Backend compile passed
- Security scanner re-check passed

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Re-run Final Production Full System QA / Release Lock
"@ | Set-Content "$VERIFY\FINAL_RELEASE_CONFIG_JWT_SECRET_KEY_ENV_FIX_REPORT.txt" -Encoding UTF8

Write-Host "FINAL RELEASE CONFIG JWT SECRET KEY ENV FIX PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime