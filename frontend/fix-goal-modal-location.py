from pathlib import Path

p = Path("src/App.jsx")
text = p.read_text(encoding="utf-8")

start = text.find("      {goalEditModal.open && (")
end_marker = "      {goalHistoryModal.open && ("

if start == -1:
    raise SystemExit("ERROR: goal modal block start not found")

second = text.find(end_marker, start)
if second == -1:
    raise SystemExit("ERROR: goal history modal block not found")

end = text.find("      <aside className=\"sidebar\">", second)

if end == -1:
    # modal was inserted in login area, so end before first </main>
    end = text.find("      </main>", second)
    if end == -1:
        raise SystemExit("ERROR: modal end marker not found")

modal_block = text[start:end]
text = text[:start] + text[end:]

aside = "      <aside className=\"sidebar\">"
if aside not in text:
    raise SystemExit("ERROR: aside marker not found")

text = text.replace(aside, modal_block + "\n" + aside, 1)

p.write_text(text, encoding="utf-8")
print("GOAL MODALS MOVED TO CORRECT PLACE OK")
