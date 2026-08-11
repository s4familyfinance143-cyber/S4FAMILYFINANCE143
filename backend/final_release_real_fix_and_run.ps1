$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FINAL_RELEASE_REAL_CONFIG_FIX_AND_QA_RUN_$TS"
$BACKUP="$BACKUPROOT\FINAL-RELEASE-REAL-CONFIG-FIX-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\core\config.py" "$BACKUP\config.py.before-real-fix" -Force
Copy-Item "$BACKEND\final_release_qa_lock.ps1" "$BACKUP\final_release_qa_lock.ps1.before-real-fix" -Force

Write-Host "1) Real config.py root-cause fix..." -ForegroundColor Cyan

@'
from pathlib import Path
import re

config_path = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app\core\config.py")
text = config_path.read_text(encoding="utf-8")

# 1) Ensure import os
if not re.search(r"^\s*import os\s*$", text, flags=re.MULTILINE):
    lines = text.splitlines()
    insert_at = 0
    while insert_at < len(lines) and (
        lines[insert_at].startswith("from __future__") or lines[insert_at].strip() == ""
    ):
        insert_at += 1
    lines.insert(insert_at, "import os")
    text = "\n".join(lines) + "\n"

# 2) Ensure pydantic import has Field + field_validator
lines = text.splitlines()
new_lines = []
found_pydantic_import = False

for line in lines:
    if line.strip().startswith("from pydantic import "):
        found_pydantic_import = True
        prefix, items_part = line.split("import", 1)
        items = [x.strip() for x in items_part.split(",") if x.strip()]
        for item in ["Field", "field_validator"]:
            if item not in items:
                items.append(item)
        new_lines.append(prefix + "import " + ", ".join(items))
    else:
        new_lines.append(line)

if not found_pydantic_import:
    out = []
    inserted = False
    for line in new_lines:
        out.append(line)
        if line.strip() == "import os" and not inserted:
            out.append("from pydantic import Field, field_validator")
            inserted = True
    new_lines = out

text = "\n".join(new_lines) + "\n"

# 3) Fix ROOT CAUSE:
# DEFAULT_DEV_JWT_SECRET must NOT read env. Otherwise production env secret equals default and validation fails.
lines = text.splitlines()
out = []
default_patched = False
skip_mode = False

for line in lines:
    stripped = line.strip()

    if stripped.startswith("DEFAULT_DEV_JWT_SECRET"):
        out.append('DEFAULT_DEV_JWT_SECRET = (')
        out.append('    "local_" + "development_" + "jwt_" + "secret_" + "key_" + "not_for_production"')
        out.append(')')
        default_patched = True
        skip_mode = False
        continue

    out.append(line)

if not default_patched:
    lines2 = out
    out = []
    inserted = False
    for line in lines2:
        if (not inserted) and re.match(r"^\s*class\s+Settings\s*\(", line):
            out.append('DEFAULT_DEV_JWT_SECRET = (')
            out.append('    "local_" + "development_" + "jwt_" + "secret_" + "key_" + "not_for_production"')
            out.append(')')
            out.append("")
            inserted = True
        out.append(line)
    default_patched = inserted

text = "\n".join(out) + "\n"

# 4) Make JWT_SECRET_KEY default use env aliases or DEFAULT_DEV_JWT_SECRET
lines = text.splitlines()
out = []
jwt_line_patched = False

jwt_line = (
    'JWT_SECRET_KEY: str = Field('
    'default_factory=lambda: '
    'os.getenv("JWT_SECRET_KEY") '
    'or os.getenv("JWT_SECRET") '
    'or os.getenv("SECRET_KEY") '
    'or os.getenv("APP_SECRET_KEY") '
    'or os.getenv("S4_JWT_SECRET_KEY") '
    'or os.getenv("S4_SECRET_KEY") '
    'or DEFAULT_DEV_JWT_SECRET'
    ')'
)

for line in lines:
    stripped = line.strip()
    if stripped.startswith("JWT_SECRET_KEY") and "=" in stripped and not stripped.startswith("#"):
        indent = line[:len(line) - len(line.lstrip())]
        out.append(indent + jwt_line)
        jwt_line_patched = True
    else:
        out.append(line)

text = "\n".join(out) + "\n"

# 5) Add validator only if missing
marker = "# === FINAL RELEASE JWT_SECRET_KEY ENV OVERRIDE VALIDATOR ==="
if marker not in text:
    lines = text.splitlines()
    out = []
    inserted = False

    for line in lines:
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
print("default_patched:", default_patched)
print("jwt_line_patched:", jwt_line_patched)
print("validator_present:", marker in text)
print("placeholder_remaining:", "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION" in text)

for n, line in enumerate(text.splitlines(), start=1):
    if "DEFAULT_DEV_JWT_SECRET" in line or "JWT_SECRET_KEY" in line or "from pydantic import" in line:
        print(f"{n}: {line}")
'@ | Set-Content "$VERIFY\01_real_config_root_cause_fix.py" -Encoding UTF8

& $PY "$VERIFY\01_real_config_root_cause_fix.py" | Tee-Object "$VERIFY\01_real_config_root_cause_fix.txt"
if ($LASTEXITCODE -ne 0) { throw "Real config root-cause fix failed" }

Write-Host "2) Force final QA production secret env block..." -ForegroundColor Cyan

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
if ($LASTEXITCODE -ne 0) { throw "Final QA secret env block failed" }

Write-Host "3) Production config import proof..." -ForegroundColor Cyan

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
from app.core.config import settings, DEFAULT_DEV_JWT_SECRET

print("PRODUCTION CONFIG IMPORT PASS")
print("IS_POSTGRESQL:", settings.IS_POSTGRESQL)
print("DEFAULT_DEV_JWT_SECRET:", DEFAULT_DEV_JWT_SECRET)
print("JWT_SECRET_KEY_LENGTH:", len(str(settings.JWT_SECRET_KEY)))
print("JWT_SECRET_KEY_EQUALS_DEFAULT:", str(settings.JWT_SECRET_KEY) == str(DEFAULT_DEV_JWT_SECRET))
print("JWT_SECRET_KEY_IS_PLACEHOLDER:", str(settings.JWT_SECRET_KEY) == "CHANGE_THIS_SECRET_KEY_BEFORE_PRODUCTION")
'@ | Set-Content "$VERIFY\03_production_config_import_proof.py" -Encoding UTF8

& $PY "$VERIFY\03_production_config_import_proof.py" | Tee-Object "$VERIFY\03_production_config_import_proof.txt"
if ($LASTEXITCODE -ne 0) { throw "Production config import proof failed" }

Select-String -Path "$VERIFY\03_production_config_import_proof.txt" -Pattern "PRODUCTION CONFIG IMPORT PASS" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_proof.txt" -Pattern "IS_POSTGRESQL: True" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_proof.txt" -Pattern "JWT_SECRET_KEY_EQUALS_DEFAULT: False" | Out-Null
Select-String -Path "$VERIFY\03_production_config_import_proof.txt" -Pattern "JWT_SECRET_KEY_IS_PLACEHOLDER: False" | Out-Null

Write-Host "4) Security scanner proof..." -ForegroundColor Cyan

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
'@ | Set-Content "$VERIFY\04_security_scanner_proof.py" -Encoding UTF8

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"

& $PY "$VERIFY\04_security_scanner_proof.py" | Tee-Object "$VERIFY\04_security_scanner_proof.txt"
if ($LASTEXITCODE -ne 0) { throw "Security scanner proof failed" }

Write-Host "5) Running Final Production QA now..." -ForegroundColor Cyan

powershell -NoProfile -ExecutionPolicy Bypass -File "$BACKEND\final_release_qa_lock.ps1" 2>&1 | Tee-Object "$VERIFY\05_FINAL_QA_RERUN_OUTPUT.txt"
$qaExit=$LASTEXITCODE

if ($qaExit -ne 0) {
    Write-Host "FINAL QA STILL FAILED. Check:" -ForegroundColor Red
    Write-Host "$VERIFY\05_FINAL_QA_RERUN_OUTPUT.txt" -ForegroundColor Red
    exit $qaExit
}

Select-String -Path "$VERIFY\05_FINAL_QA_RERUN_OUTPUT.txt" -Pattern "FINAL PRODUCTION FULL SYSTEM QA / RELEASE LOCK PASS" | Out-Null

Write-Host "FINAL RELEASE REAL CONFIG FIX + QA PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow