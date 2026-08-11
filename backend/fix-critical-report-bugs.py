from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

# Fix get_posted_transactions missing start_dt
old = '''    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)
'''

new = '''    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)
'''

if old in text:
    text = text.replace(old, new, 1)

# Fix bad model names
text = text.replace("FinancialFinancialGoal", "FinancialGoal")
text = text.replace("SavingsFinancialGoal", "SavingsGoal")

p.write_text(text, encoding="utf-8")
print("CRITICAL REPORT BUGS FIXED OK")
