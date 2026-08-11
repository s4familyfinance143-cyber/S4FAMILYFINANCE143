from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

start = text.find('@router.get("/executive-dashboard/{family_id}")')
end = text.find('@router.get("/cashflow/{family_id}")', start)

if start == -1:
    raise SystemExit("ERROR: executive dashboard endpoint not found")

if end == -1:
    raise SystemExit("ERROR: cashflow marker not found after executive dashboard")

new_endpoint = r'''
@router.get("/executive-dashboard/{family_id}")
def executive_dashboard_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    dashboard = report_dashboard(family_id, db, current_user)
    categories = category_wise_report(family_id, None, None, db, current_user)
    goal_analytics = goal_analytics_report(family_id, db, current_user)
    loan_analytics = loan_analytics_report(family_id, db, current_user)

    active_budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.status == "ACTIVE",
            Budget.deleted_at.is_(None),
        )
        .count()
    )

    members = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .count()
    )

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .count()
    )

    d = dashboard["dashboard"]
    g = goal_analytics["summary"]
    l = loan_analytics["summary"]

    given_remaining = Decimal(l.get("given_remaining", "0") or "0")
    taken_remaining = Decimal(l.get("taken_remaining", "0") or "0")
    total_loan_remaining = given_remaining + taken_remaining

    score = 0

    if Decimal(d.get("cashflow", "0")) > 0:
        score += 30

    if Decimal(d.get("total_savings", "0")) > Decimal(d.get("total_expense", "0")):
        score += 20

    if Decimal(d.get("net_worth", "0")) > 0:
        score += 20

    if Decimal(g.get("overall_progress_percent", "0")) >= Decimal("25"):
        score += 15

    if total_loan_remaining >= 0:
        score += 15

    grade = "D"
    if score >= 85:
        grade = "A"
    elif score >= 70:
        grade = "B"
    elif score >= 50:
        grade = "C"

    return {
        "family_id": family_id,
        "financial_overview": {
            "total_income": d.get("total_income"),
            "total_expense": d.get("total_expense"),
            "cashflow": d.get("cashflow"),
            "wallet_balance": d.get("wallet_balance"),
            "net_worth": d.get("net_worth"),
        },
        "savings_and_goals": {
            "total_savings": d.get("total_savings"),
            "goal_saved": d.get("goal_saved"),
            "goal_target": g.get("total_target_amount"),
            "goal_progress_percent": g.get("overall_progress_percent"),
        },
        "loans": {
            "given_remaining": money(given_remaining),
            "taken_remaining": money(taken_remaining),
            "total_remaining": money(total_loan_remaining),
        },
        "counts": {
            "members": members,
            "wallets": wallets,
            "active_goals": g.get("active_goals"),
            "active_loans": l.get("active_loans"),
            "active_budgets": active_budgets,
        },
        "top_income_category": categories["summary"]["top_income_category"],
        "top_expense_category": categories["summary"]["top_expense_category"],
        "financial_health": {
            "score": score,
            "grade": grade,
        },
    }


'''

text = text[:start] + new_endpoint + text[end:]
p.write_text(text, encoding="utf-8")
print("EXECUTIVE DASHBOARD FIXED OK")
