from datetime import datetime, time
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.goal import FinancialGoal
from app.models.budget import Budget
from app.models.savings import SavingsGoal
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.services.permission_service import require_permission
from io import BytesIO
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

router = APIRouter(prefix="/reports", tags=["Reports"])


def money(value) -> str:
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def percent(current, target) -> str:
    current = Decimal(current or 0)
    target = Decimal(target or 0)
    if target <= 0:
        return "0.00"
    return str(((current / target) * Decimal("100")).quantize(Decimal("0.01")))


def require_report_access(db: Session, family_id: str, user_id: str) -> FamilyMember:
    return require_permission(
        db=db,
        family_id=family_id,
        user_id=user_id,
        permission="report.read",
    )


def parse_date_start(value: str | None):
    if not value:
        return None
    return datetime.combine(datetime.fromisoformat(value).date(), time.min)


def parse_date_end(value: str | None):
    if not value:
        return None
    return datetime.combine(datetime.fromisoformat(value).date(), time.max)


def serialize_category(db: Session, category_id: str | None):
    if not category_id:
        return None

    category = db.get(Category, category_id)
    if not category:
        return None

    return {
        "id": category.id,
        "name_en": category.name_en,
        "name_bn": category.name_bn,
        "category_type": category.category_type,
        "icon": category.icon,
        "color": category.color,
    }


def serialize_account(db: Session, account_id: str | None):
    if not account_id:
        return None

    account = db.get(Account, account_id)
    if not account:
        return None

    return {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "currency": account.currency,
    }


def get_posted_transactions(
    db: Session,
    family_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
):
    query = db.query(Transaction).filter(
        Transaction.family_id == family_id,
        Transaction.status == "POSTED",
        Transaction.deleted_at.is_(None),
    )

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)

    if end_dt:
        query = query.filter(Transaction.created_at <= end_dt)

    return query.order_by(Transaction.created_at.desc()).all()


def transaction_wallet_info(db: Session, tx: Transaction):
    lines = (
        db.query(TransactionLine)
        .filter(
            TransactionLine.transaction_id == tx.id,
            TransactionLine.account_id.isnot(None),
        )
        .all()
    )

    if tx.transaction_type == "TRANSFER":
        from_line = None
        to_line = None

        for line in lines:
            if Decimal(line.credit or 0) > 0:
                from_line = line
            elif Decimal(line.debit or 0) > 0:
                to_line = line

        return {
            "wallet": None,
            "transfer": {
                "from_wallet": serialize_account(db, from_line.account_id if from_line else None),
                "to_wallet": serialize_account(db, to_line.account_id if to_line else None),
            },
        }

    account_line = None

    for line in lines:
        if line.account_id:
            account_line = line
            break

    return {
        "wallet": serialize_account(db, account_line.account_id if account_line else None),
        "transfer": None,
    }


@router.get("/goals/{family_id}")
def goal_report(
    family_id: str,
    goal_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    goals_query = db.query(FinancialGoal).filter(
        FinancialFinancialGoal.family_id == family_id,
        FinancialFinancialGoal.deleted_at.is_(None),
    )

    if goal_id:
        goals_query = goals_query.filter(FinancialGoal.id == goal_id)

    goals = goals_query.order_by(FinancialGoal.created_at.desc()).all()

    total_target = Decimal("0")
    total_current = Decimal("0")
    total_contributed = Decimal("0")
    total_withdrawn = Decimal("0")
    items = []

    for goal in goals:
        contribution_total = Decimal("0")
        withdraw_total = Decimal("0")
        history = []
        monthly_map = {}

        txs = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.goal_id == goal.id,
                Transaction.transaction_type.in_(["GOAL_CONTRIBUTION", "GOAL_WITHDRAW"]),
                Transaction.status == "POSTED",
                Transaction.deleted_at.is_(None),
            )
            .order_by(Transaction.created_at.desc())
            .all()
        )

        for tx in txs:
            if start_dt and tx.created_at < start_dt:
                continue
            if end_dt and tx.created_at > end_dt:
                continue

            amount = Decimal(tx.amount)
            wallet_info = transaction_wallet_info(db, tx)
            month_key = tx.created_at.strftime("%Y-%m")

            if month_key not in monthly_map:
                monthly_map[month_key] = {
                    "month": month_key,
                    "contribution": Decimal("0"),
                    "withdraw": Decimal("0"),
                    "net": Decimal("0"),
                }

            if tx.transaction_type == "GOAL_CONTRIBUTION":
                contribution_total += amount
                monthly_map[month_key]["contribution"] += amount

            elif tx.transaction_type == "GOAL_WITHDRAW":
                withdraw_total += amount
                monthly_map[month_key]["withdraw"] += amount

            history.append(
                {
                    "transaction_id": tx.id,
                    "goal_id": tx.goal_id,
                    "transaction_type": tx.transaction_type,
                    "amount": money(amount),
                    "currency": tx.currency,
                    "wallet": wallet_info["wallet"],
                    "description": tx.description,
                    "created_at": tx.created_at,
                }
            )

        for row in monthly_map.values():
            row["net"] = row["contribution"] - row["withdraw"]

        total_target += Decimal(goal.target_amount)
        total_current += Decimal(goal.current_amount)
        total_contributed += contribution_total
        total_withdrawn += withdraw_total

        items.append(
            {
                "id": goal.id,
                "goal_name": goal.goal_name,
                "goal_type": goal.goal_type,
                "linked_savings_goal_id": goal.linked_savings_goal_id,
                "target_amount": money(goal.target_amount),
                "current_amount": money(goal.current_amount),
                "progress_percent": percent(goal.current_amount, goal.target_amount),
                "contribution_total": money(contribution_total),
                "withdraw_total": money(withdraw_total),
                "net_contribution": money(contribution_total - withdraw_total),
                "currency": goal.currency,
                "target_date": goal.target_date,
                "status": goal.status,
                "note": goal.note,
                "created_at": goal.created_at,
                "monthly_trend": [
                    {
                        "month": row["month"],
                        "contribution": money(row["contribution"]),
                        "withdraw": money(row["withdraw"]),
                        "net": money(row["net"]),
                    }
                    for row in sorted(monthly_map.values(), key=lambda x: x["month"])
                ],
                "history": history[offset: offset + limit],
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "goal_id": goal_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "goal_count": len(goals),
            "total_target_amount": money(total_target),
            "total_current_amount": money(total_current),
            "overall_progress_percent": percent(total_current, total_target),
            "total_contributed": money(total_contributed),
            "total_withdrawn": money(total_withdrawn),
            "net_contribution": money(total_contributed - total_withdrawn),
        },
        "goals": items,
    }



