from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

text = text.replace(
'''    for goal in goals:
        currency = getattr(goal, "currency", base_currency)

        rate = report_currency_rate(db, currency, base_currency)
''',
'''    for goal in goals:
        goal_name = (
            getattr(goal, "name", None)
            or getattr(goal, "title", None)
            or getattr(goal, "goal_name", None)
            or getattr(goal, "description", None)
            or str(goal.id)
        )

        currency = getattr(goal, "currency", base_currency)

        rate = report_currency_rate(db, currency, base_currency)
'''
)

text = text.replace(
'            if goal.name not in (tx.description or ""):',
'            if goal_name not in (tx.description or ""):'
)

text = text.replace(
'            "goal_name": goal.name,',
'            "goal_name": goal_name,'
)

p.write_text(text, encoding="utf-8")
print("GOAL STATEMENT ATTRIBUTE FIXED")
