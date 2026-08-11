from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.budget import Budget
from app.models.goal import FinancialGoal
from app.models.loan import Loan
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction
from app.models.user import User
from app.models.family import Family
from app.models.currency import ExchangeRate
from app.services.permission_service import require_permission

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])




def get_rate_to_base(db, from_currency, to_currency):
    if from_currency == to_currency:
        return Decimal("1")

    rate = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
        )
        .order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if not rate:
        return Decimal("0")

    return Decimal(str(rate.rate))


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def percent(current, target):
    current = Decimal(current or 0)
    target = Decimal(target or 0)

    if target <= 0:
        return "0.00"

    return str(((current / target) * Decimal("100")).quantize(Decimal("0.01")))


@router.get("/{family_id}")
def dashboard_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .all()
    )

    savings_goals = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .all()
    )

    total_wallet_balance = sum(
        Decimal(account.current_balance or 0)
        for account in accounts
    )

    total_income = Decimal("0")
    total_expense = Decimal("0")
    total_transfer = Decimal("0")

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            total_income += amount
        elif tx.transaction_type == "EXPENSE":
            total_expense += amount
        elif tx.transaction_type == "TRANSFER":
            total_transfer += amount

    total_savings_target = sum(
        Decimal(goal.target_amount or 0)
        for goal in savings_goals
    )

    total_savings_current = sum(
        Decimal(goal.current_amount or 0)
        for goal in savings_goals
    )

    loan_given_remaining = Decimal("0")
    loan_taken_remaining = Decimal("0")

    for loan in loans:
        if loan.loan_type == "GIVEN":
            loan_given_remaining += Decimal(loan.remaining_amount or 0)
        elif loan.loan_type == "TAKEN":
            loan_taken_remaining += Decimal(loan.remaining_amount or 0)

    total_goal_target = sum(
        Decimal(goal.target_amount or 0)
        for goal in goals
    )

    total_goal_current = sum(
        Decimal(goal.current_amount or 0)
        for goal in goals
    )

    active_budget_count = 0
    over_budget_count = 0

    for budget in budgets:
        if budget.status == "ACTIVE":
            active_budget_count += 1

        if Decimal(budget.spent_amount or 0) > Decimal(budget.budget_amount or 0):
            over_budget_count += 1

    recent_transactions = sorted(
        transactions,
        key=lambda tx: tx.created_at,
        reverse=True,
    )[:10]

    return {
        "family_id": family_id,
        "summary": {
            "wallet_count": len(accounts),
            "total_wallet_balance": money(total_wallet_balance),
            "total_income": money(total_income),
            "total_expense": money(total_expense),
            "net_income_expense": money(total_income - total_expense),
            "total_transfer": money(total_transfer),
            "transaction_count": len(transactions),
        },
        "savings": {
            "goal_count": len(savings_goals),
            "total_target_amount": money(total_savings_target),
            "total_current_amount": money(total_savings_current),
            "overall_progress_percent": percent(
                total_savings_current,
                total_savings_target,
            ),
        },
        "loans": {
            "loan_count": len(loans),
            "loan_given_remaining": money(loan_given_remaining),
            "loan_taken_remaining": money(loan_taken_remaining),
            "net_loan_position": money(
                loan_given_remaining - loan_taken_remaining
            ),
        },
        "goals": {
            "goal_count": len(goals),
            "total_target_amount": money(total_goal_target),
            "total_current_amount": money(total_goal_current),
            "overall_progress_percent": percent(
                total_goal_current,
                total_goal_target,
            ),
        },
        "budgets": {
            "budget_count": len(budgets),
            "active_budget_count": active_budget_count,
            "over_budget_count": over_budget_count,
        },
        "wallets": [
            {
                "id": account.id,
                "name": account.name,
                "account_type": account.account_type,
                "balance": money(account.current_balance),
                "currency": account.currency,
                "is_owner_wallet": account.is_owner_wallet,
                "is_shared_family": account.is_shared_family,
            }
            for account in accounts
        ],
        "recent_transactions": [
            {
                "id": tx.id,
                "transaction_type": tx.transaction_type,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "description": tx.description,
                "created_at": tx.created_at,
            }
            for tx in recent_transactions
        ],
    }

@router.get("/{family_id}/currency")
def dashboard_currency_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )

    total_balance = Decimal("0")

    wallets = []

    for account in accounts:
        balance = Decimal(account.current_balance or 0)

        rate = get_rate_to_base(
            db,
            account.currency,
            base_currency,
        )

        converted = balance * rate

        total_balance += converted

        wallets.append({
            "wallet_name": account.name,
            "currency": account.currency,
            "balance": money(balance),
            "rate": money(rate),
            "converted_balance": money(converted),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "total_balance": money(total_balance),
        "wallets": wallets,
    }