@router.get("/income/{family_id}")
def income_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "INCOME"
    ]

    total_income = Decimal("0")
    monthly = {}
    category_map = {}
    wallet_map = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        total_income += amount

        month_key = tx.created_at.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, Decimal("0")) + amount

        if tx.category_id:
            category_map[tx.category_id] = category_map.get(tx.category_id, Decimal("0")) + amount

        wallet_info = transaction_wallet_info(db, tx)
        wallet = wallet_info["wallet"]

        if wallet:
            wallet_id = wallet["id"]
            wallet_map.setdefault(
                wallet_id,
                {
                    "wallet_id": wallet_id,
                    "wallet_name": wallet["name"],
                    "wallet_type": wallet["account_type"],
                    "total_income": Decimal("0"),
                },
            )
            wallet_map[wallet_id]["total_income"] += amount

    category_rows = []
    for category_id, total in category_map.items():
        category = serialize_category(db, category_id)
        category_rows.append(
            {
                "category": category,
                "total_income": money(total),
            }
        )

    wallet_rows = []
    for row in wallet_map.values():
        wallet_rows.append(
            {
                "wallet_id": row["wallet_id"],
                "wallet_name": row["wallet_name"],
                "wallet_type": row["wallet_type"],
                "total_income": money(row["total_income"]),
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income": money(total_income),
            "transaction_count": len(transactions),
        },
        "monthly_income": [
            {
                "month": month,
                "total_income": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "category_income": sorted(
            category_rows,
            key=lambda x: Decimal(x["total_income"]),
            reverse=True,
        ),
        "wallet_income": sorted(
            wallet_rows,
            key=lambda x: Decimal(x["total_income"]),
            reverse=True,
        ),
        "transactions": [
            {
                "transaction_id": tx.id,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "category": serialize_category(db, tx.category_id),
                "wallet": transaction_wallet_info(db, tx)["wallet"],
                "description": tx.description,
                "created_at": tx.created_at,
                "status": tx.status,
            }
            for tx in transactions
        ],
    }



@router.get("/expense/{family_id}")
def expense_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "EXPENSE"
    ]

    total_expense = Decimal("0")
    monthly = {}
    category_map = {}
    wallet_map = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        total_expense += amount

        month_key = tx.created_at.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, Decimal("0")) + amount

        if tx.category_id:
            category_map[tx.category_id] = category_map.get(tx.category_id, Decimal("0")) + amount

        wallet_info = transaction_wallet_info(db, tx)
        wallet = wallet_info["wallet"]

        if wallet:
            wallet_id = wallet["id"]
            wallet_map.setdefault(
                wallet_id,
                {
                    "wallet_id": wallet_id,
                    "wallet_name": wallet["name"],
                    "wallet_type": wallet["account_type"],
                    "total_expense": Decimal("0"),
                },
            )
            wallet_map[wallet_id]["total_expense"] += amount

    return {
        "family_id": family_id,
        "filters": {"start_date": start_date, "end_date": end_date},
        "summary": {
            "total_expense": money(total_expense),
            "transaction_count": len(transactions),
        },
        "monthly_expense": [
            {"month": month, "total_expense": money(total)}
            for month, total in sorted(monthly.items())
        ],
        "category_expense": sorted(
            [
                {"category": serialize_category(db, category_id), "total_expense": money(total)}
                for category_id, total in category_map.items()
            ],
            key=lambda x: Decimal(x["total_expense"]),
            reverse=True,
        ),
        "wallet_expense": sorted(
            [
                {
                    "wallet_id": row["wallet_id"],
                    "wallet_name": row["wallet_name"],
                    "wallet_type": row["wallet_type"],
                    "total_expense": money(row["total_expense"]),
                }
                for row in wallet_map.values()
            ],
            key=lambda x: Decimal(x["total_expense"]),
            reverse=True,
        ),
        "transactions": [
            {
                "transaction_id": tx.id,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "category": serialize_category(db, tx.category_id),
                "wallet": transaction_wallet_info(db, tx)["wallet"],
                "description": tx.description,
                "created_at": tx.created_at,
                "status": tx.status,
            }
            for tx in transactions
        ],
    }



