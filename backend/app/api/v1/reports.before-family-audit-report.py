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
from app.models.family import Family
from app.models.currency import ExchangeRate
from app.models.audit_log import AuditLog
from app.services.permission_service import require_permission
from io import BytesIO
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

router = APIRouter(prefix="/reports", tags=["Reports"])




def report_currency_rate(db: Session, from_currency: str, to_currency: str):
    if from_currency == to_currency:
        return Decimal("1")

    rate = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.deleted_at.is_(None),
            ExchangeRate.is_active.is_(True),
        )
        .order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if not rate:
        return Decimal("0")

    return Decimal(rate.rate)


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
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
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





@router.get("/income-currency/{family_id}")
def income_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "INCOME"
    ]

    total_original = Decimal("0")
    total_base = Decimal("0")
    rows = []
    monthly = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        total_original += amount
        total_base += converted

        month_key = tx.created_at.strftime("%Y-%m")
        if month_key not in monthly:
            monthly[month_key] = Decimal("0")
        monthly[month_key] += converted

        rows.append({
            "transaction_id": tx.id,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "category": serialize_category(db, tx.category_id),
            "wallet": transaction_wallet_info(db, tx)["wallet"],
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "transaction_count": len(transactions),
            "total_original_mixed": money(total_original),
            "total_income_base": money(total_base),
        },
        "monthly_income_base": [
            {
                "month": month,
                "total_income_base": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "transactions": rows,
    }




@router.get("/expense-currency/{family_id}")
def expense_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "EXPENSE"
    ]

    total_original = Decimal("0")
    total_base = Decimal("0")
    rows = []
    monthly = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        total_original += amount
        total_base += converted

        month_key = tx.created_at.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, Decimal("0")) + converted

        rows.append({
            "transaction_id": tx.id,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "category": serialize_category(db, tx.category_id),
            "wallet": transaction_wallet_info(db, tx)["wallet"],
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "transaction_count": len(transactions),
            "total_original_mixed": money(total_original),
            "total_expense_base": money(total_base),
        },
        "monthly_expense_base": [
            {
                "month": month,
                "total_expense_base": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "transactions": rows,
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





@router.get("/loans-currency/{family_id}")
def loan_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    total_principal_base = Decimal("0")
    total_paid_base = Decimal("0")
    total_remaining_base = Decimal("0")
    given_remaining_base = Decimal("0")
    taken_remaining_base = Decimal("0")

    rows = []

    for loan in loans:
        rate = report_currency_rate(db, loan.currency, base_currency)

        principal = Decimal(loan.principal_amount or 0)
        paid = Decimal(loan.paid_amount or 0)
        remaining = Decimal(loan.remaining_amount or 0)

        principal_base = principal * rate
        paid_base = paid * rate
        remaining_base = remaining * rate

        total_principal_base += principal_base
        total_paid_base += paid_base
        total_remaining_base += remaining_base

        if loan.loan_type == "GIVEN":
            given_remaining_base += remaining_base
        elif loan.loan_type == "TAKEN":
            taken_remaining_base += remaining_base

        rows.append({
            "loan_id": loan.id,
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "principal_amount": money(principal),
            "paid_amount": money(paid),
            "remaining_amount": money(remaining),
            "principal_base": money(principal_base),
            "paid_base": money(paid_base),
            "remaining_base": money(remaining_base),
            "status": loan.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "loan_count": len(loans),
            "total_principal_base": money(total_principal_base),
            "total_paid_base": money(total_paid_base),
            "total_remaining_base": money(total_remaining_base),
            "given_remaining_base": money(given_remaining_base),
            "taken_remaining_base": money(taken_remaining_base),
            "net_loan_position_base": money(given_remaining_base - taken_remaining_base),
        },
        "loans": rows,
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






@router.get("/transfer-currency/{family_id}")
def transfer_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "TRANSFER"
    ]

    total_original = Decimal("0")
    total_base = Decimal("0")

    monthly = {}
    rows = []

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        converted = amount * rate

        total_original += amount
        total_base += converted

        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = Decimal("0")

        monthly[month_key] += converted

        rows.append({
            "transaction_id": tx.id,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "transaction_count": len(transactions),
            "total_transfer_original": money(total_original),
            "total_transfer_base": money(total_base),
        },
        "monthly_transfer_base": [
            {
                "month": month,
                "total_transfer_base": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "transfers": rows,
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





@router.get("/budget-currency/{family_id}")
def budget_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    total_budget_base = Decimal("0")
    total_spent_base = Decimal("0")
    total_remaining_base = Decimal("0")

    def category_spent(category_id):
        total = Decimal("0")

        txs = (
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

        for tx in txs:
            total += Decimal(tx.amount or 0)

        return total

    for budget in budgets:
        budget_amount = Decimal(budget.budget_amount or 0)
        spent_amount = category_spent(budget.category_id)
        remaining_amount = budget_amount - spent_amount

        rate = report_currency_rate(
            db,
            budget.currency,
            base_currency,
        )

        budget_base = budget_amount * rate
        spent_base = spent_amount * rate
        remaining_base = remaining_amount * rate

        total_budget_base += budget_base
        total_spent_base += spent_base
        total_remaining_base += remaining_base

        rows.append({
            "budget_id": budget.id,
            "budget_name": budget.name,
            "currency": budget.currency,
            "base_currency": base_currency,
            "rate": money(rate),

            "budget_amount": money(budget_amount),
            "budget_amount_base": money(budget_base),

            "spent_amount": money(spent_amount),
            "spent_amount_base": money(spent_base),

            "remaining_amount": money(remaining_amount),
            "remaining_amount_base": money(remaining_base),

            "status": budget.status,
            "period_type": budget.period_type,
        })

    used_percent = "0.00"

    if total_budget_base > 0:
        used_percent = str(
            round(
                (total_spent_base / total_budget_base) * Decimal("100"),
                2,
            )
        )

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "budget_count": len(rows),
            "total_budget_base": money(total_budget_base),
            "total_spent_base": money(total_spent_base),
            "total_remaining_base": money(total_remaining_base),
            "used_percent": used_percent,
        },
        "budgets": rows,
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





@router.get("/net-worth-currency/{family_id}")
def net_worth_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    wallet_balance_base = Decimal("0")
    savings_amount_base = Decimal("0")
    goal_saved_base = Decimal("0")
    loan_given_base = Decimal("0")
    loan_taken_base = Decimal("0")

    wallet_rows = []
    savings_rows = []
    goal_rows = []
    loan_rows = []

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        wallet_balance_base += converted

        wallet_rows.append({
            "wallet_id": wallet.id,
            "wallet_name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    for item in savings:
        amount = Decimal(item.current_amount or 0)
        rate = report_currency_rate(db, item.currency, base_currency)
        converted = amount * rate
        savings_amount_base += converted

        savings_rows.append({
            "savings_id": item.id,
            "name": item.name,
            "currency": item.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        goal_saved_base += converted

        goal_rows.append({
            "goal_id": goal.id,
            "goal_name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            loan_given_base += converted
        elif loan.loan_type == "TAKEN":
            loan_taken_base += converted

        loan_rows.append({
            "loan_id": loan.id,
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "remaining_amount": money(amount),
            "rate": money(rate),
            "converted_remaining_amount": money(converted),
        })

    total_assets_base = wallet_balance_base + savings_amount_base + goal_saved_base
    net_loan_position_base = loan_given_base - loan_taken_base
    net_worth_base = total_assets_base + net_loan_position_base

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_balance_base": money(wallet_balance_base),
            "savings_amount_base": money(savings_amount_base),
            "goal_saved_amount_base": money(goal_saved_base),
            "total_assets_base": money(total_assets_base),
            "loan_given_base": money(loan_given_base),
            "loan_taken_base": money(loan_taken_base),
            "net_loan_position_base": money(net_loan_position_base),
            "net_worth_base": money(net_worth_base),
        },
        "wallets": wallet_rows,
        "savings": savings_rows,
        "goals": goal_rows,
        "loans": loan_rows,
    }














@router.get("/trial-balance-currency/{family_id}")
def trial_balance_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    debit_total = Decimal("0")
    credit_total = Decimal("0")
    rows = []

    def add_row(account_name, account_type, debit, credit):
        nonlocal debit_total, credit_total

        debit_total += debit
        credit_total += credit

        rows.append({
            "account_name": account_name,
            "account_type": account_type,
            "debit_base": money(debit),
            "credit_base": money(credit),
        })

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate

        if converted >= 0:
            add_row(wallet.name, "ASSET_WALLET", converted, Decimal("0"))
        else:
            add_row(wallet.name, "ASSET_WALLET", Decimal("0"), abs(converted))

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        add_row(saving.name, "ASSET_SAVINGS", converted, Decimal("0"))

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        add_row(goal.goal_name, "ASSET_GOAL", converted, Decimal("0"))

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            add_row(
                f"Loan Given - {loan.person_name}",
                "ASSET_RECEIVABLE",
                converted,
                Decimal("0"),
            )

        elif loan.loan_type == "TAKEN":
            add_row(
                f"Loan Taken - {loan.person_name}",
                "LIABILITY_PAYABLE",
                Decimal("0"),
                converted,
            )

    equity = debit_total - credit_total

    add_row(
        "Family Equity / Net Worth",
        "EQUITY",
        Decimal("0"),
        equity,
    )

    difference = debit_total - credit_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "debit_total": money(debit_total),
            "credit_total": money(credit_total),
            "difference": money(difference),
            "is_balanced": difference == Decimal("0"),
        },
        "rows": rows,
    }




@router.get("/profit-loss-currency/{family_id}")
def profit_loss_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    txs = get_posted_transactions(db, family_id, start_date, end_date)

    income_total = Decimal("0")
    expense_total = Decimal("0")

    income_by_category = {}
    expense_by_category = {}

    for tx in txs:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        category_key = tx.category_id or "UNCATEGORIZED"

        if tx.transaction_type == "INCOME":
            income_total += converted
            income_by_category[category_key] = income_by_category.get(category_key, Decimal("0")) + converted

        elif tx.transaction_type == "EXPENSE":
            expense_total += converted
            expense_by_category[category_key] = expense_by_category.get(category_key, Decimal("0")) + converted

    net_profit = income_total - expense_total

    income_rows = []
    for category_id, total in income_by_category.items():
        income_rows.append({
            "category": serialize_category(db, None if category_id == "UNCATEGORIZED" else category_id),
            "amount_base": money(total),
        })

    expense_rows = []
    for category_id, total in expense_by_category.items():
        expense_rows.append({
            "category": serialize_category(db, None if category_id == "UNCATEGORIZED" else category_id),
            "amount_base": money(total),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income_base": money(income_total),
            "total_expense_base": money(expense_total),
            "net_profit_base": money(net_profit),
            "profit_margin_percent": percent(net_profit, income_total),
        },
        "income_by_category": sorted(
            income_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
        "expense_by_category": sorted(
            expense_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
    }




@router.get("/balance-sheet-currency/{family_id}")
def balance_sheet_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    assets_total = Decimal("0")
    liabilities_total = Decimal("0")
    equity_total = Decimal("0")

    current_assets = []
    savings_assets = []
    goal_assets = []
    receivables = []
    liabilities = []

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        assets_total += converted

        current_assets.append({
            "account_id": wallet.id,
            "name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        assets_total += converted

        savings_assets.append({
            "savings_id": saving.id,
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        assets_total += converted

        goal_assets.append({
            "goal_id": goal.id,
            "name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            assets_total += converted
            receivables.append({
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "currency": loan.currency,
                "amount": money(amount),
                "rate": money(rate),
                "converted_amount": money(converted),
            })

        elif loan.loan_type == "TAKEN":
            liabilities_total += converted
            liabilities.append({
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "currency": loan.currency,
                "amount": money(amount),
                "rate": money(rate),
                "converted_amount": money(converted),
            })

    equity_total = assets_total - liabilities_total

    balanced = assets_total == liabilities_total + equity_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "balance_sheet": {
            "assets_total": money(assets_total),
            "liabilities_total": money(liabilities_total),
            "equity_total": money(equity_total),
            "liabilities_plus_equity": money(liabilities_total + equity_total),
            "balanced": balanced,
        },
        "assets": {
            "current_assets": current_assets,
            "savings_assets": savings_assets,
            "goal_assets": goal_assets,
            "receivables": receivables,
        },
        "liabilities": liabilities,
        "equity": {
            "family_net_worth": money(equity_total),
        },
    }




@router.get("/financial-statement-currency/{family_id}")
def financial_statement_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    transactions = get_posted_transactions(db, family_id, None, None)

    wallet_total = Decimal("0")
    savings_total = Decimal("0")
    goal_total = Decimal("0")
    loan_given_total = Decimal("0")
    loan_taken_total = Decimal("0")
    income_total = Decimal("0")
    expense_total = Decimal("0")
    transfer_total = Decimal("0")

    asset_rows = []
    receivable_rows = []
    liability_rows = []

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        wallet_total += converted

        asset_rows.append({
            "type": "WALLET",
            "id": wallet.id,
            "name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        savings_total += converted

        asset_rows.append({
            "type": "SAVINGS",
            "id": saving.id,
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        goal_total += converted

        asset_rows.append({
            "type": "GOAL",
            "id": goal.id,
            "name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        row = {
            "type": loan.loan_type,
            "id": loan.id,
            "person_name": loan.person_name,
            "currency": loan.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        }

        if loan.loan_type == "GIVEN":
            loan_given_total += converted
            receivable_rows.append(row)

        elif loan.loan_type == "TAKEN":
            loan_taken_total += converted
            liability_rows.append(row)

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        if tx.transaction_type == "INCOME":
            income_total += converted
        elif tx.transaction_type == "EXPENSE":
            expense_total += converted
        elif tx.transaction_type == "TRANSFER":
            transfer_total += converted

    total_assets = wallet_total + savings_total + goal_total
    total_receivables = loan_given_total
    total_liabilities = loan_taken_total
    cashflow = income_total - expense_total
    net_worth = total_assets + total_receivables - total_liabilities

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "statement": {
            "assets": {
                "wallets": money(wallet_total),
                "savings": money(savings_total),
                "goals": money(goal_total),
                "total_assets": money(total_assets),
            },
            "receivables": {
                "loan_given": money(total_receivables),
            },
            "liabilities": {
                "loan_taken": money(total_liabilities),
            },
            "profit_loss": {
                "income": money(income_total),
                "expense": money(expense_total),
                "cashflow": money(cashflow),
                "transfer": money(transfer_total),
            },
            "net_worth": money(net_worth),
        },
        "assets_detail": asset_rows,
        "receivables_detail": receivable_rows,
        "liabilities_detail": liability_rows,
    }




@router.get("/dashboard-currency/{family_id}")
def report_dashboard_currency(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    txs = get_posted_transactions(db, family_id, None, None)

    income_base = Decimal("0")
    expense_base = Decimal("0")
    transfer_base = Decimal("0")
    monthly = {}

    for tx in txs:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate
        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
                "transfer": Decimal("0"),
                "cashflow": Decimal("0"),
            }

        if tx.transaction_type == "INCOME":
            income_base += converted
            monthly[month_key]["income"] += converted

        elif tx.transaction_type == "EXPENSE":
            expense_base += converted
            monthly[month_key]["expense"] += converted

        elif tx.transaction_type == "TRANSFER":
            transfer_base += converted
            monthly[month_key]["transfer"] += converted

    for month in monthly.values():
        month["cashflow"] = month["income"] - month["expense"]

    cashflow_base = income_base - expense_base

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "total_income_base": money(income_base),
            "total_expense_base": money(expense_base),
            "cashflow_base": money(cashflow_base),
            "total_transfer_base": money(transfer_base),
            "transaction_count": len(txs),
        },
        "monthly": [
            {
                "month": month,
                "income_base": money(values["income"]),
                "expense_base": money(values["expense"]),
                "cashflow_base": money(values["cashflow"]),
                "transfer_base": money(values["transfer"]),
            }
            for month, values in sorted(monthly.items())
        ],
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



@router.get("/goal-analytics/{family_id}")
def goal_analytics_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    active_count = 0
    completed_count = 0
    closed_count = 0

    total_target = Decimal("0")
    total_saved = Decimal("0")

    rows = []

    for goal in goals:
        target = Decimal(goal.target_amount or 0)
        saved = Decimal(goal.current_amount or 0)

        total_target += target
        total_saved += saved

        progress = Decimal("0")
        if target > 0:
            progress = (saved / target) * Decimal("100")

        if goal.status == "ACTIVE":
            active_count += 1
        elif goal.status == "COMPLETED":
            completed_count += 1
        else:
            closed_count += 1

        rows.append(
            {
                "goal_id": goal.id,
                "goal_name": goal.goal_name,
                "goal_type": goal.goal_type,
                "target_amount": money(target),
                "saved_amount": money(saved),
                "remaining_amount": money(target - saved),
                "progress_percent": str(round(progress, 2)),
                "status": goal.status,
                "target_date": goal.target_date,
            }
        )

    overall_progress = Decimal("0")
    if total_target > 0:
        overall_progress = (total_saved / total_target) * Decimal("100")

    return {
        "family_id": family_id,
        "summary": {
            "total_goals": len(goals),
            "active_goals": active_count,
            "completed_goals": completed_count,
            "closed_goals": closed_count,
            "total_target_amount": money(total_target),
            "total_saved_amount": money(total_saved),
            "overall_progress_percent": str(round(overall_progress, 2)),
        },
        "goals": sorted(
            rows,
            key=lambda x: float(x["progress_percent"]),
            reverse=True,
        ),
    }







@router.get("/savings-currency/{family_id}")
def savings_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    savings_goals = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")
    rows = []

    for saving in savings_goals:
        rate = report_currency_rate(
            db,
            saving.currency,
            base_currency,
        )

        target_amount = Decimal(saving.target_amount or 0)
        current_amount = Decimal(saving.current_amount or 0)

        target_base = target_amount * rate
        current_base = current_amount * rate

        total_target_base += target_base
        total_current_base += current_base

        rows.append({
            "savings_id": saving.id,
            "name": saving.name,
            "goal_type": saving.goal_type,
            "currency": saving.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(target_amount),
            "current_amount": money(current_amount),
            "target_base": money(target_base),
            "current_base": money(current_base),
            "progress_percent": percent(current_amount, target_amount),
            "status": saving.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "savings_count": len(savings_goals),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(
                total_current_base,
                total_target_base,
            ),
        },
        "savings": rows,
    }


@router.get("/goals-currency/{family_id}")
def goal_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")

    rows = []

    for goal in goals:

        goal_currency = getattr(goal, "currency", base_currency)

        rate = report_currency_rate(
            db,
            goal_currency,
            base_currency,
        )

        target_amount = Decimal(goal.target_amount or 0)
        current_amount = Decimal(goal.current_amount or 0)

        target_base = target_amount * rate
        current_base = current_amount * rate

        total_target_base += target_base
        total_current_base += current_base

        rows.append({
            "goal_id": goal.id,
            "goal_name": goal.goal_name,
            "currency": goal_currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(target_amount),
            "current_amount": money(current_amount),
            "target_base": money(target_base),
            "current_base": money(current_base),
            "progress_percent": percent(
                current_amount,
                target_amount,
            ),
            "status": goal.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "goal_count": len(goals),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(
                total_current_base,
                total_target_base,
            ),
        },
        "goals": rows,
    }


@router.get("/loan-analytics/{family_id}")
def loan_analytics_report(
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

    given_total = Decimal("0")
    taken_total = Decimal("0")

    given_remaining = Decimal("0")
    taken_remaining = Decimal("0")

    active_count = 0
    closed_count = 0

    rows = []

    for loan in loans:

        principal = Decimal(loan.principal_amount or 0)
        paid = Decimal(loan.paid_amount or 0)
        remaining = Decimal(loan.remaining_amount or 0)

        if loan.loan_type == "GIVEN":
            given_total += principal
            given_remaining += remaining
        else:
            taken_total += principal
            taken_remaining += remaining

        if loan.status == "ACTIVE":
            active_count += 1
        else:
            closed_count += 1

        recovery_rate = Decimal("0")

        if principal > 0:
            recovery_rate = (paid / principal) * Decimal("100")

        rows.append(
            {
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "loan_type": loan.loan_type,
                "principal_amount": money(principal),
                "paid_amount": money(paid),
                "remaining_amount": money(remaining),
                "recovery_rate": str(round(recovery_rate, 2)),
                "status": loan.status,
            }
        )

    overall_recovery = Decimal("0")

    total_principal = given_total + taken_total
    total_paid = total_principal - (given_remaining + taken_remaining)

    if total_principal > 0:
        overall_recovery = (total_paid / total_principal) * Decimal("100")

    return {
        "family_id": family_id,
        "summary": {
            "total_loans": len(loans),
            "active_loans": active_count,
            "closed_loans": closed_count,
            "given_total": money(given_total),
            "taken_total": money(taken_total),
            "given_remaining": money(given_remaining),
            "taken_remaining": money(taken_remaining),
            "overall_recovery_rate": str(round(overall_recovery, 2)),
        },
        "loans": sorted(
            rows,
            key=lambda x: float(x["recovery_rate"]),
            reverse=True,
        ),
    }



@router.get("/transaction-register/{family_id}")
def transaction_register_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    query = db.query(Transaction).filter(
        Transaction.family_id == family_id,
        Transaction.deleted_at.is_(None),
    )

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)

    if end_dt:
        query = query.filter(Transaction.created_at <= end_dt)

    if transaction_type:
        query = query.filter(
            Transaction.transaction_type == transaction_type
        )

    if status:
        query = query.filter(
            Transaction.status == status
        )

    transactions = (
        query.order_by(Transaction.created_at.desc())
        .all()
    )

    total_amount = Decimal("0")

    rows = []

    for tx in transactions:

        amount = Decimal(tx.amount or 0)
        total_amount += amount

        wallet_info = transaction_wallet_info(db, tx)

        rows.append(
            {
                "transaction_id": tx.id,
                "transaction_number": getattr(
                    tx,
                    "transaction_number",
                    None
                ),
                "transaction_type": tx.transaction_type,
                "amount": money(amount),
                "currency": tx.currency,
                "status": tx.status,
                "description": tx.description,
                "wallet": wallet_info["wallet"],
                "transfer": wallet_info["transfer"],
                "goal_id": getattr(tx, "goal_id", None),
                "loan_id": getattr(tx, "loan_id", None),
                "budget_id": getattr(tx, "budget_id", None),
                "created_at": tx.created_at,
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
            "transaction_type": transaction_type,
            "status": status,
        },
        "summary": {
            "transaction_count": len(rows),
            "total_amount": money(total_amount),
        },
        "transactions": rows,
    }



def _transaction_register_export_rows(report: dict) -> list[dict]:
    rows = []

    for tx in report.get("transactions", []):
        wallet = tx.get("wallet") or {}
        transfer = tx.get("transfer") or {}

        from_wallet = ""
        to_wallet = ""

        if transfer:
            from_wallet = (transfer.get("from_wallet") or {}).get("name", "")
            to_wallet = (transfer.get("to_wallet") or {}).get("name", "")

        rows.append(
            {
                "Date": tx.get("created_at"),
                "Transaction ID": tx.get("transaction_id"),
                "Transaction Number": tx.get("transaction_number") or "",
                "Type": tx.get("transaction_type"),
                "Amount": tx.get("amount"),
                "Currency": tx.get("currency"),
                "Status": tx.get("status"),
                "Wallet": wallet.get("name", ""),
                "From Wallet": from_wallet,
                "To Wallet": to_wallet,
                "Goal ID": tx.get("goal_id") or "",
                "Loan ID": tx.get("loan_id") or "",
                "Budget ID": tx.get("budget_id") or "",
                "Description": tx.get("description") or "",
            }
        )

    return rows


@router.get("/transaction-register/{family_id}/export/excel")
def export_transaction_register_excel(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_register_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        status=status,
        db=db,
        current_user=current_user,
    )

    return _excel_response(
        filename="s4_transaction_register",
        sheet_name="Transaction Register",
        rows=_transaction_register_export_rows(report),
    )


@router.get("/transaction-register/{family_id}/export/pdf")
def export_transaction_register_pdf(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_register_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        status=status,
        db=db,
        current_user=current_user,
    )

    return _pdf_response(
        filename="s4_transaction_register",
        title="S4 Transaction Register Report",
        rows=_transaction_register_export_rows(report),
    )




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

@router.get("/cash-flow-currency/{family_id}")
def cash_flow_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    txs = get_posted_transactions(
        db,
        family_id,
        start_date,
        end_date,
    )

    operating_inflow = Decimal("0")
    operating_outflow = Decimal("0")
    transfer_total = Decimal("0")

    monthly = {}

    for tx in txs:

        amount = Decimal(tx.amount or 0)

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        converted = amount * rate

        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = {
                "inflow": Decimal("0"),
                "outflow": Decimal("0"),
                "transfer": Decimal("0"),
            }

        if tx.transaction_type == "INCOME":
            operating_inflow += converted
            monthly[month_key]["inflow"] += converted

        elif tx.transaction_type == "EXPENSE":
            operating_outflow += converted
            monthly[month_key]["outflow"] += converted

        elif tx.transaction_type == "TRANSFER":
            transfer_total += converted
            monthly[month_key]["transfer"] += converted

    net_cash_flow = operating_inflow - operating_outflow

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "operating_inflow_base": money(operating_inflow),
            "operating_outflow_base": money(operating_outflow),
            "net_cash_flow_base": money(net_cash_flow),
            "transfer_base": money(transfer_total),
        },
        "monthly": [
            {
                "month": month,
                "inflow_base": money(data["inflow"]),
                "outflow_base": money(data["outflow"]),
                "net_cash_flow_base": money(
                    data["inflow"] - data["outflow"]
                ),
                "transfer_base": money(data["transfer"]),
            }
            for month, data in sorted(monthly.items())
        ],
    }

@router.get("/family-summary-currency/{family_id}")
def family_summary_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
        Account.is_active.is_(True),
    ).all()

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    transactions = get_posted_transactions(
        db,
        family_id,
        None,
        None,
    )

    wallet_total = Decimal("0")
    savings_total = Decimal("0")
    goal_total = Decimal("0")
    loan_given_total = Decimal("0")
    loan_taken_total = Decimal("0")

    income_total = Decimal("0")
    expense_total = Decimal("0")
    transfer_total = Decimal("0")

    for account in accounts:
        rate = report_currency_rate(
            db,
            account.currency,
            base_currency,
        )

        wallet_total += (
            Decimal(account.current_balance or 0) * rate
        )

    for item in savings:
        rate = report_currency_rate(
            db,
            item.currency,
            base_currency,
        )

        savings_total += (
            Decimal(item.current_amount or 0) * rate
        )

    for item in goals:
        currency = getattr(
            item,
            "currency",
            base_currency,
        )

        rate = report_currency_rate(
            db,
            currency,
            base_currency,
        )

        goal_total += (
            Decimal(item.current_amount or 0) * rate
        )

    for loan in loans:
        rate = report_currency_rate(
            db,
            loan.currency,
            base_currency,
        )

        remaining = (
            Decimal(loan.remaining_amount or 0)
            * rate
        )

        if loan.loan_type == "GIVEN":
            loan_given_total += remaining
        else:
            loan_taken_total += remaining

    for tx in transactions:

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        converted = (
            Decimal(tx.amount or 0)
            * rate
        )

        if tx.transaction_type == "INCOME":
            income_total += converted

        elif tx.transaction_type == "EXPENSE":
            expense_total += converted

        elif tx.transaction_type == "TRANSFER":
            transfer_total += converted

    net_cash_flow = income_total - expense_total

    net_worth = (
        wallet_total
        + savings_total
        + goal_total
        + loan_given_total
        - loan_taken_total
    )

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_balance_base": money(wallet_total),
            "savings_balance_base": money(savings_total),
            "goal_balance_base": money(goal_total),
            "loan_given_base": money(loan_given_total),
            "loan_taken_base": money(loan_taken_total),
            "income_base": money(income_total),
            "expense_base": money(expense_total),
            "transfer_base": money(transfer_total),
            "net_cash_flow_base": money(net_cash_flow),
            "net_worth_base": money(net_worth),
        },
        "counts": {
            "wallets": len(accounts),
            "savings": len(savings),
            "goals": len(goals),
            "loans": len(loans),
            "transactions": len(transactions),
        },
    }



@router.get("/member-contribution-currency/{family_id}")
def member_contribution_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    members = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    transactions = get_posted_transactions(
        db,
        family_id,
        start_date,
        end_date,
    )

    member_map = {}

    for member in members:
        member_map[member.id] = {
            "member_id": member.id,
            "user_id": member.user_id,
            "member_name": member.user.full_name if member.user else None,
            "role": member.role,
            "relationship": member.relationship_display_label,
            "income_base": Decimal("0"),
            "expense_base": Decimal("0"),
            "transfer_base": Decimal("0"),
            "savings_deposit_base": Decimal("0"),
            "savings_withdraw_base": Decimal("0"),
            "loan_given_base": Decimal("0"),
            "loan_taken_base": Decimal("0"),
            "transaction_count": 0,
        }

    for tx in transactions:
        member_id = tx.created_by_member_id

        if member_id not in member_map:
            continue

        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )
        converted = amount * rate

        tx_type = (tx.transaction_type or "").upper()

        row = member_map[member_id]
        row["transaction_count"] += 1

        if tx_type == "INCOME":
            row["income_base"] += converted

        elif tx_type == "EXPENSE":
            row["expense_base"] += converted

        elif tx_type == "TRANSFER":
            row["transfer_base"] += converted

        elif tx_type == "SAVINGS_DEPOSIT":
            row["savings_deposit_base"] += converted

        elif tx_type == "SAVINGS_WITHDRAW":
            row["savings_withdraw_base"] += converted

        elif tx_type == "LOAN_GIVEN":
            row["loan_given_base"] += converted

        elif tx_type == "LOAN_TAKEN":
            row["loan_taken_base"] += converted

    total_income = Decimal("0")
    total_expense = Decimal("0")
    total_net = Decimal("0")
    rows = []

    for row in member_map.values():
        net_contribution = (
            row["income_base"]
            - row["expense_base"]
            - row["savings_deposit_base"]
            + row["savings_withdraw_base"]
            - row["loan_given_base"]
            + row["loan_taken_base"]
        )

        total_income += row["income_base"]
        total_expense += row["expense_base"]
        total_net += net_contribution

        rows.append({
            "member_id": row["member_id"],
            "user_id": row["user_id"],
            "member_name": row["member_name"],
            "role": row["role"],
            "relationship": row["relationship"],
            "income_base": money(row["income_base"]),
            "expense_base": money(row["expense_base"]),
            "transfer_base": money(row["transfer_base"]),
            "savings_deposit_base": money(row["savings_deposit_base"]),
            "savings_withdraw_base": money(row["savings_withdraw_base"]),
            "loan_given_base": money(row["loan_given_base"]),
            "loan_taken_base": money(row["loan_taken_base"]),
            "net_contribution_base": money(net_contribution),
            "transaction_count": row["transaction_count"],
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "member_count": len(rows),
            "total_income_base": money(total_income),
            "total_expense_base": money(total_expense),
            "total_net_contribution_base": money(total_net),
        },
        "members": sorted(
            rows,
            key=lambda x: Decimal(x["net_contribution_base"]),
            reverse=True,
        ),
    }

@router.get("/category-analytics-currency/{family_id}")
def category_analytics_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    transactions = get_posted_transactions(
        db,
        family_id,
        start_date,
        end_date,
    )

    income_categories = {}
    expense_categories = {}

    total_income = Decimal("0")
    total_expense = Decimal("0")

    for tx in transactions:

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        amount_base = Decimal(tx.amount or 0) * rate

        category = serialize_category(
            db,
            tx.category_id,
        )

        category_key = tx.category_id or "UNCATEGORIZED"

        if tx.transaction_type == "INCOME":

            total_income += amount_base

            if category_key not in income_categories:
                income_categories[category_key] = {
                    "category": category,
                    "amount": Decimal("0"),
                }

            income_categories[category_key]["amount"] += amount_base

        elif tx.transaction_type == "EXPENSE":

            total_expense += amount_base

            if category_key not in expense_categories:
                expense_categories[category_key] = {
                    "category": category,
                    "amount": Decimal("0"),
                }

            expense_categories[category_key]["amount"] += amount_base

    income_rows = []

    for row in income_categories.values():

        percent_value = Decimal("0")

        if total_income > 0:
            percent_value = (
                row["amount"] / total_income
            ) * Decimal("100")

        income_rows.append({
            "category": row["category"],
            "amount_base": money(row["amount"]),
            "percent": str(
                round(percent_value, 2)
            ),
        })

    expense_rows = []

    for row in expense_categories.values():

        percent_value = Decimal("0")

        if total_expense > 0:
            percent_value = (
                row["amount"] / total_expense
            ) * Decimal("100")

        expense_rows.append({
            "category": row["category"],
            "amount_base": money(row["amount"]),
            "percent": str(
                round(percent_value, 2)
            ),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income_base": money(total_income),
            "total_expense_base": money(total_expense),
            "income_category_count": len(income_rows),
            "expense_category_count": len(expense_rows),
        },
        "income_categories": sorted(
            income_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
        "expense_categories": sorted(
            expense_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
    }

@router.get("/member-performance-ranking/{family_id}")
def member_performance_ranking_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)
    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    members = db.query(FamilyMember).filter(
        FamilyMember.family_id == family_id,
        FamilyMember.deleted_at.is_(None),
    ).all()

    transactions = get_posted_transactions(db, family_id, start_date, end_date)

    rows = {}

    for member in members:
        rows[member.id] = {
            "member_id": member.id,
            "member_name": member.user.full_name if member.user else None,
            "role": member.role,
            "relationship": member.relationship_display_label,
            "income": Decimal("0"),
            "expense": Decimal("0"),
            "savings": Decimal("0"),
            "loan_given": Decimal("0"),
            "loan_taken": Decimal("0"),
            "transactions": 0,
        }

    for tx in transactions:
        if tx.created_by_member_id not in rows:
            continue

        rate = report_currency_rate(db, tx.currency, base_currency)
        amount = Decimal(tx.amount or 0) * rate
        row = rows[tx.created_by_member_id]
        row["transactions"] += 1

        tx_type = (tx.transaction_type or "").upper()

        if tx_type == "INCOME":
            row["income"] += amount
        elif tx_type == "EXPENSE":
            row["expense"] += amount
        elif tx_type == "SAVINGS_DEPOSIT":
            row["savings"] += amount
        elif tx_type == "LOAN_GIVEN":
            row["loan_given"] += amount
        elif tx_type == "LOAN_TAKEN":
            row["loan_taken"] += amount

    result = []

    for row in rows.values():
        score = (
            row["income"]
            - row["expense"]
            + row["savings"]
            - row["loan_given"]
            + row["loan_taken"]
        )

        result.append({
            "member_id": row["member_id"],
            "member_name": row["member_name"],
            "role": row["role"],
            "relationship": row["relationship"],
            "income_base": money(row["income"]),
            "expense_base": money(row["expense"]),
            "savings_base": money(row["savings"]),
            "loan_given_base": money(row["loan_given"]),
            "loan_taken_base": money(row["loan_taken"]),
            "performance_score_base": money(score),
            "transaction_count": row["transactions"],
        })

    ranked = sorted(
        result,
        key=lambda x: Decimal(x["performance_score_base"]),
        reverse=True,
    )

    for index, row in enumerate(ranked, start=1):
        row["rank"] = index

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "member_count": len(ranked),
        "ranking": ranked,
    }






@router.get("/family-audit/{family_id}")
def family_audit_report(
    family_id: str,
    action_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    query = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
    )

    if action_type:
        query = query.filter(AuditLog.action_type == action_type.upper())

    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type.upper())

    if severity:
        query = query.filter(AuditLog.severity == severity.upper())

    total_logs = query.count()

    logs = (
        query.order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    by_action = {}
    by_entity = {}
    by_severity = {}

    all_logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
        .all()
    )

    for item in all_logs:
        by_action[item.action_type] = by_action.get(item.action_type, 0) + 1
        by_entity[item.entity_type] = by_entity.get(item.entity_type, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1

    rows = []

    for item in logs:
        member = db.get(FamilyMember, item.member_id) if item.member_id else None

        rows.append({
            "audit_id": item.id,
            "member_id": item.member_id,
            "member_name": member.user.full_name if member and member.user else None,
            "role": member.role if member else None,
            "relationship": member.relationship_display_label if member else None,
            "action_type": item.action_type,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": item.title,
            "description": item.description,
            "severity": item.severity,
            "ip_address": item.ip_address,
            "user_agent": item.user_agent,
            "created_at": item.created_at,
        })

    return {
        "family_id": family_id,
        "filters": {
            "action_type": action_type,
            "entity_type": entity_type,
            "severity": severity,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "total_logs": total_logs,
            "by_action": by_action,
            "by_entity": by_entity,
            "by_severity": by_severity,
        },
        "logs": rows,
    }






@router.get("/general-ledger-currency/{family_id}")
def general_ledger_currency_report(
    family_id: str,
    account_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    lines_query = (
        db.query(TransactionLine, Transaction)
        .join(Transaction, TransactionLine.transaction_id == Transaction.id)
        .filter(
            Transaction.family_id == family_id,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
    )

    if account_id:
        lines_query = lines_query.filter(TransactionLine.account_id == account_id)

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        lines_query = lines_query.filter(Transaction.created_at >= start_dt)

    if end_dt:
        lines_query = lines_query.filter(Transaction.created_at <= end_dt)

    all_rows = (
        lines_query
        .order_by(Transaction.created_at.asc())
        .all()
    )

    debit_total_base = Decimal("0")
    credit_total_base = Decimal("0")
    running_balance_base = Decimal("0")

    rows = []

    for line, tx in all_rows:
        account = db.get(Account, line.account_id) if line.account_id else None

        debit = Decimal(line.debit or 0)
        credit = Decimal(line.credit or 0)

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        debit_base = debit * rate
        credit_base = credit * rate

        debit_total_base += debit_base
        credit_total_base += credit_base

        running_balance_base += debit_base - credit_base

        rows.append({
            "transaction_id": tx.id,
            "transaction_type": tx.transaction_type,
            "account_id": line.account_id,
            "account_name": account.name if account else None,
            "account_type": account.account_type if account else None,
            "description": tx.description,
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "debit": money(debit),
            "credit": money(credit),
            "debit_base": money(debit_base),
            "credit_base": money(credit_base),
            "running_balance_base": money(running_balance_base),
            "created_at": tx.created_at,
        })

    paginated_rows = rows[offset: offset + limit]

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "account_id": account_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "line_count": len(rows),
            "debit_total_base": money(debit_total_base),
            "credit_total_base": money(credit_total_base),
            "difference_base": money(debit_total_base - credit_total_base),
            "ending_balance_base": money(running_balance_base),
        },
        "ledger": paginated_rows,
    }






@router.get("/member-statement-currency/{family_id}")
def member_statement_currency_report(
    family_id: str,
    member_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    member_query = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
    )

    if member_id:
        member_query = member_query.filter(FamilyMember.id == member_id)

    members = member_query.all()

    member_map = {}

    for member in members:
        member_map[member.id] = {
            "member_id": member.id,
            "user_id": member.user_id,
            "member_name": member.user.full_name if member.user else None,
            "role": member.role,
            "relationship": member.relationship_display_label,
            "income_base": Decimal("0"),
            "expense_base": Decimal("0"),
            "transfer_base": Decimal("0"),
            "savings_deposit_base": Decimal("0"),
            "savings_withdraw_base": Decimal("0"),
            "goal_contribution_base": Decimal("0"),
            "goal_withdraw_base": Decimal("0"),
            "loan_given_base": Decimal("0"),
            "loan_given_payment_base": Decimal("0"),
            "loan_taken_base": Decimal("0"),
            "loan_taken_payment_base": Decimal("0"),
            "transactions": [],
        }

    txs = get_posted_transactions(db, family_id, start_date, end_date)

    for tx in txs:
        if tx.created_by_member_id not in member_map:
            continue

        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate
        tx_type = (tx.transaction_type or "").upper()

        row = member_map[tx.created_by_member_id]

        if tx_type == "INCOME":
            row["income_base"] += converted
        elif tx_type == "EXPENSE":
            row["expense_base"] += converted
        elif tx_type == "TRANSFER":
            row["transfer_base"] += converted
        elif tx_type == "SAVINGS_DEPOSIT":
            row["savings_deposit_base"] += converted
        elif tx_type == "SAVINGS_WITHDRAW":
            row["savings_withdraw_base"] += converted
        elif tx_type == "GOAL_CONTRIBUTION":
            row["goal_contribution_base"] += converted
        elif tx_type == "GOAL_WITHDRAW":
            row["goal_withdraw_base"] += converted
        elif tx_type == "LOAN_GIVEN":
            row["loan_given_base"] += converted
        elif tx_type == "LOAN_GIVEN_PAYMENT":
            row["loan_given_payment_base"] += converted
        elif tx_type == "LOAN_TAKEN":
            row["loan_taken_base"] += converted
        elif tx_type == "LOAN_TAKEN_PAYMENT":
            row["loan_taken_payment_base"] += converted

        row["transactions"].append({
            "transaction_id": tx.id,
            "transaction_type": tx.transaction_type,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    result = []

    for row in member_map.values():
        net_contribution = (
            row["income_base"]
            - row["expense_base"]
            - row["savings_deposit_base"]
            + row["savings_withdraw_base"]
            - row["goal_contribution_base"]
            + row["goal_withdraw_base"]
            - row["loan_given_base"]
            + row["loan_given_payment_base"]
            + row["loan_taken_base"]
            - row["loan_taken_payment_base"]
        )

        result.append({
            "member_id": row["member_id"],
            "user_id": row["user_id"],
            "member_name": row["member_name"],
            "role": row["role"],
            "relationship": row["relationship"],
            "summary": {
                "income_base": money(row["income_base"]),
                "expense_base": money(row["expense_base"]),
                "transfer_base": money(row["transfer_base"]),
                "savings_deposit_base": money(row["savings_deposit_base"]),
                "savings_withdraw_base": money(row["savings_withdraw_base"]),
                "goal_contribution_base": money(row["goal_contribution_base"]),
                "goal_withdraw_base": money(row["goal_withdraw_base"]),
                "loan_given_base": money(row["loan_given_base"]),
                "loan_given_payment_base": money(row["loan_given_payment_base"]),
                "loan_taken_base": money(row["loan_taken_base"]),
                "loan_taken_payment_base": money(row["loan_taken_payment_base"]),
                "net_contribution_base": money(net_contribution),
                "transaction_count": len(row["transactions"]),
            },
            "transactions": row["transactions"][offset: offset + limit],
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "member_id": member_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "offset": offset,
        },
        "member_count": len(result),
        "members": result,
    }






@router.get("/audit-analytics/{family_id}")
def audit_analytics_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    query = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
    )

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(AuditLog.created_at >= start_dt)

    if end_dt:
        query = query.filter(AuditLog.created_at <= end_dt)

    logs = query.order_by(AuditLog.created_at.desc()).all()

    by_action = {}
    by_entity = {}
    by_severity = {}
    by_member = {}
    by_day = {}

    for item in logs:
        by_action[item.action_type] = by_action.get(item.action_type, 0) + 1
        by_entity[item.entity_type] = by_entity.get(item.entity_type, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1

        day_key = item.created_at.strftime("%Y-%m-%d")
        by_day[day_key] = by_day.get(day_key, 0) + 1

        member_key = item.member_id or "SYSTEM"

        if member_key not in by_member:
            member = db.get(FamilyMember, item.member_id) if item.member_id else None

            by_member[member_key] = {
                "member_id": item.member_id,
                "member_name": member.user.full_name if member and member.user else "SYSTEM",
                "role": member.role if member else "SYSTEM",
                "relationship": member.relationship_display_label if member else None,
                "log_count": 0,
            }

        by_member[member_key]["log_count"] += 1

    latest_logs = []

    for item in logs[:20]:
        member = db.get(FamilyMember, item.member_id) if item.member_id else None

        latest_logs.append({
            "audit_id": item.id,
            "member_id": item.member_id,
            "member_name": member.user.full_name if member and member.user else None,
            "action_type": item.action_type,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": item.title,
            "severity": item.severity,
            "created_at": item.created_at,
        })

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_logs": len(logs),
            "by_action": by_action,
            "by_entity": by_entity,
            "by_severity": by_severity,
        },
        "member_activity": sorted(
            by_member.values(),
            key=lambda x: x["log_count"],
            reverse=True,
        ),
        "daily_activity": [
            {
                "date": day,
                "log_count": count,
            }
            for day, count in sorted(by_day.items())
        ],
        "latest_logs": latest_logs,
    }


