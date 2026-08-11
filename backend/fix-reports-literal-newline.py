from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

text = text.replace("    }\\n\\n\n\n@router.get(\"/wallets-currency/{family_id}\")", "    }\n\n\n@router.get(\"/wallets-currency/{family_id}\")")

p.write_text(text, encoding="utf-8")
print("BROKEN LITERAL NEWLINE FIXED")