@router.get("/wallets/{family_id}")
def wallet_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    total_balance = Decimal("0")

    for wallet in wallets:
        inflow = Decimal("0")
        outflow = Decimal("0")

        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet.id)
            .all()
        )

        for line in lines:
            inflow += Decimal(line.debit or 0)
            outflow += Decimal(line.credit or 0)

        balance = inflow - outflow
        total_balance += balance

        rows.append(
            {
                "wallet_id": wallet.id,
                "wallet_name": wallet.name,
                "wallet_type": wallet.account_type,
                "currency": wallet.currency,
                "total_inflow": money(inflow),
                "total_outflow": money(outflow),
                "balance": money(balance),
                "is_active": wallet.is_active,
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "wallet_count": len(rows),
            "total_balance": money(total_balance),
        },
        "wallets": sorted(
            rows,
            key=lambda x: Decimal(x["balance"]),
            reverse=True,
        ),
    }



@router.get("/family-summary/{family_id}")
def family_summary_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    income_total = Decimal("0")
    expense_total = Decimal("0")
    savings_total = Decimal("0")
    goal_target_total = Decimal("0")
    goal_current_total = Decimal("0")
    loan_total = Decimal("0")

    transactions = get_posted_transactions(db, family_id, None, None)

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            income_total += amount
        elif tx.transaction_type == "EXPENSE":
            expense_total += amount

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    for goal in goals:
        goal_target_total += Decimal(goal.target_amount or 0)
        goal_current_total += Decimal(goal.current_amount or 0)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    for loan in loans:
        loan_total += Decimal(loan.remaining_amount or 0)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    for item in savings:
        savings_total += Decimal(item.current_amount or 0)

    net_worth = (
        income_total
        + savings_total
        + goal_current_total
        - expense_total
        - loan_total
    )

    return {
        "family_id": family_id,
        "summary": {
            "total_income": money(income_total),
            "total_expense": money(expense_total),
            "total_savings": money(savings_total),
            "total_goal_target": money(goal_target_total),
            "total_goal_saved": money(goal_current_total),
            "total_loan_remaining": money(loan_total),
            "net_worth": money(net_worth),
        },
        "counts": {
            "goals": len(goals),
            "loans": len(loans),
            "savings": len(savings),
        },
    }



@router.get("/savings/{family_id}")
def savings_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
        )
        .all()
    )

    total_target = Decimal("0")
    total_saved = Decimal("0")

    rows = []

    for item in savings:
        target = Decimal(item.target_amount or 0)
        saved = Decimal(item.current_amount or 0)

        total_target += target
        total_saved += saved

        progress = Decimal("0")

        if target > 0:
            progress = (saved / target) * Decimal("100")

        rows.append(
            {
                "id": item.id,
                "name": item.name,
                "goal_type": item.goal_type,
                "target_amount": money(target),
                "current_amount": money(saved),
                "remaining_amount": money(target - saved),
                "progress_percent": str(round(progress, 2)),
                "currency": item.currency,
                "status": item.status,
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "total_savings_goals": len(rows),
            "total_target_amount": money(total_target),
            "total_saved_amount": money(total_saved),
            "total_remaining_amount": money(total_target - total_saved),
        },
        "savings": rows,
    }



@router.get("/loans/{family_id}")
def loan_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
        )
        .all()
    )

    total_loan_amount = Decimal("0")
    total_remaining_amount = Decimal("0")
    total_paid_amount = Decimal("0")

    rows = []

    for loan in loans:
        loan_amount = Decimal(loan.principal_amount or 0)
        remaining_amount = Decimal(loan.remaining_amount or 0)
        paid_amount = loan_amount - remaining_amount

        total_loan_amount += loan_amount
        total_remaining_amount += remaining_amount
        total_paid_amount += paid_amount

        progress = Decimal("0")

        if loan_amount > 0:
            progress = (paid_amount / loan_amount) * Decimal("100")

        rows.append(
            {
                "id": loan.id,
                "person_name": loan.person_name,
                "loan_type": loan.loan_type,
                "loan_amount": money(loan_amount),
                "paid_amount": money(paid_amount),
                "remaining_amount": money(remaining_amount),
                "progress_percent": str(round(progress, 2)),
                "currency": loan.currency,
                "status": loan.status,
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "total_loans": len(rows),
            "total_loan_amount": money(total_loan_amount),
            "total_paid_amount": money(total_paid_amount),
            "total_remaining_amount": money(total_remaining_amount),
        },
        "loans": rows,
    }




