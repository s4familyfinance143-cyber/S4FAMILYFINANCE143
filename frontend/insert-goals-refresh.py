from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

needle = "    await loadRecurring();"
insert = "    await loadGoals();"

if insert in text:
    print("GOALS REFRESH ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, needle + "\n" + insert, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS REFRESH INSERTED OK")
else:
    raise SystemExit("ERROR: loadRecurring refresh line not found")
