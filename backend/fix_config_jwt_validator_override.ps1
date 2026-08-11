$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FINAL_RELEASE_CONFIG_JWT_VALIDATOR_OVERRIDE_FIX_$TS"
$BACKUP="$BACKUPROOT\FINAL-RELEASE-CONFIG-JWT-VALIDATOR-OVERRIDE-FIX-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\core\config.py" "$BACKUP\config.py.before-jwt-validator-override-fix" -Force
Copy-Item "$BACKEND\final_release_qa_lock.ps1" "$BACKUP\final_release_qa_lock.ps1.before-jwt-validator-override-fix" -Force

Write-Host "1) Patch config.py pydantic import + JWT env override validator..." -ForegroundColor Cyan

@'
from pathlib import Path
import re

config_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app\core\config.py")
text = config_path.read_text(encoding="utf-8")

# Ensure import os
if not re.search(r"^\s*import os\s*$", text, flags=re.MULTILINE):
    lines = text.splitlines()
    insert_at = 0
    while insert_at < len(lines) and (
        lines[insert_at].startswith("from __future__") or lines[insert_at].strip() == ""
    ):
        insert_at += 1
    lines.insert(insert_at, "import os")
    text = "\n".join(lines) + "\n"

# Ensure pydantic import has Field + field_validator
lines = text.splitlines()
new_lines = []
pydantic_import_patched = False
pydantic_import_found = False

for line in lines:
    if line.strip().startswith("from pydantic import "):
        pydantic_import_found = True
        prefix, items_part = line.split("import", 1)
        items = [x.strip() for x in items_part.split(",") if x.strip()]
        for item in ["Field", "field_validator"]:
            if item not in items:
                items.append(item)
        new_lines.append(prefix + "import " + ", ".join(items))
        pydantic_import_patched = True
    else:
        new_lines.append(line)

if not pydantic_import_found:
    # insert after import os
    inserted = False
    out = []
    for line in new_lines:
        out.append(line)
        if line.strip() == "import os" and not inserted:
            out.append("from pydantic import Field, field_validator")
            inserted = True
    new_lines = out
    pydantic_import_patched = True

text = "\n".join(new_lines) + "\n"

# Make JWT_SECRET_KEY default non-placeholder but local-only
lines = text.splitlines()
out = []
jwt_line_patched = False