@router.get("/budget/{family_id}")
def budget_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .order_by(Budget.created_at.desc())
        .all()
    )

    active_rows = []
    closed_rows = []

    active_total_budget = Decimal("0")
    active_total_spent = Decimal("0")

    counted_active_categories = set()

    def calculate_category_spent(category_id: str) -> Decimal:
        total = Decimal("0")

        transactions = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.category_id == category_id,
                Transaction.transaction_type == "EXPENSE",
                Transaction.status == "POSTED",
                Transaction.deleted_at.is_(None),
            )
            .all()
        )

        for tx in transactions:
            total += Decimal(tx.amount or 0)

        return total

    for budget in budgets:
        budget_amount = Decimal(budget.budget_amount or 0)
        spent_amount = calculate_category_spent(budget.category_id)
        remaining_amount = budget_amount - spent_amount

        used_percent = Decimal("0")
        if budget_amount > 0:
            used_percent = (spent_amount / budget_amount) * Decimal("100")

        row = {
            "budget_id": budget.id,
            "budget_name": budget.name,
            "category": serialize_category(db, budget.category_id),
            "budget_amount": money(budget_amount),
            "spent_amount": money(spent_amount),
            "remaining_amount": money(remaining_amount),
            "used_percent": str(round(used_percent, 2)),
            "over_budget": spent_amount > budget_amount,
            "currency": budget.currency,
            "period_type": budget.period_type,
            "status": budget.status,
            "note": budget.note,
            "created_at": budget.created_at,
        }

        if budget.status == "ACTIVE":
            active_rows.append(row)

            if budget.category_id not in counted_active_categories:
                active_total_budget += budget_amount
                active_total_spent += spent_amount
                counted_active_categories.add(budget.category_id)

        else:
            closed_rows.append(row)

    active_total_remaining = active_total_budget - active_total_spent

    active_used_percent = "0.00"
    if active_total_budget > 0:
        active_used_percent = str(
            round((active_total_spent / active_total_budget) * Decimal("100"), 2)
        )

    return {
        "family_id": family_id,
        "summary": {
            "active_budget_count": len(active_rows),
            "closed_budget_count": len(closed_rows),
            "active_total_budget": money(active_total_budget),
            "active_total_spent": money(active_total_spent),
            "active_total_remaining": money(active_total_remaining),
            "active_used_percent": active_used_percent,
            "active_over_budget": active_total_spent > active_total_budget if active_total_budget > 0 else False,
        },
        "active_budgets": active_rows,
        "closed_budgets": closed_rows,
    }



@router.get("/net-worth/{family_id}")
def net_worth_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    wallet_balance = Decimal("0")
    savings_amount = Decimal("0")
    goal_saved_amount = Decimal("0")
    loan_remaining = Decimal("0")

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    for wallet in wallets:
        inflow = Decimal("0")
        outflow = Decimal("0")

        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet.id)
            .all()
        )

        for line in lines:
            inflow += Decimal(line.debit or 0)
            outflow += Decimal(line.credit or 0)

        wallet_balance += (inflow - outflow)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
        )
        .all()
    )

    for item in savings:
        savings_amount += Decimal(item.current_amount or 0)

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
        )
        .all()
    )

    for goal in goals:
        goal_saved_amount += Decimal(goal.current_amount or 0)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
        )
        .all()
    )

    for loan in loans:
        loan_remaining += Decimal(loan.remaining_amount or 0)

    total_assets = wallet_balance + savings_amount + goal_saved_amount
    net_worth = total_assets - loan_remaining

    return {
        "family_id": family_id,
        "summary": {
            "wallet_balance": money(wallet_balance),
            "savings_amount": money(savings_amount),
            "goal_saved_amount": money(goal_saved_amount),
            "total_assets": money(total_assets),
            "loan_remaining": money(loan_remaining),
            "net_worth": money(net_worth),
        }
    }



@router.get("/dashboard/{family_id}")
def report_dashboard(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    income = Decimal("0")
    expense = Decimal("0")

    txs = get_posted_transactions(db, family_id, None, None)

    for tx in txs:
        amt = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            income += amt
        elif tx.transaction_type == "EXPENSE":
            expense += amt

    savings_total = Decimal("0")
    for s in db.query(SavingsGoal).filter(SavingsGoal.family_id == family_id).all():
        savings_total += Decimal(s.current_amount or 0)

    goal_saved = Decimal("0")
    for g in db.query(FinancialGoal).filter(FinancialGoal.family_id == family_id).all():
        goal_saved += Decimal(g.current_amount or 0)

    loan_remaining = Decimal("0")
    for l in db.query(Loan).filter(Loan.family_id == family_id).all():
        loan_remaining += Decimal(l.remaining_amount or 0)

    wallet_balance = Decimal("0")

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    for wallet in wallets:
        inflow = Decimal("0")
        outflow = Decimal("0")

        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet.id)
            .all()
        )

        for line in lines:
            inflow += Decimal(line.debit or 0)
            outflow += Decimal(line.credit or 0)

        wallet_balance += inflow - outflow

    net_worth = wallet_balance + savings_total + goal_saved - loan_remaining

    return {
        "family_id": family_id,
        "dashboard": {
            "total_income": money(income),
            "total_expense": money(expense),
            "cashflow": money(income - expense),
            "wallet_balance": money(wallet_balance),
            "total_savings": money(savings_total),
            "goal_saved": money(goal_saved),
            "loan_remaining": money(loan_remaining),
            "net_worth": money(net_worth),
        }
    }


