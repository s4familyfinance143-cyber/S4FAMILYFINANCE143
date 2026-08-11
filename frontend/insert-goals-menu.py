from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

old = '<button onClick={() => setActiveMenu("recurring")}>Recurring</button>'
new = old + '\n        <button onClick={() => setActiveMenu("goals")}>Goals</button>'

if '<button onClick={() => setActiveMenu("goals")}>Goals</button>' in text:
    print("GOALS MENU ALREADY EXISTS")
elif old in text:
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")
    print("GOALS MENU INSERTED OK")
else:
    raise SystemExit("ERROR: Recurring menu button not found")
