from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
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

    score = 0

    if Decimal(d["cashflow"]) > 0:
        score += 30

    if Decimal(d["total_savings"]) > Decimal(d["total_expense"]):
        score += 20

    if Decimal(d["net_worth"]) > 0:
        score += 20

    if Decimal(g["overall_progress_percent"]) >= Decimal("25"):
        score += 15

    if Decimal(l["total_remaining"]) >= 0:
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
            "total_income": d["total_income"],
            "total_expense": d["total_expense"],
            "cashflow": d["cashflow"],
            "wallet_balance": d["wallet_balance"],
            "net_worth": d["net_worth"],
        },
        "savings_and_goals": {
            "total_savings": d["total_savings"],
            "goal_saved": d["goal_saved"],
            "goal_target": g["total_target_amount"],
            "goal_progress_percent": g["overall_progress_percent"],
        },
        "loans": {
            "given_remaining": l["given_remaining"],
            "taken_remaining": l["taken_remaining"],
            "total_remaining": l["given_remaining"],
            "total_loan_remaining": d["loan_remaining"],
        },
        "counts": {
            "members": members,
            "wallets": wallets,
            "active_goals": g["active_goals"],
            "active_loans": l["active_loans"],
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

if '@router.get("/executive-dashboard/{family_id}")' in text:
    print("EXECUTIVE DASHBOARD ALREADY EXISTS")
else:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("EXECUTIVE DASHBOARD INSERTED OK")