@router.get("/categories/{family_id}")
def category_wise_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, start_date, end_date)

    income_map = {}
    expense_map = {}

    total_income = Decimal("0")
    total_expense = Decimal("0")

    for tx in transactions:
        if not tx.category_id:
            continue

        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            total_income += amount
            income_map[tx.category_id] = income_map.get(tx.category_id, Decimal("0")) + amount

        elif tx.transaction_type == "EXPENSE":
            total_expense += amount
            expense_map[tx.category_id] = expense_map.get(tx.category_id, Decimal("0")) + amount

    def build_rows(category_map, total_amount):
        rows = []

        for category_id, amount in category_map.items():
            category = serialize_category(db, category_id)

            percent_value = Decimal("0")
            if total_amount > 0:
                percent_value = (amount / total_amount) * Decimal("100")

            rows.append(
                {
                    "category": category,
                    "amount": money(amount),
                    "percent": str(round(percent_value, 2)),
                }
            )

        return sorted(
            rows,
            key=lambda x: Decimal(x["amount"]),
            reverse=True,
        )

    income_rows = build_rows(income_map, total_income)
    expense_rows = build_rows(expense_map, total_expense)

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income": money(total_income),
            "total_expense": money(total_expense),
            "net_income_expense": money(total_income - total_expense),
            "top_income_category": income_rows[0] if income_rows else None,
            "top_expense_category": expense_rows[0] if expense_rows else None,
        },
        "income_categories": income_rows,
        "expense_categories": expense_rows,
    }



@router.get("/monthly-trend/{family_id}")
def monthly_trend_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, None, None)

    monthly = {}

    for tx in transactions:
        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
            }

        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            monthly[month_key]["income"] += amount

        elif tx.transaction_type == "EXPENSE":
            monthly[month_key]["expense"] += amount

    rows = []

    for month, data in sorted(monthly.items()):
        income = data["income"]
        expense = data["expense"]

        rows.append(
            {
                "month": month,
                "income": money(income),
                "expense": money(expense),
                "cashflow": money(income - expense),
            }
        )

    return {
        "family_id": family_id,
        "months": rows,
    }



@router.get("/yearly-trend/{family_id}")
def yearly_trend_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, None, None)

    yearly = {}

    for tx in transactions:
        year_key = tx.created_at.strftime("%Y")

        if year_key not in yearly:
            yearly[year_key] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
            }

        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            yearly[year_key]["income"] += amount

        elif tx.transaction_type == "EXPENSE":
            yearly[year_key]["expense"] += amount

    rows = []

    for year, data in sorted(yearly.items()):
        income = data["income"]
        expense = data["expense"]

        rows.append(
            {
                "year": year,
                "income": money(income),
                "expense": money(expense),
                "cashflow": money(income - expense),
            }
        )

    return {
        "family_id": family_id,
        "years": rows,
    }



@router.get("/members/{family_id}")
def member_wise_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    members = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    for member in members:

        income = Decimal("0")
        expense = Decimal("0")
        savings = Decimal("0")
        goals = Decimal("0")
        loans = Decimal("0")

        txs = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.created_by_member_id == member.id,
                Transaction.status == "POSTED",
            )
            .all()
        )

        for tx in txs:
            amount = Decimal(tx.amount or 0)

            if tx.transaction_type == "INCOME":
                income += amount

            elif tx.transaction_type == "EXPENSE":
                expense += amount

        member_savings = (
            db.query(SavingsGoal)
            .filter(
                SavingsGoal.family_id == family_id,
                SavingsGoal.owner_member_id == member.id,
            )
            .all()
        )

        for item in member_savings:
            savings += Decimal(item.current_amount or 0)

        member_goals = (
            db.query(FinancialGoal)
            .filter(
                FinancialGoal.family_id == family_id,
                FinancialGoal.created_by_member_id == member.id,
            )
            .all()
        )

        for item in member_goals:
            goals += Decimal(item.current_amount or 0)

        member_loans = (
            db.query(Loan)
            .filter(
                Loan.family_id == family_id,
                Loan.owner_member_id == member.id,
            )
            .all()
        )

        for item in member_loans:
            loans += Decimal(item.remaining_amount or 0)

        rows.append(
            {
                "member_id": member.id,
                "member_name": member.user.full_name if member.user else None,
                "role": member.role,
                "relationship": member.relationship_display_label,
                "income": money(income),
                "expense": money(expense),
                "savings": money(savings),
                "goals": money(goals),
                "loan_remaining": money(loans),
                "net_contribution": money(
                    income - expense + savings + goals - loans
                ),
            }
        )

    return {
        "family_id": family_id,
        "member_count": len(rows),
        "members": rows,
    }


