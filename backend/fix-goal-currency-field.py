from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

text = text.replace(
    '"goal_name": goal.name,',
    '"goal_name": goal.goal_name,'
)

p.write_text(text, encoding="utf-8")
print("GOAL CURRENCY FIELD FIXED")
