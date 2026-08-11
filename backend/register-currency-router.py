from pathlib import Path

p = Path("app/api/v1/router.py")
text = p.read_text(encoding="utf-8")

if "from app.api.v1.currency import router as currency_router" not in text:
    text = text.replace(
        "from app.api.v1.categories import router as category_router",
        "from app.api.v1.categories import router as category_router\nfrom app.api.v1.currency import router as currency_router",
        1,
    )

if "api_router.include_router(currency_router)" not in text:
    text = text.replace(
        "api_router.include_router(category_router)",
        "api_router.include_router(category_router)\napi_router.include_router(currency_router)",
        1,
    )

p.write_text(text, encoding="utf-8")
print("CURRENCY ROUTER REGISTERED OK")