@router.get("/cashflow/{family_id}")
def cashflow_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, start_date, end_date)

    total_inflow = Decimal("0")
    total_outflow = Decimal("0")
    monthly = {}
    income_categories = {}
    expense_categories = {}
    wallet_map = {}

    for tx in transactions:
        amount = Decimal(tx.amount)
        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = {
                "month": month_key,
                "inflow": Decimal("0"),
                "outflow": Decimal("0"),
                "net": Decimal("0"),
            }

        wallet_info = transaction_wallet_info(db, tx)
        wallet = wallet_info["wallet"]

        wallet_id = wallet["id"] if wallet else None
        wallet_name = wallet["name"] if wallet else None

        inflow_types = {
            "INCOME",
            "SAVINGS_WITHDRAW",
            "LOAN_TAKEN",
            "LOAN_GIVEN_PAYMENT",
            "GOAL_WITHDRAW",
        }
        outflow_types = {
            "EXPENSE",
            "SAVINGS_DEPOSIT",
            "LOAN_GIVEN",
            "LOAN_TAKEN_PAYMENT",
            "GOAL_CONTRIBUTION",
        }

        if tx.transaction_type in inflow_types:
            total_inflow += amount
            monthly[month_key]["inflow"] += amount

            if tx.transaction_type == "INCOME" and tx.category_id:
                income_categories[tx.category_id] = income_categories.get(tx.category_id, Decimal("0")) + amount

            if wallet_id:
                wallet_map.setdefault(
                    wallet_id,
                    {
                        "wallet_id": wallet_id,
                        "name": wallet_name,
                        "inflow": Decimal("0"),
                        "outflow": Decimal("0"),
                    },
                )
                wallet_map[wallet_id]["inflow"] += amount

        elif tx.transaction_type in outflow_types:
            total_outflow += amount
            monthly[month_key]["outflow"] += amount

            if tx.transaction_type == "EXPENSE" and tx.category_id:
                expense_categories[tx.category_id] = expense_categories.get(tx.category_id, Decimal("0")) + amount

            if wallet_id:
                wallet_map.setdefault(
                    wallet_id,
                    {
                        "wallet_id": wallet_id,
                        "name": wallet_name,
                        "inflow": Decimal("0"),
                        "outflow": Decimal("0"),
                    },
                )
                wallet_map[wallet_id]["outflow"] += amount

        elif tx.transaction_type == "TRANSFER":
            transfer = wallet_info["transfer"]
            from_wallet = transfer["from_wallet"] if transfer else None
            to_wallet = transfer["to_wallet"] if transfer else None

            if from_wallet:
                fw_id = from_wallet["id"]
                wallet_map.setdefault(
                    fw_id,
                    {
                        "wallet_id": fw_id,
                        "name": from_wallet["name"],
                        "inflow": Decimal("0"),
                        "outflow": Decimal("0"),
                    },
                )
                wallet_map[fw_id]["outflow"] += amount

            if to_wallet:
                tw_id = to_wallet["id"]
                wallet_map.setdefault(
                    tw_id,
                    {
                        "wallet_id": tw_id,
                        "name": to_wallet["name"],
                        "inflow": Decimal("0"),
                        "outflow": Decimal("0"),
                    },
                )
                wallet_map[tw_id]["inflow"] += amount

    for row in monthly.values():
        row["net"] = row["inflow"] - row["outflow"]

    def category_rows(category_map):
        rows = []
        for category_id, total in category_map.items():
            category = db.get(Category, category_id)
            rows.append(
                {
                    "category_id": category_id,
                    "name_en": category.name_en if category else None,
                    "name_bn": category.name_bn if category else None,
                    "icon": category.icon if category else None,
                    "color": category.color if category else None,
                    "total_amount": money(total),
                }
            )
        return sorted(rows, key=lambda x: Decimal(x["total_amount"]), reverse=True)

    wallet_rows = []
    for row in wallet_map.values():
        wallet_rows.append(
            {
                "wallet_id": row["wallet_id"],
                "name": row["name"],
                "inflow": money(row["inflow"]),
                "outflow": money(row["outflow"]),
                "net": money(row["inflow"] - row["outflow"]),
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_inflow": money(total_inflow),
            "total_outflow": money(total_outflow),
            "net_cashflow": money(total_inflow - total_outflow),
            "transaction_count": len(transactions),
        },
        "monthly_cashflow": [
            {
                "month": row["month"],
                "inflow": money(row["inflow"]),
                "outflow": money(row["outflow"]),
                "net": money(row["net"]),
            }
            for row in sorted(monthly.values(), key=lambda x: x["month"])
        ],
        "income_categories": category_rows(income_categories),
        "expense_categories": category_rows(expense_categories),
        "wallet_cashflow": sorted(wallet_rows, key=lambda x: x["name"] or ""),
    }


@router.get("/transactions/{family_id}")
def transaction_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    transaction_type: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    wallet_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, start_date, end_date)

    if transaction_type:
        transactions = [
            tx for tx in transactions
            if tx.transaction_type == transaction_type.upper()
        ]

    if category_id:
        transactions = [
            tx for tx in transactions
            if tx.category_id == category_id
        ]

    if wallet_id:
        wallet_tx_ids = {
            row.transaction_id
            for row in db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet_id)
            .all()
        }

        transactions = [
            tx for tx in transactions
            if tx.id in wallet_tx_ids
        ]

    totals = {
        "income": Decimal("0"),
        "expense": Decimal("0"),
        "transfer": Decimal("0"),
        "savings_deposit": Decimal("0"),
        "savings_withdraw": Decimal("0"),
        "loan_given": Decimal("0"),
        "loan_taken": Decimal("0"),
        "loan_payment": Decimal("0"),
        "goal_contribution": Decimal("0"),
        "goal_withdraw": Decimal("0"),
    }

    for tx in transactions:
        amount = Decimal(tx.amount)

        if tx.transaction_type == "INCOME":
            totals["income"] += amount
        elif tx.transaction_type == "EXPENSE":
            totals["expense"] += amount
        elif tx.transaction_type == "TRANSFER":
            totals["transfer"] += amount
        elif tx.transaction_type == "SAVINGS_DEPOSIT":
            totals["savings_deposit"] += amount
        elif tx.transaction_type == "SAVINGS_WITHDRAW":
            totals["savings_withdraw"] += amount
        elif tx.transaction_type == "LOAN_GIVEN":
            totals["loan_given"] += amount
        elif tx.transaction_type == "LOAN_TAKEN":
            totals["loan_taken"] += amount
        elif tx.transaction_type.endswith("_PAYMENT"):
            totals["loan_payment"] += amount
        elif tx.transaction_type == "GOAL_CONTRIBUTION":
            totals["goal_contribution"] += amount
        elif tx.transaction_type == "GOAL_WITHDRAW":
            totals["goal_withdraw"] += amount

    rows = []

    for tx in transactions[offset: offset + limit]:
        wallet_info = transaction_wallet_info(db, tx)

        rows.append(
            {
                "transaction_id": tx.id,
                "transaction_type": tx.transaction_type,
                "loan_id": tx.loan_id,
                "goal_id": tx.goal_id,
                "category": serialize_category(db, tx.category_id),
                "wallet": wallet_info["wallet"],
                "transfer": wallet_info["transfer"],
                "amount": money(tx.amount),
                "currency": tx.currency,
                "description": tx.description,
                "status": tx.status,
                "created_at": tx.created_at,
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
            "transaction_type": transaction_type.upper() if transaction_type else None,
            "category_id": category_id,
            "wallet_id": wallet_id,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "income": money(totals["income"]),
            "expense": money(totals["expense"]),
            "net_income_expense": money(totals["income"] - totals["expense"]),
            "transfer": money(totals["transfer"]),
            "savings_deposit": money(totals["savings_deposit"]),
            "savings_withdraw": money(totals["savings_withdraw"]),
            "loan_given": money(totals["loan_given"]),
            "loan_taken": money(totals["loan_taken"]),
            "loan_payment": money(totals["loan_payment"]),
            "goal_contribution": money(totals["goal_contribution"]),
            "goal_withdraw": money(totals["goal_withdraw"]),
            "count": len(transactions),
        },
        "transactions": rows,
    }
def _excel_response(filename: str, sheet_name: str, rows: list[dict]):
    output = BytesIO()
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]

    if not rows:
        ws.append(["No data"])
    else:
        headers = list(rows[0].keys())
        ws.append(headers)

        for row in rows:
            ws.append([str(row.get(header, "") or "") for header in headers])

        for column_cells in ws.columns:
            max_length = 12
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                max_length = max(max_length, len(str(cell.value or "")))
            ws.column_dimensions[column_letter].width = min(max_length + 2, 45)

    wb.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.xlsx"'
        },
    )


def _pdf_response(filename: str, title: str, rows: list[dict]):
    output = BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        rightMargin=18,
        leftMargin=18,
        topMargin=18,
        bottomMargin=18,
    )

    styles = getSampleStyleSheet()
    elements = [
        Paragraph(title, styles["Title"]),
        Spacer(1, 12),
    ]

    if not rows:
        elements.append(Paragraph("No data", styles["Normal"]))
    else:
        headers = list(rows[0].keys())
        data = [headers]

        for row in rows:
            data.append(
                [
                    str(row.get(header, "") or "")[:60]
                    for header in headers
                ]
            )

        table = Table(data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )

        elements.append(table)

    doc.build(elements)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.pdf"'
        },
    )


def _transaction_export_rows(report: dict) -> list[dict]:
    rows = []

    for item in report.get("transactions", []):
        wallet = item.get("wallet") or {}
        category = item.get("category") or {}
        transfer = item.get("transfer") or {}

        from_wallet = ""
        to_wallet = ""

        if transfer:
            from_wallet = (transfer.get("from_wallet") or {}).get("name", "")
            to_wallet = (transfer.get("to_wallet") or {}).get("name", "")

        rows.append(
            {
                "Date": item.get("created_at"),
                "Type": item.get("transaction_type"),
                "Amount": item.get("amount"),
                "Currency": item.get("currency"),
                "Wallet": wallet.get("name", ""),
                "From Wallet": from_wallet,
                "To Wallet": to_wallet,
                "Category": category.get("name_en", ""),
                "Description": item.get("description", ""),
                "Status": item.get("status"),
                "Transaction ID": item.get("transaction_id"),
            }
        )

    return rows


def _cashflow_export_rows(report: dict) -> list[dict]:
    rows = []

    rows.append({"Section": "SUMMARY", "Name": "Total Inflow", "Amount": report["summary"]["total_inflow"]})
    rows.append({"Section": "SUMMARY", "Name": "Total Outflow", "Amount": report["summary"]["total_outflow"]})
    rows.append({"Section": "SUMMARY", "Name": "Net Cashflow", "Amount": report["summary"]["net_cashflow"]})
    rows.append({"Section": "SUMMARY", "Name": "Transaction Count", "Amount": report["summary"]["transaction_count"]})

    for item in report.get("monthly_cashflow", []):
        rows.append(
            {
                "Section": "MONTHLY",
                "Name": item.get("month"),
                "Inflow": item.get("inflow"),
                "Outflow": item.get("outflow"),
                "Net": item.get("net"),
            }
        )

    for item in report.get("income_categories", []):
        rows.append(
            {
                "Section": "INCOME CATEGORY",
                "Name": item.get("name_en"),
                "Amount": item.get("total_amount"),
            }
        )

    for item in report.get("expense_categories", []):
        rows.append(
            {
                "Section": "EXPENSE CATEGORY",
                "Name": item.get("name_en"),
                "Amount": item.get("total_amount"),
            }
        )

    for item in report.get("wallet_cashflow", []):
        rows.append(
            {
                "Section": "WALLET",
                "Name": item.get("name"),
                "Inflow": item.get("inflow"),
                "Outflow": item.get("outflow"),
                "Net": item.get("net"),
            }
        )

    return rows


def _goal_export_rows(report: dict) -> list[dict]:
    rows = []

    for goal in report.get("goals", []):
        rows.append(
            {
                "Goal Name": goal.get("goal_name"),
                "Goal Type": goal.get("goal_type"),
                "Target Amount": goal.get("target_amount"),
                "Current Amount": goal.get("current_amount"),
                "Progress %": goal.get("progress_percent"),
                "Contribution Total": goal.get("contribution_total"),
                "Withdraw Total": goal.get("withdraw_total"),
                "Net Contribution": goal.get("net_contribution"),
                "Currency": goal.get("currency"),
                "Target Date": goal.get("target_date"),
                "Status": goal.get("status"),
                "Note": goal.get("note"),
            }
        )

    return rows


@router.get("/transactions/{family_id}/export/excel")
def export_transactions_excel(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    transaction_type: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    wallet_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        category_id=category_id,
        wallet_id=wallet_id,
        limit=500,
        offset=0,
        db=db,
        current_user=current_user,
    )

    return _excel_response(
        filename="s4_transaction_report",
        sheet_name="Transactions",
        rows=_transaction_export_rows(report),
    )


@router.get("/transactions/{family_id}/export/pdf")
def export_transactions_pdf(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    transaction_type: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    wallet_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        category_id=category_id,
        wallet_id=wallet_id,
        limit=500,
        offset=0,
        db=db,
        current_user=current_user,
    )

    return _pdf_response(
        filename="s4_transaction_report",
        title="S4 Transaction Report",
        rows=_transaction_export_rows(report),
    )


@router.get("/cashflow/{family_id}/export/excel")
def export_cashflow_excel(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = cashflow_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )

    return _excel_response(
        filename="s4_cashflow_report",
        sheet_name="Cashflow",
        rows=_cashflow_export_rows(report),
    )


@router.get("/cashflow/{family_id}/export/pdf")
def export_cashflow_pdf(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = cashflow_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )

    return _pdf_response(
        filename="s4_cashflow_report",
        title="S4 Cashflow Report",
        rows=_cashflow_export_rows(report),
    )


@router.get("/goals/{family_id}/export/excel")
def export_goals_excel(
    family_id: str,
    goal_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = goal_report(
        family_id=family_id,
        goal_id=goal_id,
        start_date=start_date,
        end_date=end_date,
        limit=1000,
        offset=0,
        db=db,
        current_user=current_user,
    )

    return _excel_response(
        filename="s4_goal_report",
        sheet_name="Goals",
        rows=_goal_export_rows(report),
    )


@router.get("/goals/{family_id}/export/pdf")
def export_goals_pdf(
    family_id: str,
    goal_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = goal_report(
        family_id=family_id,
        goal_id=goal_id,
        start_date=start_date,
        end_date=end_date,
        limit=1000,
        offset=0,
        db=db,
        current_user=current_user,
    )

    return _pdf_response(
        filename="s4_goal_report",
        title="S4 Goal Report",
        rows=_goal_export_rows(report),
    )