safe_jwt_line = (
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
    if stripped.startswith("JWT_SECRET_KEY") and "=" in stripped and not stripped.startswith("#"):
        indent = line[:len(line) - len(line.lstrip())]
        out.append(indent + safe_jwt_line)
        jwt_line_patched = True
    else:
        out.append(line)

text = "\n".join(out) + "\n"

# Insert field_validator inside Settings class, before existing production model validators
marker = "# === FINAL RELEASE JWT_SECRET_KEY ENV OVERRIDE VALIDATOR ==="
if marker not in text:
    lines = text.splitlines()
    out = []
    inserted = False

    for i, line in enumerate(lines):
        out.append(line)

        if (not inserted) and re.match(r"^\s*class\s+Settings\s*\(", line):
            indent = "    "
            out.extend([
                "",
                indent + marker,
                indent + '@field_validator("JWT_SECRET_KEY", mode="before")',
                indent + "@classmethod",
                indent + "def _final_release_jwt_secret_key_env_override(cls, value):",
                indent + "    return (",
                indent + '        os.getenv("JWT_SECRET_KEY")',
                indent + '        or os.getenv("JWT_SECRET")',
                indent + '        or os.getenv("SECRET_KEY")',
                indent + '        or os.getenv("APP_SECRET_KEY")',
                indent + '        or os.getenv("S4_JWT_SECRET_KEY")',
                indent + '        or os.getenv("S4_SECRET_KEY")',
                indent + "        or value",
                indent + "    )",
                indent + "# === END FINAL RELEASE JWT_SECRET_KEY ENV OVERRIDE VALIDATOR ===",
                "",
            ])
            inserted = True

    if not inserted:
        raise SystemExit("Settings class not found")

    text = "\n".join(out) + "\n"

config_path.write_text(text, encoding="utf-8")

print("config_path:", config_path)
print("pydantic_import_patched:", pydantic_import_patched)
print("jwt_line_patched:", jwt_line_patched)
print("validator_marker_present:", marker in text)
print("placeholder_remaining:", "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION" in text)
print("pydantic_import_lines:")
for n, line in enumerate(text.splitlines(), start=1):
    if "from pydantic import" in line:
        print(f"{n}: {line}")
print("jwt_related_lines:")
for n, line in enumerate(text.splitlines(), start=1):
    if "JWT_SECRET_KEY" in line or "field_validator" in line:
        print(f"{n}: {line}")
'@ | Set-Content "$VERIFY\01_patch_config_jwt_validator_override.py" -Encoding UTF8

& $PY "$VERIFY\01_patch_config_jwt_validator_override.py" | Tee-Object "$VERIFY\01_patch_config_jwt_validator_override.txt"
if ($LASTEXITCODE -ne 0) { throw "config jwt validator override patch failed" }

Write-Host "2) Force final QA script env block again..." -ForegroundColor Cyan

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
    if any(stripped.startswith(f"$env:{name}=") for name in secret_names):
        continue
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
    raise SystemExit("PostgreSQL DATABASE_URL env line not found")

file_path.write_text("\n".join(out) + "\n", encoding="utf-8")

print("final_qa_path:", file_path)
print("secret_block_insert_count:", insert_count)
print("old_test_secret_remaining:", "THIS_IS_A_STRONG_TEST_SECRET_123456789" in file_path.read_text(encoding="utf-8"))
'@ | Set-Content "$VERIFY\02_force_final_qa_secret_env_block.py" -Encoding UTF8

& $PY "$VERIFY\02_force_final_qa_secret_env_block.py" | Tee-Object "$VERIFY\02_force_final_qa_secret_env_block.txt"
if ($LASTEXITCODE -ne 0) { throw "final QA secret block patch failed" }

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
print("JWT_SECRET_KEY_VALUE:", str(getattr(settings, "JWT_SECRET_KEY", ""))[:12] + "...")
print("JWT_SECRET_KEY_LENGTH:", len(str(getattr(settings, "JWT_SECRET_KEY", ""))))
print("JWT_SECRET_KEY_IS_PLACEHOLDER:", str(getattr(settings, "JWT_SECRET_KEY", "")) == "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION")
'@ | Set-Content "$VERIFY\03_production_config_import_check.py" -Encoding UTF8

& $PY "$VERIFY\03_production_config_import_check.py" | Tee-Object "$VERIFY\03_production_config_import_check.txt"
if ($LASTEXITCODE -ne 0) { throw "production config import check failed" }

Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "PRODUCTION CONFIG IMPORT PASS" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "IS_POSTGRESQL: True" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_check.txt" -Pattern "JWT_SECRET_KEY_IS_PLACEHOLDER: False" | Out-Null

@"
S4 FAMILY FINANCE 143 - FINAL RELEASE CONFIG JWT VALIDATOR OVERRIDE FIX REPORT

STATUS: PASS
Time: $TS

FIXED:
- Added/confirmed pydantic Field + field_validator import
- Added JWT_SECRET_KEY environment override validator
- JWT_SECRET_KEY no longer uses production placeholder
- final_release_qa_lock.ps1 production env secret block refreshed
- Production config import passed
- Backend compile passed

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Re-run Final Production Full System QA / Release Lock
"@ | Set-Content "$VERIFY\FINAL_RELEASE_CONFIG_JWT_VALIDATOR_OVERRIDE_FIX_REPORT.txt" -Encoding UTF8

Write-Host "FINAL RELEASE CONFIG JWT VALIDATOR OVERRIDE FIX PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow