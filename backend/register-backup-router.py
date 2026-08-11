from pathlib import Path

p = Path("app/api/v1/router.py")
text = p.read_text(encoding="utf-8")

if "from app.api.v1.backup import router as backup_router" not in text:
    text = text.replace(
        "from app.api.v1.auth import router as auth_router",
        "from app.api.v1.auth import router as auth_router\nfrom app.api.v1.backup import router as backup_router",
        1,
    )

if "api_router.include_router(backup_router)" not in text:
    text = text.replace(
        "api_router.include_router(auth_router)",
        "api_router.include_router(auth_router)\napi_router.include_router(backup_router)",
        1,
    )

p.write_text(text, encoding="utf-8")
print("BACKUP ROUTER REGISTERED OK")
