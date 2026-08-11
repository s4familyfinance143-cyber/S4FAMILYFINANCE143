from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

start = text.find("      {goalEditModal.open && (")
end = text.find("\n</main>", start)

if start == -1:
    raise SystemExit("ERROR: goal modal start not found in login block")

if end == -1:
    raise SystemExit("ERROR: login </main> not found after modal block")

modal_block = text[start:end]
text = text[:start] + text[end:]

insert_after = '  return (\n    <div className="app-layout">\n'

if insert_after not in text:
    raise SystemExit("ERROR: app-layout return marker not found")

text = text.replace(
    insert_after,
    insert_after + modal_block + "\n",
    1,
)

p.write_text(text, encoding="utf-8")
print("GOAL MODALS MOVED OUT OF LOGIN OK")
